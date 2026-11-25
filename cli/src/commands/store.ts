// 置き場（別の repo の pagetray。127.0.0.1 で待つ、ページと file を DB に持つサーバー）に curl で頼む足場と、roster を動かす機械の控えの folder。
// roster page と roster file が使う。置き場は roster を動かす機械に 1 つで、project をまたいで同じなので、控えの folder と URL は設定（config.jsonc）でなく環境変数で替える。
// 置き場を起こす・止めるのは DevOps Engineer 担当（docs-site の運用のページの「ページの置き場（pagetray）」）。
// 設定の api.pagetray が next なら、置き場の API（ページと file を置く・探す・消す・返事の状態・レビューの印）と版は、生成した pagetray の client で新しい API に送る（pagesRequest・storeAtLeast。AI-36 の段 6c）。
// 答えは今の道の Reply の形（本文は今の API の JSON の字・code は状態の数の字）にそろえ、呼ぶ側（page.ts）は替えない。
// ページと file の本文の URL は新しい API でも同じ手の道なので、fetchTo・compareStored は curl のまま（next の時に curl で打つのは、この 2 つだけ）。
import type { HttpHandler } from '@smithy/core/protocols';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type * as Pagetray from '../../gen/pagetray-client/dist-types/index.js';
import { clientConfig, nextApi, pagetrayApi, sendOnce, toSnake, withoutAwsMiddleware } from '../clients.ts';
import type { Context } from '../context.ts';
import type { ExecResult } from '../exec.ts';
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

/** この cli が話せる、置き場の API の版（pagetray の docs/src/api.md。置き場は、どの答えにも header `Pagetray-Api` で自分の版を付ける）。 */
export const PAGES_API = '1';

/** 課題の Key として folder の名にしてよい字（path の外へ出ないように）。 */
export const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** 控えの folder の中の、project の folder の名にある字（状態の folder の名は - で始まる）。 */
export const PROJECT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
/** 置き場が受ける workspace の ID の形。 */
const WORKSPACE = /^[A-Za-z0-9:._-]{0,64}$/;
/** 置き場の答えを待つ秒数。 */
const TIMEOUT = '10';

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

/** {@link call} と {@link pagesRequest} の答え。 */
export interface Reply {
  body: string
  /** HTTP の code（つながらなければ 000）。 */
  code: string
  /** curl の結果（curl で送った時だけ）。 */
  result?: ExecResult
  /** 置き場が、送り手（actorRef）を castlist に登録の無い物として断った（新しい API の 400 の fieldList に /actorRef。今の API の 422 と同じ訳）。 */
  unknownSender?: boolean
}

/**
 * 置き場に curl で頼む。答えの本文と HTTP の code を返す（つながらなければ code は 000）。
 * 答えの API の版がこの cli の話せる版と違えば、答えを使わずに止まる。header の無い答えは、API の版ができる前の置き場の物で、形は版 1 と同じなので通す。
 * 今は curl を spawnSync で打つので、待つ物は無い。形だけ非同期にしておき、後で Promise を返す HTTP の client に替える（AI-36）。
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function call(ctx: Context, args: string[], input?: string): Promise<Reply> {
  const result = ctx.exec('curl', ['-sS', '--max-time', TIMEOUT, '-w', '\n%{http_code} %header{pagetray-api}', ...args], input === undefined ? undefined : { input });
  const cut = result.stdout.lastIndexOf('\n');
  const [code = '', api = ''] = result.stdout.slice(cut + 1).trim().split(' ');
  if (result.status === 0 && api !== '' && api !== PAGES_API) {
    throw new TpmError(`置き場（${pagesUrl(ctx.env)}）の API の版は ${api} で、この roster が話せるのは ${PAGES_API} です。置き場の版（pagetray）と roster の版が合っていません。roster を pull するか、置き場の版を roster の .pagetray-version に合わせるよう roster ask devops で頼んでください`);
  }
  return { body: result.stdout.slice(0, Math.max(cut, 0)), code: result.status !== 0 || code === '' ? '000' : code, result };
}

/**
 * 生成した pagetray の client を作る（pagetray の client を作る所は、ここだけ）。送り直さず、時間切れは今の curl と同じ（TIMEOUT）。
 * requestHandler は試験が偽の HTTP を差し込む所。
 */
export function pagetrayClient(url: string, requestHandler?: HttpHandler): Pagetray.PagetrayClient {
  const { PagetrayClient } = pagetrayApi();
  return withoutAwsMiddleware(new PagetrayClient(clientConfig(url, Number(TIMEOUT) * 1000, requestHandler)));
}

/** 新しい置き場が、castlist に登録の無い送り手を断る訳の頭（pagetray の docs/src/next.md の「送り手」）。 */
const UNREGISTERED = 'castlist に登録の無い送り手';

