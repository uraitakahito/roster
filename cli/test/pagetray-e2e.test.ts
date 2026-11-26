// cli と本物の置き場（pagetray）のつなぎの試験。$ROSTER_E2E_PAGES_URL に動いている pagetray の URL がある時だけ流す
// （CI の pagetray-e2e.yml。手元では docs-site の開発のページの「pagetray（ページの置き場のサーバー）とのつなぎ」）。
// ほかの試験は偽の置き場（helpers.ts の FakeStore）で流すので、API の形（URL・引数の名・JSON の欄）のずれはここで見つける。
// 置き場には、いつも生成した client で新しい API（pagetray 1.0.0 から）に送る。置き場は file・返事・レビューの印をみな持つので、版で試験を選ばない。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { fileDelete, fileList, filePath, filePut, type FileRecord } from '../src/commands/file.ts';
import { PAGE_KINDS, pageDelete, pageImport, pageList, pagePath, pagePut, pageReply, type PageRecord } from '../src/commands/page.ts';
import { setReply, waitingUrls } from '../src/commands/reply.ts';
import type { Context } from '../src/context.ts';
import { exec } from '../src/exec.ts';
import { ROLE_NAMES } from '../src/protocol.ts';
import { world } from './helpers.ts';
import { markBrief, markEscalated, markVerdict } from '../src/commands/review-marks.ts';
import { pagetrayClient } from '../src/commands/store.ts';
import type { Review } from '../src/reviews.ts';

const URL = process.env.ROSTER_E2E_PAGES_URL ?? '';
/** PNG の頭の 8 byte と、少しの中身。 */
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('つなぎの試験の図')]);

/** 本物の curl と生成した client で、本物の置き場に向けた周り。project の名（状態の folder の名）は world ごとに違う。 */
function setup() {
  const w = world();
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'roster-e2e-pages-')));
  const real = (ctx: Context, env: NodeJS.ProcessEnv = {}): Context => ({ ...ctx, exec, clients: { ...ctx.clients, pagetray: url => pagetrayClient(url) }, env: { ...ctx.env, ROSTER_PAGES_URL: URL, ROSTER_PAGES_DIR: dir, ...env } });
  const html = join(dir, 'src.html');
  const put = async (ctx: Context, kind: string, text: string, key?: string): Promise<string> => {
    writeFileSync(html, text);
    return (await pagePut(ctx, html, { kind, ...(key === undefined ? {} : { key }) }))[1]?.replace('URL: ', '') ?? '';
  };
  const list = async (ctx: Context, options: Parameters<typeof pageList>[1]): Promise<(PageRecord & { url: string })[]> =>
    JSON.parse((await pageList(ctx, { ...options, json: true })).join('\n')) as (PageRecord & { url: string })[];
  return { w, dir, real, put, list, project: basename(w.tpm.state.dir), tpm: real(w.tpm) };
}

