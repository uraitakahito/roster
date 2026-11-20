// 依頼書と成果のページを、代わりの置き場（local の folder を Nginx の container が 127.0.0.1 で出す物）に置く・読む。
// 置き場は Mac に 1 つで、project をまたいで同じなので、置き場の folder と URL は設定（config.jsonc）でなく環境変数で替える。
// container を起こす・止めるのは DevOps Engineer 担当（docs-site の運用のページの「代わりの置き場（tpm-pages）」）。
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { Context } from '../context.ts';
import { TpmError } from '../skill-sets.ts';

/** ページの種類。file の名の頭になる（`<種類>-<番号>.html`）。 */
export const PAGE_KINDS = ['brief', 'confirm', 'proposal', 'plan', 'result'] as const;
/** ページの種類の名前。 */
export type PageKind = typeof PAGE_KINDS[number];

/** 置き場の URL の既定（container の port の publish の 127.0.0.1:8800）。 */
export const DEFAULT_PAGES_URL = 'http://127.0.0.1:8800';

/** 課題の鍵として folder の名にしてよい字（path の外へ出ないように）。 */
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** 置き場の folder。$TPM_PAGES_DIR、無ければ $XDG_DATA_HOME（それも無ければ ~/.local/share）の `tpm/pages`。 */
export function pagesDir(env: NodeJS.ProcessEnv): string {
  if (env.TPM_PAGES_DIR) return env.TPM_PAGES_DIR;
  return join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'tpm', 'pages');
}

/** 置き場の URL（末尾の / は落とす）。$TPM_PAGES_URL、無ければ既定。 */
export function pagesUrl(env: NodeJS.ProcessEnv): string {
  return (env.TPM_PAGES_URL || DEFAULT_PAGES_URL).replace(/\/+$/, '');
}

/** 課題の鍵のページを置く folder（`<置き場>/<状態の folder の名>/<鍵>`）。 */
export const pageFolder = (ctx: Context, key: string): string => join(pagesDir(ctx.env), basename(ctx.state.dir), key);

/**
 * ページを置く。`<置き場>/<状態の folder の名>/<鍵>/<種類>-<次の番号>.html` に写し、置き場が出しているかを HEAD で見てから URL を返す。
 * project の名を状態の folder の名にするのは、起こされた担当も $TPM_STATE で同じ folder を受け取り、TPM 担当と名がずれないため。
 * 鍵は --key、無ければ $TPM_KEY（担当）。上書きはしない（同時に置かれたら次の番号にする）。
 */
export function pagePut(ctx: Context, file: string, options: { kind: string, key?: string }): string[] {
  if (!(PAGE_KINDS as readonly string[]).includes(options.kind)) throw new TpmError(`--kind は ${PAGE_KINDS.join('・')} のどれかにしてください`);
  const key = options.key ?? ctx.env.TPM_KEY;
  if (!key) throw new TpmError('課題の鍵がわかりません。TPM 担当は --key <鍵> を付けてください');
  if (!KEY.test(key)) throw new TpmError(`課題の鍵に使えない字があります: ${key}`);
  if (!existsSync(file) || !statSync(file).isFile()) throw new TpmError(`file がありません: ${file}`);
  const body = readFileSync(file);
  const project = basename(ctx.state.dir);
  const folder = pageFolder(ctx, key);
  mkdirSync(folder, { recursive: true });
  const name = writeNext(folder, options.kind, body);
  const path = join(folder, name);
  const url = `${pagesUrl(ctx.env)}/${[project, key, name].map(encodeURIComponent).join('/')}`;
  const r = ctx.exec('curl', ['-sI', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '3', url]);
  const code = r.stdout.trim();
  if (code === '200') return [`置いた: ${path}`, `URL: ${url}`];
  if (r.status !== 0 || code === '000' || code === '') {
    throw new TpmError(`置き場（${pagesUrl(ctx.env)}）が応えません。file は ${path} に置きました。置き場を起こすよう tpm ask devops で頼んでください`);
  }
  throw new TpmError(`置き場が ${url} に ${code} を返しました。置き場の folder（${pagesDir(ctx.env)}）と container の mount がずれています。tpm ask devops で頼んでください`);
}

/** folder に `<kind>-<次の番号>.html` を作って書き、名を返す。番号は今ある最大＋1。先を越されたら（EEXIST）次の番号で作り直す。 */
function writeNext(folder: string, kind: string, body: Buffer): string {
  const pattern = new RegExp(`^${kind}-(\\d+)\\.html$`);
  let n = Math.max(0, ...readdirSync(folder).map(f => Number(pattern.exec(f)?.[1] ?? 0))) + 1;
  for (;;) {
    const name = `${kind}-${n}.html`;
    try {
      writeFileSync(join(folder, name), body, { flag: 'wx' });
      return name;
    }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      n += 1;
    }
  }
}

/** 置き場の URL を、置き場の file の path にする（Read tool で読むため）。置き場の外の URL・無い file は誤り。 */
export function pagePath(ctx: Context, url: string): string[] {
  const base = pagesUrl(ctx.env);
  if (!url.startsWith(`${base}/`)) throw new TpmError(`置き場（${base}）の URL ではありません: ${url}`);
  const rest = url.slice(base.length + 1).replace(/[?#].*$/, '');
  const parts = rest.split('/').map((p) => {
    try {
      return decodeURIComponent(p);
    }
    catch {
      throw new TpmError(`URL を読めません: ${url}`);
    }
  });
  if (parts.some(p => p === '' || p === '.' || p === '..' || p.includes('/'))) throw new TpmError(`置き場の file を指す URL ではありません: ${url}`);
  const path = join(pagesDir(ctx.env), ...parts);
  if (!existsSync(path) || !statSync(path).isFile()) throw new TpmError(`置き場に file がありません: ${path}`);
  return [path];
}
