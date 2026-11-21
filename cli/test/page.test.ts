import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { isPageUrl, pageDelete, pageImport, pageList, pagePath, pagePut, pagesDir, pagesUrl } from '../src/commands/page.ts';
import type { Context } from '../src/context.ts';
import { writeRole } from '../src/roster.ts';
import { State } from '../src/state.ts';
import { world } from './helpers.ts';

const BASE = 'http://127.0.0.1:8801';
const HTML = '<title>試し</title><p>日本語</p>';

/** 控えを一時の folder にし、偽の置き場に向けた、t-x7k2 の Software Engineer 担当（居場所 file:1）と TPM 担当の周り。 */
function setup() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tpm-pages-')));
  const w = world();
  const wire = (ctx: Context, env: NodeJS.ProcessEnv = {}): Context => ({ ...ctx, env: { ...ctx.env, TPM_PAGES_DIR: dir, ...env } });
  const role = wire(w.role('t-x7k2', 'file:1'), { TPM_ROLE: 'software-engineer' });
  const tpm = wire(w.tpm);
  writeRole(tpm, { key: 't-x7k2', role: 'software-engineer', title: 'SWE t-x7k2', cwd: w.project, addDirs: [], model: 'm', effort: 'e', permissionMode: 'p', address: 'file:1' });
  tpm.state.write('tpm.jsonc', { address: 'file:tpm' });
  const project = basename(w.tpm.state.dir);
  const html = join(dir, '..', `${basename(dir)}-src.html`);
  writeFileSync(html, HTML);
  /** 置き場への要求（curl）の引数。 */
  const curls = (): string[][] => w.calls.filter(c => c.cmd === 'curl').map(c => c.args);
  /** 置き場に入っているページの記録を、path から。 */
  const stored = (path: string) => w.store.pages.get(path)?.record;
  return { dir, w, store: w.store, role, tpm, project, html, curls, stored };
}

