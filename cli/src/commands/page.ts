// 依頼書と成果のページを、置き場（pagestore。127.0.0.1 で待つ、ページを DB に持つサーバー）に置く・読む・探す。
// 番号は置き場が決める。置いた・読んだページは、この Mac の控えの folder にも写す（Read tool で読むためと、置き場が止まっても読めるため）。
// 置き場は Mac に 1 つで、project をまたいで同じなので、控えの folder と URL は設定（config.jsonc）でなく環境変数で替える。
// 置き場を起こす・止めるのは DevOps Engineer 担当（docs-site の運用のページの「ページの置き場（tpm-pagestore）」）。
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Context } from '../context.ts';
import type { ExecResult } from '../exec.ts';
import type { RoleRecord, TpmRecord } from '../roster.ts';
import { readRole } from '../roster.ts';
import { TpmError } from '../skill-sets.ts';
import { roleOf } from './infra.ts';

/** ページの種類。file の名の頭になる（`<種類>-<番号>.html`）。置き場は名の一覧を持たないので、種類を足すのはここだけ。 */
export const PAGE_KINDS = ['brief', 'confirm', 'proposal', 'plan', 'result', 'issue'] as const;
/** ページの種類の名前。 */
export type PageKind = typeof PAGE_KINDS[number];

/** 置き場の URL の既定（container の port の publish の 127.0.0.1:8801）。 */
export const DEFAULT_PAGES_URL = 'http://127.0.0.1:8801';
/** 前の置き場（Nginx）の URL。前に置いたページの URL も、読む時は受ける。 */
export const LEGACY_PAGES_URLS = ['http://127.0.0.1:8800'];

/** 課題の Key として folder の名にしてよい字（path の外へ出ないように）。 */
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** 控えの folder の中の、project の folder の名にある字（状態の folder の名は - で始まる）。 */
const PROJECT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
/** 控えの folder にあるページの file の名（`<種類>-<番号>.html`。番号は頭に 0 の無い 1 以上）。 */
const PAGE_FILE = /^([a-z][a-z0-9-]{0,31})-([1-9]\d*)\.html$/;
/** 置き場が受ける workspace の ID の形。 */
const WORKSPACE = /^[A-Za-z0-9:._-]{0,64}$/;
/** 置き場の答えを待つ秒数。 */
const TIMEOUT = '10';

/** 置き場が返す、ページ 1 枚の記録（本文は入らない）。 */
export interface PageRecord {
  project: string
  key: string
  kind: string
  n: number
  title: string
  /** 置いた担当の役割（前の置き場から入れた物は unknown）。 */
  role: string
  /** 置いた担当の居場所の宛先（わからなければ空）。 */
  workspace: string
  /** 置いた時刻（UTC の ISO）。 */
  created_at: string
  size: number
  /** 置き場の中の path（`/<project>/<Key>/<種類>-<番号>.html`）。 */
  path: string
}

/** 控えの folder。$TPM_PAGES_DIR、無ければ $XDG_DATA_HOME（それも無ければ ~/.local/share）の `tpm/pages`。 */
export function pagesDir(env: NodeJS.ProcessEnv): string {
  if (env.TPM_PAGES_DIR) return env.TPM_PAGES_DIR;
  return join(env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'tpm', 'pages');
}

/** 置き場の URL（末尾の / は落とす）。$TPM_PAGES_URL、無ければ既定。 */
export function pagesUrl(env: NodeJS.ProcessEnv): string {
  return (env.TPM_PAGES_URL || DEFAULT_PAGES_URL).replace(/\/+$/, '');
}

/** URL が置き場（今の URL か、前の置き場の URL）のページを指していれば、置き場の中の path（`<project>/<Key>/<file>`）。違えば undefined。 */
function inStore(env: NodeJS.ProcessEnv, url: string): string | undefined {
  const base = [pagesUrl(env), ...LEGACY_PAGES_URLS].find(b => url.startsWith(`${b}/`));
  return base === undefined ? undefined : url.slice(base.length + 1);
}