/**
 * 送り手を castlist に登録の無い物として断った答えか（今の API の 422 と同じ訳にする物）。fieldList に /actorRef があり、訳が UNREGISTERED で始まる時だけ。
 * actorRef の形の誤りも /actorRef の 400 だが、打ち直しても通らないので、「登録されてから打ち直す」の訳にしない。
 */
const unknownSender = (sent: { message: string, fields: string[] }): boolean => sent.fields.includes('/actorRef') && sent.message.startsWith(UNREGISTERED);

/** 誤りの型の無い 404 の訳: 新しい API の道を持たない置き場（今の 0.x の版）が答えた物。 */
const OUTDATED = '置き場が新しい API を持たない（設定の api.pagetray は next だが、置き場（pagetray）の版が 1.0.0 より前に見える。置き場の版か、設定の api を見る）';

/**
 * 生成した pagetray の client で 1 つ送り（clients.ts の sendOnce。送る 1 回は今の curl と同じ TIMEOUT で切る）、答えを今の道の Reply の形にする
 * （本文は shape で今の API の JSON の形にした字、code は状態の数）。答えの無い物と、2xx なのに本文を読めない答えは 000（今の curl の道で、つながらない時と同じ）。
 * 誤りの答えの本文は、今の API の誤りの形（`{"error": <message>}`）にする。送り手を断った 400（fieldList に /actorRef）には unknownSender を付ける。
 */
async function viaPagetray<O extends { $metadata: { httpStatusCode?: number } }>(ctx: Context, send: (client: Pagetray.PagetrayClient, api: typeof Pagetray, options: { abortSignal: AbortSignal }) => Promise<O>, shape: (out: O) => unknown): Promise<Reply> {
  const sent = await sendOnce(() => ctx.clients.pagetray(pagesUrl(ctx.env)), (client, options) => send(client, pagetrayApi(), options), { server: 'pagetray', wait: Number(TIMEOUT) * 1000, outdated: OUTDATED });
  if (sent.kind === 'down') return { body: '', code: '000' };
  if (sent.kind === 'failed') return { body: JSON.stringify({ error: sent.message }), code: String(sent.code), ...(unknownSender(sent) ? { unknownSender: true } : {}) };
  return { body: JSON.stringify(shape(sent.out)), code: String(sent.out.$metadata.httpStatusCode ?? 200) };
}

/**
 * 新しい API の記録（ページか file）を、今の API の記録の形にする（page.ts の PageRecord・file.ts の FileRecord）。番号 n は数に、送り手の actor は無ければ null（今の API の未確認）。
 * 置く答えの url・location は、今の API の記録に無いので落とす。
 */
function recordOf(record: object): Record<string, unknown> {
  const rest = Object.fromEntries(Object.entries(toSnake(record) as Record<string, unknown>).filter(([k]) => k !== 'url' && k !== 'location'));
  const sender = rest.sender as Record<string, unknown> | undefined;
  return { ...rest, n: Number(rest.n), ...(sender === undefined ? {} : { sender: { actor: null, ...sender } }) };
}

/**
 * 置き場の API の要求（今の道の引数の名で書く）。返事の状態（state・on）とレビューの印は、ページ 1 枚（project・key・kind・n）を引数で名指す。
 * file を置く時の contentType は、file.ts の拡張子の表の Content-Type。
 */
export type PagesRequest =
  | { op: 'CreatePage', query: URLSearchParams, source: { file: string } | { text: string } }
  | { op: 'ListPages' | 'DeletePages' | 'ListFiles' | 'DeleteFiles' | 'SetReplyState', query: URLSearchParams }
  | { op: 'CreateFile', query: URLSearchParams, file: string, contentType: string }
  | { op: 'AddReviewMarks', query: URLSearchParams, marks: { verdict?: string, targets: string[] } };

/** 今の API の引数の名 → 新しい API の名（ここに無い名は、どちらも同じ）。 */
const RENAMED: Record<string, string> = { created_at: 'createdAt', actor_issuer: 'actorIssuer', actor_ref: 'actorRef' };

/** 今の API の引数を、新しい API の入力にする（時刻は Date）。 */
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