describe('tpm page put', () => {
  test('担当が置くと、置き場が番号を決め、役割と居場所が記録に入り、控えに写る。2 度目は -2', () => {
    const s = setup();
    const path = join(s.dir, s.project, 't-x7k2', 'proposal-1.html');
    const url = `${BASE}/${s.project}/t-x7k2/proposal-1.html`;
    expect(pagePut(s.role, s.html, { kind: 'proposal' })).toEqual([`置いた: ${path}`, `URL: ${url}`]);
    expect(readFileSync(path, 'utf8')).toBe(HTML);
    expect(s.stored(`/${s.project}/t-x7k2/proposal-1.html`)).toMatchObject({ role: 'software-engineer', workspace: 'file:1', title: '試し' });
    expect(s.store.pages.get(`/${s.project}/t-x7k2/proposal-1.html`)?.body.toString()).toBe(HTML);
    expect(pagePut(s.role, s.html, { kind: 'proposal' })[1]).toBe(`URL: ${BASE}/${s.project}/t-x7k2/proposal-2.html`);
  });

  test('置く要求は、file をそのまま送る POST 1 つ', () => {
    const s = setup();
    pagePut(s.role, s.html, { kind: 'plan' });
    const query = `project=${encodeURIComponent(s.project)}&key=t-x7k2&kind=plan&role=software-engineer&workspace=file%3A1`;
    expect(s.curls()).toEqual([[
      '-sS',
      '--max-time',
      '10',
      '-w',
      '\n%{http_code} %header{pagetray-api}',
      '-X',
      'POST',
      '-H',
      'Content-Type: text/html; charset=utf-8',
      '--data-binary',
      `@${s.html}`,
      `${BASE}/api/pages?${query}`,
    ]]);
  });

  test('TPM 担当は --key で置き、役割は tpm、居場所は自分の宛先。担当と project の名が揃う', () => {
    const s = setup();
    expect(pagePut(s.tpm, s.html, { kind: 'brief', key: 't-x7k2' })[1]).toBe(`URL: ${BASE}/${s.project}/t-x7k2/brief-1.html`);
    expect(s.stored(`/${s.project}/t-x7k2/brief-1.html`)).toMatchObject({ role: 'tpm', workspace: 'file:tpm' });
    expect(pagePut(s.role, s.html, { kind: 'brief' })[1]).toBe(`URL: ${BASE}/${s.project}/t-x7k2/brief-2.html`);
  });

  test('TPM 担当が --key なしで置くと誤り', () => {
    const s = setup();
    expect(() => pagePut(s.tpm, s.html, { kind: 'brief' })).toThrow('--key');
  });

  test('名簿に宛先が無くても置ける（居場所は空）', () => {
    const s = setup();
    const other = { ...s.role, env: { ...s.role.env, TPM_KEY: 't-none' } };
    pagePut(other, s.html, { kind: 'plan' });
    expect(s.stored(`/${s.project}/t-none/plan-1.html`)).toMatchObject({ workspace: '' });
  });

  test('置き場が応えなければ置けない。控えも書かず、DevOps に頼むよう言う', () => {
    const s = setup();
    s.store.down = true;
    expect(() => pagePut(s.role, s.html, { kind: 'result' })).toThrow(/置き場（http:\/\/127\.0\.0\.1:8801）が応えません。ページは置けていません.*tpm ask devops/);
    expect(existsSync(join(s.dir, s.project))).toBe(false);
  });

  test('置き場の API の版が違えば、答えを使わずに止まる。控えも書かない', () => {
    const s = setup();
    s.store.api = '2';
    expect(() => pagePut(s.role, s.html, { kind: 'result' })).toThrow(/API の版は 2 で、この tpm が話せるのは 1 です.*\.pagetray-version.*tpm ask devops/);
    expect(existsSync(join(s.dir, s.project))).toBe(false);
    expect(() => pageList(s.role, {})).toThrow(/API の版は 2/);
  });

  test('API の版を付けない置き場（版ができる前の物）には、今までどおり置ける', () => {
    const s = setup();
    s.store.api = undefined;
    expect(pagePut(s.role, s.html, { kind: 'result' })[1]).toBe(`URL: ${BASE}/${s.project}/t-x7k2/result-1.html`);
  });

  test('置き場が断れば、置き場の言う訳を出す', () => {
    const s = setup();
    s.store.refuse = { code: 413, body: 'length limit exceeded' };
    expect(() => pagePut(s.role, s.html, { kind: 'result' })).toThrow('置き場がページを受け取りませんでした（413）: length limit exceeded');
    s.store.refuse = { code: 400, body: '{"error":"本文が空"}' };
    expect(() => pagePut(s.role, s.html, { kind: 'result' })).toThrow('（400）: 本文が空');
  });

  test('控えに別の中身が残っていたら、消さずに退けてから写す', () => {
    const s = setup();
    const folder = join(s.dir, s.project, 't-x7k2');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'plan-1.html'), '置き場を通さずに置かれた物');
    pagePut(s.role, s.html, { kind: 'plan' });
    expect(readFileSync(join(folder, 'plan-1.html'), 'utf8')).toBe(HTML);
    const aside = readdirSync(folder).filter(f => f.startsWith('plan-1.html.replaced-'));
    expect(aside).toHaveLength(1);
    expect(readFileSync(join(folder, aside[0] ?? ''), 'utf8')).toBe('置き場を通さずに置かれた物');
  });

  test('種類が表に無い・file が無い・Key に使えない字があれば、置き場に頼む前に誤り', () => {
    const s = setup();
    expect(() => pagePut(s.role, s.html, { kind: 'memo' })).toThrow('--kind');
    expect(() => pagePut(s.role, join(s.dir, 'nope.html'), { kind: 'plan' })).toThrow('file がありません');
    expect(() => pagePut(s.tpm, s.html, { kind: 'plan', key: '../x' })).toThrow('使えない字');
    expect(s.curls()).toEqual([]);
  });

  test('tpm を使う project でない folder（scratchpad など）からは、置き場に頼む前に止める', () => {
    const s = setup();
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'tpm-scratch-')));
    const stray = { ...s.tpm, project: scratch, state: new State(join(s.tpm.state.dir, '..', basename(scratch))) };
    expect(() => pagePut(stray, s.html, { kind: 'brief', key: 't-x7k2' })).toThrow('$TPM_PROJECT');
    expect(s.curls()).toEqual([]);
    // TPM 担当が起きた印があれば、設定の file が無くても置ける（設定を書く前の project）。
    stray.state.write('tpm.jsonc', { address: 'file:tpm' });
    expect(pagePut(stray, s.html, { kind: 'brief', key: 't-x7k2' })[1]).toContain('/brief-1.html');
  });

  test('$TPM_PAGES_URL で置き場の URL を替えられる（末尾の / は落とす）', () => {
    const s = setup();
    const ctx = { ...s.role, env: { ...s.role.env, TPM_PAGES_URL: 'http://127.0.0.1:9900/' } };
    expect(pagePut(ctx, s.html, { kind: 'plan' })[1]).toBe(`URL: http://127.0.0.1:9900/${s.project}/t-x7k2/plan-1.html`);
    expect(s.curls()[0]?.at(-1)).toMatch(/^http:\/\/127\.0\.0\.1:9900\/api\/pages\?/);
  });
});

