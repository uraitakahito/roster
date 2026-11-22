import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { readAudits } from '../src/audits.ts';
import { castlistIssuer } from '../src/castlist.ts';
import { filePut } from '../src/commands/file.ts';
import { pageDelete, pageImport, pageList, pagePath, pagePut } from '../src/commands/page.ts';
import { isPageUrl, pagesDir, pagesUrl } from '../src/commands/store.ts';
import type { Context } from '../src/context.ts';
import { writeRole } from '../src/roster.ts';
import { State } from '../src/state.ts';
import { world } from './helpers.ts';

const BASE = 'http://127.0.0.1:8801';
const HTML = '<title>試し</title><p>日本語</p>';
/** PNG の頭の 8 byte と、少しの中身。 */
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('png')]);

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

  test('#45 の形: 担当は、TPM 担当からの未読があれば、確認・提案・計画・結果のページを置く前に 1 度止まり、打ち直すと置く', () => {
    const s = setup();
    s.w.wire.hold('file:1');
    for (const [i, kind] of ['confirm', 'proposal', 'plan', 'result'].entries()) {
      const { id } = s.w.wire.send('file:1', 'Technical Program Manager', `【answer】案 B にする ${i}`);
      const before = s.curls().length;
      expect(() => pagePut(s.role, s.html, { kind })).toThrow([
        'TPM 担当から、まだ読んでいないメッセージが 1 件あります。ページを置いていません。',
        `--- Technical Program Manager（id ${id}）`,
        `【answer】案 B にする ${i}`,
        '--- ここまで',
        '読んだうえで、同じ命令を打ち直せば置きます（事情が変わっていたら、ページを書き直して打つ）。',
      ].join('\n'));
      // 止まった回は、置き場に頼まない
      expect(s.curls()).toHaveLength(before);
      expect(pagePut(s.role, s.html, { kind })[1]).toBe(`URL: ${BASE}/${s.project}/t-x7k2/${kind}-1.html`);
    }
    expect(s.tpm.state.lines<{ gate: string }>('gate.jsonl').map(l => l.gate)).toEqual(['unread', 'unread', 'unread', 'unread']);
  });

  test('依頼書・課題の写し・時系列・監査のページは、未読があっても止めない', () => {
    const s = setup();
    s.w.wire.hold('file:1');
    s.w.wire.send('file:1', 'Technical Program Manager', '【notify】知らせ');
    for (const kind of ['brief', 'issue', 'timeline', 'audit']) expect(pagePut(s.role, s.html, { kind })[1]).toBe(`URL: ${BASE}/${s.project}/t-x7k2/${kind}-1.html`);
    // 見せていないので、次の確認のページでは止まる
    expect(() => pagePut(s.role, s.html, { kind: 'confirm' })).toThrow(/1 件あります。ページを置いていません。/);
  });

  test('TPM 担当は、--key の担当から来た未読だけで止まる', () => {
    const s = setup();
    s.w.wire.hold('file:tpm');
    s.w.wire.send('file:tpm', 'SWE t-b2c3', '【done】別の課題');
    expect(pagePut(s.tpm, s.html, { kind: 'confirm', key: 't-x7k2' })[1]).toContain('/t-x7k2/confirm-1.html');
    s.w.wire.send('file:tpm', 'SWE t-x7k2', '【ask-tpm】前提が変わった');
    expect(() => pagePut(s.tpm, s.html, { kind: 'confirm', key: 't-x7k2' })).toThrow(/^t-x7k2 の担当から、まだ読んでいないメッセージが 1 件あります。ページを置いていません。[\s\S]*前提が変わった/);
    expect(pagePut(s.tpm, s.html, { kind: 'confirm', key: 't-x7k2' })[1]).toContain('/t-x7k2/confirm-2.html');
    // 名簿に無い Key では見ない
    s.w.wire.send('file:tpm', 'SWE t-x7k2', '【ask-tpm】もう 1 つ');
    expect(pagePut(s.tpm, s.html, { kind: 'confirm', key: 't-zzzz' })[1]).toContain('/t-zzzz/confirm-1.html');
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

/** 送り手の試験の castlist の URL（置き場に聞かせるだけで、tpm からは送らない）と、Claude Code の session の id。 */
const CASTLIST = 'http://127.0.0.1:8802';
const SID = '5f0c2a8e-0000-4000-8000-000000000001';
/** castlist の設定（$TPM_CASTLIST_URL）と session の id を足した周り。 */
const seated = (ctx: Context, env: NodeJS.ProcessEnv = {}): Context => ({ ...ctx, env: { ...ctx.env, TPM_CASTLIST_URL: CASTLIST, CLAUDE_CODE_SESSION_ID: SID, ...env } });

describe('tpm page put の送り手（pagetray 0.6.0 の actor_issuer・actor_ref）', () => {
  test('castlist の設定と session の id があれば、issuer と claude.session:<id> を、URL の引数に符号にして付ける', () => {
    const s = setup();
    pagePut(seated(s.role), s.html, { kind: 'plan' });
    const issuer = castlistIssuer(s.w.tpm.state.dir);
    expect(issuer).toMatch(/^tpm\./);
    expect(s.store.posts.map(q => [q.get('actor_issuer'), q.get('actor_ref')])).toEqual([[issuer, `claude.session:${SID}`]]);
    expect(s.curls()[0]?.at(-1)).toContain(`&actor_issuer=${encodeURIComponent(issuer)}&actor_ref=claude.session%3A${SID}`);
    expect(s.stored(`/${s.project}/t-x7k2/plan-1.html`)).toMatchObject({ role: 'software-engineer', workspace: 'file:1' });
  });

  test('設定の castlist（config.jsonc）でも付ける。TPM 担当が置く時も付ける。字は符号にする', () => {
    const s = setup();
    const tpm: Context = { ...s.tpm, config: { ...s.tpm.config, castlist: CASTLIST }, env: { ...s.tpm.env, CLAUDE_CODE_SESSION_ID: 'a&b=c d' } };
    pagePut(tpm, s.html, { kind: 'brief', key: 't-x7k2' });
    expect(s.store.posts[0]?.get('actor_ref')).toBe('claude.session:a&b=c d');
    expect(s.curls()[0]?.at(-1)).toContain('actor_ref=claude.session%3Aa%26b%3Dc+d');
  });

  test('castlist の設定が無い・session の id が無い（空も）時は、今までどおり付けない', () => {
    const s = setup();
    pagePut({ ...s.role, env: { ...s.role.env, CLAUDE_CODE_SESSION_ID: SID } }, s.html, { kind: 'plan' });
    pagePut(seated(s.role, { CLAUDE_CODE_SESSION_ID: undefined }), s.html, { kind: 'plan' });
    pagePut(seated(s.role, { CLAUDE_CODE_SESSION_ID: '' }), s.html, { kind: 'plan' });
    expect(s.store.posts.map(q => [q.has('actor_issuer'), q.has('actor_ref')])).toEqual([[false, false], [false, false], [false, false]]);
    expect(s.store.pages.size).toBe(3);
  });

  test('置き場が castlist に聞けない（503）と、ページを置かずに 1 行で止まる。castlist が起きてから打ち直し、続けば台帳に挙げるよう言う', () => {
    const s = setup();
    s.store.sender = 'unreachable';
    let message = '';
    try {
      pagePut(seated(s.role), s.html, { kind: 'result' });
    }
    catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/置き場（http:\/\/127\.0\.0\.1:8801）が castlist に送り手を聞けませんでした（503）。ページは置けていません。.*castlist が起きてから.*打ち直して.*tpm report incident/);
    expect(message).not.toContain('\n');
    expect(s.store.pages.size).toBe(0);
    expect(existsSync(join(s.dir, s.project))).toBe(false);
    expect(s.store.posts).toHaveLength(1);
  });

  test('置き場が、この session は castlist に登録が無いと答える（422）と、ページを置かずに 1 行で止まる。打ち直し、続けば台帳に挙げるよう言う', () => {
    const s = setup();
    s.store.sender = 'unregistered';
    let message = '';
    try {
      pagePut(seated(s.role), s.html, { kind: 'result' });
    }
    catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(new RegExp(`この session（claude\\.session:${SID}）は castlist に登録が無いと、置き場が答えました（422）。ページは置けていません。.*guard.*Bash.*打ち直して.*tpm report incident`));
    expect(message).not.toContain('\n');
    expect(s.store.pages.size).toBe(0);
    expect(existsSync(join(s.dir, s.project))).toBe(false);
  });

  test('送り手を付けない時の 503・422 は、今までどおり置き場の訳を出す', () => {
    const s = setup();
    s.store.refuse = { code: 503, body: '{"error":"混んでいる"}' };
    expect(() => pagePut(s.role, s.html, { kind: 'result' })).toThrow('置き場がページを受け取りませんでした（503）: 混んでいる');
  });

  test('取り込み（tpm page import）は、送り手を付けない（置いた担当はわからない）', () => {
    const s = setup();
    const folder = join(s.dir, s.project, 't-x7k2');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'result-1.html'), HTML);
    pageImport(seated(s.tpm));
    expect(s.store.posts.map(q => q.has('actor_ref'))).toEqual([false]);
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
    // ほかの機械の控えは無い、という形にする。
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

describe('tpm page path と、ページが参照する file', () => {
  /** 画像を t-x7k2 と t-y に上げ、それを参照するページを置いて、別の機械（控えが空）の周りを返す。 */
  function referenced(body: (key: string) => string) {
    const s = setup();
    const png = join(s.dir, '..', `${basename(s.dir)}-shot.png`);
    writeFileSync(png, PNG);
    filePut(s.role, png, { reviewed: true, name: 'shot.png' });
    filePut(s.tpm, png, { reviewed: true, name: 'shot.png', key: 't-y' });
    writeFileSync(s.html, body('t-y'));
    const url = pagePut(s.role, s.html, { kind: 'result' })[1]?.replace('URL: ', '') ?? '';
    const other = { ...s.role, env: { ...s.role.env, TPM_PAGES_DIR: join(s.dir, 'other') } };
    const at = (...parts: string[]) => join(s.dir, 'other', s.project, ...parts);
    return { ...s, url, other, at };
  }

  test('ページが相対で参照する file（同じ Key・別の Key）も、控えの同じ相対の所に取ってくる', () => {
    const s = referenced(key => `<title>結果</title><img src="files/shot-1.png"><img src='./files/shot-1.png?v=2'><a href=../${key}/files/shot-1.png>図</a>`);
    expect(pagePath(s.other, s.url)).toEqual([
      s.at('t-x7k2', 'result-1.html'),
      `参照の file: ${s.at('t-x7k2', 'files', 'shot-1.png')}`,
      `参照の file: ${s.at('t-y', 'files', 'shot-1.png')}`,
    ]);
    expect(readFileSync(s.at('t-x7k2', 'files', 'shot-1.png')).equals(PNG)).toBe(true);
    expect(readFileSync(s.at('t-y', 'files', 'shot-1.png')).equals(PNG)).toBe(true);
    // 控えにある物は、もう取らない。
    const before = s.curls().length;
    pagePath(s.other, s.url);
    expect(s.curls()).toHaveLength(before);
  });

  test('ページが控えにあっても、控えに無い参照の file は取る', () => {
    const s = referenced(() => '<img src="files/shot-1.png">');
    rmSync(join(s.dir, s.project, 't-x7k2', 'files'), { recursive: true });
    expect(pagePath(s.role, s.url)[1]).toBe(`参照の file: ${join(s.dir, s.project, 't-x7k2', 'files', 'shot-1.png')}`);
    expect(existsSync(join(s.dir, s.project, 't-x7k2', 'files', 'shot-1.png'))).toBe(true);
  });

  test('取れない参照は注意の行にし、ページの path は返す。控えの外へ出る参照・形の違う参照は見ない', () => {
    const s = referenced(() => [
      '<img src="files/none-1.png">',
      '<img src="files/../../../etc/x-1.png"><img src="../../x/files/a-1.png"><img src="../../files/a-1.png">',
      '<img src="files/a-01.png"><img src="files/a-1.svg"><img src="/abs/files/a-1.png"><img src="https://example.com/files/a-1.png">',
    ].join(''));
    const lines = pagePath(s.other, s.url);
    expect(lines[0]).toBe(s.at('t-x7k2', 'result-1.html'));
    expect(lines.slice(1)).toEqual([expect.stringMatching(/^注意: ページが参照する file を取れなかった（.*\/t-x7k2\/files\/none-1\.png）: 置き場に file がありません（404）/)]);
  });

  test('置き場が file を扱えない（0.4.0 より前）・応えない時も、ページは読める', () => {
    const s = referenced(() => '<img src="files/shot-1.png">');
    s.store.noFiles = true;
    expect(pagePath(s.other, s.url)[1]).toMatch(/^注意: .*版が古く/);
    s.store.down = true;
    expect(pagePath(s.other, s.url)).toEqual([s.at('t-x7k2', 'result-1.html'), expect.stringMatching(/^注意: .*応えません/)]);
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

  test('控えの <Key>/files/ の file も、同じ番号と時刻で入れる。打ち直しても増えず、ぶつかった物・消した物は入れない', () => {
    const s = legacy();
    mkdirSync(join(s.folder, 'files'));
    for (const [name, body] of [['shot-2.png', PNG], ['log-1.txt', 'ログ'], ['bad-01.png', PNG], ['x.svg', '<svg/>']] as const) {
      writeFileSync(join(s.folder, 'files', name), body);
      utimesSync(join(s.folder, 'files', name), new Date('2026-11-19T01:02:03.456Z'), new Date('2026-11-19T01:02:03.456Z'));
    }
    const lines = pageImport(s.tpm);
    expect(lines.slice(4)).toEqual([
      'file: 入れた: 2 個・もう入っていた: 0 個・消した file: 0 個・ぶつかった: 0 個',
      `+ ${BASE}/-Users-me-projects-x/AI-14/files/log-1.txt`,
      `+ ${BASE}/-Users-me-projects-x/AI-14/files/shot-2.png`,
    ]);
    expect(s.store.files.get('/-Users-me-projects-x/AI-14/files/shot-2.png')?.record).toMatchObject({ n: 2, role: 'unknown', workspace: '', created_at: '2026-11-19T01:02:03.456Z', type: 'image/png' });
    expect(s.store.files.get('/-Users-me-projects-x/AI-14/files/log-1.txt')?.body.toString()).toBe('ログ');
    expect(pageImport(s.tpm).at(-1)).toBe('file: 入れた: 0 個・もう入っていた: 2 個・消した file: 0 個・ぶつかった: 0 個');
    writeFileSync(join(s.folder, 'files', 'log-1.txt'), '別のログ');
    s.store.files.delete('/-Users-me-projects-x/AI-14/files/shot-2.png');
    s.store.removedFiles.add('/-Users-me-projects-x/AI-14/files/shot-2.png');
    expect(pageImport(s.tpm).slice(-2)).toEqual([
      'file: 入れた: 0 個・もう入っていた: 0 個・消した file: 1 個・ぶつかった: 1 個',
      `! 同じ番号に別の中身がある（入れていない。要るなら tpm file put で上げ直す）: ${join(s.folder, 'files', 'log-1.txt')}`,
    ]);
  });

  test('控えに file が無ければ、file のエンドポイントに聞かない（0.4.0 より前の置き場にも入れられる）', () => {
    const s = legacy();
    s.store.noFiles = true;
    expect(pageImport(s.tpm)[0]).toContain('入れた: 3 枚');
    mkdirSync(join(s.folder, 'files'));
    writeFileSync(join(s.folder, 'files', 'a-1.png'), PNG);
    expect(() => pageImport(s.tpm)).toThrow('版が古く');
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

  test('Auditor が置いたページは、Product Manager の言葉（--pm）が無ければ消せない。消した事は記録に残る', () => {
    const s = placed();
    const auditor = { ...s.role, env: { ...s.role.env, TPM_KEY: 'audit', TPM_ROLE: 'auditor' } };
    pagePut(auditor, s.html, { kind: 'audit' });
    pagePut(auditor, s.html, { kind: 'audit' });
    const audit = (n: number): string => s.url('audit', `audit-${n}.html`);
    const before = s.curls().filter(c => c.includes('DELETE')).length;
    // URL を名指しても、Key ごとでも、project ごとでも、--yes が無くても止まる。
    for (const run of [
      () => pageDelete(s.tpm, [audit(1)], { yes: true }),
      () => pageDelete(s.tpm, [audit(1)], {}),
      () => pageDelete(s.tpm, [], { key: 'audit', yes: true }),
      () => pageDelete(s.tpm, [], { project: s.project, yes: true }),
      () => pageDelete(s.tpm, [audit(1)], { yes: true, pm: ' ' }),
    ]) expect(run).toThrow(/Auditor が置いたページが \d 枚あります。消していません。/);
    expect(s.curls().filter(c => c.includes('DELETE'))).toHaveLength(before);
    expect(s.store.pages.size).toBe(7);
    // Auditor のページが入っていなければ、今までどおり消せる。
    expect(pageDelete(s.tpm, [s.url('t-x7k2', 'plan-1.html')], { yes: true })[0]).toBe('消した: 1 枚（控えも消した）');
    expect(pageDelete(s.tpm, [audit(1)], { yes: true, pm: '秘密が写っていたので消して' })).toEqual(['消した: 1 枚（控えも消した）', `- ${audit(1)}`]);
    expect(readAudits(s.tpm)).toEqual([{ at: '2026-11-20T12:00:00.000Z', kind: 'page-deleted', url: audit(1), by: 'tpm', pm: '秘密が写っていたので消して' }]);
    expect(() => pagePath(s.tpm, audit(2))).not.toThrow();
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

  test('--key・--project は、合う file も一緒に出して消す。URL の名指しは file を消さない', () => {
    const s = placed();
    const png = join(s.dir, '..', `${basename(s.dir)}-a.png`);
    writeFileSync(png, PNG);
    filePut(s.role, png, { reviewed: true, name: 'a.png' });
    filePut(s.tpm, png, { reviewed: true, name: 'a.png', key: 't-y' });
    expect(pageDelete(s.tpm, [s.url('t-x7k2', 'plan-1.html')], { yes: true })).toEqual(['消した: 1 枚（控えも消した）', `- ${s.url('t-x7k2', 'plan-1.html')}`]);
    expect(s.store.files.size).toBe(2);
    expect(pageDelete(s.tpm, [], { key: 't-x7k2' })).toEqual([
      '消すページ（2 枚。戻せない）:',
      `${s.url('t-x7k2', 'proposal-2.html')}  試し`,
      `${s.url('t-x7k2', 'proposal-1.html')}  試し`,
      '消す file（1 個。戻せない）:',
      `${s.url('t-x7k2', 'files/a-1.png')}  ${PNG.length} byte`,
      '消すには、同じ命令に --yes を付けて打ってください',
    ]);
    expect(pageDelete(s.tpm, [], { key: 't-x7k2', yes: true })).toEqual([
      '消した: 2 枚（控えも消した）',
      `- ${s.url('t-x7k2', 'proposal-1.html')}`,
      `- ${s.url('t-x7k2', 'proposal-2.html')}`,
      '消した file: 1 個',
      `- ${s.url('t-x7k2', 'files/a-1.png')}`,
    ]);
    expect(existsSync(join(s.dir, s.project, 't-x7k2'))).toBe(false);
    expect(s.store.removedFiles.has(`/${s.project}/t-x7k2/files/a-1.png`)).toBe(true);
    // ページの無い Key でも、file だけ消せる。
    pageDelete(s.tpm, [], { key: 't-y', yes: true });
    expect(pageDelete(s.tpm, [], { project: s.project })).toEqual(['置き場に、消すページは無い']);
    expect(s.store.files.size).toBe(0);
  });

  test('file を扱えない置き場（0.4.0 より前）でも、--key でページは消せる', () => {
    const s = placed();
    s.store.noFiles = true;
    expect(pageDelete(s.tpm, [], { key: 't-x7k2', yes: true })[0]).toBe('消した: 3 枚（控えも消した）');
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