/** 今の道（curl）で頼む。 */
function curlOf(ctx: Context, request: PagesRequest): Promise<Reply> {
  const at = (path: string): string => `${pagesUrl(ctx.env)}${path}?${request.query.toString()}`;
  switch (request.op) {
    case 'CreatePage': {
      const { source } = request;
      return call(ctx, ['-X', 'POST', '-H', 'Content-Type: text/html; charset=utf-8', '--data-binary', 'file' in source ? `@${source.file}` : '@-', at('/api/pages')], 'file' in source ? undefined : source.text);
    }
    case 'ListPages': return call(ctx, [at('/api/pages')]);
    case 'DeletePages': return call(ctx, ['-X', 'DELETE', at('/api/pages')]);
    case 'CreateFile': return call(ctx, ['-X', 'POST', '-H', `Content-Type: ${request.contentType}`, '--data-binary', `@${request.file}`, at('/api/files')]);
    case 'ListFiles': return call(ctx, [at('/api/files')]);
    case 'DeleteFiles': return call(ctx, ['-X', 'DELETE', at('/api/files')]);
    case 'SetReplyState': return call(ctx, ['-X', 'POST', at('/api/pages/reply')]);
    case 'AddReviewMarks': return call(ctx, ['-X', 'POST', '-H', 'Content-Type: application/json', '--data-binary', '@-', at('/api/pages/review')], JSON.stringify(request.marks));
  }
}

/**
 * 一覧（ListPages・ListFiles）を、limit の数まで nextToken で辿って読む（今の置き場と同じく 1 から 1000 に丸める）。sort の created_at は createdAt。
 * 答えは今の道の形（`{"pages": […]}`・`{"files": […]}`）。
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
 * 置き場の API に頼む（ページと file を置く・探す・消す・返事の状態とレビューの印を書く）。今の道なら curl、設定の api.pagetray が next なら生成した client。
 * 答えはどちらも今の道の形（記録は今の API の欄の名。誤りは今の Reply の形）。
 */
export async function pagesRequest(ctx: Context, request: PagesRequest): Promise<Reply> {
  if (!nextApi(ctx, 'pagetray')) return curlOf(ctx, request);
  await requireNextStore(ctx);
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
  }
}

/** 新しい API を持つ置き場の版（設定の api.pagetray が next なのに、これより前の版なら送らない）。 */
export const PAGES_NEXT_SINCE = '1.0.0';

/** 1 つの命令の中で、置き場の版を引いた答え（引くのは 1 度だけ）。 */
/** 1 つの命令の中で、置き場の版を引いた答え（引くのは 1 度だけ）。null は応えなかった（覚えて、頼むたびに待ち直さない）。 */
const storeVersions = new WeakMap<Context, string | null>();

/**
 * 置き場の版の字。版を答えない置き場は ''。応えなければ undefined（覚えない。次にまた聞く）。1 つの命令（Context）の中では、置き場に 1 度だけ聞く。
 * 設定の api.pagetray が next なら、新しい API の /healthz（GetHealth）の version で見る（新しい API に /api/version は無い）。
 * 2xx で読めない答え（今の版の置き場の /healthz は字の ok）・version の無い答え・型の無い 404 は、新しい API を持たない置き場として ''。
 */
async function storeVersion(ctx: Context): Promise<string | undefined> {
  const known = storeVersions.get(ctx);
  if (known !== undefined) return known ?? undefined;
  let version: string | undefined;
  if (nextApi(ctx, 'pagetray')) {
    const sent = await sendOnce(() => ctx.clients.pagetray(pagesUrl(ctx.env)), (client, options) => client.send(new (pagetrayApi().GetHealthCommand)({}), options), { server: 'pagetray', wait: Number(TIMEOUT) * 1000, outdated: OUTDATED });
    if (sent.kind === 'ok') version = sent.out.version ?? '';
    else if ((sent.kind === 'down' && sent.status !== undefined) || (sent.kind === 'failed' && sent.message === OUTDATED)) version = '';
  }
  else {
    const r = await call(ctx, [`${pagesUrl(ctx.env)}/api/version`]);
    // 覚えるのは、版を答えた（200）か、版を答えない古い置き場（404）の時だけ。起き直す間の 502・503 などは、応えないとみなす。
    if (r.code === '200' || r.code === '404') {
      let answered: unknown;
      try {
        answered = r.code === '200' ? (JSON.parse(r.body) as { version?: unknown }).version : undefined;
      }
      catch { /* JSON でない答えは、版を答えない置き場 */ }
      version = typeof answered === 'string' ? answered : '';
    }
  }
  storeVersions.set(ctx, version ?? null);
  return version;
}

/**
 * 置き場の版が since（`<major>.<minor>.<patch>`）以上か。yes・old（古い。版を答えない置き場も）・down（応えない）。
 * 版は数にして比べる（字で比べると 0.10.0 を 0.8.0 より前とみなす）。道は設定の api.pagetray で決まる（storeVersion）。
 */
export async function storeAtLeast(ctx: Context, since: string): Promise<'yes' | 'old' | 'down'> {
  const version = await storeVersion(ctx);
  if (version === undefined) return 'down';
  return atLeast(version, since) ? 'yes' : 'old';
}

