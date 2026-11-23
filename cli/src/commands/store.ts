// 置き場（別の repo の pagetray。127.0.0.1 で待つ、ページと file を DB に持つサーバー）に curl で頼む足場と、tpm を動かす機械の控えの folder。
// tpm page と tpm file が使う。置き場は tpm を動かす機械に 1 つで、project をまたいで同じなので、控えの folder と URL は設定（config.jsonc）でなく環境変数で替える。
// 置き場を起こす・止めるのは DevOps Engineer 担当（docs-site の運用のページの「ページの置き場（pagetray）」）。
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Context } from '../context.ts';
import type { ExecResult } from '../exec.ts';
import type { RoleRecord, TpmRecord } from '../roster.ts';
import { castlistUrl, issuerOf, sessionRef } from '../castlist.ts';
import { rolesConfigFile } from '../config.ts';
import { readRole, subjectOf } from '../roster.ts';
import { TpmError } from '../skill-sets.ts';

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

/** 控えの folder。$TPM_PAGES_DIR、無ければ $XDG_DATA_HOME（それも無ければ ~/.local/share）の `tpm/pages`。 */
export function pagesDir(env: NodeJS.ProcessEnv): string {
  if (env.TPM_PAGES_DIR) return env.TPM_PAGES_DIR;
  return join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'tpm', 'pages');
}

/** 置き場の URL（末尾の / は落とす）。$TPM_PAGES_URL、無ければ既定。 */
export function pagesUrl(env: NodeJS.ProcessEnv): string {
  return (env.TPM_PAGES_URL || DEFAULT_PAGES_URL).replace(/\/+$/, '');
}