/** URL が置き場のページを指しているか。 */
export const isPageUrl = (env: NodeJS.ProcessEnv, url: string): boolean => inStore(env, url) !== undefined;

/** 課題の Key のページの控えを置く folder（`<控えの folder>/<状態の folder の名>/<Key>`）。 */
export const pageFolder = (ctx: Context, key: string): string => join(pagesDir(ctx.env), basename(ctx.state.dir), key);

/** 置き場に curl で頼む。答えの本文と HTTP の code を返す（つながらなければ code は 000）。 */
function call(ctx: Context, args: string[], input?: string): { body: string, code: string, result: ExecResult } {
  const result = ctx.exec('curl', ['-sS', '--max-time', TIMEOUT, '-w', '\n%{http_code}', ...args], input === undefined ? undefined : { input });
  const cut = result.stdout.lastIndexOf('\n');
  const code = result.stdout.slice(cut + 1).trim();
  return { body: result.stdout.slice(0, Math.max(cut, 0)), code: result.status !== 0 || code === '' ? '000' : code, result };
}

/** 置き場の誤りの答え（`{"error": "…"}`）から文を取り出す。JSON でなければ本文のまま。 */
function reason(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === 'string') return parsed.error;
  }
  catch { /* JSON でない答えは、そのまま出す */ }
  return body.trim();
}

/** 置き場が応えない時の文。 */
const down = (ctx: Context, what: string): TpmError =>
  new TpmError(`置き場（${pagesUrl(ctx.env)}）が応えません。${what}置き場を起こすよう tpm ask devops で頼んでください`);

/** 自分の居場所の宛先（担当は名簿、TPM 担当は tpm.jsonc）。わからなければ空。 */
function selfAddress(ctx: Context): string {
  const record: RoleRecord | TpmRecord | undefined = ctx.env.TPM_KEY ? readRole(ctx, ctx.env.TPM_KEY) : ctx.state.read<TpmRecord>('tpm.jsonc');
  const address = record?.address ?? '';
  return WORKSPACE.test(address) ? address : '';
}

/**
 * ページを置く。置き場が番号を決めて DB に持ち、`<控えの folder>/<状態の folder の名>/<Key>/<種類>-<番号>.html` に控えを写して URL を返す。
 * project の名を状態の folder の名にするのは、起こされた担当も $TPM_STATE で同じ folder を受け取り、TPM 担当と名がずれないため。
 * Key は --key、無ければ $TPM_KEY（担当）。置き直すと次の番号になり、前の版は残る。置き場が応えなければ置けない。
 */
export function pagePut(ctx: Context, file: string, options: { kind: string, key?: string }): string[] {
  if (!(PAGE_KINDS as readonly string[]).includes(options.kind)) throw new TpmError(`--kind は ${PAGE_KINDS.join('・')} のどれかにしてください`);
  if (!existsSync(file) || !statSync(file).isFile()) throw new TpmError(`file がありません: ${file}`);
  const { path, url } = putPage(ctx, { file }, options.kind as PageKind, options.key);
  return [`置いた: ${path}`, `URL: ${url}`];
}

/** file の中身か字をページとして置き、控えの path と URL を返す（pagePut と、tpm assign の課題の写し）。 */
export function putPage(ctx: Context, source: { file: string } | { text: string }, kind: PageKind, keyOption?: string): { path: string, url: string } {
  const key = keyOption ?? ctx.env.TPM_KEY;
  if (!key) throw new TpmError('課題の Key がわかりません。TPM 担当は --key <Key> を付けてください');
  if (!KEY.test(key)) throw new TpmError(`課題の Key に使えない字があります: ${key}`);
  const query = new URLSearchParams({
    project: basename(ctx.state.dir),
    key,
    kind,
    role: roleOf(ctx.env) ?? 'tpm',
    workspace: selfAddress(ctx),
  });
  const record = post(ctx, source, query);
  if (record === 'taken') throw new TpmError('置き場が番号を決められませんでした（409）。もう 1 度打ってください');
  const path = join(pagesDir(ctx.env), ...record.path.split('/').filter(part => part !== ''));
  mkdirSync(dirname(path), { recursive: true });
  const body = 'file' in source ? readFileSync(source.file) : Buffer.from(source.text);
  // 置き場の番号が正しい。控えに別の中身が残っていたら（置き場を通さずに置かれた物）、消さずに退ける。
  if (existsSync(path) && !readFileSync(path).equals(body)) renameSync(path, `${path}.replaced-${ctx.now().toISOString().replaceAll(':', '')}`);
  writeFileSync(path, body);
  return { path, url: `${pagesUrl(ctx.env)}${record.path}` };
}