describe('tpm page path', () => {
  test('控えにあるページは、置き場に聞かずに path を返す', () => {
    const s = setup();
    const url = pagePut(s.role, s.html, { kind: 'confirm' })[1]?.replace('URL: ', '') ?? '';
    const before = s.curls().length;
    s.store.down = true;
    expect(pagePath(s.role, url)).toEqual([join(s.dir, s.project, 't-x7k2', 'confirm-1.html')]);
    expect(pagePath(s.role, `${url}?x=1#top`)).toEqual([join(s.dir, s.project, 't-x7k2', 'confirm-1.html')]);
    expect(s.curls()).toHaveLength(before);
  });

  test('控えに無ければ、置き場から取って控えに写す', () => {
    const s = setup();
    const url = pagePut(s.role, s.html, { kind: 'plan' })[1]?.replace('URL: ', '') ?? '';
    // ほかの Mac の控えは無い、という形にする。
    const other = { ...s.role, env: { ...s.role.env, TPM_PAGES_DIR: join(s.dir, 'other') } };
    const path = join(s.dir, 'other', s.project, 't-x7k2', 'plan-1.html');
    expect(pagePath(other, url)).toEqual([path]);
    expect(readFileSync(path, 'utf8')).toBe(HTML);
    expect(readdirSync(join(s.dir, 'other', s.project, 't-x7k2'))).toEqual(['plan-1.html']);
  });

  test('前の置き場（8800）の URL も、同じ控えの path になる', () => {
    const s = setup();
    pagePut(s.role, s.html, { kind: 'plan' });
    expect(pagePath(s.role, `http://127.0.0.1:8800/${s.project}/t-x7k2/plan-1.html`)).toEqual([join(s.dir, s.project, 't-x7k2', 'plan-1.html')]);
    expect(isPageUrl(s.role.env, `http://127.0.0.1:8800/${s.project}/t-x7k2/plan-1.html`)).toBe(true);
    expect(isPageUrl(s.role.env, `${BASE}/x`)).toBe(true);
    expect(isPageUrl(s.role.env, 'https://claude.ai/artifact/x')).toBe(false);
  });

  test('置き場の外の URL・.. を含む URL・無いページは誤り。途中の file は残さない', () => {
    const s = setup();
    expect(() => pagePath(s.role, 'https://claude.ai/artifact/x')).toThrow('置き場');
    expect(() => pagePath(s.role, `${BASE}/${s.project}/../x.html`)).toThrow('file を指す URL ではありません');
    expect(() => pagePath(s.role, `${BASE}/${s.project}/t-x7k2/plan-9.html`)).toThrow('置き場にページがありません（404）');
    expect(readdirSync(join(s.dir, s.project, 't-x7k2'))).toEqual([]);
    // ページの形でない path は、置き場に聞かない。
    const before = s.curls().length;
    expect(() => pagePath(s.role, `${BASE}/api/backup`)).toThrow('file がありません');
    expect(() => pagePath(s.role, `${BASE}/${s.project}/t-x7k2/notes.txt`)).toThrow('file がありません');
    expect(s.curls()).toHaveLength(before);
  });

  test('置き場の API の版が違えば読まず、途中の file も残さない', () => {
    const s = setup();
    pagePut(s.role, s.html, { kind: 'plan' });
    const folder = join(s.dir, s.project, 't-x7k2');
    for (const name of readdirSync(folder)) rmSync(join(folder, name));
    s.store.api = '2';
    expect(() => pagePath(s.role, `${BASE}/${s.project}/t-x7k2/plan-1.html`)).toThrow(/API の版は 2/);
    expect(readdirSync(folder)).toEqual([]);
  });

  test('控えに無く、置き場も応えなければ、DevOps に頼むよう言う', () => {
    const s = setup();
    s.store.down = true;
    expect(() => pagePath(s.role, `${BASE}/${s.project}/t-x7k2/plan-1.html`)).toThrow(/応えません。控え（.*plan-1\.html）もありません。.*tpm ask devops/);
  });
});

