// 置き場（別の repo の pagetray。127.0.0.1 で待つ、ページと file を DB に持つサーバー）に頼む足場と、roster を動かす機械の控えの folder。
// roster page と roster file が使う。置き場は roster を動かす機械に 1 つで、project をまたいで同じなので、控えの folder と URL は設定（config.jsonc）でなく環境変数で替える。
// 置き場を起こす・止めるのは DevOps Engineer 担当（docs-site の運用のページの「ページの置き場（pagetray）」）。
// 置き場の API（ページと file を置く・探す・消す・返事の状態・レビューの印・送った記録の写し）は、いつも生成した pagetray の client で新しい API（pagetray 1.0.0 から。送った記録は 1.1.0 から）に送る（pagesRequest）。
// 答えは Reply の形（本文は記録を snake_case にした JSON の字・code は状態の数の字）にそろえ、呼ぶ側（page.ts）は替えない。
// ページと file の本文は URL の手の道なので、fetchTo・compareStored は curl で取る（curl で打つのは、この 2 つだけ）。
import type { HttpHandler } from '@smithy/core/protocols';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type * as Pagetray from '../../gen/pagetray-client/dist-types/index.js';
import { askingJapanese, clientConfig, pagetrayApi, sendOnce, toSnake, withoutAwsMiddleware } from '../clients.ts';
import type { Context } from '../context.ts';
import type { RoleRecord, TpmRecord } from '../roster.ts';
import { castlistUrl, issuerOf, sessionRef } from '../castlist.ts';
import { rolesConfigFile } from '../config.ts';
import { readRole, subjectOf } from '../roster.ts';
import { TpmError } from '../skill-sets.ts';
import { envOf } from '../env.ts';
import { rosterHome } from '../state.ts';

/** 置き場の URL の既定（container の port の publish の 127.0.0.1:8801）。 */
export const DEFAULT_PAGES_URL = 'http://127.0.0.1:8801';
/** 前の置き場（Nginx）の URL。前に置いたページの URL も、読む時は受ける。 */
export const LEGACY_PAGES_URLS = ['http://127.0.0.1:8800'];

/** 課題の Key として folder の名にしてよい字（path の外へ出ないように）。 */
export const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** 控えの folder の中の、project の folder の名にある字（状態の folder の名は - で始まる）。 */
export const PROJECT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
/** 置き場が受ける workspace の ID の形。 */
const WORKSPACE = /^[A-Za-z0-9:._-]{0,64}$/;
/** 置き場の答えを待つ秒数。 */
const TIMEOUT = '10';
/** 送った記録を写す要求（PutMessage）だけの、答えを待つミリ秒。送る命令のたびに出るので、置き場が応えない時に命令を長く待たせない。 */
const MESSAGE_WAIT = 2000;

/** 控えの folder。$ROSTER_PAGES_DIR、無ければ $XDG_DATA_HOME（それも無ければ ~/.local/share）の `roster/pages`（古い在り処の扱いは rosterHome）。 */
export function pagesDir(env: NodeJS.ProcessEnv): string {
  const given = envOf(env, 'PAGES_DIR');
  if (given) return given;
  return join(rosterHome(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), dir => existsSync(join(dir, 'pages'))), 'pages');
}

/** 置き場の URL（末尾の / は落とす）。$ROSTER_PAGES_URL、無ければ既定。 */
export function pagesUrl(env: NodeJS.ProcessEnv): string {
  return (envOf(env, 'PAGES_URL') || DEFAULT_PAGES_URL).replace(/\/+$/, '');
}

