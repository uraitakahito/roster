// 依頼書と成果のページを、置き場（別の repo の pagetray。127.0.0.1 で待つ、ページを DB に持つサーバー。頼む足場は store.ts）に置く・読む・探す・消す。
// 番号は置き場が決める。置いた・読んだページは、この Mac の控えの folder にも写す（Read tool で読むためと、置き場が止まっても読めるため）。
// ページが参照する file（画像など。file.ts）も、読む時に控えに写し、取り込む・消す時に一緒に扱う。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Context } from '../context.ts';
import { TpmError } from '../skill-sets.ts';
import { copyRefs, fileImport, findFiles, removeFiles } from './file.ts';
import { roleOf } from './infra.ts';
import { call, compareStored, down, fetchTo, inStore, KEY, localPath, pagesDir, pagesUrl, PROJECT, reason, removeLocal, requireKey, selfAddress, writeCopy } from './store.ts';

/** ページの種類。file の名の頭になる（`<種類>-<番号>.html`）。置き場は名の一覧を持たないので、種類を足すのはここだけ。 */
export const PAGE_KINDS = ['brief', 'confirm', 'proposal', 'plan', 'result', 'issue'] as const;
/** ページの種類の名前。 */
export type PageKind = typeof PAGE_KINDS[number];

/** 控えの folder にあるページの file の名（`<種類>-<番号>.html`。番号は頭に 0 の無い 1 以上）。 */
const PAGE_FILE = /^([a-z][a-z0-9-]{0,31})-([1-9]\d*)\.html$/;
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

/** 課題の Key のページの控えを置く folder（`<控えの folder>/<状態の folder の名>/<Key>`）。 */
export const pageFolder = (ctx: Context, key: string): string => join(pagesDir(ctx.env), basename(ctx.state.dir), key);

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
  const key = requireKey(ctx, keyOption);
  const query = new URLSearchParams({
    project: basename(ctx.state.dir),
    key,
    kind,
    role: roleOf(ctx.env) ?? 'tpm',
    workspace: selfAddress(ctx),
  });
  const record = post(ctx, source, query);
  if (record === 'taken') throw new TpmError('置き場が番号を決められませんでした（409）。もう 1 度打ってください');
  const path = localPath(ctx, record.path);
  writeCopy(ctx, path, 'file' in source ? readFileSync(source.file) : Buffer.from(source.text));
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
 * ページが相対で参照する file（`files/…`・`../<Key>/files/…`）も、控えに無ければ取って、ページから同じ相対の所に写す（取れなければ注意の行を足す）。
 * 前の置き場の URL（8800）も受ける。置き場の外の URL・無いページは誤り。file の URL は tpm file path に回す。
 */
export function pagePath(ctx: Context, url: string): string[] {
  const rest = inStore(ctx.env, url);
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
  if (parts.length === 4 && parts[2] === 'files') throw new TpmError(`ページでなく file の URL です。tpm file path ${url} で読んでください`);
  const path = join(pagesDir(ctx.env), ...parts);
  const [project = '', key = '', file = ''] = parts;
  const page = parts.length === 3 && PAGE_FILE.test(file);
  if (!existsSync(path) || !statSync(path).isFile()) {
    if (!page) throw new TpmError(`置き場に file がありません: ${path}`);
    fetchPage(ctx, `/${parts.map(encodeURIComponent).join('/')}`, path);
  }
  return page ? [path, ...copyRefs(ctx, project, key, path)] : [path];
}

/** 置き場からページを取り、控えの path に書く。途中の file は残さない。 */
function fetchPage(ctx: Context, storePath: string, path: string): void {
  const code = fetchTo(ctx, storePath, path);
  if (code === '200') return;
  if (code === '000') throw down(ctx, `控え（${path}）もありません。`);
  if (code === '410') throw new TpmError(`置き場のページは消してあります（410）: ${pagesUrl(ctx.env)}${storePath}`);
  throw new TpmError(`置き場にページがありません（${code}）: ${pagesUrl(ctx.env)}${storePath}`);
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
 * 何度打っても同じ結果になる。消したページ（置き場が 410 を返す番号）は入れない。置いた担当はわからないので、役割は依頼書と課題の写しだけ tpm、ほかは unknown、居場所は空で入る。
 * 同じ番号に別の中身があるページは入れず、並べて知らせる。控えの `<Key>/files/` にある file も、同じ決まりで入れる（file.ts の fileImport）。
 */
export function pageImport(ctx: Context): string[] {
  const dir = pagesDir(ctx.env);
  const added: string[] = [];
  const conflicts: string[] = [];
  let same = 0;
  let removed = 0;
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
    // 消したページ（410）は、番号が残っているので入らない。控えだけが残っていた物。
    const seen = compareStored(ctx, storePath, page.file);
    if (seen === 'same') same += 1;
    else if (seen === 'removed') removed += 1;
    else conflicts.push(page.file);
  }
  return [
    `入れた: ${added.length} 枚・もう入っていた: ${same} 枚・消したページ: ${removed} 枚・ぶつかった: ${conflicts.length} 枚（控えの folder: ${dir}）`,
    ...added.map(path => `+ ${pagesUrl(ctx.env)}${path}`),
    ...conflicts.map(file => `! 同じ番号に別の中身がある（入れていない。要るなら tpm page put で置き直す）: ${file}`),
    ...fileImport(ctx),
  ];
}

/** `tpm page delete` の旗。 */
export interface PageDeleteOptions {
  /** この Key のページをみな消す。 */
  key?: string
  /** この project のページを消す（既定は今の project）。--key が無ければ project のページをみな消す。 */
  project?: string
  /** 一覧を見せるだけでなく、本当に消す。 */
  yes?: boolean
}

