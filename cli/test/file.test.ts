import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { castlistIssuer } from '../src/castlist.ts';
import { fileDelete, fileList, filePath, filePut, uploadName } from '../src/commands/file.ts';
import { pagePath, pagePut } from '../src/commands/page.ts';
import type { Context } from '../src/context.ts';
import { writeRole } from '../src/roster.ts';
import { world } from './helpers.ts';

const BASE = 'http://127.0.0.1:8801';
/** PNG の頭の 8 byte と、少しの中身。 */
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('png の中身')]);
/** 試験の中で秘密の形を組み立てる（この file そのものが秘密の形に見えないように）。 */
const TOKEN = ['gh', 'p_', 'a'.repeat(36)].join('');

/** 控えを一時の folder にし、偽の置き場に向けた、t-x7k2 の Software Engineer 担当（居場所 file:1）と TPM 担当の周り。 */
function setup() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tpm-files-')));
  const src = realpathSync(mkdtempSync(join(tmpdir(), 'tpm-files-src-')));
  const w = world();
  const wire = (ctx: Context, env: NodeJS.ProcessEnv = {}): Context => ({ ...ctx, env: { ...ctx.env, TPM_PAGES_DIR: dir, ...env } });
  const role = wire(w.role('t-x7k2', 'file:1'), { TPM_ROLE: 'software-engineer' });
  const tpm = wire(w.tpm);
  writeRole(tpm, { key: 't-x7k2', role: 'software-engineer', title: 'SWE t-x7k2', cwd: w.project, addDirs: [], model: 'm', effort: 'e', permissionMode: 'p', address: 'file:1' });
  tpm.state.write('tpm.jsonc', { address: 'file:tpm' });
  const project = basename(w.tpm.state.dir);
  /** 元の file を一時の folder に書く。 */
  const source = (name: string, body: Buffer | string): string => {
    writeFileSync(join(src, name), body);
    return join(src, name);
  };
  const curls = (): string[][] => w.calls.filter(c => c.cmd === 'curl').map(c => c.args);
  /** 置いて、出た URL を返す。 */
  const put = (ctx: Context, name: string, body: Buffer | string = PNG): string => filePut(ctx, source(name, body), { reviewed: true })[1]?.replace('URL: ', '') ?? '';
  return { dir, src, w, store: w.store, role, tpm, project, source, curls, put };
}