describe.skipIf(URL === '')('cli と pagetray のつなぎ', () => {
  test('どの役割も、どの種類も置けて、役割と種類で探せて、置き場から読み戻せる', async () => {
    const s = setup();
    for (const role of ROLE_NAMES) {
      const ctx = s.real(s.w.role('K-1', 'file:1'), { ROSTER_ROLE: role });
      for (const kind of PAGE_KINDS) {
        const text = `<!doctype html><title>${role} の ${kind}</title><p>つなぎの試験 ${role} ${kind}</p>`;
        const url = await s.put(ctx, kind, text);
        expect(url).toBe(`${URL}/${s.project}/K-1/${kind}-${ROLE_NAMES.indexOf(role) + 1}.html`);
        // 控えを消すと、置き場から取り直す。中身は置いた物と同じ。
        const [path = ''] = await pagePath(ctx, url);
        rmSync(path);
        expect(readFileSync((await pagePath(ctx, url))[0] ?? '', 'utf8')).toBe(text);
      }
      const mine = await s.list(s.tpm, { role });
      expect(mine.map(p => p.kind).sort()).toEqual([...PAGE_KINDS].sort());
      expect(mine.every(p => p.role === role && p.title.startsWith(`${role} の `))).toBe(true);
    }
    for (const kind of PAGE_KINDS) expect(await s.list(s.tpm, { kind })).toHaveLength(ROLE_NAMES.length);
  });

  test('TPM 担当が置くと役割は tpm。居場所・Key・語で絞れ、時刻の順に並ぶ', async () => {
    const s = setup();
    s.tpm.state.write('tpm.jsonc', { address: 'workspace:7' });
    const brief = await s.put(s.tpm, 'brief', '<title>依頼書</title><p>絞り込みを作る</p>', 'K-2');
    const plan = await s.put(s.real(s.w.role('K-2', 'file:9'), { ROSTER_ROLE: 'software-engineer' }), 'plan', '<title>計画</title><p>並べ替えを作る</p>');
    expect((await s.list(s.tpm, {})).map(p => p.url)).toEqual([plan, brief]);
    expect((await s.list(s.tpm, { oldest: true })).map(p => p.url)).toEqual([brief, plan]);
    expect(await s.list(s.tpm, { workspace: 'workspace:7' })).toEqual([expect.objectContaining({ url: brief, role: 'tpm', key: 'K-2', kind: 'brief', n: 1, title: '依頼書' })]);
    expect((await s.list(s.tpm, { q: '並べ替え' })).map(p => p.url)).toEqual([plan]);
    expect(await s.list(s.tpm, { key: 'K-none' })).toEqual([]);
    expect(await pageList(s.tpm, { key: 'K-2', kind: 'plan' })).toEqual([expect.stringMatching(/Z {2}K-2 {2}plan-1 {2}software-engineer {2}- {2}http.*plan-1\.html {2}計画$/)]);
  });

  test('前の置き場の控えを、同じ番号と時刻で取り込める。打ち直しても増えず、ぶつかった物は知らせる', async () => {
    const s = setup();
    const project = `${s.project}-legacy`;
    const folder = join(s.dir, project, 'K-3');
    mkdirSync(folder, { recursive: true });
    for (const name of ['brief-1.html', 'result-3.html']) {
      writeFileSync(join(folder, name), `<title>${name}</title>`);
      utimesSync(join(folder, name), new Date('2026-11-19T01:02:03.456Z'), new Date('2026-11-19T01:02:03.456Z'));
    }
    expect((await pageImport(s.tpm))[0]).toContain('入れた: 2 枚・もう入っていた: 0 枚・消したページ: 0 枚・ぶつかった: 0 枚');
    expect((await pageImport(s.tpm))[0]).toContain('入れた: 0 枚・もう入っていた: 2 枚・消したページ: 0 枚・ぶつかった: 0 枚');
    const pages = (await s.list(s.tpm, { allProjects: true, key: 'K-3', oldest: true })).filter(p => p.project === project);
    expect(pages.map(p => [p.kind, p.n, p.role, p.workspace, p.created_at])).toEqual([
      ['brief', 1, 'tpm', '', '2026-11-19T01:02:03.456Z'],
      ['result', 3, 'unknown', '', '2026-11-19T01:02:03.456Z'],
    ]);
    writeFileSync(join(folder, 'result-3.html'), '<title>別の中身</title>');
    const lines = await pageImport(s.tpm);
    expect(lines[0]).toContain('ぶつかった: 1 枚');
    expect(lines[1]).toContain(join(folder, 'result-3.html'));
  });

  test('TPM 担当が消すと、置き場と控えから消え、URL は 410。番号は使い回さず、import でも生き返らない', async () => {
    const s = setup();
    const ctx = s.real(s.w.role('K-5', 'file:1'), { ROSTER_ROLE: 'software-engineer' });
    const first = await s.put(ctx, 'plan', '<title>一つ目</title><p>残る計画</p>');
    const second = await s.put(ctx, 'plan', '<title>二つ目</title><p>消す計画</p>');
    const [cached = ''] = await pagePath(ctx, second);
    await expect(pageDelete(ctx, [second], { yes: true })).rejects.toThrow('TPM 担当だけ');
    expect((await pageDelete(s.tpm, [second], {}))[0]).toBe('消すページ（1 枚。戻せない）:');
    expect(await pageDelete(s.tpm, [second], { yes: true })).toEqual(['消した: 1 枚（控えも消した）', `- ${second}`]);
    await expect(pagePath(ctx, second)).rejects.toThrow('（410）');
    expect((await s.list(s.tpm, { key: 'K-5' })).map(p => p.url)).toEqual([first]);
    expect(await s.list(s.tpm, { q: '消す計画' })).toEqual([]);
    expect(await s.put(ctx, 'plan', '<title>三つ目</title>')).toBe(`${URL}/${s.project}/K-5/plan-3.html`);
    // 控えが別の所に残っていても、import は入れない。
    writeFileSync(cached, '<title>二つ目</title><p>消す計画</p>');
    expect((await pageImport(s.tpm))[0]).toContain('消したページ: 1 枚');
    await expect(pagePath(ctx, second)).resolves.toBeDefined();
    rmSync(cached);
    await expect(pagePath(ctx, second)).rejects.toThrow('（410）');
    // Key ごと消す。
    expect((await pageDelete(s.tpm, [], { key: 'K-5', yes: true }))[0]).toBe('消した: 2 枚（控えも消した）');
    expect(await s.list(s.tpm, { key: 'K-5' })).toEqual([]);
  });

  test('置き場が断る物は、訳を添えて止まる', async () => {
    const s = setup();
    const ctx = s.real(s.w.role('K-4', 'file:1'));
    const empty = join(s.dir, 'empty.html');
    writeFileSync(empty, '');
    // 訳は ValidationException の字（欄の path は /body）。
    await expect(pagePut(ctx, empty, { kind: 'plan' })).rejects.toThrow(/置き場がページを受け取りませんでした（400）.*\/body/s);
    await expect(pagePath(ctx, `${URL}/${s.project}/K-4/plan-1.html`)).rejects.toThrow('置き場にページがありません（404）');
  });
});