/** URL が置き場（今の URL か、前の置き場の URL）を指していれば、置き場の中の path（頭の / は無し。`?` と `#` から後は落とす）。違えば undefined。 */
export function inStore(env: NodeJS.ProcessEnv, url: string): string | undefined {
  const base = [pagesUrl(env), ...LEGACY_PAGES_URLS].find(b => url.startsWith(`${b}/`));
  return base === undefined ? undefined : url.slice(base.length + 1).replace(/[?#].*$/, '');
}

/** URL が置き場のページか file を指しているか。 */
export const isPageUrl = (env: NodeJS.ProcessEnv, url: string): boolean => inStore(env, url) !== undefined;

/** {@link pagesRequest} の答え。 */
export interface Reply {
  body: string
  /** HTTP の code（つながらなければ 000）。 */
  code: string
  /** 置き場が、送り手（actorRef）を castlist に登録の無い物として断った（400 の fieldList に /actorRef）。 */
  unknownSender?: boolean
  /** 置き場が 2xx を返したのに、本文を読めなかった時の状態の数（code は 000。応えない時と分けたい呼ぶ側が見る）。 */
  unreadable?: number
}

/** 置き場の物（ページか file）の本文を、URL で curl で取り、out の path に書く。HTTP の code を返す（つながらなければ 000）。 */
function fetchBody(ctx: Context, storePath: string, out: string): string {
  const result = ctx.exec('curl', ['-sS', '--max-time', TIMEOUT, '-w', '%{http_code}', '-o', out, `${pagesUrl(ctx.env)}${storePath}`]);
  const code = result.stdout.trim();
  return result.status !== 0 || code === '' ? '000' : code;
}

/**
 * 生成した pagetray の client を作る（pagetray の client を作る所は、ここだけ）。送り直さず、時間切れは本文を取る curl と同じ（TIMEOUT）。誤りの文は日本語を頼む（askingJapanese）。
 * requestHandler は試験が偽の HTTP を差し込む所。
 */
export function pagetrayClient(url: string, requestHandler?: HttpHandler): Pagetray.PagetrayClient {
  const { PagetrayClient } = pagetrayApi();
  return askingJapanese(withoutAwsMiddleware(new PagetrayClient(clientConfig(url, Number(TIMEOUT) * 1000, requestHandler))));
}

/**
 * 新しい置き場が、castlist に登録の無い送り手を断る訳の頭（pagetray の docs/src/next.md の「送り手」）。
 * 日本語の字で見分ける: roster はいつも日本語を頼む（clients.ts の askingJapanese）ので、置き場の既定の言語が英語でも、この字で届く（AI-48）。
 */
const UNREGISTERED = 'castlist に登録の無い送り手';

/**
 * 送り手を castlist に登録の無い物として断った答えか（senderRefused の「登録されてから打ち直す」の訳にする物）。fieldList に /actorRef があり、訳が UNREGISTERED で始まる時だけ。
 * actorRef の形の誤りも /actorRef の 400 だが、打ち直しても通らないので、「登録されてから打ち直す」の訳にしない。
 */
const unknownSender = (sent: { message: string, fields: string[] }): boolean => sent.fields.includes('/actorRef') && sent.message.startsWith(UNREGISTERED);

/** NotFound でない 404（UnknownOperationException・誤りの型の無い 404）の訳: この roster の呼ぶ操作を持たない置き場（定義より古い版）が答えた物。 */
const OUTDATED = '置き場が、この roster の呼ぶ操作を持たない（置き場（pagetray）の版が、この roster の .pagetray-version より古い。置き場の版を上げるよう roster ask devops で頼む）';

/**
 * 生成した pagetray の client で 1 つ送り（clients.ts の sendOnce。送る 1 回は wait ミリ秒（既定は TIMEOUT）で切る）、答えを Reply の形にする
 * （本文は shape で JSON の形にした字、code は状態の数）。答えの無い物と、2xx なのに本文を読めない答えは 000（つながらない時と同じ）。
 * 誤りの答えの本文は `{"error": <message>}`（reason が読む形）にする。送り手を断った 400（fieldList に /actorRef）には unknownSender を付ける。
 */
async function viaPagetray<O extends { $metadata: { httpStatusCode?: number } }>(ctx: Context, send: (client: Pagetray.PagetrayClient, api: typeof Pagetray, options: { abortSignal: AbortSignal }) => Promise<O>, shape: (out: O) => unknown, wait = Number(TIMEOUT) * 1000): Promise<Reply> {
  const sent = await sendOnce(() => ctx.clients.pagetray(pagesUrl(ctx.env)), (client, options) => send(client, pagetrayApi(), options), { server: 'pagetray', wait, outdated: OUTDATED });
  if (sent.kind === 'down') return { body: '', code: '000', ...(sent.status === undefined ? {} : { unreadable: sent.status }) };
  if (sent.kind === 'failed') return { body: JSON.stringify({ error: sent.message }), code: String(sent.code), ...(unknownSender(sent) ? { unknownSender: true } : {}) };
  return { body: JSON.stringify(shape(sent.out)), code: String(sent.out.$metadata.httpStatusCode ?? 200) };
}

/**
 * 新しい API の記録（ページか file）を、roster の記録の形にする（page.ts の PageRecord・file.ts の FileRecord。欄は snake_case）。番号 n は数に、送り手の actor は無ければ null（未確認）。
 * 置く答えの url・location は、記録に無いので落とす。
 */
function recordOf(record: object): Record<string, unknown> {
  const rest = Object.fromEntries(Object.entries(toSnake(record) as Record<string, unknown>).filter(([k]) => k !== 'url' && k !== 'location'));
  const sender = rest.sender as Record<string, unknown> | undefined;
  return { ...rest, n: Number(rest.n), ...(sender === undefined ? {} : { sender: { actor: null, ...sender } }) };
}

/**
 * 置き場の API の要求（引数は snake_case の名で書く。inputOf が新しい API の名にする）。返事の状態（state・on）とレビューの印は、ページ 1 枚（project・key・kind・n）を引数で名指す。
 * file を置く時の contentType は、file.ts の拡張子の表の Content-Type。
 * PutMessage（送った記録の写し。pagetray 1.1.0 から）は、project・id と送り手を引数で、記録の欄を message で渡す。
 */
export type PagesRequest =
  | { op: 'CreatePage', query: URLSearchParams, source: { file: string } | { text: string } }
  | { op: 'ListPages' | 'DeletePages' | 'ListFiles' | 'DeleteFiles' | 'SetReplyState', query: URLSearchParams }
  | { op: 'CreateFile', query: URLSearchParams, file: string, contentType: string }
  | { op: 'AddReviewMarks', query: URLSearchParams, marks: { verdict?: string, targets: string[] } }
  | { op: 'PutMessage', query: URLSearchParams, message: Omit<Pagetray.PutMessageCommandInput, 'project' | 'id' | 'actorIssuer' | 'actorRef'> };

/** 要求の引数の名 → 新しい API の名（ここに無い名は、どちらも同じ）。 */
const RENAMED: Record<string, string> = { created_at: 'createdAt', actor_issuer: 'actorIssuer', actor_ref: 'actorRef' };

/** 要求の引数を、新しい API の入力にする（時刻は Date）。 */
function inputOf(query: URLSearchParams, skip: string[] = []): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [name, value] of query) {
    if (skip.includes(name)) continue;
    const to = RENAMED[name] ?? name;
    input[to] = to === 'createdAt' ? new Date(value) : value;
  }
  return input;
}