describe('tpm file put', () => {
  test('画像は --reviewed が無ければ、置き場に頼む前に、Read で見るよう言って止まる', () => {
    const s = setup();
    const file = s.source('screen.png', PNG);
    expect(() => filePut(s.role, file, {})).toThrow(/Read tool でその file を見て、token・鍵・個人の情報・ほかの人の画面・tpm を動かす機械の path が写っていないか確かめてから --reviewed を付けて打つ/);
    expect(() => filePut(s.role, s.source('doc.pdf', '%PDF-1.4'), {})).toThrow('--reviewed');
    expect(s.curls()).toEqual([]);
  });

  test('置き場が番号を決め、控えの <Key>/files/ に写し、URL とページからの参照を出す。2 度目は -2', () => {
    const s = setup();
    const file = s.source('screen.png', PNG);
    const path = join(s.dir, s.project, 't-x7k2', 'files', 'screen-1.png');
    expect(filePut(s.role, file, { reviewed: true })).toEqual([
      `置いた: ${path}`,
      `URL: ${BASE}/${s.project}/t-x7k2/files/screen-1.png`,
      'ページからの参照: files/screen-1.png',
    ]);
    expect(readFileSync(path).equals(PNG)).toBe(true);
    expect(s.store.files.get(`/${s.project}/t-x7k2/files/screen-1.png`)?.record).toMatchObject({ role: 'software-engineer', workspace: 'file:1', type: 'image/png' });
    expect(s.curls()[0]).toEqual([
      '-sS',
      '--max-time',
      '10',
      '-w',
      '\n%{http_code} %header{pagetray-api}',
      '-X',
      'POST',
      '-H',
      'Content-Type: image/png',
      '--data-binary',
      `@${file}`,
      `${BASE}/api/files?project=${encodeURIComponent(s.project)}&key=t-x7k2&name=screen.png&role=software-engineer&workspace=file%3A1`,
    ]);
    expect(filePut(s.role, file, { reviewed: true })[2]).toBe('ページからの参照: files/screen-2.png');
  });

  test('名は元の file の名から作り、--name で替えられる。名の決まりに合わない --name・受けない種類・空・大きすぎは止める', () => {
    expect(uploadName('/x/Screenshot 2026-11-21 at 10.00.PNG')).toBe('screenshot-2026-11-21-at-10-00.png');
    expect(uploadName('画面.jpg')).toBe('file.jpg');
    expect(uploadName('_a__b--.txt')).toBe('a__b.txt');
    expect(uploadName(`${'a'.repeat(70)}.md`)).toBe(`${'a'.repeat(64)}.md`);
    const s = setup();
    expect(filePut(s.role, s.source('My Notes.txt', 'メモ'), { name: 'notes_v2.md' })[2]).toBe('ページからの参照: files/notes_v2-1.md');
    expect(s.store.files.get(`/${s.project}/t-x7k2/files/notes_v2-1.md`)?.record.type).toBe('text/markdown; charset=utf-8');
    const before = s.curls().length;
    expect(() => filePut(s.role, s.source('a.txt', 'x'), { name: 'Bad.txt' })).toThrow('<語>.<拡張子>');
    expect(() => filePut(s.role, s.source('a.txt', 'x'), { name: 'noext' })).toThrow('<語>.<拡張子>');
    expect(() => filePut(s.role, s.source('pic.svg', '<svg/>'), {})).toThrow('受けない種類の file です（.svg）');
    expect(() => filePut(s.role, s.source('movie.mp4', 'x'), {})).toThrow('受けない種類');
    expect(() => filePut(s.role, s.source('empty.txt', ''), {})).toThrow('file が空です');
    const big = s.source('big.log', '');
    truncateSync(big, 16 * 1024 * 1024 + 1);
    expect(() => filePut(s.role, big, {})).toThrow('16 MiB まで');
    expect(() => filePut(s.role, join(s.src, 'none.png'), {})).toThrow('file がありません');
    expect(s.curls()).toHaveLength(before);
  });

  test('字の file は --reviewed なしで上がる。秘密の形に当たれば、行の番号だけを出して止まる（秘密そのものは出さない）', () => {
    const s = setup();
    expect(filePut(s.role, s.source('build.log', 'ok\nfine\n'), {})[1]).toContain('/files/build-1.log');
    const lines = ['ok', `token=${TOKEN}`, 'x', 'AKIA' + 'ABCDEFGHIJKLMNOP', ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ')];
    const file = s.source('leak.txt', lines.join('\n'));
    let message = '';
    try {
      filePut(s.role, file, {});
    }
    catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('2・4・5 行目');
    expect(message).toContain('--allow-secret');
    expect(message).not.toContain(TOKEN);
    expect(s.store.files.size).toBe(1);
    for (const secret of [['github', '_pat_', 'A'.repeat(30)], ['sk-', 'ant-', 'b'.repeat(30)], ['xo', 'xb-', '1234567890-abc'], ['ATA', 'TT', 'x'.repeat(40)]]) {
      expect(() => filePut(s.role, s.source('one.txt', secret.join('')), {}), secret.join('')).toThrow('1 行目');
    }
  });

  test('--allow-secret なら上げ、注意の行を出し、状態の folder の file-secret.jsonl に残す', () => {
    const s = setup();
    const lines = filePut(s.role, s.source('leak.txt', `a\n${TOKEN}\n`), { allowSecret: true });
    expect(lines.at(-1)).toBe('注意: 秘密の形に当たる行（2 行目）をそのまま上げた（--allow-secret）');
    expect(s.role.state.lines('file-secret.jsonl')).toEqual([expect.objectContaining({ url: `${BASE}/${s.project}/t-x7k2/files/leak-1.txt`, lines: [2], role: 'software-engineer', key: 't-x7k2' })]);
  });

  test('EXIF のある JPEG は、上げた上で位置情報の注意を出す。EXIF の無い JPEG には出さない', () => {
    const s = setup();
    const app1 = Buffer.concat([Buffer.from('ffe10010', 'hex'), Buffer.from('Exif\0\0'), Buffer.alloc(8)]);
    const jpeg = (...parts: Buffer[]): Buffer => Buffer.concat([Buffer.from('ffd8', 'hex'), ...parts, Buffer.from('ffda000200', 'hex')]);
    const app0 = Buffer.concat([Buffer.from('ffe00010', 'hex'), Buffer.from('JFIF\0'), Buffer.alloc(9)]);
    expect(filePut(s.role, s.source('photo.jpg', jpeg(app0, app1)), { reviewed: true }).at(-1)).toMatch(/^注意: この写真には EXIF があり/);
    expect(filePut(s.role, s.source('plain.jpeg', jpeg(app0)), { reviewed: true })).toHaveLength(3);
  });

  test('TPM 担当は --key で上げ、役割は tpm。--key が無ければ止まる', () => {
    const s = setup();
    expect(() => filePut(s.tpm, s.source('a.png', PNG), { reviewed: true })).toThrow('--key');
    expect(filePut(s.tpm, s.source('a.png', PNG), { reviewed: true, key: 'AI-24' })[1]).toBe(`URL: ${BASE}/${s.project}/AI-24/files/a-1.png`);
    expect(s.store.files.get(`/${s.project}/AI-24/files/a-1.png`)?.record).toMatchObject({ role: 'tpm', workspace: 'file:tpm' });
  });

  test('置き場が断れば訳を出す。応えなければ DevOps に頼むよう言う。控えは書かない', () => {
    const s = setup();
    s.store.refuse = { code: 415, body: '{"error":"中身が拡張子の形でない"}' };
    expect(() => s.put(s.role, 'a.png')).toThrow('置き場が file を受け取りませんでした（415）: 中身が拡張子の形でない');
    s.store.refuse = undefined;
    s.store.down = true;
    expect(() => s.put(s.role, 'a.png')).toThrow(/応えません。file は上げていません.*tpm ask devops/);
    expect(existsSync(join(s.dir, s.project))).toBe(false);
  });
});

describe('tpm file put の送り手（pagetray 0.6.0 の actor_issuer・actor_ref）', () => {
  const SID = '5f0c2a8e-0000-4000-8000-000000000002';
  const seated = (ctx: Context, env: NodeJS.ProcessEnv = {}): Context => ({ ...ctx, env: { ...ctx.env, TPM_CASTLIST_URL: 'http://127.0.0.1:8802', CLAUDE_CODE_SESSION_ID: SID, ...env } });

  test('castlist の設定と session の id があれば、ページと同じ issuer と claude.session:<id> を付ける', () => {
    const s = setup();
    s.put(seated(s.role), 'screen.png');
    expect(s.store.posts.map(q => [q.get('actor_issuer'), q.get('actor_ref')])).toEqual([[castlistIssuer(s.w.tpm.state.dir), `claude.session:${SID}`]]);
    expect(s.curls()[0]?.at(-1)).toContain(`&actor_ref=claude.session%3A${SID}`);
    expect(s.store.files.get(`/${s.project}/t-x7k2/files/screen-1.png`)?.record).toMatchObject({ role: 'software-engineer' });
  });

  test('castlist の設定が無い・session の id が無い時は付けない', () => {
    const s = setup();
    s.put({ ...s.role, env: { ...s.role.env, CLAUDE_CODE_SESSION_ID: SID } }, 'a.png');
    s.put(seated(s.role, { CLAUDE_CODE_SESSION_ID: undefined }), 'b.png');
    expect(s.store.posts.map(q => q.has('actor_issuer') || q.has('actor_ref'))).toEqual([false, false]);
  });

  test('503 は castlist に聞けない、422 は登録が無い。どちらも file を上げずに 1 行で止まり、控えも書かない', () => {
    const s = setup();
    s.store.sender = 'unreachable';
    expect(() => s.put(seated(s.role), 'a.png')).toThrow(/^置き場（http:\/\/127\.0\.0\.1:8801）が castlist に送り手を聞けませんでした（503）。file は上げていません。.*castlist が起きてから.*打ち直して.*tpm report incident[^\n]*$/);
    s.store.sender = 'unregistered';
    expect(() => s.put(seated(s.role), 'a.png')).toThrow(new RegExp(`^この session（claude\\.session:${SID}）は castlist に登録が無いと、置き場が答えました（422）。file は上げていません。.*guard.*Bash.*打ち直して.*tpm report incident[^\\n]*$`));
    expect(s.store.files.size).toBe(0);
    expect(existsSync(join(s.dir, s.project))).toBe(false);
  });
});

describe('置き場が 0.4.0 より前（file のエンドポイントが無い）', () => {
  test('put・path・list・delete は、置き場の版を上げるよう DevOps に頼むよう言って止まる', () => {
    const s = setup();
    s.store.noFiles = true;
    const old = '置き場（pagetray）の版が古く、file を扱えません。tpm ask devops で置き場の版を上げるよう頼んでください';
    expect(() => s.put(s.role, 'a.png')).toThrow(old);
    expect(() => filePath(s.role, `${BASE}/${s.project}/t-x7k2/files/a-1.png`)).toThrow(old);
    expect(() => fileList(s.role, {})).toThrow(old);
    expect(() => fileDelete(s.tpm, [`${BASE}/${s.project}/t-x7k2/files/a-1.png`], {})).toThrow(old);
    expect(existsSync(join(s.dir, s.project, 't-x7k2', 'files', 'a-1.png'))).toBe(false);
  });
});

describe('tpm file path', () => {
  test('控えにあれば置き場に聞かない。無ければ置き場から取って写す', () => {
    const s = setup();
    const url = s.put(s.role, 'screen.png');
    const path = join(s.dir, s.project, 't-x7k2', 'files', 'screen-1.png');
    const before = s.curls().length;
    expect(filePath(s.role, `${url}?v=1`)).toEqual([path]);
    expect(s.curls()).toHaveLength(before);
    rmSync(path);
    expect(filePath(s.role, url)).toEqual([path]);
    expect(readFileSync(path).equals(PNG)).toBe(true);
  });

  test('無い file は 404、消した file は 410。途中の file は残さない。file の URL でなければ置き場に聞かない', () => {
    const s = setup();
    expect(() => filePath(s.role, `${BASE}/${s.project}/t-x7k2/files/none-1.png`)).toThrow('置き場に file がありません（404）');
    s.put(s.role, 'gone.png');
    s.store.files.clear();
    s.store.removedFiles.add(`/${s.project}/t-x7k2/files/gone-1.png`);
    rmSync(join(s.dir, s.project, 't-x7k2', 'files', 'gone-1.png'));
    expect(() => filePath(s.role, `${BASE}/${s.project}/t-x7k2/files/gone-1.png`)).toThrow('置き場の file は消してあります（410）');
    expect(existsSync(join(s.dir, s.project, 't-x7k2', 'files', 'gone-1.png'))).toBe(false);
    const before = s.curls().length;
    for (const bad of [`${BASE}/${s.project}/t-x7k2/plan-1.html`, `${BASE}/${s.project}/../files/a-1.png`, `${BASE}/${s.project}/t-x7k2/files/a-01.png`, `${BASE}/${s.project}/t-x7k2/files/a-1.svg`, 'https://example.com/p/k/files/a-1.png']) {
      expect(() => filePath(s.role, bad), bad).toThrow('置き場の file の URL ではありません');
    }
    expect(s.curls()).toHaveLength(before);
  });

  test('tpm page path に file の URL を渡すと、tpm file path に回すよう言う', () => {
    const s = setup();
    const url = s.put(s.role, 'screen.png');
    expect(() => pagePath(s.role, url)).toThrow(`tpm file path ${url}`);
  });
});

describe('tpm file list', () => {
  test('今の project の file を新しい順に出す。旗で絞り、--json は url を足した記録', () => {
    const s = setup();
    s.put(s.role, 'a.png');
    expect(fileList(s.role, {})).toEqual([`2026-11-20T13:00:00.000Z  t-x7k2  a-1.png  software-engineer  file:1  ${BASE}/${s.project}/t-x7k2/files/a-1.png  ${PNG.length} byte`]);
    filePut(s.tpm, s.source('c.txt', 'yy'), { key: 't-y' });
    expect(fileList(s.role, { key: 't-y' })).toEqual([expect.stringContaining('t-y  c-1.txt  tpm  file:tpm')]);
    expect(fileList(s.role, { q: 'zzz' })).toEqual(['合う file は無い']);
    const files = JSON.parse(fileList(s.role, { json: true, role: 'tpm' }).join('\n')) as Record<string, unknown>[];
    expect(files).toEqual([expect.objectContaining({ key: 't-y', name: 'c', ext: 'txt', n: 1, url: `${BASE}/${s.project}/t-y/files/c-1.txt` })]);
    fileList(s.role, { q: 'c.txt', limit: '5', allProjects: true });
    expect(s.curls().at(-1)?.at(-1)).toBe(`${BASE}/api/files?limit=5&q=c.txt`);
  });
});

describe('tpm file delete', () => {
  /** t-x7k2 に file 2 つと、それを参照するページ・しないページを置いた周り。 */
  function placed() {
    const s = setup();
    const shot = s.put(s.role, 'shot.png');
    const other = s.put(s.role, 'other.png');
    const html = join(s.src, 'page.html');
    writeFileSync(html, '<title>結果</title><img src="files/shot-1.png">');
    pagePut(s.role, html, { kind: 'result' });
    writeFileSync(html, '<title>別の Key の計画</title><a href=\'../t-x7k2/files/shot-1.png\'>図</a>');
    pagePut(s.tpm, html, { kind: 'plan', key: 't-y' });
    writeFileSync(html, '<title>参照しない</title><p>files/shot-1.png と字で書いただけ</p>');
    pagePut(s.role, html, { kind: 'proposal' });
    return { ...s, shot, other };
  }

  test('担当の居場所からは消せない。TPM 担当に頼むよう言い、置き場に頼まない', () => {
    const s = placed();
    const before = s.curls().length;
    expect(() => fileDelete(s.role, [s.shot], { yes: true })).toThrow('file を消せるのは TPM 担当だけです。消す file の URL と訳を、tpm ask tpm で TPM 担当に送って頼んでください');
    expect(s.curls()).toHaveLength(before);
  });

  test('--yes が無ければ、消す物と、それを参照しているページを出すだけ。控えに無いページは取って読む', () => {
    const s = placed();
    rmSync(join(s.dir, s.project, 't-y'), { recursive: true });
    expect(fileDelete(s.tpm, [s.shot], {})).toEqual([
      '消す file（1 個。戻せない）:',
      `${s.shot}  ${PNG.length} byte`,
      '参照しているページ（消すと、その図やリンクが切れる）:',
      `  ${BASE}/${s.project}/t-y/plan-1.html  別の Key の計画（shot-1.png を参照）`,
      `  ${BASE}/${s.project}/t-x7k2/result-1.html  結果（shot-1.png を参照）`,
      '消すには、同じ命令に --yes を付けて打ってください',
    ]);
    expect(s.store.files.size).toBe(2);
    expect(fileDelete(s.tpm, [s.other], {})).toContain('参照しているページは無い');
  });

  test('--yes で置き場と控えから消え、URL は 410、番号は使い回さない。ほかの file は残る', () => {
    const s = placed();
    expect(fileDelete(s.tpm, [s.shot, s.shot], { yes: true })).toEqual(['消した: 1 個（控えも消した）', `- ${s.shot}`]);
    expect(s.curls().at(-1)?.at(-1)).toBe(`${BASE}/api/files?project=${encodeURIComponent(s.project)}&key=t-x7k2&name=shot.png&n=1`);
    expect(existsSync(join(s.dir, s.project, 't-x7k2', 'files', 'shot-1.png'))).toBe(false);
    expect(existsSync(join(s.dir, s.project, 't-x7k2', 'files', 'other-1.png'))).toBe(true);
    expect(() => filePath(s.tpm, s.shot)).toThrow('（410）');
    expect(s.put(s.role, 'shot.png')).toBe(`${BASE}/${s.project}/t-x7k2/files/shot-2.png`);
    expect(fileDelete(s.tpm, [s.shot], { yes: true })).toEqual(['置き場に、消す file は無い']);
    expect(() => fileDelete(s.tpm, [], {})).toThrow('URL を書いてください');
  });
});