describe.skipIf(URL === '')('cli と pagetray のつなぎ（file）', () => {
  /** 図を書いて上げ、URL を返す。 */
  async function upload(s: ReturnType<typeof setup>, ctx: Context, name: string, body: Buffer | string = PNG, key?: string): Promise<string> {
    const src = join(s.dir, `src-${name}`);
    writeFileSync(src, body);
    return (await filePut(ctx, src, { reviewed: true, name, ...(key === undefined ? {} : { key }) }))[1]?.replace('URL: ', '') ?? '';
  }
  const files = async (s: ReturnType<typeof setup>, options: Parameters<typeof fileList>[1]): Promise<(FileRecord & { url: string })[]> =>
    JSON.parse((await fileList(s.tpm, { ...options, json: true })).join('\n')) as (FileRecord & { url: string })[];

  test('上げると番号が付き、控えを消しても読み戻せる。ページの <img> の参照も roster page path が控えに写す', async () => {
    const s = setup();
    const ctx = s.real(s.w.role('K-6', 'file:1'), { ROSTER_ROLE: 'software-engineer' });
    const url = await upload(s, ctx, 'shot.png');
    expect(url).toBe(`${URL}/${s.project}/K-6/files/shot-1.png`);
    expect(await upload(s, ctx, 'shot.png')).toBe(`${URL}/${s.project}/K-6/files/shot-2.png`);
    const [path = ''] = await filePath(ctx, url);
    rmSync(path);
    expect(readFileSync((await filePath(ctx, url))[0] ?? '').equals(PNG)).toBe(true);
    expect((await files(s, { key: 'K-6' })).map(f => [f.name, f.ext, f.n, f.type, f.size, f.role, f.workspace])).toEqual([
      ['shot', 'png', 2, 'image/png', PNG.length, 'software-engineer', ''],
      ['shot', 'png', 1, 'image/png', PNG.length, 'software-engineer', ''],
    ]);
    expect(await files(s, { q: 'shot.png' })).toHaveLength(2);
    const page = await s.put(ctx, 'result', '<title>図のある結果</title><img src="files/shot-1.png">');
    rmSync(path);
    rmSync(join(s.dir, s.project, 'K-6', 'result-1.html'));
    expect(await pagePath(ctx, page)).toEqual([join(s.dir, s.project, 'K-6', 'result-1.html'), `参照の file: ${path}`]);
    expect(readFileSync(path).equals(PNG)).toBe(true);
  });

  test('置き場が中身の合わない file を断れば、訳を添えて止まる。無い file は 404', async () => {
    const s = setup();
    const ctx = s.real(s.w.role('K-7', 'file:1'));
    await expect(upload(s, ctx, 'fake.png', '%PDF-1.4')).rejects.toThrow('置き場が file を受け取りませんでした（415）');
    await expect(filePath(ctx, `${URL}/${s.project}/K-7/files/none-1.png`)).rejects.toThrow('置き場に file がありません（404）');
  });

  test('TPM 担当が消す前に、参照しているページを出す。消すと 410 で、番号は使い回さない', async () => {
    const s = setup();
    const ctx = s.real(s.w.role('K-8', 'file:1'), { ROSTER_ROLE: 'software-engineer' });
    const url = await upload(s, ctx, 'shot.png');
    const page = await s.put(ctx, 'plan', '<title>図のある計画</title><img src="files/shot-1.png">');
    await expect(fileDelete(ctx, [url], { yes: true })).rejects.toThrow('TPM 担当だけ');
    expect(await fileDelete(s.tpm, [url], {})).toContain(`  ${page}  図のある計画（shot-1.png を参照）`);
    expect(await fileDelete(s.tpm, [url], { yes: true })).toEqual(['消した: 1 個（控えも消した）', `- ${url}`]);
    await expect(filePath(ctx, url)).rejects.toThrow('（410）');
    expect(await upload(s, ctx, 'shot.png')).toBe(`${URL}/${s.project}/K-8/files/shot-2.png`);
    // Key ごと消すと、ページと file が一緒に消える。
    expect((await pageDelete(s.tpm, [], { key: 'K-8', yes: true })).slice(-2)).toEqual(['消した file: 1 個', `- ${URL}/${s.project}/K-8/files/shot-2.png`]);
    expect(await files(s, { key: 'K-8' })).toEqual([]);
    expect(existsSync(join(s.dir, s.project, 'K-8'))).toBe(false);
  });

  test('控えの files/ の file を、同じ番号と時刻で取り込める。打ち直しても増えない', async () => {
    const s = setup();
    const project = `${s.project}-legacy`;
    const folder = join(s.dir, project, 'K-9', 'files');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'shot-3.png'), PNG);
    utimesSync(join(folder, 'shot-3.png'), new Date('2026-11-19T01:02:03.456Z'), new Date('2026-11-19T01:02:03.456Z'));
    expect((await pageImport(s.tpm)).at(-2)).toBe('file: 入れた: 1 個・もう入っていた: 0 個・消した file: 0 個・ぶつかった: 0 個');
    expect((await pageImport(s.tpm)).at(-1)).toBe('file: 入れた: 0 個・もう入っていた: 1 個・消した file: 0 個・ぶつかった: 0 個');
    expect((await files(s, { allProjects: true, key: 'K-9' })).filter(f => f.project === project).map(f => [f.n, f.role, f.created_at])).toEqual([[3, 'unknown', '2026-11-19T01:02:03.456Z']]);
  });

  test('返事の状態: 返事待ちにして、絞って探せて、答えたにできる。消したページ・無いページには書けない', async () => {
    const s = setup();
    const se = s.real(s.w.role('K-9', 'file:1'), { ROSTER_ROLE: 'software-engineer' });
    const first = await s.put(se, 'confirm', '<title>案を選ぶ</title>');
    const second = await s.put(se, 'confirm', '<title>計画の確認</title>');
    const result = await s.put(se, 'result', '<title>結果</title>');
    expect(await waitingUrls(s.tpm, 'K-9')).toEqual([]);
    expect((await s.list(s.tpm, { key: 'K-9' })).every(p => p.asked_at === undefined && p.answered_at === undefined)).toBe(true);

    expect(await setReply(se, first, 'waiting')).toBe('done');
    expect(await pageReply(s.tpm, [second], { waiting: true })).toEqual([`返事待ちにした: ${second}`]);
    // 古い順に返る（roster answer が、止まった時に並べる順）。
    expect(await waitingUrls(s.tpm, 'K-9')).toEqual([first, second]);
    expect((await s.list(s.tpm, { reply: 'waiting' })).map(p => p.url)).toEqual([second, first]);

    expect(await setReply(s.tpm, first, 'answered')).toBe('done');
    expect(await waitingUrls(s.tpm, 'K-9')).toEqual([second]);
    const answered = await s.list(s.tpm, { reply: 'answered' });
    expect(answered.map(p => p.url)).toEqual([first]);
    expect(answered[0]?.asked_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect((answered[0]?.answered_at ?? '') >= (answered[0]?.asked_at ?? 'x')).toBe(true);
    // 返事を求めていないページは、どちらの絞りにも出ない。
    expect([...await s.list(s.tpm, { reply: 'waiting' }), ...answered].map(p => p.url)).not.toContain(result);

    expect(await setReply(s.tpm, `${URL}/${s.project}/K-9/confirm-9.html`, 'waiting')).toBe('missing');
    await pageDelete(s.tpm, [second], { yes: true });
    expect(await setReply(s.tpm, second, 'answered')).toBe('missing');
    expect(await waitingUrls(s.tpm, 'K-9')).toEqual([]);
  });
});