/** 一覧の 1 頁の上限（新しい API の maxResults）。 */
const PAGE_MAX = 1000;

/**
 * 一覧（ListPages・ListFiles）を、limit の数まで nextToken で辿って読む（1 から 1000 に丸める。既定は 100）。sort の created_at は createdAt。
 * 答えは `{"pages": […]}`・`{"files": […]}` の形。
 */
async function listAll(ctx: Context, op: 'ListPages' | 'ListFiles', query: URLSearchParams): Promise<Reply> {
  const limit = Number.parseInt(query.get('limit') ?? '', 10);
  const want = Math.min(Math.max(Number.isNaN(limit) ? 100 : limit, 1), PAGE_MAX);
  const filter = inputOf(query, ['limit']);
  if (typeof filter.sort === 'string') filter.sort = filter.sort.replace('created_at', 'createdAt');
  const items = op === 'ListPages' ? 'pages' : 'files';
  const rows: Record<string, unknown>[] = [];
  let nextToken: string | undefined;
  do {
    const input = { ...filter, maxResults: want - rows.length, ...(nextToken === undefined ? {} : { nextToken }) };
    let token: string | undefined;
    const r = await viaPagetray<Pagetray.ListPagesCommandOutput | Pagetray.ListFilesCommandOutput>(
      ctx,
      (client, api, options) => op === 'ListPages'
        ? client.send(new api.ListPagesCommand(input as Pagetray.ListPagesCommandInput), options)
        : client.send(new api.ListFilesCommand(input as Pagetray.ListFilesCommandInput), options),
      (out) => {
        token = out.nextToken;
        return { [items]: ('pages' in out ? out.pages : out.files) ?? [] };
      },
    );
    if (r.code !== '200') return r;
    rows.push(...((JSON.parse(r.body) as Record<string, object[]>)[items] ?? []).map(recordOf));
    nextToken = token;
  } while (nextToken !== undefined && rows.length < want);
  return { body: JSON.stringify({ [items]: rows }), code: '200' };
}

/**
 * 置き場の API に頼む（ページと file を置く・探す・消す・返事の状態とレビューの印を書く・送った記録を写す）。生成した pagetray の client で送る。
 * 答えは Reply の形（記録は snake_case の欄の名。誤りは `{"error": …}` の本文）。
 */