/** 消す物 1 つ。置き場に頼む引数と、控えの中で消す物（file か folder）。 */
interface DeleteTarget {
  query: URLSearchParams
  /** 置き場の中の path のうち、消す物に当たるか。 */
  covers: (path: string) => boolean
  /** 控えの folder の中の、消す file か folder（project・Key ごとなら folder ごと消す）。 */
  local: string[]
  /** 合う file（ページが参照する画像など）も一緒に消すか（Key・project ごとの時）。 */
  files: boolean
}

/**
 * ページを消す（戻せない）。消してよいのは TPM 担当だけ（担当の居場所から打つと止まる）。
 * URL を名指すか、--key（今の project か --project の、その Key のページみな）か、--project だけ（その project のページみな）。
 * --key・--project の時は、合う file も一緒に消す（file を扱えない前の置き場なら、file は無い物とする）。
 * まず消す物を一覧で出し、--yes を付けたときだけ置き場に頼む。置き場は番号を残すので、消した URL は 410 になり、同じ番号は 2 度使われない。
 * 消した後に、控えの file（Key・project ごとなら folder）も消す。
 */
export function pageDelete(ctx: Context, urls: string[], options: PageDeleteOptions): string[] {
  if (roleOf(ctx.env) !== undefined) throw new TpmError('ページを消せるのは TPM 担当だけです。消すページの URL と訳を、tpm ask tpm で TPM 担当に送って頼んでください');
  const targets = deleteTargets(ctx, urls, options);
  const dir = pagesDir(ctx.env);
  const found = targets.map((target) => {
    const query = new URLSearchParams({ project: target.query.get('project') ?? '', limit: '1000' });
    const key = target.query.get('key');
    if (key !== null) query.set('key', key);
    const r = call(ctx, [`${pagesUrl(ctx.env)}/api/pages?${query.toString()}`]);
    if (r.code === '000') throw down(ctx, 'ページは消していません。');
    if (r.code !== '200') throw new TpmError(`置き場が一覧を返しませんでした（${r.code}）: ${reason(r.body)}`);
    const pages = (JSON.parse(r.body) as { pages: PageRecord[] }).pages.filter(p => target.covers(p.path));
    return { target, pages, files: target.files ? findFiles(ctx, query) ?? [] : [] };
  });
  const pages = found.flatMap(f => f.pages);
  const files = found.flatMap(f => f.files);
  if (pages.length === 0 && files.length === 0) return ['置き場に、消すページは無い'];
  if (!options.yes) {
    return [
      ...pages.length > 0 ? [`消すページ（${pages.length} 枚。戻せない）:`, ...pages.map(p => `${pagesUrl(ctx.env)}${p.path}  ${p.title}`)] : [],
      ...files.length > 0 ? [`消す file（${files.length} 個。戻せない）:`, ...files.map(f => `${pagesUrl(ctx.env)}${f.path}  ${f.size} byte`)] : [],
      '消すには、同じ命令に --yes を付けて打ってください',
    ];
  }
  const removed = found.map(({ target, files }) => {
    const r = call(ctx, ['-X', 'DELETE', `${pagesUrl(ctx.env)}/api/pages?${target.query.toString()}`]);
    if (r.code === '000') throw down(ctx, 'ページは消していません。');
    if (r.code !== '200') throw new TpmError(`置き場がページを消しませんでした（${r.code}）: ${reason(r.body)}`);
    const gone = { pages: (JSON.parse(r.body) as { removed: string[] }).removed, files: files.length > 0 ? removeFiles(ctx, target.query) : [] };
    for (const local of target.local) removeLocal(dir, local);
    return gone;
  });
  const [gonePages, goneFiles] = [removed.flatMap(g => g.pages), removed.flatMap(g => g.files)];
  return [
    `消した: ${gonePages.length} 枚（控えも消した）`,
    ...gonePages.map(path => `- ${pagesUrl(ctx.env)}${path}`),
    ...goneFiles.length > 0 ? [`消した file: ${goneFiles.length} 個`, ...goneFiles.map(path => `- ${pagesUrl(ctx.env)}${path}`)] : [],
  ];
}

/** 消す物を、URL か旗から作る。 */
function deleteTargets(ctx: Context, urls: string[], options: PageDeleteOptions): DeleteTarget[] {
  const dir = pagesDir(ctx.env);
  if (urls.length > 0) {
    if (options.key !== undefined || options.project !== undefined) throw new TpmError('URL と --key・--project は一緒に書けません');
    return urls.map((url) => {
      const [project = '', key = '', file = '', ...rest] = (inStore(ctx.env, url) ?? '').split('/');
      const m = PAGE_FILE.exec(file);
      if (m === null || rest.length > 0 || !PROJECT.test(project) || !KEY.test(key)) throw new TpmError(`置き場のページの URL ではありません: ${url}`);
      const path = `/${project}/${key}/${file}`;
      return { query: new URLSearchParams({ project, key, kind: m[1] ?? '', n: m[2] ?? '' }), covers: p => p === path, local: [join(dir, project, key, file)], files: false };
    });
  }
  const project = options.project ?? basename(ctx.state.dir);
  if (!PROJECT.test(project)) throw new TpmError(`project の名に使えない字があります: ${project}`);
  if (options.key === undefined) {
    if (options.project === undefined) throw new TpmError('消すページの URL か、--key <Key>・--project <名> を書いてください');
    return [{ query: new URLSearchParams({ project }), covers: p => p.startsWith(`/${project}/`), local: [join(dir, project)], files: true }];
  }
  const key = options.key;
  if (!KEY.test(key)) throw new TpmError(`課題の Key に使えない字があります: ${key}`);
  return [{ query: new URLSearchParams({ project, key }), covers: p => p.startsWith(`/${project}/${key}/`), local: [join(dir, project, key)], files: true }];
}
