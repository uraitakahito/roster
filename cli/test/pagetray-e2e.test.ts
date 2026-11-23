// cli と本物の置き場（pagetray）のつなぎの試験。$ROSTER_E2E_PAGES_URL に動いている pagetray の URL がある時だけ流す
// （CI の pagetray-e2e.yml。手元では docs-site の開発のページの「pagetray（ページの置き場のサーバー）とのつなぎ」）。
// ほかの試験は偽の置き場（helpers.ts の FakeStore）で流すので、API の形（URL・引数の名・JSON の欄）のずれはここで見つける。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { fileDelete, fileList, filePath, filePut, type FileRecord } from '../src/commands/file.ts';
import { PAGE_KINDS, pageDelete, pageImport, pageList, pagePath, pagePut, pageReply, type PageRecord } from '../src/commands/page.ts';
import { PARTY_SINCE, setReply, waitingUrls } from '../src/commands/reply.ts';
import { castlistIssuer } from '../src/castlist.ts';
import type { Context } from '../src/context.ts';
import { exec } from '../src/exec.ts';
import { ROLE_NAMES } from '../src/protocol.ts';
import { world } from './helpers.ts';
import { markBrief, markEscalated, markVerdict } from '../src/commands/review-marks.ts';
import { atLeast } from '../src/commands/store.ts';
import type { Review } from '../src/reviews.ts';

const URL = process.env.ROSTER_E2E_PAGES_URL ?? '';
/**
 * 置き場に file のエンドポイントがあるか（pagetray 0.4.0 から）。.pagetray-version が 0.3 の間は、file の試験を飛ばして CI を緑に保つ。
 * 版の番号でなくエンドポイントで見るのは、0.4.0 の release の前の手元のサーバー（版は 0.3.x のまま）にも向けて流せるように。
 */
const FILES = URL !== '' && execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', `${URL}/api/files?limit=1`], { encoding: 'utf8' }) === '200';
/**
 * 置き場が返事の状態を持てるか（pagetray 0.5.0 から）。引数の無い POST に、持てる置き場は 400、前の置き場は 405（その道が無い）を返す。
 * 持てない置き場には、「印を付けずに通る」方の試験を流す（新しい roster が古い置き場に当たった時の振る舞い）。
 */
const REPLY = URL !== '' && execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-X', 'POST', `${URL}/api/pages/reply`], { encoding: 'utf8' }) === '400';
/**
 * 置き場が送り手（actor_issuer・actor_ref）を記録するか（pagetray 0.6.0 から）。/api/version の版で見る（前の版は知らない引数を読まずに置くので、答えでは見分けられない）。
 * CI の置き場は PAGETRAY_CASTLIST_URL を付けずに起こすので、castlist には聞かず、付随する id だけを残す（未確認。`sender.actor` は null）。
 */
const SENDER = URL !== '' && ((): boolean => {
  const [major = 0, minor = 0] = (JSON.parse(execFileSync('curl', ['-fsS', `${URL}/api/version`], { encoding: 'utf8' })) as { version: string }).version.split('.').map(Number);
  return major > 0 || minor >= 6;
})();
/** PNG の頭の 8 byte と、少しの中身。 */
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('つなぎの試験の図')]);

/** 本物の curl で本物の置き場に向けた周り。project の名（状態の folder の名）は world ごとに違う。 */
function setup() {
  const w = world();
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'roster-e2e-pages-')));
  const real = (ctx: Context, env: NodeJS.ProcessEnv = {}): Context => ({ ...ctx, exec, env: { ...ctx.env, ROSTER_PAGES_URL: URL, ROSTER_PAGES_DIR: dir, ...env } });
  const html = join(dir, 'src.html');
  const put = (ctx: Context, kind: string, text: string, key?: string): string => {
    writeFileSync(html, text);
    return pagePut(ctx, html, { kind, ...(key === undefined ? {} : { key }) })[1]?.replace('URL: ', '') ?? '';
  };
  const list = (ctx: Context, options: Parameters<typeof pageList>[1]): (PageRecord & { url: string })[] =>
    JSON.parse(pageList(ctx, { ...options, json: true }).join('\n')) as (PageRecord & { url: string })[];
  return { w, dir, real, put, list, project: basename(w.tpm.state.dir), tpm: real(w.tpm) };
}