describe.skipIf(URL === '')('cli と pagetray のつなぎ（レビューの印）', () => {
  test('依頼書にレビュー待ちと見る物、レビューのページに判定と見た物、上げた件の待ち。Product Manager の返事待ちには入らない', async () => {
    const s = setup();
    const se = s.real(s.w.role('K-30', 'file:1'), { ROSTER_ROLE: 'software-engineer' });
    const plan = await s.put(se, 'plan', '<title>計画</title>');
    const brief = await s.put(se, 'brief', '<title>レビューの依頼書</title>');
    const review = await s.put(s.real(s.w.role('K-30.staff', 'file:2'), { ROSTER_ROLE: 'staff-engineer' }), 'review', '<title>レビュー</title>', 'K-30');
    const PR = 'https://github.com/o/r/pull/7';
    const asks: Review[] = [
      { n: 1, key: 'K-30', url: plan, by: 'SWE K-30', askedAt: '2026-11-23T00:00:00.000Z', brief },
      { n: 2, key: 'K-30', url: PR, by: 'SWE K-30', askedAt: '2026-11-23T00:00:01.000Z', brief },
    ];
    expect(await markBrief(se, brief, asks, [])).toEqual([`置き場の印: レビュー待ちにした ${brief}`]);
    const target = `/${s.project}/K-30/plan-1.html`;
    expect((await s.list(s.tpm, { key: 'K-30', kind: 'brief' }))[0]).toMatchObject({ waits_on: 'review', targets: [target, PR] });
    expect(await waitingUrls(s.tpm, 'K-30')).toEqual([]);
    expect((await s.list(s.tpm, { key: 'K-30', reply: 'waiting', on: 'review' })).map(p => p.url)).toEqual([brief]);

    expect(await markVerdict(se, review, 'reject', asks)).toEqual([`置き場の印: 判定と見た物を書いた ${review}`, `置き場の印: レビュー済みにした ${brief}`]);
    expect((await s.list(s.tpm, { key: 'K-30', kind: 'review' }))[0]).toMatchObject({ verdict: 'reject', targets: [target, PR] });
    expect(await s.list(s.tpm, { key: 'K-30', reply: 'answered' })).toEqual([]);

    expect(await markEscalated(se, review)).toEqual([`置き場の印: 上げた（TPM 担当の返事待ち）にした ${review}`]);
    expect((await s.list(s.tpm, { key: 'K-30', reply: 'waiting', on: 'tpm' })).map(p => p.url)).toEqual([review]);
    // 相手を違えると、置き場は何も替えない
    expect(await setReply(s.tpm, review, 'answered')).toBe('conflict');
    expect(await pageReply(s.tpm, [review], { answered: true, on: 'tpm' })).toEqual([`決まったにした: ${review}`]);
    expect(await s.list(s.tpm, { key: 'K-30', reply: 'waiting', on: 'tpm' })).toEqual([]);
  });
});
