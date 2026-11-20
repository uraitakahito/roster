import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { pagePath, pagePut, pagesDir, pagesUrl } from '../src/commands/page.ts';
import type { Context } from '../src/context.ts';
import type { ExecResult } from '../src/exec.ts';
import { world } from './helpers.ts';

const BASE = 'http://127.0.0.1:8800';

/** 置き場を一時の folder にし、curl の HEAD の答えを head で替えた、t-x の担当と TPM 担当の周り。 */
function setup(head: ExecResult = { status: 0, stdout: '200', stderr: '' }) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tpm-pages-')));
  const heads: string[][] = [];
  const env = { TPM_PAGES_DIR: dir };
  const w = world();
  const wire = (ctx: Context): Context => ({
    ...ctx,
    env: { ...ctx.env, ...env },
    exec: (cmd, args) => {
      if (cmd === 'curl') heads.push(args);
      return head;
    },
  });
  const role = wire(w.role('t-x', 'file:1'));
  const tpm = wire(w.tpm);
  const project = basename(w.tpm.state.dir);
  const html = join(dir, '..', `${basename(dir)}-src.html`);
  writeFileSync(html, '<title>試し</title><p>日本語</p>');
  return { dir, heads, role, tpm, project, html };
}

describe('tpm page put', () => {
  test('担当は今の鍵の folder に <種類>-1.html で置き、HEAD で確かめて URL を出す。2 度目は -2', () => {
    const s = setup();
    const path = join(s.dir, s.project, 't-x', 'proposal-1.html');
    const url = `${BASE}/${s.project}/t-x/proposal-1.html`;
    expect(pagePut(s.role, s.html, { kind: 'proposal' })).toEqual([`置いた: ${path}`, `URL: ${url}`]);
    expect(readFileSync(path, 'utf8')).toBe('<title>試し</title><p>日本語</p>');
    expect(s.heads).toEqual([['-sI', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '3', url]]);
    expect(pagePut(s.role, s.html, { kind: 'proposal' })[1]).toBe(`URL: ${BASE}/${s.project}/t-x/proposal-2.html`);
  });

  test('TPM 担当と担当で project の名が揃う（状態の folder の名）', () => {
    const s = setup();
    expect(pagePut(s.tpm, s.html, { kind: 'brief', key: 't-x' })[1]).toBe(`URL: ${BASE}/${s.project}/t-x/brief-1.html`);
    expect(pagePut(s.role, s.html, { kind: 'brief' })[1]).toBe(`URL: ${BASE}/${s.project}/t-x/brief-2.html`);
  });

  test('TPM 担当が --key なしで置くと誤り', () => {
    const s = setup();
    expect(() => pagePut(s.tpm, s.html, { kind: 'brief' })).toThrow('--key');
  });

  test('先に大きい番号があれば、その次の番号にし、上書きしない', () => {
    const s = setup();
    pagePut(s.role, s.html, { kind: 'plan' });
    const later = join(s.dir, s.project, 't-x', 'plan-2.html');
    writeFileSync(later, 'ほかの担当が置いた');
    expect(pagePut(s.role, s.html, { kind: 'plan' })[1]).toBe(`URL: ${BASE}/${s.project}/t-x/plan-3.html`);
    expect(readFileSync(later, 'utf8')).toBe('ほかの担当が置いた');
  });

  test('置き場が応えなければ、file は残して DevOps に頼むよう言う', () => {
    const s = setup({ status: 7, stdout: '000', stderr: '' });
    expect(() => pagePut(s.role, s.html, { kind: 'result' })).toThrow('tpm ask devops');
    expect(existsSync(join(s.dir, s.project, 't-x', 'result-1.html'))).toBe(true);
  });

  test('置き場が 404 を返せば、folder と mount のずれと言う', () => {
    const s = setup({ status: 0, stdout: '404', stderr: '' });
    expect(() => pagePut(s.role, s.html, { kind: 'result' })).toThrow('mount がずれて');
  });

  test('種類が表に無い・file が無い・鍵に使えない字があれば誤り', () => {
    const s = setup();
    expect(() => pagePut(s.role, s.html, { kind: 'memo' })).toThrow('--kind');
    expect(() => pagePut(s.role, join(s.dir, 'nope.html'), { kind: 'plan' })).toThrow('file がありません');
    expect(() => pagePut(s.tpm, s.html, { kind: 'plan', key: '../x' })).toThrow('使えない字');
  });

  test('$TPM_PAGES_URL で置き場の URL を替えられる（末尾の / は落とす）', () => {
    const s = setup();
    const ctx = { ...s.role, env: { ...s.role.env, TPM_PAGES_URL: 'http://127.0.0.1:9900/' } };
    expect(pagePut(ctx, s.html, { kind: 'plan' })[1]).toBe(`URL: http://127.0.0.1:9900/${s.project}/t-x/plan-1.html`);
  });
});

describe('tpm page path', () => {
  test('置いたページの URL を file の path にする', () => {
    const s = setup();
    const url = pagePut(s.role, s.html, { kind: 'confirm' })[1]?.replace('URL: ', '') ?? '';
    expect(pagePath(s.role, url)).toEqual([join(s.dir, s.project, 't-x', 'confirm-1.html')]);
  });

  test('置き場の外の URL・.. を含む URL・無い file は誤り', () => {
    const s = setup();
    expect(() => pagePath(s.role, 'https://claude.ai/artifact/x')).toThrow('置き場');
    expect(() => pagePath(s.role, `${BASE}/${s.project}/../x.html`)).toThrow('file を指す URL ではありません');
    expect(() => pagePath(s.role, `${BASE}/${s.project}/t-x/plan-9.html`)).toThrow('file がありません');
  });
});

describe('置き場の既定', () => {
  test('folder は $TPM_PAGES_DIR、無ければ $XDG_DATA_HOME/tpm/pages。URL は既定 127.0.0.1:8800', () => {
    expect(pagesDir({ TPM_PAGES_DIR: '/p' })).toBe('/p');
    expect(pagesDir({ XDG_DATA_HOME: '/d' })).toBe('/d/tpm/pages');
    expect(pagesUrl({})).toBe(BASE);
  });
});
