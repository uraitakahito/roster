// cli と本物の置き場（pagestore）のつなぎの試験。$TPM_E2E_PAGES_URL に動いている pagestore の URL がある時だけ流す
// （CI の pagetray-e2e.yml。手元では docs-site の開発のページの「pagetray（ページの置き場のサーバー）とのつなぎ」）。
// ほかの試験は偽の置き場（helpers.ts の FakeStore）で流すので、API の形（URL・引数の名・JSON の欄）のずれはここで見つける。
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { PAGE_KINDS, pageDelete, pageImport, pageList, pagePath, pagePut, type PageRecord } from '../src/commands/page.ts';
import type { Context } from '../src/context.ts';
import { exec } from '../src/exec.ts';
import { ROLE_NAMES } from '../src/protocol.ts';
import { world } from './helpers.ts';

const URL = process.env.TPM_E2E_PAGES_URL ?? '';

/** 本物の curl で本物の置き場に向けた周り。project の名（状態の folder の名）は world ごとに違う。 */
function setup() {
  const w = world();
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tpm-e2e-pages-')));
  const real = (ctx: Context, env: NodeJS.ProcessEnv = {}): Context => ({ ...ctx, exec, env: { ...ctx.env, TPM_PAGES_URL: URL, TPM_PAGES_DIR: dir, ...env } });
  const html = join(dir, 'src.html');
  const put = (ctx: Context, kind: string, text: string, key?: string): string => {
    writeFileSync(html, text);
    return pagePut(ctx, html, { kind, ...(key === undefined ? {} : { key }) })[1]?.replace('URL: ', '') ?? '';
  };
  const list = (ctx: Context, options: Parameters<typeof pageList>[1]): (PageRecord & { url: string })[] =>
    JSON.parse(pageList(ctx, { ...options, json: true }).join('\n')) as (PageRecord & { url: string })[];
  return { w, dir, real, put, list, project: basename(w.tpm.state.dir), tpm: real(w.tpm) };
}