export async function pagesRequest(ctx: Context, request: PagesRequest): Promise<Reply> {
  const input = inputOf(request.query);
  switch (request.op) {
    case 'CreatePage': {
      const { source } = request;
      const body = 'file' in source ? readFileSync(source.file) : Buffer.from(source.text);
      return viaPagetray(ctx, (client, api, options) => client.send(new api.CreatePageCommand({ ...input, body } as unknown as Pagetray.CreatePageCommandInput), options), recordOf);
    }
    case 'CreateFile': {
      const body = readFileSync(request.file);
      return viaPagetray(ctx, (client, api, options) => client.send(new api.CreateFileCommand({ ...input, contentType: request.contentType, body } as unknown as Pagetray.CreateFileCommandInput), options), recordOf);
    }
    case 'ListPages': case 'ListFiles': return listAll(ctx, request.op, request.query);
    case 'DeletePages':
      return viaPagetray(ctx, (client, api, options) => client.send(new api.DeletePagesCommand(input as unknown as Pagetray.DeletePagesCommandInput), options), out => ({ removed: out.removed ?? [] }));
    case 'DeleteFiles':
      return viaPagetray(ctx, (client, api, options) => client.send(new api.DeleteFilesCommand(input as unknown as Pagetray.DeleteFilesCommandInput), options), out => ({ removed: out.removed ?? [] }));
    case 'SetReplyState':
      return viaPagetray(ctx, (client, api, options) => client.send(new api.SetReplyStateCommand(input as unknown as Pagetray.SetReplyStateCommandInput), options), recordOf);
    case 'AddReviewMarks': {
      const { marks } = request;
      return viaPagetray(ctx, (client, api, options) => client.send(new api.AddReviewMarksCommand({ ...input, ...marks } as unknown as Pagetray.AddReviewMarksCommandInput), options), recordOf);
    }
    case 'PutMessage': {
      const { message } = request;
      // 答えの記録は使わない（呼ぶ側は、置けたか（201・200）だけを見る）。
      return viaPagetray(ctx, (client, api, options) => client.send(new api.PutMessageCommand({ ...input, ...message } as unknown as Pagetray.PutMessageCommandInput), options), () => ({}), MESSAGE_WAIT);
    }
  }
}

/** 置き場の誤りの答え（`{"error": "…"}`）から文を取り出す。JSON でなければ本文のまま。 */
export function reason(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === 'string') return parsed.error;
  }
  catch { /* JSON でない答えは、そのまま出す */ }
  return body.trim();
}

/** 置き場が応えない時の文。 */
export const down = (ctx: Context, what: string): TpmError =>
  new TpmError(`置き場（${pagesUrl(ctx.env)}）が応えません。${what}置き場を起こすよう roster ask devops で頼んでください`);

/**
 * 置く人を指す付随する id（要求の引数の `actor_issuer`・`actor_ref`。新しい API の actorIssuer・actorRef）。置き場は受けたその時に castlist に送り手を聞いて残す。
 * castlist の設定があり、$CLAUDE_CODE_SESSION_ID がある時だけ付ける（issuer と鍵は、session を登録する時と同じ）。どちらかが無ければ空（今までどおり付けない）。
 */
export function sender(ctx: Context): Record<string, string> {
  const sid = ctx.env.CLAUDE_CODE_SESSION_ID;
  if (castlistUrl(ctx) === undefined || !sid) return {};
  return { actor_issuer: issuerOf(ctx), actor_ref: sessionRef(sid) };
}

/**
 * 送り手を付けて置いた要求を、置き場が castlist に聞いた答えで断った時の文（what はページか file）。断っていなければ（送り手を付けていない・503 でも unknownSender でもない）undefined。
 * 503 は置き場が castlist に聞けない、unknownSender（fieldList に /actorRef のある 400）は castlist に登録の無い session。
 * どちらも置き場は何も置いていない。打ち直すのは担当で、roster は送り直さない。
 */
export function senderRefused(ctx: Context, query: URLSearchParams, reply: Pick<Reply, 'code' | 'unknownSender'>, what: string): TpmError | undefined {
  const { code } = reply;
  const ref = query.get('actor_ref');
  if (ref === null) return undefined;
  if (code === '503') return new TpmError(`置き場（${pagesUrl(ctx.env)}）が castlist に送り手を聞けませんでした（503）。${what}。castlist が起きてから打ち直してください。続く時は roster report incident で台帳に挙げてください`);
  if (reply.unknownSender === true) return new TpmError(`この session（${ref}）は castlist に登録が無いと、置き場が答えました（${code}）。${what}。session は guard が Bash・Monitor の前に登録するので、打ち直してください。続く時は roster report incident で台帳に挙げてください`);
  return undefined;
}