describe.skipIf(URL === '')('cli と pagetray のつなぎ', () => {
  test('どの役割も、どの種類も置けて、役割と種類で探せて、置き場から読み戻せる', () => {
    const s = setup();
    for (const role of ROLE_NAMES) {
      const ctx = s.real(s.w.role('K-1', 'file:1'), { ROSTER_ROLE: role });
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
    const plan = s.put(s.real(s.w.role('K-2', 'file:9'), { ROSTER_ROLE: 'software-engineer' }), 'plan', '<title>計画</title><p>並べ替えを作る</p>');
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
    const ctx = s.real(s.w.role('K-5', 'file:1'), { ROSTER_ROLE: 'software-engineer' });
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

describe.skipIf(!FILES)('cli と pagetray のつなぎ（file。置き場が 0.4.0 から）', () => {
  /** 図を書いて上げ、URL を返す。 */
  function upload(s: ReturnType<typeof setup>, ctx: Context, name: string, body: Buffer | string = PNG, key?: string): string {
    const src = join(s.dir, `src-${name}`);
    writeFileSync(src, body);
    return filePut(ctx, src, { reviewed: true, name, ...(key === undefined ? {} : { key }) })[1]?.replace('URL: ', '') ?? '';
  }
  const files = (s: ReturnType<typeof setup>, options: Parameters<typeof fileList>[1]): (FileRecord & { url: string })[] =>
    JSON.parse(fileList(s.tpm, { ...options, json: true }).join('\n')) as (FileRecord & { url: string })[];

  test('上げると番号が付き、控えを消しても読み戻せる。ページの <img> の参照も roster page path が控えに写す', () => {
    const s = setup();
    const ctx = s.real(s.w.role('K-6', 'file:1'), { ROSTER_ROLE: 'software-engineer' });
    const url = upload(s, ctx, 'shot.png');
    expect(url).toBe(`${URL}/${s.project}/K-6/files/shot-1.png`);
    expect(upload(s, ctx, 'shot.png')).toBe(`${URL}/${s.project}/K-6/files/shot-2.png`);
    const [path = ''] = filePath(ctx, url);
    rmSync(path);
    expect(readFileSync(filePath(ctx, url)[0] ?? '').equals(PNG)).toBe(true);
    expect(files(s, { key: 'K-6' }).map(f => [f.name, f.ext, f.n, f.type, f.size, f.role, f.workspace])).toEqual([
      ['shot', 'png', 2, 'image/png', PNG.length, 'software-engineer', ''],
      ['shot', 'png', 1, 'image/png', PNG.length, 'software-engineer', ''],
    ]);
    expect(files(s, { q: 'shot.png' })).toHaveLength(2);
    const page = s.put(ctx, 'result', '<title>図のある結果</title><img src="files/shot-1.png">');
    rmSync(path);
    rmSync(join(s.dir, s.project, 'K-6', 'result-1.html'));
    expect(pagePath(ctx, page)).toEqual([join(s.dir, s.project, 'K-6', 'result-1.html'), `参照の file: ${path}`]);
    expect(readFileSync(path).equals(PNG)).toBe(true);
  });

  test('置き場が中身の合わない file を断れば、訳を添えて止まる。無い file は 404', () => {
    const s = setup();
    const ctx = s.real(s.w.role('K-7', 'file:1'));
    expect(() => upload(s, ctx, 'fake.png', '%PDF-1.4')).toThrow('置き場が file を受け取りませんでした（415）');
    expect(() => filePath(ctx, `${URL}/${s.project}/K-7/files/none-1.png`)).toThrow('置き場に file がありません（404）');
  });

  test('TPM 担当が消す前に、参照しているページを出す。消すと 410 で、番号は使い回さない', () => {
    const s = setup();
    const ctx = s.real(s.w.role('K-8', 'file:1'), { ROSTER_ROLE: 'software-engineer' });
    const url = upload(s, ctx, 'shot.png');
    const page = s.put(ctx, 'plan', '<title>図のある計画</title><img src="files/shot-1.png">');
    expect(() => fileDelete(ctx, [url], { yes: true })).toThrow('TPM 担当だけ');
    expect(fileDelete(s.tpm, [url], {})).toContain(`  ${page}  図のある計画（shot-1.png を参照）`);
    expect(fileDelete(s.tpm, [url], { yes: true })).toEqual(['消した: 1 個（控えも消した）', `- ${url}`]);
    expect(() => filePath(ctx, url)).toThrow('（410）');
    expect(upload(s, ctx, 'shot.png')).toBe(`${URL}/${s.project}/K-8/files/shot-2.png`);
    // Key ごと消すと、ページと file が一緒に消える。
    expect(pageDelete(s.tpm, [], { key: 'K-8', yes: true }).slice(-2)).toEqual(['消した file: 1 個', `- ${URL}/${s.project}/K-8/files/shot-2.png`]);
    expect(files(s, { key: 'K-8' })).toEqual([]);
    expect(existsSync(join(s.dir, s.project, 'K-8'))).toBe(false);
  });

  test('控えの files/ の file を、同じ番号と時刻で取り込める。打ち直しても増えない', () => {
    const s = setup();
    const project = `${s.project}-legacy`;
    const folder = join(s.dir, project, 'K-9', 'files');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'shot-3.png'), PNG);
    utimesSync(join(folder, 'shot-3.png'), new Date('2026-11-19T01:02:03.456Z'), new Date('2026-11-19T01:02:03.456Z'));
    expect(pageImport(s.tpm).at(-2)).toBe('file: 入れた: 1 個・もう入っていた: 0 個・消した file: 0 個・ぶつかった: 0 個');
    expect(pageImport(s.tpm).at(-1)).toBe('file: 入れた: 0 個・もう入っていた: 1 個・消した file: 0 個・ぶつかった: 0 個');
    expect(files(s, { allProjects: true, key: 'K-9' }).filter(f => f.project === project).map(f => [f.n, f.role, f.created_at])).toEqual([[3, 'unknown', '2026-11-19T01:02:03.456Z']]);
  });

  test.skipIf(!REPLY)('返事の状態: 返事待ちにして、絞って探せて、答えたにできる。消したページ・無いページには書けない', () => {
    const s = setup();
    const se = s.real(s.w.role('K-9', 'file:1'), { ROSTER_ROLE: 'software-engineer' });
    const first = s.put(se, 'confirm', '<title>案を選ぶ</title>');
    const second = s.put(se, 'confirm', '<title>計画の確認</title>');
    const result = s.put(se, 'result', '<title>結果</title>');
    expect(waitingUrls(s.tpm, 'K-9')).toEqual([]);
    expect(s.list(s.tpm, { key: 'K-9' }).every(p => p.asked_at === undefined && p.answered_at === undefined)).toBe(true);

    expect(setReply(se, first, 'waiting')).toBe('done');
    expect(pageReply(s.tpm, [second], { waiting: true })).toEqual([`返事待ちにした: ${second}`]);
    // 古い順に返る（roster answer が、止まった時に並べる順）。
    expect(waitingUrls(s.tpm, 'K-9')).toEqual([first, second]);
    expect(s.list(s.tpm, { reply: 'waiting' }).map(p => p.url)).toEqual([second, first]);

    expect(setReply(s.tpm, first, 'answered')).toBe('done');
    expect(waitingUrls(s.tpm, 'K-9')).toEqual([second]);
    const answered = s.list(s.tpm, { reply: 'answered' });
    expect(answered.map(p => p.url)).toEqual([first]);
    expect(answered[0]?.asked_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect((answered[0]?.answered_at ?? '') >= (answered[0]?.asked_at ?? 'x')).toBe(true);
    // 返事を求めていないページは、どちらの絞りにも出ない。
    expect([...s.list(s.tpm, { reply: 'waiting' }), ...answered].map(p => p.url)).not.toContain(result);

    expect(setReply(s.tpm, `${URL}/${s.project}/K-9/confirm-9.html`, 'waiting')).toBe('missing');
    pageDelete(s.tpm, [second], { yes: true });
    expect(setReply(s.tpm, second, 'answered')).toBe('missing');
    expect(waitingUrls(s.tpm, 'K-9')).toEqual([]);
  });

  test.skipIf(REPLY)('返事の状態を持てない置き場（0.5.0 より前）: 書く道は old を返し、返事待ちは 1 枚も数えない', () => {
    const s = setup();
    const se = s.real(s.w.role('K-9', 'file:1'), { ROSTER_ROLE: 'software-engineer' });
    const first = s.put(se, 'confirm', '<title>案を選ぶ</title>');
    s.put(se, 'confirm', '<title>計画の確認</title>');
    expect(setReply(se, first, 'waiting')).toBe('old');
    // 前の置き場は reply の絞りを読まずに 2 枚とも返すが、返事待ちとは数えない。
    expect(waitingUrls(s.tpm, 'K-9')).toEqual([]);
    expect(s.list(s.tpm, { reply: 'waiting' })).toEqual([]);
    expect(() => pageReply(s.tpm, [first], { waiting: true })).toThrow(/版が古く/);
  });
});

describe.skipIf(!SENDER)('cli と pagetray のつなぎ（送り手。置き場が 0.6.0 から）', () => {
  test('castlist の設定と session の id があると、ページと file の記録に、付けた issuer と ref が残る（置き場に castlist の URL が無いので未確認）', () => {
    const s = setup();
    const sid = '5f0c2a8e-0000-4000-8000-0000000000e2';
    const ctx = s.real(s.w.role('K-20', 'file:1'), { ROSTER_ROLE: 'software-engineer', ROSTER_CASTLIST_URL: 'http://127.0.0.1:8802', CLAUDE_CODE_SESSION_ID: sid });
    const sender = { issuer: castlistIssuer(s.w.tpm.state.dir), ref: `claude.session:${sid}`, actor: null };
    const url = s.put(ctx, 'result', '<title>送り手のある結果</title><p>つなぎの試験</p>');
    expect(s.list(s.tpm, { key: 'K-20' })).toEqual([expect.objectContaining({ url, sender: expect.objectContaining(sender) as unknown })]);
    const src = join(s.dir, 'src-sender.png');
    writeFileSync(src, PNG);
    const file = filePut(ctx, src, { reviewed: true })[1]?.replace('URL: ', '') ?? '';
    const listed = JSON.parse(fileList(s.tpm, { key: 'K-20', json: true }).join('\n')) as (FileRecord & { url: string })[];
    expect(listed).toEqual([expect.objectContaining({ url: file, sender: expect.objectContaining(sender) as unknown })]);
    // 付けない時は、前と同じに置き、sender は出ない。
    const plain = s.put(s.real(s.w.role('K-21', 'file:1'), { ROSTER_ROLE: 'software-engineer' }), 'result', '<title>送り手の無い結果</title>');
    expect(s.list(s.tpm, { key: 'K-21' })).toEqual([expect.not.objectContaining({ sender: expect.anything() as unknown })]);
    expect(s.list(s.tpm, { key: 'K-21' })[0]?.url).toBe(plain);
  });
});

/** 置き場がレビューの印（待ちの相手・判定・見た物）を持てるか（pagetray 0.8.0 から）。/api/version の版で見る（前の版は知らない on を読まずに捨てる）。 */
const MARKS = URL !== '' && atLeast((JSON.parse(execFileSync('curl', ['-fsS', `${URL}/api/version`], { encoding: 'utf8' })) as { version: string }).version, PARTY_SINCE);

describe.skipIf(!MARKS)('cli と pagetray のつなぎ（レビューの印。置き場が 0.8.0 から）', () => {
  test('依頼書にレビュー待ちと見る物、レビューのページに判定と見た物、上げた件の待ち。Product Manager の返事待ちには入らない', () => {
    const s = setup();
    const se = s.real(s.w.role('K-30', 'file:1'), { ROSTER_ROLE: 'software-engineer' });
    const plan = s.put(se, 'plan', '<title>計画</title>');
    const brief = s.put(se, 'brief', '<title>レビューの依頼書</title>');
    const review = s.put(s.real(s.w.role('K-30.staff', 'file:2'), { ROSTER_ROLE: 'staff-engineer' }), 'review', '<title>レビュー</title>', 'K-30');
    const PR = 'https://github.com/o/r/pull/7';
    const asks: Review[] = [
      { n: 1, key: 'K-30', url: plan, by: 'SWE K-30', askedAt: '2026-11-23T00:00:00.000Z', brief },
      { n: 2, key: 'K-30', url: PR, by: 'SWE K-30', askedAt: '2026-11-23T00:00:01.000Z', brief },
    ];
    expect(markBrief(se, brief, asks, [])).toEqual([`置き場の印: レビュー待ちにした ${brief}`]);
    const target = `/${s.project}/K-30/plan-1.html`;
    expect(s.list(s.tpm, { key: 'K-30', kind: 'brief' })[0]).toMatchObject({ waits_on: 'review', targets: [target, PR] });
    expect(waitingUrls(s.tpm, 'K-30')).toEqual([]);
    expect(s.list(s.tpm, { key: 'K-30', reply: 'waiting', on: 'review' }).map(p => p.url)).toEqual([brief]);

    expect(markVerdict(se, review, 'reject', asks)).toEqual([`置き場の印: 判定と見た物を書いた ${review}`, `置き場の印: レビュー済みにした ${brief}`]);
    expect(s.list(s.tpm, { key: 'K-30', kind: 'review' })[0]).toMatchObject({ verdict: 'reject', targets: [target, PR] });
    expect(s.list(s.tpm, { key: 'K-30', reply: 'answered' })).toEqual([]);

    expect(markEscalated(se, review)).toEqual([`置き場の印: 上げた（TPM 担当の返事待ち）にした ${review}`]);
    expect(s.list(s.tpm, { key: 'K-30', reply: 'waiting', on: 'tpm' }).map(p => p.url)).toEqual([review]);
    // 相手を違えると、置き場は何も替えない
    expect(setReply(s.tpm, review, 'answered')).toBe('conflict');
    expect(pageReply(s.tpm, [review], { answered: true, on: 'tpm' })).toEqual([`決まったにした: ${review}`]);
    expect(s.list(s.tpm, { key: 'K-30', reply: 'waiting', on: 'tpm' })).toEqual([]);
  });
});
