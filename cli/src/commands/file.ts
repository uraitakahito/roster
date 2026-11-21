// ページから参照する画像・PDF・字の file を、置き場（pagetray 0.4.0 から）に上げる・読む・探す・消す。
// 番号は置き場が決める（`<語>-<番号>.<拡張子>`。同じ名で上げ直すと次の番号になり、前の物は残る）。
// 上げた・読んだ file は、控えの folder の `<project>/<Key>/files/` にも写す。ページからの相対の参照（`files/…`・`../<Key>/files/…`）が、置き場でも控えでも同じ形で開くように。
// 上げた file は model にも人にも見えるので、画像と PDF は人（担当）が中身を見た印（--reviewed）を、字の file は秘密の形の走査を、上げる前に求める。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Context } from '../context.ts';
import { TpmError } from '../skill-sets.ts';
import { roleOf } from './infra.ts';
import type { PageRecord } from './page.ts';
import { call, compareStored, down, fetchTo, inStore, KEY, localPath, pagesDir, pagesUrl, PROJECT, reason, removeLocal, requireKey, selfAddress, writeCopy } from './store.ts';

/** 置き場が返す、file 1 つの記録（中身は入らない）。 */
export interface FileRecord {
  project: string
  key: string
  /** 名の語（`screen`）。 */
  name: string
  /** 拡張子（`png`）。 */
  ext: string
  /** 名と拡張子ごとの番号。 */
  n: number
  /** 返す時の Content-Type。 */
  type: string
  size: number
  /** 中身の SHA-256（16 進の小文字）。 */
  sha256: string
  /** 上げた担当の役割（取り込んだ物は unknown）。 */
  role: string
  /** 上げた担当の居場所の宛先（わからなければ空）。 */
  workspace: string
  /** 上げた時刻（UTC の ISO）。 */
  created_at: string
  /** 置き場の中の path（`/<project>/<Key>/files/<語>-<番号>.<拡張子>`）。 */
  path: string
}

/** 置き場が受ける file の種類（拡張子 → 送る Content-Type）。pagetray の crates/api の FILE_TYPES と揃える。 */
export const FILE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
};
/** 上げる前に、中身を見た印（--reviewed）が要る種類（画像と PDF。字の file は秘密の形を走査する）。 */
const NEEDS_REVIEW = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf']);
/** 1 つの file の上限（置き場と同じ 16 MiB）。 */
const MAX_FILE = 16 * 1024 * 1024;
/** 名の語（英小文字・数字・- _ で 1〜64 字。英小文字か数字で始まる）。 */
const STEM = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** 置き場の file の名（`<語>-<番号>.<拡張子>`。番号は頭に 0 の無い 1 以上）。 */
const STORED = /^([a-z0-9][a-z0-9_-]{0,63})-([1-9]\d*)\.([a-z0-9]+)$/;

/** 字の file の中の、秘密の形（token・鍵の頭）。pagetray の ci/strings-deny.txt と揃える。 */
const SECRETS = [
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[bp]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bATATT[A-Za-z0-9_=-]{20,}/,
];

/** 置き場が file を扱えない（0.4.0 より前の置き場は、file のエンドポイントに 404 を返す）時の文。 */
const oldStore = (): TpmError => new TpmError('置き場（pagetray）の版が古く、file を扱えません。tpm ask devops で置き場の版を上げるよう頼んでください');

/** 置き場の file の名（`<語>-<番号>.<拡張子>`）を分ける。形でないか、受けない拡張子なら undefined。 */
export function parseStoredName(name: string): { stem: string, n: string, ext: string } | undefined {
  const m = STORED.exec(name);
  if (m === null || !Object.hasOwn(FILE_TYPES, m[3] ?? '')) return undefined;
  return { stem: m[1] ?? '', n: m[2] ?? '', ext: m[3] ?? '' };
}

/**
 * 元の file の名から、置き場に上げる名（`<語>.<拡張子>`）を作る。語は小文字にし、英小文字・数字・- _ でない字の続きを - 1 つにし、
 * 頭と末尾の - と _ を落として 64 字までにする。字が残らなければ `file`。拡張子も小文字にする（受けるかは見ない）。
 */