/** URL が置き場（今の URL か、前の置き場の URL）を指していれば、置き場の中の path（頭の / は無し。`?` と `#` から後は落とす）。違えば undefined。 */
export function inStore(env: NodeJS.ProcessEnv, url: string): string | undefined {
  const base = [pagesUrl(env), ...LEGACY_PAGES_URLS].find(b => url.startsWith(`${b}/`));
  return base === undefined ? undefined : url.slice(base.length + 1).replace(/[?#].*$/, '');
}

/** URL が置き場のページか file を指しているか。 */
export const isPageUrl = (env: NodeJS.ProcessEnv, url: string): boolean => inStore(env, url) !== undefined;

/** {@link call} の答え。 */
export interface Reply {
  body: string
  /** HTTP の code（つながらなければ 000）。 */
  code: string
  result: ExecResult
}

/**
 * 置き場に curl で頼む。答えの本文と HTTP の code を返す（つながらなければ code は 000）。
 * 答えの API の版がこの cli の話せる版と違えば、答えを使わずに止まる。header の無い答えは、API の版ができる前の置き場の物で、形は版 1 と同じなので通す。
 */
export function call(ctx: Context, args: string[], input?: string): Reply {
  const result = ctx.exec('curl', ['-sS', '--max-time', TIMEOUT, '-w', '\n%{http_code} %header{pagetray-api}', ...args], input === undefined ? undefined : { input });
  const cut = result.stdout.lastIndexOf('\n');
  const [code = '', api = ''] = result.stdout.slice(cut + 1).trim().split(' ');
  if (result.status === 0 && api !== '' && api !== PAGES_API) {
    throw new TpmError(`置き場（${pagesUrl(ctx.env)}）の API の版は ${api} で、この tpm が話せるのは ${PAGES_API} です。置き場の版（pagetray）と roster の版が合っていません。roster を pull するか、置き場の版を roster の .pagetray-version に合わせるよう tpm ask devops で頼んでください`);
  }
  return { body: result.stdout.slice(0, Math.max(cut, 0)), code: result.status !== 0 || code === '' ? '000' : code, result };
}

/** 1 つの命令の中で、置き場の版を引いた答え（引くのは 1 度だけ）。 */
const storeVersions = new WeakMap<Context, string>();

/**
 * 置き場の版が since（`<major>.<minor>.<patch>`）以上か。yes・old（古い。版を答えない置き場も）・down（応えない）。
 * 版は数にして比べる（字で比べると 0.10.0 を 0.8.0 より前とみなす）。1 つの命令（Context）の中では、置き場に 1 度だけ聞く。
 */
export function storeAtLeast(ctx: Context, since: string): 'yes' | 'old' | 'down' {
  let version = storeVersions.get(ctx);
  if (version === undefined) {
    const r = call(ctx, [`${pagesUrl(ctx.env)}/api/version`]);
    // 覚えるのは、版を答えた（200）か、版を答えない古い置き場（404）の時だけ。起き直す間の 502・503 などは、応えないとみなす。
    if (r.code !== '200' && r.code !== '404') return 'down';
    let answered: unknown;
    try {
      answered = r.code === '200' ? (JSON.parse(r.body) as { version?: unknown }).version : undefined;
    }
    catch { /* JSON でない答えは、版を答えない置き場 */ }
    version = typeof answered === 'string' ? answered : '';
    storeVersions.set(ctx, version);
  }
  return atLeast(version, since) ? 'yes' : 'old';
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
  new TpmError(`置き場（${pagesUrl(ctx.env)}）が応えません。${what}置き場を起こすよう tpm ask devops で頼んでください`);

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
 * 503 は置き場が castlist に聞けない、422 は castlist に登録の無い session。どちらも置き場は何も置いていない。打ち直すのは担当で、tpm は送り直さない。
 */
export function senderRefused(ctx: Context, query: URLSearchParams, code: string, what: string): TpmError | undefined {
  const ref = query.get('actor_ref');
  if (ref === null) return undefined;
  if (code === '503') return new TpmError(`置き場（${pagesUrl(ctx.env)}）が castlist に送り手を聞けませんでした（503）。${what}。castlist が起きてから打ち直してください。続く時は tpm report incident で台帳に挙げてください`);
  if (code === '422') return new TpmError(`この session（${ref}）は castlist に登録が無いと、置き場が答えました（422）。${what}。session は guard が Bash の前に登録するので、打ち直してください。続く時は tpm report incident で台帳に挙げてください`);
  return undefined;
}

/** 自分の居場所の宛先（担当は名簿、TPM 担当は tpm.jsonc）。わからなければ空。 */
export function selfAddress(ctx: Context): string {
  const record: RoleRecord | TpmRecord | undefined = ctx.env.TPM_KEY ? readRole(ctx, ctx.env.TPM_KEY) : ctx.state.read<TpmRecord>('tpm.jsonc');
  const address = record?.address ?? '';
  return WORKSPACE.test(address) ? address : '';
}

/**
 * 置く物の project と Key を確かめる。project は $TPM_PROJECT、無ければ今いる folder。tpm を使う project の印（設定の file・TPM 担当が起きた印）が無い folder なら、
 * scratchpad などから打った置き間違い（その folder の名が別の project になる）なので止める。Key は keyOption、無ければ $TPM_KEY（担当）。
 */
export function requireKey(ctx: Context, keyOption?: string): string {
  if (!existsSync(rolesConfigFile(ctx.project)) && ctx.state.read('tpm.jsonc') === undefined) {
    throw new TpmError(`tpm を使う project の folder ではありません: ${ctx.project}（.claude/roles/config.jsonc も、TPM 担当が起きた印も無い）。project の folder で打つか、$TPM_PROJECT に project の path を付けてください`);
  }
  // Staff Engineer 担当の席（名簿の Key は <課題の Key>.staff）は、見ている課題の Key の folder に置く。
  const own = ctx.env.TPM_KEY || undefined;
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
export function fetchTo(ctx: Context, storePath: string, path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  const partial = `${path}.part-${process.pid}`;
  try {
    const r = call(ctx, ['-o', partial, `${pagesUrl(ctx.env)}${storePath}`]);
    if (r.code === '200') renameSync(partial, path);
    return r.code;
  }
  finally {
    rmSync(partial, { force: true });
  }
}

/** 取り込みで、置き場にもうある番号（409）の中身を、控えと比べる。消した番号（410）なら removed、同じなら same、違えば conflict。 */
export function compareStored(ctx: Context, storePath: string, file: string): 'removed' | 'same' | 'conflict' {
  const copy = `${file}.check-${process.pid}`;
  try {
    const r = call(ctx, ['-o', copy, `${pagesUrl(ctx.env)}${storePath}`]);
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