describe.skipIf(URL === '')('cli と pagestore のつなぎ', () => {
  test('どの役割も、どの種類も置けて、役割と種類で探せて、置き場から読み戻せる', () => {
    const s = setup();
    for (const role of ROLE_NAMES) {
      const ctx = s.real(s.w.role('K-1', 'file:1'), { TPM_ROLE: role });
      for (const kind of PAGE_KINDS) {
        const text = `<!doctype html><title>${role} の ${kind}</title><p>つなぎの試験 ${role} ${kind}</p>`;
        const url = s.put(ctx, kind, text);
        expect(url).toBe(`${URL}/${s.project}/K-1/${kind}-${ROLE_NAMES.indexOf(role) + 1}.html`);
        // 控えを消すと、置き場から取り直す。中身は置いた物と同じ。
        const [path = ''] = pagePath(ctx, url);
        rmSync(path);
        expect(readFileSync(pagePath(ctx, url)[0] ?? '', 'utf8')).toBe(text);
      }
      const mine = s.list(s.tpm, { role });
      expect(mine.map(p => p.kind).sort()).toEqual([...PAGE_KINDS].sort());
      expect(mine.every(p => p.role === role && p.title.startsWith(`${role} の `))).toBe(true);
    }
    for (const kind of PAGE_KINDS) expect(s.list(s.tpm, { kind })).toHaveLength(ROLE_NAMES.length);
  });

  test('TPM 担当が置くと役割は tpm。居場所・Key・語で絞れ、時刻の順に並ぶ', () => {
    const s = setup();
    s.tpm.state.write('tpm.jsonc', { address: 'workspace:7' });
    const brief = s.put(s.tpm, 'brief', '<title>依頼書</title><p>絞り込みを作る</p>', 'K-2');
    const plan = s.put(s.real(s.w.role('K-2', 'file:9'), { TPM_ROLE: 'software-engineer' }), 'plan', '<title>計画</title><p>並べ替えを作る</p>');
    expect(s.list(s.tpm, {}).map(p => p.url)).toEqual([plan, brief]);
    expect(s.list(s.tpm, { oldest: true }).map(p => p.url)).toEqual([brief, plan]);
    expect(s.list(s.tpm, { workspace: 'workspace:7' })).toEqual([expect.objectContaining({ url: brief, role: 'tpm', key: 'K-2', kind: 'brief', n: 1, title: '依頼書' })]);
    expect(s.list(s.tpm, { q: '並べ替え' }).map(p => p.url)).toEqual([plan]);
    expect(s.list(s.tpm, { key: 'K-none' })).toEqual([]);
    expect(pageList(s.tpm, { key: 'K-2', kind: 'plan' })).toEqual([expect.stringMatching(/Z {2}K-2 {2}plan-1 {2}software-engineer {2}- {2}http.*plan-1\.html {2}計画$/)]);
  });

  test('前の置き場の控えを、同じ番号と時刻で取り込める。打ち直しても増えず、ぶつかった物は知らせる', () => {
    const s = setup();
    const project = `${s.project}-legacy`;
    const folder = join(s.dir, project, 'K-3');
    mkdirSync(folder, { recursive: true });
    for (const name of ['brief-1.html', 'result-3.html']) {
      writeFileSync(join(folder, name), `<title>${name}</title>`);
      utimesSync(join(folder, name), new Date('2026-11-19T01:02:03.456Z'), new Date('2026-11-19T01:02:03.456Z'));
    }
    expect(pageImport(s.tpm)[0]).toContain('入れた: 2 枚・もう入っていた: 0 枚・消したページ: 0 枚・ぶつかった: 0 枚');
    expect(pageImport(s.tpm)[0]).toContain('入れた: 0 枚・もう入っていた: 2 枚・消したページ: 0 枚・ぶつかった: 0 枚');
    const pages = s.list(s.tpm, { allProjects: true, key: 'K-3', oldest: true }).filter(p => p.project === project);
    expect(pages.map(p => [p.kind, p.n, p.role, p.workspace, p.created_at])).toEqual([
      ['brief', 1, 'tpm', '', '2026-11-19T01:02:03.456Z'],
      ['result', 3, 'unknown', '', '2026-11-19T01:02:03.456Z'],
    ]);
    writeFileSync(join(folder, 'result-3.html'), '<title>別の中身</title>');
    const lines = pageImport(s.tpm);
    expect(lines[0]).toContain('ぶつかった: 1 枚');
    expect(lines[1]).toContain(join(folder, 'result-3.html'));
  });

  test('TPM 担当が消すと、置き場と控えから消え、URL は 410。番号は使い回さず、import でも生き返らない', () => {
    const s = setup();
    const ctx = s.real(s.w.role('K-5', 'file:1'), { TPM_ROLE: 'software-engineer' });
    const first = s.put(ctx, 'plan', '<title>一つ目</title><p>残る計画</p>');
    const second = s.put(ctx, 'plan', '<title>二つ目</title><p>消す計画</p>');
    const [cached = ''] = pagePath(ctx, second);
    expect(() => pageDelete(ctx, [second], { yes: true })).toThrow('TPM 担当だけ');
    expect(pageDelete(s.tpm, [second], {})[0]).toBe('消すページ（1 枚。戻せない）:');
    expect(pageDelete(s.tpm, [second], { yes: true })).toEqual(['消した: 1 枚（控えも消した）', `- ${second}`]);
    expect(() => pagePath(ctx, second)).toThrow('（410）');
    expect(s.list(s.tpm, { key: 'K-5' }).map(p => p.url)).toEqual([first]);
    expect(s.list(s.tpm, { q: '消す計画' })).toEqual([]);
    expect(s.put(ctx, 'plan', '<title>三つ目</title>')).toBe(`${URL}/${s.project}/K-5/plan-3.html`);
    // 控えが別の所に残っていても、import は入れない。
    writeFileSync(cached, '<title>二つ目</title><p>消す計画</p>');
    expect(pageImport(s.tpm)[0]).toContain('消したページ: 1 枚');
    expect(() => pagePath(ctx, second)).not.toThrow();
    rmSync(cached);
    expect(() => pagePath(ctx, second)).toThrow('（410）');
    // Key ごと消す。
    expect(pageDelete(s.tpm, [], { key: 'K-5', yes: true })[0]).toBe('消した: 2 枚（控えも消した）');
    expect(s.list(s.tpm, { key: 'K-5' })).toEqual([]);
  });

  test('置き場が断る物は、訳を添えて止まる', () => {
    const s = setup();
    const ctx = s.real(s.w.role('K-4', 'file:1'));
    const empty = join(s.dir, 'empty.html');
    writeFileSync(empty, '');
    expect(() => pagePut(ctx, empty, { kind: 'plan' })).toThrow('（400）: 本文が空');
    expect(() => pagePath(ctx, `${URL}/${s.project}/K-4/plan-1.html`)).toThrow('置き場にページがありません（404）');
  });
});