/** 置き場に 1 枚送る。置けたら記録を、番号を名指して使われていたら 'taken' を返す。ほかは止まる。 */
function post(ctx: Context, source: { file: string } | { text: string }, query: URLSearchParams): PageRecord | 'taken' {
  const data = 'file' in source ? `@${source.file}` : '@-';
  const r = call(
    ctx,
    ['-X', 'POST', '-H', 'Content-Type: text/html; charset=utf-8', '--data-binary', data, `${pagesUrl(ctx.env)}/api/pages?${query.toString()}`],
    'file' in source ? undefined : source.text,
  );
  if (r.code === '201') return JSON.parse(r.body) as PageRecord;
  if (r.code === '409') return 'taken';
  if (r.code === '000') throw down(ctx, 'ページは置けていません（番号は置き場が決めます）。');
  throw new TpmError(`置き場がページを受け取りませんでした（${r.code}）: ${reason(r.body)}`);
}

/**
 * 置き場の URL を、控えの file の path にする（Read tool で読むため）。控えに無ければ、置き場から取って控えに写す。
 * 前の置き場の URL（8800）も受ける。置き場の外の URL・無いページは誤り。
 */
export function pagePath(ctx: Context, url: string): string[] {
  const rest = inStore(ctx.env, url)?.replace(/[?#].*$/, '');
  if (rest === undefined) throw new TpmError(`置き場（${pagesUrl(ctx.env)}）の URL ではありません: ${url}`);
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
  if (existsSync(path) && statSync(path).isFile()) return [path];
  if (parts.length !== 3 || !PAGE_FILE.test(parts[2] ?? '')) throw new TpmError(`置き場に file がありません: ${path}`);
  fetchPage(ctx, `/${parts.map(encodeURIComponent).join('/')}`, path);
  return [path];
}

/** 置き場からページを取り、控えの path に書く。途中の file は残さない。 */
function fetchPage(ctx: Context, storePath: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const partial = `${path}.part-${process.pid}`;
  const r = call(ctx, ['-o', partial, `${pagesUrl(ctx.env)}${storePath}`]);
  if (r.code === '200') {
    renameSync(partial, path);
    return;
  }
  rmSync(partial, { force: true });
  if (r.code === '000') throw down(ctx, `控え（${path}）もありません。`);
  throw new TpmError(`置き場にページがありません（${r.code}）: ${pagesUrl(ctx.env)}${storePath}`);
}

/** `tpm page list` の旗。 */
export interface PageListOptions {
  key?: string
  role?: string
  workspace?: string
  kind?: string
  q?: string
  /** 出す件数（既定は 50）。 */
  limit?: string
  /** 古い順に出す。 */
  oldest?: boolean
  /** ほかの project のページも出す。 */
  allProjects?: boolean
  json?: boolean
}

/** 置き場のページを絞って探す。既定は、今の project の新しい順。--json は記録の配列（url を足した物）を出す。 */
export function pageList(ctx: Context, options: PageListOptions): string[] {
  const query = new URLSearchParams({ limit: options.limit ?? '50' });
  if (!options.allProjects) query.set('project', basename(ctx.state.dir));
  for (const name of ['key', 'role', 'workspace', 'kind', 'q'] as const) {
    const value = options[name];
    if (value !== undefined) query.set(name, value);
  }
  if (options.oldest) query.set('sort', 'created_at');
  const r = call(ctx, [`${pagesUrl(ctx.env)}/api/pages?${query.toString()}`]);
  if (r.code === '000') throw down(ctx, '');
  if (r.code !== '200') throw new TpmError(`置き場が一覧を返しませんでした（${r.code}）: ${reason(r.body)}`);
  const pages = (JSON.parse(r.body) as { pages: PageRecord[] }).pages.map(p => ({ ...p, url: `${pagesUrl(ctx.env)}${p.path}` }));
  if (options.json) return [JSON.stringify(pages, null, 2)];
  if (pages.length === 0) return ['合うページは無い'];
  return pages.map(p => [p.created_at, p.key, `${p.kind}-${p.n}`, p.role, p.workspace === '' ? '-' : p.workspace, p.url, p.title].join('  '));
}

/** 控えの folder にあるページ（`<project>/<Key>/<種類>-<番号>.html`）を並べる。 */
function cached(dir: string): { project: string, key: string, kind: string, n: string, file: string }[] {
  const folders = (path: string): string[] => existsSync(path) ? readdirSync(path, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name) : [];
  return folders(dir).filter(project => PROJECT.test(project)).flatMap(project =>
    folders(join(dir, project)).filter(key => KEY.test(key)).flatMap(key =>
      readdirSync(join(dir, project, key)).flatMap((name) => {
        const m = PAGE_FILE.exec(name);
        return m === null ? [] : [{ project, key, kind: m[1] ?? '', n: m[2] ?? '', file: join(dir, project, key, name) }];
      })));
}

/**
 * 控えの folder にあって置き場に無いページを、同じ番号・file の時刻で置き場に入れる（前の置き場からの切り替えと、DB を失った後に使う）。
 * 何度打っても同じ結果になる。置いた担当はわからないので、役割は依頼書と課題の写しだけ tpm、ほかは unknown、居場所は空で入る。
 * 同じ番号に別の中身があるページは入れず、並べて知らせる。
 */
export function pageImport(ctx: Context): string[] {
  const dir = pagesDir(ctx.env);
  const added: string[] = [];
  const conflicts: string[] = [];
  let same = 0;
  for (const page of cached(dir)) {
    const storePath = `/${[page.project, page.key, basename(page.file)].map(encodeURIComponent).join('/')}`;
    const query = new URLSearchParams({
      project: page.project,
      key: page.key,
      kind: page.kind,
      role: page.kind === 'brief' || page.kind === 'issue' ? 'tpm' : 'unknown',
      workspace: '',
      n: page.n,
      created_at: statSync(page.file).mtime.toISOString(),
    });
    if (post(ctx, { file: page.file }, query) !== 'taken') {
      added.push(storePath);
      continue;
    }
    // もうある番号。中身が同じなら入っている。違えば、置き場を通さずに置かれた物とぶつかっている。
    const copy = `${page.file}.check-${process.pid}`;
    try {
      const r = call(ctx, ['-o', copy, `${pagesUrl(ctx.env)}${storePath}`]);
      if (r.code !== '200') throw r.code === '000' ? down(ctx, '') : new TpmError(`置き場が ${storePath} に ${r.code} を返しました`);
      if (readFileSync(copy).equals(readFileSync(page.file))) same += 1;
      else conflicts.push(page.file);
    }
    finally {
      rmSync(copy, { force: true });
    }
  }
  return [
    `入れた: ${added.length} 枚・もう入っていた: ${same} 枚・ぶつかった: ${conflicts.length} 枚（控えの folder: ${dir}）`,
    ...added.map(path => `+ ${pagesUrl(ctx.env)}${path}`),
    ...conflicts.map(file => `! 同じ番号に別の中身がある（入れていない。要るなら tpm page put で置き直す）: ${file}`),
  ];
}