export function uploadName(file: string): string {
  const name = basename(file);
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot <= 0 ? [name, ''] : [name.slice(0, dot), name.slice(dot + 1)];
  const trim = (s: string): string => s.replace(/^[-_]+/, '').replace(/[-_]+$/, '');
  const word = trim(trim(stem.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')).slice(0, 64));
  return `${word === '' ? 'file' : word}.${ext.toLowerCase()}`;
}

/** 字の file の中で、秘密の形に当たる行の番号（1 から）。 */
function secretLines(text: string): number[] {
  return text.split('\n').flatMap((line, i) => SECRETS.some(re => re.test(line)) ? [i + 1] : []);
}

/** JPEG に EXIF（APP1 の `Exif`。撮った所の位置が入りうる）があるか。画像の本体（SOS）の前の区切りだけを見る。 */
function hasExif(body: Buffer): boolean {
  for (let at = 2; at + 4 <= body.length && body[at] === 0xFF;) {
    const marker = body[at + 1];
    if (marker === 0xDA) return false;
    if (marker === 0xE1 && body.toString('latin1', at + 4, at + 10) === 'Exif\0\0') return true;
    at += 2 + body.readUInt16BE(at + 2);
  }
  return false;
}

/** 置き場に file を 1 つ送る。置けたら記録を、番号を名指して使われていたら 'taken' を返す。ほかは止まる。 */
function postFile(ctx: Context, file: string, ext: string, query: URLSearchParams): FileRecord | 'taken' {
  const r = call(ctx, ['-X', 'POST', '-H', `Content-Type: ${FILE_TYPES[ext] ?? ''}`, '--data-binary', `@${file}`, `${pagesUrl(ctx.env)}/api/files?${query.toString()}`]);
  if (r.code === '201') return JSON.parse(r.body) as FileRecord;
  if (r.code === '409') return 'taken';
  if (r.code === '404') throw oldStore();
  if (r.code === '000') throw down(ctx, 'file は上げていません（番号は置き場が決めます）。');
  throw new TpmError(`置き場が file を受け取りませんでした（${r.code}）: ${reason(r.body)}`);
}

/** `tpm file put` の旗。 */
export interface FilePutOptions {
  /** 置き場での名（`<語>.<拡張子>`）。無ければ元の file の名から作る。 */
  name?: string
  /** 画像・PDF の中身を Read tool で見て、秘密が写っていないと確かめた。 */
  reviewed?: boolean
  /** 秘密の形に当たる字の file を、わかった上で上げる（使ったことは状態の folder の file-secret.jsonl に残す）。 */
  allowSecret?: boolean
  key?: string
}

/**
 * file を置き場に上げる。置き場が番号を決めて DB に持ち、控えの `<project>/<Key>/files/<語>-<番号>.<拡張子>` に写して、URL とページからの参照の書き方を返す。
 * Key は --key、無ければ $TPM_KEY（担当）。画像と PDF は --reviewed が無ければ、字の file は秘密の形に当たれば（--allow-secret が無ければ）、置き場に頼む前に止まる。
 */
export function filePut(ctx: Context, file: string, options: FilePutOptions): string[] {
  if (!existsSync(file) || !statSync(file).isFile()) throw new TpmError(`file がありません: ${file}`);
  const name = options.name ?? uploadName(file);
  const dot = name.indexOf('.');
  const [stem, ext] = [name.slice(0, dot), name.slice(dot + 1)];
  if (dot < 0 || !STEM.test(stem)) throw new TpmError(`置き場での名は <語>.<拡張子> にしてください（語は英小文字・数字・- _ で 1〜64 字。英小文字か数字で始める）: ${name}。--name で名を付けられます`);
  if (!Object.hasOwn(FILE_TYPES, ext)) throw new TpmError(`置き場が受けない種類の file です（.${ext}）。受けるのは ${Object.keys(FILE_TYPES).join('・')} だけです（動画・HTML・SVG は受けない）`);
  const size = statSync(file).size;
  if (size === 0) throw new TpmError(`file が空です: ${file}`);
  if (size > MAX_FILE) throw new TpmError(`file が大きすぎます（${size} byte。16 MiB まで）: ${file}`);
  const key = requireKey(ctx, options.key);
  const body = readFileSync(file);
  if (NEEDS_REVIEW.has(ext) && !options.reviewed) {
    throw new TpmError(`画像と PDF は、上げる前に中身を見てください。Read tool でその file を見て、token・鍵・個人の情報・ほかの人の画面・この Mac の path が写っていないか確かめてから --reviewed を付けて打つ: ${file}`);
  }
  const secrets = NEEDS_REVIEW.has(ext) ? [] : secretLines(body.toString('utf8'));
  if (secrets.length > 0 && !options.allowSecret) {
    throw new TpmError(`秘密の形（token・鍵）に当たる行があります: ${secrets.join('・')} 行目（${file}）。上げていません。その行を消してから上げるか、秘密でないと確かめたなら --allow-secret を付けて打ってください`);
  }
  const role = roleOf(ctx.env) ?? 'tpm';
  const query = new URLSearchParams({ project: basename(ctx.state.dir), key, name: `${stem}.${ext}`, role, workspace: selfAddress(ctx) });
  const record = postFile(ctx, file, ext, query);
  if (record === 'taken') throw new TpmError('置き場が番号を決められませんでした（409）。もう 1 度打ってください');
  const path = localPath(ctx, record.path);
  writeCopy(ctx, path, body);
  const url = `${pagesUrl(ctx.env)}${record.path}`;
  if (secrets.length > 0) ctx.state.append('file-secret.jsonl', { at: ctx.now().toISOString(), url, file, lines: secrets, role, key });
  return [
    `置いた: ${path}`,
    `URL: ${url}`,
    `ページからの参照: files/${basename(record.path)}`,
    ...(ext === 'jpg' || ext === 'jpeg') && hasExif(body) ? ['注意: この写真には EXIF があり、撮った所の位置が入っているかもしれない。消すなら sips などで消して上げ直し、前の物は tpm ask tpm で消してもらう'] : [],
    ...secrets.length > 0 ? [`注意: 秘密の形に当たる行（${secrets.join('・')} 行目）をそのまま上げた（--allow-secret）`] : [],
  ];
}

/** URL を、置き場の file の project・Key・名と、置き場の中の path にする。file の URL でなければ止まる。 */
function parseFileUrl(ctx: Context, url: string): { project: string, key: string, name: string, storePath: string } {
  const [project = '', key = '', files = '', name = '', ...rest] = (inStore(ctx.env, url) ?? '').split('/');
  if (rest.length > 0 || files !== 'files' || !PROJECT.test(project) || !KEY.test(key) || parseStoredName(name) === undefined) {
    throw new TpmError(`置き場の file の URL ではありません（${pagesUrl(ctx.env)}/<project>/<Key>/files/<語>-<番号>.<拡張子>）: ${url}`);
  }
  return { project, key, name, storePath: `/${project}/${key}/files/${name}` };
}

/** 置き場から file を取り、控えの path に書く。取れなければ訳を添えて止まる。 */
function fetchFile(ctx: Context, storePath: string, path: string): void {
  const code = fetchTo(ctx, storePath, path);
  const url = `${pagesUrl(ctx.env)}${storePath}`;
  if (code === '200') return;
  if (code === '000') throw down(ctx, `控え（${path}）もありません。`);
  if (code === '410') throw new TpmError(`置き場の file は消してあります（410）: ${url}`);
  // 0.4.0 より前の置き場も、file の URL に 404 を返す。探すエンドポイントがあるかで分ける。
  if (code === '404' && call(ctx, [`${pagesUrl(ctx.env)}/api/files?limit=1`]).code === '404') throw oldStore();
  throw new TpmError(`置き場に file がありません（${code}）: ${url}`);
}

/** 置き場の file の URL を、控えの file の path にする（Read tool で読むため）。控えに無ければ、置き場から取って控えに写す。 */
export function filePath(ctx: Context, url: string): string[] {
  const { storePath } = parseFileUrl(ctx, url);
  const path = localPath(ctx, storePath);
  if (!existsSync(path)) fetchFile(ctx, storePath, path);
  return [path];
}

/** ページの HTML の src・href にある、置き場の file への相対の参照（同じ Key の `files/…`、別の Key の `../<Key>/files/…`）。key はそのページの Key。 */
export function fileRefs(html: string, key: string): { key: string, name: string }[] {
  const found = new Map<string, { key: string, name: string }>();
  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
    const value = (m[1] ?? m[2] ?? m[3] ?? '').replace(/[?#].*$/, '');
    const r = /^(?:\.\/)?(?:\.\.\/([^/]+)\/)?files\/([^/]+)$/.exec(value);
    if (r === null) continue;
    const ref = { key: r[1] ?? key, name: r[2] ?? '' };
    // 控えの folder の外へ出ないよう、Key と名を置き場の決まりで見る。
    if (KEY.test(ref.key) && parseStoredName(ref.name) !== undefined) found.set(`${ref.key}/${ref.name}`, ref);
  }
  return [...found.values()];
}

/**
 * 控えのページ（project・key の）が参照する file のうち、控えに無い物を置き場から取って控えに写す（`tpm page path`）。
 * 取れなくてもページは読めるので止まらず、注意の行を返す。控えにある参照の file は、その path を返す。
 */
export function copyRefs(ctx: Context, project: string, key: string, page: string): string[] {
  return fileRefs(readFileSync(page, 'utf8'), key).map((ref) => {
    const storePath = `/${project}/${ref.key}/files/${ref.name}`;
    const path = localPath(ctx, storePath);
    try {
      if (!existsSync(path)) fetchFile(ctx, storePath, path);
      return `参照の file: ${path}`;
    }
    catch (error) {
      if (!(error instanceof TpmError)) throw error;
      return `注意: ページが参照する file を取れなかった（${pagesUrl(ctx.env)}${storePath}）: ${error.message}`;
    }
  });
}

/** 置き場の file を探す。0.4.0 より前の置き場（探すエンドポイントが無い）なら undefined。 */
export function findFiles(ctx: Context, query: URLSearchParams): FileRecord[] | undefined {
  const r = call(ctx, [`${pagesUrl(ctx.env)}/api/files?${query.toString()}`]);
  if (r.code === '404') return undefined;
  if (r.code === '000') throw down(ctx, '');
  if (r.code !== '200') throw new TpmError(`置き場が file の一覧を返しませんでした（${r.code}）: ${reason(r.body)}`);
  return (JSON.parse(r.body) as { files: FileRecord[] }).files;
}

/** `tpm file list` の旗。 */
export interface FileListOptions {
  key?: string
  role?: string
  q?: string
  /** 出す件数（既定は 50）。 */
  limit?: string
  /** ほかの project の file も出す。 */
  allProjects?: boolean
  json?: boolean
}

/** 置き場の file を絞って探す。既定は、今の project の新しい順。--json は記録の配列（url を足した物）を出す。 */
export function fileList(ctx: Context, options: FileListOptions): string[] {
  const query = new URLSearchParams({ limit: options.limit ?? '50' });
  if (!options.allProjects) query.set('project', basename(ctx.state.dir));
  for (const name of ['key', 'role', 'q'] as const) {
    const value = options[name];
    if (value !== undefined) query.set(name, value);
  }
  const files = findFiles(ctx, query)?.map(f => ({ ...f, url: `${pagesUrl(ctx.env)}${f.path}` }));
  if (files === undefined) throw oldStore();
  if (options.json) return [JSON.stringify(files, null, 2)];
  if (files.length === 0) return ['合う file は無い'];
  return files.map(f => [f.created_at, f.key, basename(f.path), f.role, f.workspace === '' ? '-' : f.workspace, f.url, `${f.size} byte`].join('  '));
}

/** 置き場の file を消す（DELETE /api/files。query は project と、key・name・n）。消した path を返す。 */
export function removeFiles(ctx: Context, query: URLSearchParams): string[] {
  const r = call(ctx, ['-X', 'DELETE', `${pagesUrl(ctx.env)}/api/files?${query.toString()}`]);
  if (r.code === '404') throw oldStore();
  if (r.code === '000') throw down(ctx, 'file は消していません。');
  if (r.code !== '200') throw new TpmError(`置き場が file を消しませんでした（${r.code}）: ${reason(r.body)}`);
  return (JSON.parse(r.body) as { removed: string[] }).removed;
}

/** 置いた file を参照しているページ（同じ project の）。ページの本文は控えから読み、控えに無ければ置き場から取って写す。 */
function referrers(ctx: Context, files: FileRecord[]): string[] {
  const projects = [...new Set(files.map(f => f.project))];
  const targets = new Set(files.map(f => f.path));
  return projects.flatMap((project) => {
    const r = call(ctx, [`${pagesUrl(ctx.env)}/api/pages?${new URLSearchParams({ project, limit: '1000' }).toString()}`]);
    if (r.code === '000') throw down(ctx, 'file は消していません。');
    if (r.code !== '200') throw new TpmError(`置き場がページの一覧を返しませんでした（${r.code}）: ${reason(r.body)}`);
    return (JSON.parse(r.body) as { pages: PageRecord[] }).pages.flatMap((page) => {
      const path = localPath(ctx, page.path);
      if (!existsSync(path) && fetchTo(ctx, page.path, path) !== '200') return [`  （読めなかったページ: ${pagesUrl(ctx.env)}${page.path}）`];
      const hits = fileRefs(readFileSync(path, 'utf8'), page.key).map(ref => `/${project}/${ref.key}/files/${ref.name}`).filter(p => targets.has(p));
      return hits.map(p => `  ${pagesUrl(ctx.env)}${page.path}  ${page.title}（${basename(p)} を参照）`);
    });
  });
}

/**
 * file を消す（戻せない）。消してよいのは TPM 担当だけ（担当の居場所から打つと止まる）。
 * まず消す物と、それを参照しているページ（消すと図やリンクが切れる）を出し、--yes を付けたときだけ置き場に頼む。置き場は番号を残すので、消した URL は 410 になる。控えの file も消す。
 */
export function fileDelete(ctx: Context, urls: string[], options: { yes?: boolean }): string[] {
  if (roleOf(ctx.env) !== undefined) throw new TpmError('file を消せるのは TPM 担当だけです。消す file の URL と訳を、tpm ask tpm で TPM 担当に送って頼んでください');
  if (urls.length === 0) throw new TpmError('消す file の URL を書いてください');
  const targets = [...new Map(urls.map(url => parseFileUrl(ctx, url)).map(t => [t.storePath, t])).values()];
  const listed = targets.flatMap((t) => {
    const { stem, ext } = parseStoredName(t.name) ?? { stem: '', ext: '' };
    const found = findFiles(ctx, new URLSearchParams({ project: t.project, key: t.key, q: `${stem}.${ext}`, limit: '1000' }));
    if (found === undefined) throw oldStore();
    return found.filter(f => f.path === t.storePath);
  });
  if (listed.length === 0) return ['置き場に、消す file は無い'];
  const lines = listed.map(f => `${pagesUrl(ctx.env)}${f.path}  ${f.size} byte`);
  if (!options.yes) {
    const refs = referrers(ctx, listed);
    return [
      `消す file（${listed.length} 個。戻せない）:`,
      ...lines,
      ...refs.length > 0 ? ['参照しているページ（消すと、その図やリンクが切れる）:', ...refs] : ['参照しているページは無い'],
      '消すには、同じ命令に --yes を付けて打ってください',
    ];
  }
  const removed = listed.flatMap((f) => {
    const gone = removeFiles(ctx, new URLSearchParams({ project: f.project, key: f.key, name: `${f.name}.${f.ext}`, n: String(f.n) }));
    removeLocal(pagesDir(ctx.env), localPath(ctx, f.path));
    return gone;
  });
  return [`消した: ${removed.length} 個（控えも消した）`, ...removed.map(path => `- ${pagesUrl(ctx.env)}${path}`)];
}

/**
 * 控えの folder の `<project>/<Key>/files/` にあって置き場に無い file を、同じ番号・file の時刻で置き場に入れる（`tpm page import`）。
 * 消した file（置き場が 410 を返す番号）は入れない。上げた担当はわからないので、役割は unknown、居場所は空で入る。控えに file が無ければ置き場に聞かない。
 */
export function fileImport(ctx: Context): string[] {
  const dir = pagesDir(ctx.env);
  const folders = (path: string): string[] => existsSync(path) ? readdirSync(path, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name) : [];
  const cached = folders(dir).filter(project => PROJECT.test(project)).flatMap(project =>
    folders(join(dir, project)).filter(key => KEY.test(key) && existsSync(join(dir, project, key, 'files'))).flatMap(key =>
      readdirSync(join(dir, project, key, 'files')).flatMap((name) => {
        const m = parseStoredName(name);
        return m === undefined ? [] : [{ project, key, name, ...m, file: join(dir, project, key, 'files', name) }];
      })));
  if (cached.length === 0) return [];
  const added: string[] = [];
  const conflicts: string[] = [];
  const counts = { same: 0, removed: 0 };
  for (const f of cached) {
    const storePath = `/${f.project}/${f.key}/files/${f.name}`;
    const query = new URLSearchParams({
      project: f.project,
      key: f.key,
      name: `${f.stem}.${f.ext}`,
      role: 'unknown',
      workspace: '',
      n: f.n,
      created_at: statSync(f.file).mtime.toISOString(),
    });
    if (postFile(ctx, f.file, f.ext, query) !== 'taken') {
      added.push(storePath);
      continue;
    }
    const seen = compareStored(ctx, storePath, f.file);
    if (seen === 'conflict') conflicts.push(f.file);
    else counts[seen] += 1;
  }
  return [
    `file: 入れた: ${added.length} 個・もう入っていた: ${counts.same} 個・消した file: ${counts.removed} 個・ぶつかった: ${conflicts.length} 個`,
    ...added.map(path => `+ ${pagesUrl(ctx.env)}${path}`),
    ...conflicts.map(file => `! 同じ番号に別の中身がある（入れていない。要るなら tpm file put で上げ直す）: ${file}`),
  ];
}