describe('tpm page list', () => {
  /** 役割・Key・種類の違う 3 枚を置く。 */
  function seeded() {
    const s = setup();
    pagePut(s.tpm, s.html, { kind: 'brief', key: 't-x7k2' });
    pagePut(s.role, s.html, { kind: 'plan' });
    pagePut(s.tpm, s.html, { kind: 'brief', key: 't-other' });
    return s;
  }

  test('今の project のページを、新しい順に 1 行ずつ出す', () => {
    const s = seeded();
    expect(pageList(s.role, {})).toEqual([
      `2026-11-20T12:00:02.000Z  t-other  brief-1  tpm  file:tpm  ${BASE}/${s.project}/t-other/brief-1.html  試し`,
      `2026-11-20T12:00:01.000Z  t-x7k2  plan-1  software-engineer  file:1  ${BASE}/${s.project}/t-x7k2/plan-1.html  試し`,
      `2026-11-20T12:00:00.000Z  t-x7k2  brief-1  tpm  file:tpm  ${BASE}/${s.project}/t-x7k2/brief-1.html  試し`,
    ]);
    expect(s.curls().at(-1)?.at(-1)).toBe(`${BASE}/api/pages?limit=50&project=${encodeURIComponent(s.project)}`);
  });

  test('旗で絞り、並びを替える', () => {
    const s = seeded();
    expect(pageList(s.role, { role: 'software-engineer' })).toHaveLength(1);
    expect(pageList(s.role, { workspace: 'file:tpm', key: 't-x7k2' })).toEqual([expect.stringContaining('t-x7k2  brief-1')]);
    expect(pageList(s.role, { kind: 'brief', oldest: true }).map(l => l.split('  ')[1])).toEqual(['t-x7k2', 't-other']);
    expect(pageList(s.role, { q: '無い語' })).toEqual(['合うページは無い']);
    pageList(s.role, { q: '試し', limit: '5', allProjects: true });
    expect(s.curls().at(-1)?.at(-1)).toBe(`${BASE}/api/pages?limit=5&q=${encodeURIComponent('試し')}`);
  });

  test('--json は、url を足した記録の配列を出す', () => {
    const s = seeded();
    const pages = JSON.parse(pageList(s.role, { json: true, kind: 'plan' }).join('\n')) as Record<string, unknown>[];
    expect(pages).toEqual([expect.objectContaining({ key: 't-x7k2', kind: 'plan', n: 1, role: 'software-engineer', workspace: 'file:1', url: `${BASE}/${s.project}/t-x7k2/plan-1.html` })]);
  });

  test('置き場が応えなければ、DevOps に頼むよう言う', () => {
    const s = seeded();
    s.store.down = true;
    expect(() => pageList(s.role, {})).toThrow('tpm ask devops');
  });
});