/** 自分の居場所の宛先（担当は名簿、TPM 担当は tpm.jsonc）。わからなければ空。 */
export function selfAddress(ctx: Context): string {
  const own = envOf(ctx.env, 'KEY');
  const record: RoleRecord | TpmRecord | undefined = own ? readRole(ctx, own) : ctx.state.read<TpmRecord>('tpm.jsonc');
  const address = record?.address ?? '';
  return WORKSPACE.test(address) ? address : '';
}

/**
 * 置く物の project と Key を確かめる。project は $ROSTER_PROJECT、無ければ今いる folder。roster を使う project の印（設定の file・TPM 担当が起きた印）が無い folder なら、
 * scratchpad などから打った置き間違い（その folder の名が別の project になる）なので止める。Key は keyOption、無ければ $ROSTER_KEY（担当）。
 */
export function requireKey(ctx: Context, keyOption?: string): string {
  if (!existsSync(rolesConfigFile(ctx.project)) && ctx.state.read('tpm.jsonc') === undefined) {
    throw new TpmError(`roster を使う project の folder ではありません: ${ctx.project}（.claude/roles/config.jsonc も、TPM 担当が起きた印も無い）。project の folder で打つか、$ROSTER_PROJECT に project の path を付けてください`);
  }
  // Staff Engineer 担当の席（名簿の Key は <課題の Key>.staff）は、見ている課題の Key の folder に置く。
  const own = envOf(ctx.env, 'KEY');
  const key = keyOption ?? (own === undefined ? undefined : subjectOf(readRole(ctx, own) ?? { key: own }));
  if (!key) throw new TpmError('課題の Key がわかりません。TPM 担当は --key <Key> を付けてください');
  if (!KEY.test(key)) throw new TpmError(`課題の Key に使えない字があります: ${key}`);
  return key;
}

/** 置き場の中の path（`/<project>/…`）の、控えの path。 */
export const localPath = (ctx: Context, storePath: string): string => join(pagesDir(ctx.env), ...storePath.split('/').filter(part => part !== ''));

/** 控えに写す。置き場の番号が正しいので、控えに別の中身が残っていたら（置き場を通さずに置かれた物）、消さずに退ける。 */
export function writeCopy(ctx: Context, path: string, body: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path) && !readFileSync(path).equals(body)) renameSync(path, `${path}.replaced-${ctx.now().toISOString().replaceAll(':', '')}`);
  writeFileSync(path, body);
}

/** 置き場の物（ページか file）を取り、控えの path に書く。200 のほかは書かず、途中の file も残さない。HTTP の code を返す。 */
// 今は curl を spawnSync で打つので、待つ物は無い。形だけ非同期にしておく（呼ぶ側を替えずに、Promise を返す HTTP の client に替えられるように）。
// eslint-disable-next-line @typescript-eslint/require-await
export async function fetchTo(ctx: Context, storePath: string, path: string): Promise<string> {
  mkdirSync(dirname(path), { recursive: true });
  const partial = `${path}.part-${process.pid}`;
  try {
    const code = fetchBody(ctx, storePath, partial);
    if (code === '200') renameSync(partial, path);
    return code;
  }
  finally {
    rmSync(partial, { force: true });
  }
}

/** 取り込みで、置き場にもうある番号（409）の中身を、控えと比べる。消した番号（410）なら removed、同じなら same、違えば conflict。 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function compareStored(ctx: Context, storePath: string, file: string): Promise<'removed' | 'same' | 'conflict'> {
  const copy = `${file}.check-${process.pid}`;
  try {
    const code = fetchBody(ctx, storePath, copy);
    if (code === '410') return 'removed';
    if (code !== '200') throw code === '000' ? down(ctx, '') : new TpmError(`置き場が ${storePath} に ${code} を返しました`);
    return readFileSync(copy).equals(readFileSync(file)) ? 'same' : 'conflict';
  }
  finally {
    rmSync(copy, { force: true });
  }
}

/** 控えの file か folder を消し、空になった上の folder（控えの folder の中だけ）も消す。 */
export function removeLocal(dir: string, path: string): void {
  rmSync(path, { recursive: true, force: true });
  for (let parent = dirname(path); parent.startsWith(`${dir}/`); parent = dirname(parent)) {
    if (!existsSync(parent) || readdirSync(parent).length > 0) break;
    rmdirSync(parent);
  }
}