/** 置き場の版が古く、新しい API（api.pagetray の next）で頼めない（requireNextStore）。頼む物によっては、止めずに見分けて続ける（返事の状態・返事待ちの一覧）。 */
export class OldStoreError extends TpmError {}

/**
 * 設定の api.pagetray が next の時に、置き場が新しい API を持つかを見る（1 つの命令で 1 度だけ。castlist の requireUp の版の見方と同じ）。
 * 1.0.0 より前の版なら、送らずに止める（今の版の置き場に新しい API の道で頼むと、どれも断られるため）。応えなければ止めない（頼む物の答えで、応えないと出る）。
 */
async function requireNextStore(ctx: Context): Promise<void> {
  const version = await storeVersion(ctx);
  if (version === undefined || atLeast(version, PAGES_NEXT_SINCE)) return;
  throw new OldStoreError(`置き場（${pagesUrl(ctx.env)}）の版は ${version || 'わからない'} で、新しい API（${PAGES_NEXT_SINCE} から）を持ちません。設定の api.pagetray を外すか、置き場を新しい版に替えてください（置き場を替えるのは、roster ask devops で頼む）`);
}

/** 版の字（`0.10.1`。後ろの `-dev` などは読まない）が since 以上か。頭が `<数>.<数>.<数>` でなければ false。 */
export function atLeast(version: string, since: string): boolean {
  const parse = (v: string): number[] | undefined => /^\d+\.\d+\.\d+/.exec(v)?.[0].split('.').map(Number);
  const [a, b] = [parse(version), parse(since)];
  if (a === undefined || b === undefined) return false;
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
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
 * 置く人を指す付随する id（pagetray 0.6.0 の `actor_issuer`・`actor_ref`）。置き場は受けたその時に castlist に送り手を聞いて残す。
 * castlist の設定があり、$CLAUDE_CODE_SESSION_ID がある時だけ付ける（issuer と鍵は、session を登録する時と同じ）。どちらかが無ければ空（今までどおり付けない）。
 */
export function sender(ctx: Context): Record<string, string> {
  const sid = ctx.env.CLAUDE_CODE_SESSION_ID;
  if (castlistUrl(ctx) === undefined || !sid) return {};
  return { actor_issuer: issuerOf(ctx), actor_ref: sessionRef(sid) };
}

/**
 * 送り手を付けて置いた要求を、置き場が castlist に聞いた答えで断った時の文（what はページか file）。断っていなければ（送り手を付けていない・503 でも 422 でもない）undefined。
 * 503 は置き場が castlist に聞けない、422（新しい API では fieldList に /actorRef のある 400。unknownSender）は castlist に登録の無い session。
 * どちらも置き場は何も置いていない。打ち直すのは担当で、roster は送り直さない。
 */
export function senderRefused(ctx: Context, query: URLSearchParams, reply: Pick<Reply, 'code' | 'unknownSender'>, what: string): TpmError | undefined {
  const { code } = reply;
  const ref = query.get('actor_ref');
  if (ref === null) return undefined;
  if (code === '503') return new TpmError(`置き場（${pagesUrl(ctx.env)}）が castlist に送り手を聞けませんでした（503）。${what}。castlist が起きてから打ち直してください。続く時は roster report incident で台帳に挙げてください`);
  if (code === '422' || reply.unknownSender === true) return new TpmError(`この session（${ref}）は castlist に登録が無いと、置き場が答えました（${code}）。${what}。session は guard が Bash の前に登録するので、打ち直してください。続く時は roster report incident で台帳に挙げてください`);
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
export async function fetchTo(ctx: Context, storePath: string, path: string): Promise<string> {
  mkdirSync(dirname(path), { recursive: true });
  const partial = `${path}.part-${process.pid}`;
  try {
    const r = await call(ctx, ['-o', partial, `${pagesUrl(ctx.env)}${storePath}`]);
    if (r.code === '200') renameSync(partial, path);
    return r.code;
  }
  finally {
    rmSync(partial, { force: true });
  }
}

/** 取り込みで、置き場にもうある番号（409）の中身を、控えと比べる。消した番号（410）なら removed、同じなら same、違えば conflict。 */
export async function compareStored(ctx: Context, storePath: string, file: string): Promise<'removed' | 'same' | 'conflict'> {
  const copy = `${file}.check-${process.pid}`;
  try {
    const r = await call(ctx, ['-o', copy, `${pagesUrl(ctx.env)}${storePath}`]);
    if (r.code === '410') return 'removed';
    if (r.code !== '200') throw r.code === '000' ? down(ctx, '') : new TpmError(`置き場が ${storePath} に ${r.code} を返しました`);
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