describe('tpm page import', () => {
  /** 前の置き場の形（控えの folder に file だけがある）を作る。 */
  function legacy() {
    const s = setup();
    const folder = join(s.dir, '-Users-me-projects-x', 'AI-14');
    mkdirSync(folder, { recursive: true });
    const files = { 'brief-1.html': '<title>依頼書</title>', 'issue-1.html': '<title>写し</title>', 'plan-2.html': '<title>計画</title>' };
    for (const [name, html] of Object.entries(files)) {
      writeFileSync(join(folder, name), html);
      utimesSync(join(folder, name), new Date('2026-11-19T01:02:03.456Z'), new Date('2026-11-19T01:02:03.456Z'));
    }
    // ページでない物は入れない。
    writeFileSync(join(folder, 'notes.txt'), 'x');
    writeFileSync(join(folder, 'plan-1.html.replaced-2026'), 'x');
    writeFileSync(join(folder, 'plan-01.html'), 'x');
    writeFileSync(join(s.dir, 'brief-1.html'), 'x');
    return { ...s, folder };
  }

  test('控えのページを、同じ番号と file の時刻で入れる。役割は依頼書と課題の写しだけ tpm', () => {
    const s = legacy();
    const lines = pageImport(s.tpm);
    expect(lines[0]).toBe(`入れた: 3 枚・もう入っていた: 0 枚・消したページ: 0 枚・ぶつかった: 0 枚（控えの folder: ${s.dir}）`);
    expect(lines.slice(1).sort()).toEqual([
      `+ ${BASE}/-Users-me-projects-x/AI-14/brief-1.html`,
      `+ ${BASE}/-Users-me-projects-x/AI-14/issue-1.html`,
      `+ ${BASE}/-Users-me-projects-x/AI-14/plan-2.html`,
    ]);
    expect(s.stored('/-Users-me-projects-x/AI-14/plan-2.html')).toMatchObject({ n: 2, role: 'unknown', workspace: '', created_at: '2026-11-19T01:02:03.456Z', title: '計画' });
    expect(s.stored('/-Users-me-projects-x/AI-14/brief-1.html')).toMatchObject({ role: 'tpm' });
    expect(s.stored('/-Users-me-projects-x/AI-14/issue-1.html')).toMatchObject({ role: 'tpm' });
    expect(s.store.pages.size).toBe(3);
  });

  test('何度打っても同じ。後から控えに増えた分だけが入る', () => {
    const s = legacy();
    pageImport(s.tpm);
    writeFileSync(join(s.folder, 'result-1.html'), '<title>結果</title>');
    expect(pageImport(s.tpm)).toEqual([
      `入れた: 1 枚・もう入っていた: 3 枚・消したページ: 0 枚・ぶつかった: 0 枚（控えの folder: ${s.dir}）`,
      `+ ${BASE}/-Users-me-projects-x/AI-14/result-1.html`,
    ]);
    expect(readdirSync(s.folder).filter(f => f.includes('.check-'))).toEqual([]);
  });

  test('同じ番号に別の中身があれば、入れずに知らせる', () => {
    const s = legacy();
    pageImport(s.tpm);
    writeFileSync(join(s.folder, 'plan-2.html'), '<title>別の計画</title>');
    const lines = pageImport(s.tpm);
    expect(lines[0]).toContain('入れた: 0 枚・もう入っていた: 2 枚・消したページ: 0 枚・ぶつかった: 1 枚');
    expect(lines[1]).toBe(`! 同じ番号に別の中身がある（入れていない。要るなら tpm page put で置き直す）: ${join(s.folder, 'plan-2.html')}`);
    expect(s.store.pages.get('/-Users-me-projects-x/AI-14/plan-2.html')?.body.toString()).toBe('<title>計画</title>');
  });

  test('消したページは、控えに残っていても入れない（生き返らない）', () => {
    const s = legacy();
    pageImport(s.tpm);
    s.store.pages.delete('/-Users-me-projects-x/AI-14/plan-2.html');
    s.store.removed.add('/-Users-me-projects-x/AI-14/plan-2.html');
    expect(pageImport(s.tpm)).toEqual([`入れた: 0 枚・もう入っていた: 2 枚・消したページ: 1 枚・ぶつかった: 0 枚（控えの folder: ${s.dir}）`]);
    expect(s.store.pages.has('/-Users-me-projects-x/AI-14/plan-2.html')).toBe(false);
  });

  test('置き場が応えなければ止まる', () => {
    const s = legacy();
    s.store.down = true;
    expect(() => pageImport(s.tpm)).toThrow('tpm ask devops');
  });
});

describe('tpm page delete', () => {
  /** t-x7k2 に 3 枚、t-y に 1 枚、ほかの project に 1 枚を置いた周り。 */
  function placed() {
    const s = setup();
    for (const kind of ['proposal', 'proposal', 'plan']) pagePut(s.role, s.html, { kind });
    pagePut(s.tpm, s.html, { kind: 'brief', key: 't-y' });
    const other = { ...s.tpm, state: new State(join(s.tpm.state.dir, '..', '-other')) };
    pagePut(other, s.html, { kind: 'brief', key: 't-z' });
    const url = (key: string, file: string, project = s.project) => `${BASE}/${project}/${key}/${file}`;
    const cachedFile = (key: string, file: string, project = s.project) => join(s.dir, project, key, file);
    return { ...s, url, cachedFile };
  }

  test('担当の居場所からは消せない。TPM 担当に頼むよう言い、置き場に頼まない', () => {
    const s = placed();
    const before = s.curls().length;
    expect(() => pageDelete(s.role, [s.url('t-x7k2', 'plan-1.html')], { yes: true })).toThrow('tpm ask tpm');
    expect(s.curls()).toHaveLength(before);
    expect(s.store.pages.size).toBe(5);
  });

  test('--yes が無ければ、消す物を出すだけで消さない', () => {
    const s = placed();
    expect(pageDelete(s.tpm, [s.url('t-x7k2', 'proposal-2.html')], {})).toEqual([
      '消すページ（1 枚。戻せない）:',
      `${s.url('t-x7k2', 'proposal-2.html')}  試し`,
      '消すには、同じ命令に --yes を付けて打ってください',
    ]);
    expect(s.store.pages.size).toBe(5);
    expect(existsSync(s.cachedFile('t-x7k2', 'proposal-2.html'))).toBe(true);
  });

  test('URL の 1 枚を消すと、置き場と控えから消え、URL は 410、番号は使い回されない', () => {
    const s = placed();
    expect(pageDelete(s.tpm, [s.url('t-x7k2', 'proposal-2.html')], { yes: true })).toEqual([
      '消した: 1 枚（控えも消した）',
      `- ${s.url('t-x7k2', 'proposal-2.html')}`,
    ]);
    expect(s.curls().at(-1)).toEqual(['-sS', '--max-time', '10', '-w', '\n%{http_code} %header{pagetray-api}', '-X', 'DELETE', `${BASE}/api/pages?project=${encodeURIComponent(s.project)}&key=t-x7k2&kind=proposal&n=2`]);
    expect(existsSync(s.cachedFile('t-x7k2', 'proposal-2.html'))).toBe(false);
    expect(existsSync(s.cachedFile('t-x7k2', 'proposal-1.html'))).toBe(true);
    expect(s.store.pages.size).toBe(4);
    expect(() => pagePath(s.tpm, s.url('t-x7k2', 'proposal-2.html'))).toThrow('410');
    expect(pagePut(s.role, s.html, { kind: 'proposal' })[1]).toBe(`URL: ${s.url('t-x7k2', 'proposal-3.html')}`);
  });

  test('--key は今の project のその Key のページをみな消し、控えの folder も消す。ほかの Key は残る', () => {
    const s = placed();
    const lines = pageDelete(s.tpm, [], { key: 't-x7k2', yes: true });
    expect(lines[0]).toBe('消した: 3 枚（控えも消した）');
    expect(existsSync(join(s.dir, s.project, 't-x7k2'))).toBe(false);
    expect(existsSync(s.cachedFile('t-y', 'brief-1.html'))).toBe(true);
    expect([...s.store.pages.keys()].sort()).toEqual([`/-other/t-z/brief-1.html`, `/${s.project}/t-y/brief-1.html`]);
  });

  test('--project だけなら、その project のページをみな消し、控えの project の folder も消す', () => {
    const s = placed();
    expect(pageDelete(s.tpm, [], { project: '-other' })[0]).toBe('消すページ（1 枚。戻せない）:');
    expect(pageDelete(s.tpm, [], { project: '-other', yes: true })[0]).toBe('消した: 1 枚（控えも消した）');
    expect(existsSync(join(s.dir, '-other'))).toBe(false);
    expect(existsSync(s.dir)).toBe(true);
    expect(s.store.pages.size).toBe(4);
  });

  test('合うページが無ければそう言う。名指しの誤りは置き場に頼む前に止める', () => {
    const s = placed();
    expect(pageDelete(s.tpm, [], { key: 't-none', yes: true })).toEqual(['置き場に、消すページは無い']);
    expect(() => pageDelete(s.tpm, [], {})).toThrow('--key');
    expect(() => pageDelete(s.tpm, [s.url('t-x7k2', 'plan-1.html')], { key: 't-x7k2' })).toThrow('一緒に書けません');
    for (const bad of ['https://example.com/p/k/plan-1.html', `${BASE}/p/k/plan-01.html`, `${BASE}/p/k/x/plan-1.html`, `${BASE}/../k/plan-1.html`]) {
      expect(() => pageDelete(s.tpm, [bad], {}), bad).toThrow('URL ではありません');
    }
    expect(() => pageDelete(s.tpm, [], { key: '../x' })).toThrow('使えない字');
  });

  test('置き場が応えなければ、消さずに DevOps に頼むよう言う', () => {
    const s = placed();
    s.store.down = true;
    expect(() => pageDelete(s.tpm, [], { key: 't-x7k2', yes: true })).toThrow('tpm ask devops');
    expect(existsSync(join(s.dir, s.project, 't-x7k2'))).toBe(true);
  });
});

describe('置き場の既定', () => {
  test('控えの folder は $TPM_PAGES_DIR、無ければ $XDG_DATA_HOME/tpm/pages。URL は既定 127.0.0.1:8801', () => {
    expect(pagesDir({ TPM_PAGES_DIR: '/p' })).toBe('/p');
    expect(pagesDir({ XDG_DATA_HOME: '/d' })).toBe('/d/tpm/pages');
    expect(pagesUrl({})).toBe(BASE);
  });
});
