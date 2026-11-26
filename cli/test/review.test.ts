// レビューの 1 周: 課題の担当が頼む（roster ask review。Staff の席が無ければ起こし、居ればじかに届ける）→ Staff が返す（roster report review。課題の担当へじかに届く）→ 数える（roster review list）。
// どちらも TPM 担当を通らない。受けない時だけ、課題の担当が roster ask tpm --review で上げる。
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { askTpm, dismiss, notify, reportDone, toPeer } from '../src/commands/messages.ts';
import { pageList, pagePath, pagePut, pageReply, type PageRecord } from '../src/commands/page.ts';
import { reviewList } from '../src/commands/review.ts';
import { markBrief } from '../src/commands/review-marks.ts';
import { hello } from '../src/commands/role-side.ts';
import { askReview, reportReview } from '../src/commands/staff.ts';
import { collect } from '../src/commands/timeline.ts';
import { assign, close } from '../src/commands/tpm-side.ts';
import type { Context } from '../src/context.ts';
import { readReviews, reviewLabel, type Review } from '../src/reviews.ts';
import { requireRole } from '../src/roster.ts';
import type { MessageTrace } from '../src/transport/types.ts';
import { BRIEF, staffRoot, world, type World } from './helpers.ts';

const TPM = { model: 'claude-opus-5-5', effort: 'medium' };
const STAFF = { role: 'staff-engineer', wait: 0 } as const;
const PR = 'https://github.com/o/r/pull/7';
const SE_TITLE = 'SWE AI-8: 計画と実装';

interface Seats extends World { se: Context, plan: string, staffAt: (address: string) => Context, put: (ctx: Context, kind: string) => Promise<string> }

/** TPM 担当と AI-8 の Software Engineer 担当（file:1）が名乗った世界。plan は、担当が置いた計画のページ。どちらも、Staff Engineer 担当の skill が在る root。 */
async function started(config: Record<string, unknown> = {}, issue?: string): Promise<Seats> {
  const w = world(config);
  const tpm = { ...w.tpm, root: staffRoot() };
  await hello(tpm, TPM);
  await assign(tpm, 'AI-8', { role: 'software-engineer', title: '計画と実装', brief: BRIEF, wait: 0, ...(issue === undefined ? {} : { issue }) });
  const se = { ...w.role('AI-8', 'file:1'), root: staffRoot(), env: { ...w.role('AI-8', 'file:1').env, ROSTER_ROLE: 'software-engineer' } };
  await hello(se);
  const html = join(realpathSync(mkdtempSync(join(tmpdir(), 'roster-review-'))), 'p.html');
  writeFileSync(html, '<title>試し</title>');
  const put = async (ctx: Context, kind: string): Promise<string> => (await pagePut(ctx, html, { kind })).find(l => l.startsWith('URL: '))?.slice(5) ?? '';
  const staffAt = (address: string): Context => {
    const base = w.role('AI-8.staff', address);
    return { ...base, env: { ...base.env, ROSTER_ROLE: 'staff-engineer' } };
  };
  return { ...w, tpm, se, plan: await put(se, 'plan'), staffAt, put };
}

/** started に、頼み 1 つと、それで起きて名乗った Staff の席（file:2）を足した世界。 */
async function asked(config: Record<string, unknown> = {}, issue?: string): Promise<Seats & { staff: Context }> {
  const w = await started(config, issue);
  await askReview(w.se, { url: w.plan, focus: '名簿の Key の決め方', wait: 0 });
  const staff = w.staffAt('file:2');
  await hello(staff);
  return { ...w, staff };
}

const texts = (w: World, address: string): string[] => w.wire.inbox(address).map(m => m.text);

describe('roster ask review（席が無い時: 命令が席を起こす）', () => {
  test('頼みから依頼書を作って置き、それで席を起こす。TPM 担当には何も届かない', async () => {
    const w = await started({ tracker: 'jira' }, 'AI-8');
    expect(await askReview(w.se, { url: w.plan, focus: '名簿の Key の決め方', wait: 0 })).toEqual([
      '起こした: レビュー AI-8: 計画 plan-1（file:2・Opus 5.5 · high）',
      `folder: ${w.project}`,
      '名乗り（roster hello）は待っていない',
      expect.stringMatching(/^置き場の印: レビュー待ちにした http:\/\/127\.0\.0\.1:8801\/.+\/AI-8\/brief-1\.html$/) as string,
      '状態: 回答待ち(レビュー): 計画 plan-1',
    ]);
    expect(texts(w, 'file:tpm')).toEqual([]);
    // 説明は見てほしい所、帯は紫
    expect(w.wire.look('file:2')).toEqual({ title: 'レビュー AI-8: 計画 plan-1', description: '名簿の Key の決め方', color: 'Purple' });
    expect(requireRole(w.tpm, 'AI-8.staff')).toMatchObject({ key: 'AI-8.staff', subject: 'AI-8', role: 'staff-engineer', title: 'レビュー AI-8: 計画 plan-1', issue: 'AI-8', model: 'claude-opus-5-5', effort: 'high' });
    const brief = requireRole(w.tpm, 'AI-8.staff').brief ?? '';
    expect(brief).toMatch(new RegExp(`/${basename(w.tpm.state.dir)}/AI-8/brief-1\\.html$`));
    const html = readFileSync((await pagePath(w.tpm, brief))[0] ?? '', 'utf8');
    expect(html).toContain('<section id="summary">');
    for (const part of ['頼み #1', w.plan, '名簿の Key の決め方', SE_TITLE, BRIEF]) expect(html, part).toContain(part);
    expect(readReviews(w.tpm)).toEqual([{ n: 1, key: 'AI-8', url: w.plan, focus: '名簿の Key の決め方', by: SE_TITLE, askedAt: '2026-11-20T12:00:00.000Z', brief }]);
    expect(w.wire.status('file:1')?.wait).toBe('回答待ち(レビュー): 計画 plan-1');
  });

  test('席の model などは、設定の staff-engineer の欄 > 役割の既定（旗は無い）', async () => {
    const w = await started({ 'staff-engineer': { model: 'claude-fable-5-2' } });
    await askReview(w.se, { url: w.plan, wait: 0 });
    expect(requireRole(w.tpm, 'AI-8.staff')).toMatchObject({ model: 'claude-fable-5-2', effort: 'high' });
  });

  test('席が落ちていたら起こし直し、返っていない前の頼みも新しい依頼書で渡し直す', async () => {
    const w = await asked();
    w.tpm.transport.close('file:2');
    w.se.now = () => new Date('2026-11-20T12:10:00.000Z');
    expect((await askReview(w.se, { url: PR, wait: 0 }))[0]).toBe('起こし直した: レビュー AI-8: PR #7 +1（file:3・Opus 5.5 · high）');
    const [one, two] = readReviews(w.tpm);
    expect(one?.brief).toMatch(/brief-2\.html$/);
    expect(two?.brief).toBe(one?.brief);
  });

  test('起こした席が名乗らなければ、訳を出して止まる。頼みは残る（依頼書は渡してある）', async () => {
    const w = await started();
    await expect(askReview(w.se, { url: w.plan, wait: 4 })).rejects.toThrow(/レビュー AI-8: 計画 plan-1（file:2）が 4 秒たっても名乗りません。[\s\S]*頼み #1 は残してあります。Staff Engineer 担当の席が名乗らないことを、roster ask tpm で TPM 担当に知らせてください（TPM 担当が、残った居場所を roster close AI-8\.staff で閉じてから起こし直す）。/);
    expect(readReviews(w.tpm)[0]).toMatchObject({ n: 1, brief: expect.stringMatching(/brief-1\.html$/) as string });
  });

  test('席を起こす前に止まった回は、頼みを書かない（打ち直せる）', async () => {
    const w = await started();
    const spawn = w.se.transport.spawn.bind(w.se.transport);
    w.se.transport.spawn = () => {
      throw new Error('居場所を作れない');
    };
    await expect(askReview(w.se, { url: w.plan, wait: 0 })).rejects.toThrow('居場所を作れない');
    expect(readReviews(w.tpm)).toEqual([]);
    w.se.transport.spawn = spawn;
    expect((await askReview(w.se, { url: w.plan, wait: 0 }))[0]).toMatch(/^起こし(直し)?た: レビュー AI-8: 計画 plan-1/);
    expect(readReviews(w.tpm).map(r => r.n)).toEqual([1]);
  });

  test('skill がまだ無ければ、頼みを書かずに止まる', async () => {
    const w = await started();
    const se = { ...w.se, root: w.tpm.project };
    await expect(askReview(se, { url: w.plan, wait: 0 })).rejects.toThrow(/skill \/staff-engineer がまだありません/);
    expect(readReviews(w.tpm)).toEqual([]);
  });

  test('見る物は、置き場のページか PR の URL。同じ物は 2 度頼めない。Staff と Auditor からは頼めない', async () => {
    const w = await asked();
    await expect(askReview(w.se, { url: 'cli/src/guard.ts' })).rejects.toThrow(/--url は、置き場のページか PR の URL にしてください/);
    await expect(askReview(w.se, { url: w.plan })).rejects.toThrow(/同じ物のレビューを、もう頼んであります（#1。[\s\S]*判定は Staff Engineer 担当から【review】で届きます/);
    await expect(askReview(w.staff, { url: w.plan })).rejects.toThrow(/Staff Engineer 担当は roster ask review を打ちません/);
    const auditor = { ...w.se, env: { ...w.se.env, ROSTER_KEY: 'audit', ROSTER_ROLE: 'auditor' } };
    w.tpm.state.write('roles/audit.jsonc', { ...requireRole(w.tpm, 'AI-8'), key: 'audit', role: 'auditor', title: 'Audit' });
    await expect(askReview(auditor, { url: w.plan })).rejects.toThrow(/Auditor は roster ask review を打ちません/);
  });

  test('頼みの番号は、同じ番号の file を「在れば失敗」で作って決める（同時に頼んでも重ならない）', async () => {
    const w = await started();
    // 別の担当が、番号を読んだ後・書く前に #1 を取った形
    w.tpm.state.write('reviews/1.jsonc', { n: 1, key: 't-a3b4', url: PR, by: 'SWE t-a3b4', askedAt: '2026-11-20T11:59:00.000Z' });
    await askReview(w.se, { url: w.plan, wait: 0 });
    expect(readReviews(w.tpm).map(r => [r.n, r.key])).toEqual([[1, 't-a3b4'], [2, 'AI-8']]);
  });
});

describe('roster ask review（席が居る時: じかに届ける）', () => {
  test('【ask-review】が席へじかに届き、席の題と説明が替わる。TPM 担当には何も届かない', async () => {
    const w = await asked();
    w.staff.now = () => new Date('2026-11-20T12:05:00.000Z');
    await reportReview(w.staff, { url: await w.put(w.staff, 'review'), verdict: 'approve', summary: 'このままでよい' });
    w.se.now = () => new Date('2026-11-20T12:10:00.000Z');
    expect(await askReview(w.se, { url: PR })).toEqual(['送った: 【ask-review】→ file:2（相手の手が空いた時に届く。送り直さない）', expect.stringMatching(/^置き場の印: レビュー待ちにした http:\/\/127\.0\.0\.1:8801\/.+\/AI-8\/brief-2\.html$/) as string, '状態: 回答待ち(レビュー): PR #7']);
    const got = w.wire.inbox('file:2').at(-1);
    expect(got?.from).toBe(SE_TITLE);
    expect(got?.text).toMatch(new RegExp(`^【ask-review】http://127\\.0\\.0\\.1:8801/.+/AI-8/brief-2\\.html 頼み: #2 ${PR}$`));
    expect(texts(w, 'file:tpm')).toEqual([]);
    // 題と説明は、新しい頼みに替わる（見てほしい所の無い頼みなので、前の説明は消える）。名簿の題と依頼書も同じにする
    expect(w.wire.look('file:2')).toEqual({ title: 'レビュー AI-8: PR #7', color: 'Purple' });
    expect(requireRole(w.tpm, 'AI-8.staff')).toMatchObject({ title: 'レビュー AI-8: PR #7', brief: expect.stringMatching(/brief-2\.html$/) as string });
    expect(readReviews(w.tpm)[1]).toMatchObject({ n: 2, url: PR, brief: expect.stringMatching(/brief-2\.html$/) as string });
    // Staff の次のメッセージは、新しい題で課題の担当に届く
    w.staff.now = () => new Date('2026-11-20T12:30:00.000Z');
    await reportReview(w.staff, { url: await w.put(w.staff, 'review'), verdict: 'approve', summary: 'よい' });
    expect(w.wire.inbox('file:1').at(-1)?.from).toBe('レビュー AI-8: PR #7');
  });

  test('前の頼みが返っていなければ、後ろに積む。席は古い依頼書の頼みから返す', async () => {
    const w = await asked();
    w.se.now = () => new Date('2026-11-20T12:10:00.000Z');
    await askReview(w.se, { url: PR, focus: '試験の抜け' });
    expect(texts(w, 'file:2').at(-1)).toMatch(/brief-2\.html 頼み: #2 https:\/\/github\.com\/o\/r\/pull\/7 見てほしい所: 試験の抜け #1を済ませてから、これをする$/);
    // 席の題は、返っていない頼みをみな数える（新しい頼みと +1）
    expect(w.wire.look('file:2')?.title).toBe('レビュー AI-8: PR #7 +1');
    w.staff.now = () => new Date('2026-11-20T12:20:00.000Z');
    const first = await w.put(w.staff, 'review');
    await reportReview(w.staff, { url: first, verdict: 'reject', summary: '依頼と違う' });
    expect(texts(w, 'file:1').at(-1)).toMatch(/／頼み: #1$/);
    expect(readReviews(w.tpm).map(r => [r.n, r.verdict])).toEqual([[1, 'reject'], [2, undefined]]);
    w.staff.now = () => new Date('2026-11-20T12:30:00.000Z');
    await reportReview(w.staff, { url: await w.put(w.staff, 'review'), verdict: 'approve', summary: 'よい' });
    expect(texts(w, 'file:1').at(-1)).toMatch(/／頼み: #2$/);
    expect(readReviews(w.tpm).map(r => [r.n, r.verdict, r.page === first])).toEqual([[1, 'reject', true], [2, 'approve', false]]);
  });

  test('送れなかった回は、頼みを書かない（打ち直せる）', async () => {
    const w = await asked();
    await reportReview(w.staff, { url: await w.put(w.staff, 'review'), verdict: 'approve', summary: 'よい' });
    w.se.now = () => new Date('2026-11-20T12:10:00.000Z');
    const send = w.se.transport.send.bind(w.se.transport);
    w.se.transport.send = () => {
      throw new Error('送れない');
    };
    await expect(askReview(w.se, { url: PR })).rejects.toThrow('送れない');
    expect(readReviews(w.tpm).map(r => r.n)).toEqual([1]);
    w.se.transport.send = send;
    expect((await askReview(w.se, { url: PR }))[0]).toBe('送った: 【ask-review】→ file:2（相手の手が空いた時に届く。送り直さない）');
  });

  test('送った後の失敗では、頼みを消さない（席にはもう届いている）', async () => {
    const w = await asked();
    await reportReview(w.staff, { url: await w.put(w.staff, 'review'), verdict: 'approve', summary: 'よい' });
    w.se.now = () => new Date('2026-11-20T12:10:00.000Z');
    const state = Object.assign(Object.create(w.se.state) as Context['state'], {
      write: (): never => {
        throw new Error('書けない');
      },
    });
    await expect(askReview({ ...w.se, state }, { url: PR })).rejects.toThrow('書けない');
    expect(texts(w, 'file:2').at(-1)).toMatch(/^【ask-review】.+ 頼み: #2 /);
    expect(readReviews(w.tpm).map(r => r.n)).toEqual([1, 2]);
  });

  test('まだ席に渡していない前の頼み（前の流れで TPM 担当に送られたままの物）は、同じ依頼書で一緒に渡す', async () => {
    const w = await asked();
    await reportReview(w.staff, { url: await w.put(w.staff, 'review'), verdict: 'approve', summary: 'よい' });
    w.tpm.state.write('reviews/2.jsonc', { n: 2, key: 'AI-8', url: 'https://github.com/o/r/pull/6', by: SE_TITLE, askedAt: '2026-11-20T12:05:00.000Z' });
    w.se.now = () => new Date('2026-11-20T12:10:00.000Z');
    await askReview(w.se, { url: PR });
    expect(texts(w, 'file:2').at(-1)).toMatch(/brief-2\.html 頼み: #2 #3 https:\/\/github\.com\/o\/r\/pull\/7$/);
    const [, two, three] = readReviews(w.tpm);
    expect(two?.brief).toMatch(/brief-2\.html$/);
    expect(three?.brief).toBe(two?.brief);
    expect(w.wire.look('file:2')?.title).toBe('レビュー AI-8: PR #7 +1');
  });

  test('席の題を替えられなくても止めない。依頼書は渡したまま、名簿の題は替えずに 1 行で知らせる', async () => {
    const w = await asked();
    w.staff.now = () => new Date('2026-11-20T12:20:00.000Z');
    await reportReview(w.staff, { url: await w.put(w.staff, 'review'), verdict: 'approve', summary: 'よい' });
    w.se.now = () => new Date('2026-11-20T12:30:00.000Z');
    const relabel = (): never => {
      throw new Error('Workspace ref not found');
    };
    const se = { ...w.se, transport: Object.assign(Object.create(w.se.transport) as Context['transport'], { relabel }) };
    expect(await askReview(se, { url: PR })).toEqual(['送った: 【ask-review】→ file:2（相手の手が空いた時に届く。送り直さない）', '居場所の題を替えられなかった（名簿の題は レビュー AI-8: 計画 plan-1 のまま）: Workspace ref not found', expect.stringMatching(/^置き場の印: レビュー待ちにした http:\/\/127\.0\.0\.1:8801\/.+\/AI-8\/brief-2\.html$/) as string, '状態: 回答待ち(レビュー): PR #7']);
    expect(requireRole(w.tpm, 'AI-8.staff').title).toBe('レビュー AI-8: 計画 plan-1');
    expect(readReviews(w.tpm)[1]?.brief).toMatch(/brief-2\.html$/);
  });

  test('同じメッセージを 30 秒の内に 2 度は送らない（相手の宛先で数える）', async () => {
    const w = await asked();
    const self = requireRole(w.tpm, 'AI-8');
    const seat = requireRole(w.tpm, 'AI-8.staff');
    toPeer(w.se, self, seat, 'ask-review', '同じ本文');
    expect(() => toPeer(w.se, self, seat, 'ask-review', '同じ本文')).toThrow(/同じ【ask-review】を、.+ にもう送っています/);
    expect(texts(w, 'file:2').filter(t => t === '【ask-review】同じ本文')).toHaveLength(1);
  });
});

describe('roster assign --role staff-engineer（TPM 担当の起こし直し）', () => {
  test('頼みが無ければ止まる。渡してある頼みを 2 度は依頼書にしない。--brief は書けない', async () => {
    const w = await started();
    await expect(assign(w.tpm, 'AI-8', STAFF)).rejects.toThrow(/AI-8 に、まだ依頼書にしていないレビューの頼みがありません。頼むのは課題の担当（roster ask review）/);
    await expect(assign(w.tpm, 'AI-8', { ...STAFF, brief: BRIEF })).rejects.toThrow(/Staff Engineer 担当への依頼書は、レビューの頼み（roster ask review）から命令が作ります。--brief は書かない/);
    await askReview(w.se, { url: w.plan, wait: 0 });
    await hello(w.staffAt('file:2'));
    await expect(assign(w.tpm, 'AI-8', STAFF)).rejects.toThrow(/まだ依頼書にしていないレビューの頼みがありません/);
    expect(w.wire.seats().map(s => s.address)).toEqual(['file:1', 'file:2']);
  });

  test('返っていない頼みがあるのに席が落ちたら、TPM 担当が起こし直せる（旗で model も変えられる）', async () => {
    const w = await asked();
    w.tpm.transport.close('file:2');
    expect((await assign(w.tpm, 'AI-8', { ...STAFF, model: 'claude-fable-5-2' }))[0]).toBe('起こし直した: レビュー AI-8: 計画 plan-1（file:3・Fable 5.2 · high）');
    expect(readReviews(w.tpm)[0]?.brief).toMatch(/brief-2\.html$/);
  });

  test('起こした席が名乗らずに居場所が残った時は、TPM 担当が席を閉じてから起こし直す', async () => {
    const w = await started();
    await expect(askReview(w.se, { url: w.plan, wait: 4 })).rejects.toThrow(/名乗りません/);
    // 居場所が残っている間は、頼みはもう依頼書にしてあるので、起こし直しは止まる
    await expect(assign(w.tpm, 'AI-8', STAFF)).rejects.toThrow(/まだ依頼書にしていないレビューの頼みがありません/);
    await close(w.tpm, 'AI-8.staff');
    expect((await assign(w.tpm, 'AI-8', STAFF))[0]).toBe('起こした: レビュー AI-8: 計画 plan-1（file:3・Opus 5.5 · high）');
    expect(readReviews(w.tpm)[0]?.brief).toMatch(/brief-2\.html$/);
  });

  test('--supersede は、じかに届いた頼みも「済んでいない依頼書」に数えて取り消し、新しい依頼書に入れ直す', async () => {
    const w = await asked();
    w.se.now = () => new Date('2026-11-20T12:10:00.000Z');
    await askReview(w.se, { url: PR });
    await assign(w.tpm, 'AI-8', { ...STAFF, supersede: true });
    expect(texts(w, 'file:2').at(-1)).toMatch(/^【brief】.+brief-3\.html.* 取り消す: brief-1（.+）・brief-2（.+）$/);
    const [one, two] = readReviews(w.tpm);
    expect(one?.brief).toMatch(/brief-3\.html$/);
    expect(two?.brief).toBe(one?.brief);
    // 頼みが 2 つの依頼書は、新しい方の頼みと +1
    expect(w.wire.look('file:2')?.title).toBe('レビュー AI-8: PR #7 +1');
    w.staff.now = () => new Date('2026-11-20T12:20:00.000Z');
    await reportReview(w.staff, { url: await w.put(w.staff, 'review'), verdict: 'concerns', summary: '2 つとも見た' });
    expect(texts(w, 'file:1').at(-1)).toMatch(/／頼み: #1 #2$/);
  });
});

describe('roster report review', () => {
  test('課題の担当へじかに【review】を送り、判定を記録に書き、次の頼みを待つ。TPM 担当には何も届かない', async () => {
    const w = await asked();
    const page = await w.put(w.staff, 'review');
    expect(page).toMatch(/\/AI-8\/review-1\.html$/);
    w.staff.now = () => new Date('2026-11-20T12:07:00.000Z');
    expect(await reportReview(w.staff, { url: page, verdict: 'concerns', summary: 'Key の形に抜けが 1 つ' })).toEqual([
      '送った: 【review】→ file:1（相手の手が空いた時に届く。送り直さない）',
      `置き場の印: 判定と見た物を書いた ${page}`,
      expect.stringMatching(/^置き場の印: レビュー済みにした http:\/\/127\.0\.0\.1:8801\/.+\/AI-8\/brief-1\.html$/) as string,
      '状態: 回答待ち(レビュー): 次の頼み',
    ]);
    expect(w.wire.inbox('file:1').at(-1)).toMatchObject({ from: 'レビュー AI-8: 計画 plan-1', text: `【review】${page} 判定: 気になる所あり（concerns）／一言: Key の形に抜けが 1 つ／頼み: #1` });
    expect(texts(w, 'file:tpm')).toEqual([]);
    expect(readReviews(w.tpm)[0]).toMatchObject({ n: 1, verdict: 'concerns', page, summary: 'Key の形に抜けが 1 つ', reviewedAt: '2026-11-20T12:07:00.000Z' });
    expect(w.wire.status('file:2')?.wait).toBe('回答待ち(レビュー): 次の頼み');
  });

  test('課題があれば、記録「レビュー」を書く', async () => {
    const w = await asked({ tracker: 'jira' }, 'AI-8');
    const out = await reportReview(w.staff, { url: await w.put(w.staff, 'review'), verdict: 'reject', summary: '依頼と違う' });
    expect(out[0]).toBe('記録を書いた: AI-8【レビュー】');
    expect(w.tpm.state.lines<{ issue: string, kind: string, by: string }>('tracker.jsonl').at(-1)).toMatchObject({ issue: 'AI-8', kind: 'レビュー', by: 'AI-8.staff' });
  });

  test('課題の担当の居場所が無ければ、送らず・記録も判定も書かずに止まる', async () => {
    const w = await asked({ tracker: 'jira' }, 'AI-8');
    w.tpm.transport.close('file:1');
    const comments = (): number => w.tpm.state.lines<{ kind?: string }>('tracker.jsonl').filter(l => l.kind === 'レビュー').length;
    await expect(reportReview(w.staff, { url: await w.put(w.staff, 'review'), verdict: 'approve', summary: 'よい' })).rejects.toThrow('AI-8 の居場所がありません。送っていません・記録も書いていません。roster ask tpm で TPM 担当に知らせてください');
    expect(comments()).toBe(0);
    expect(readReviews(w.tpm)[0]?.verdict).toBeUndefined();
  });

  test('打てるのは Staff だけ。判定は 4 つの語、ページは置き場のレビューのページ、返す頼みが要る', async () => {
    const w = await asked();
    const page = await w.put(w.staff, 'review');
    await expect(reportReview(w.se, { url: page, verdict: 'approve', summary: 'x' })).rejects.toThrow(/roster report review は Staff Engineer 担当（Staff の席）が打ちます/);
    await expect(reportReview(w.staff, { url: page, verdict: 'ok', summary: 'x' })).rejects.toThrow(/--verdict は approve・concerns・reject・not-assessed のどれかにしてください/);
    await expect(reportReview(w.staff, { url: w.plan, verdict: 'approve', summary: 'x' })).rejects.toThrow(/--url は、roster page put --kind review で置いたレビューのページの URL にしてください/);
    const other = page.replace('/AI-8/', '/AI-9/');
    await expect(reportReview(w.staff, { url: other, verdict: 'approve', summary: 'x' })).rejects.toThrow(/AI-8 のレビューのページにしてください/);
    await reportReview(w.staff, { url: page, verdict: 'not-assessed', summary: 'PR が読めない' });
    w.staff.now = () => new Date('2026-11-20T12:30:00.000Z');
    await expect(reportReview(w.staff, { url: page, verdict: 'approve', summary: '2 度目' })).rejects.toThrow(/AI-8 に、返していないレビューの頼みがありません/);
  });
});

describe('じかの 2 通の、届いた時刻の写し', () => {
  test('roster ask review と roster report review の後に、deliveries.jsonl にじかの 2 通が載る', async () => {
    const w = await asked();
    await reportReview(w.staff, { url: await w.put(w.staff, 'review'), verdict: 'approve', summary: 'よい' });
    w.wire.hold('file:2');
    w.se.now = () => new Date('2026-11-20T12:10:00.000Z');
    expect((await askReview(w.se, { url: PR }))[0]).toMatch(/相手の手が空いた時に届く/);
    const asking = w.wire.inbox('file:2').at(-1)?.id ?? '';
    w.wire.release('file:2', '2026-11-20T12:12:00.000Z');
    w.wire.hold('file:1');
    w.staff.now = () => new Date('2026-11-20T12:20:00.000Z');
    await reportReview(w.staff, { url: await w.put(w.staff, 'review'), verdict: 'approve', summary: 'よい' });
    const traces = (): MessageTrace[] => w.tpm.state.lines<MessageTrace>('deliveries.jsonl');
    expect(traces().find(t => t.id === asking)).toMatchObject({ deliveredAt: '2026-11-20T12:12:00.000Z' });
    const judged = w.wire.inbox('file:1').at(-1)?.id ?? '';
    w.wire.release('file:1', '2026-11-20T12:21:00.000Z');
    w.se.now = () => new Date('2026-11-20T12:30:00.000Z');
    await askReview(w.se, { url: await w.put(w.se, 'plan') });
    expect(traces().find(t => t.id === judged)).toMatchObject({ deliveredAt: '2026-11-20T12:21:00.000Z' });
  });
});

describe('時系列の行き違いの印（じかの 2 通）', () => {
  test('課題の担当と Staff の席の間の、逆向きのじかの物だけを相手に数える', async () => {
    const w = await asked();
    const at = (ctx: Context, hhmmss: string): void => {
      ctx.now = () => new Date(`2026-11-20T${hhmmss}.000Z`);
    };
    const id = (address: string): string => w.wire.inbox(address).at(-1)?.id ?? '';
    const arrive = (message: string, hhmmss: string): void => w.tpm.state.append('deliveries.jsonl', { id: message, deliveredAt: `2026-11-20T${hhmmss}.000Z` } satisfies MessageTrace);
    // 12:10 課題の担当が PR のレビューを頼む（席に届くのは 12:15）。その前に、12:11 課題の担当が TPM 担当へ問い、12:12 席が前の頼みの判定を返し、12:13 TPM 担当が答える（届くのは 12:20）。
    at(w.se, '12:10:00');
    await askReview(w.se, { url: PR });
    const asking = id('file:2');
    at(w.se, '12:11:00');
    await askTpm(w.se, { text: '案で迷う', waitingFor: '案' });
    at(w.staff, '12:12:00');
    await reportReview(w.staff, { url: await w.put(w.staff, 'review'), verdict: 'approve', summary: 'よい' });
    const judged = id('file:1');
    at(w.tpm, '12:13:00');
    notify(w.tpm, 'AI-8', { text: 'A で進める' });
    const answered = id('file:1');
    arrive(asking, '12:15:00');
    arrive(judged, '12:12:01');
    arrive(answered, '12:20:00');
    const crossings = Object.fromEntries(collect(w.tpm, 'AI-8').filter(e => e.kind === 'メッセージ').map(e => [e.what.split('（id ').at(-1)?.replace('）', '') ?? '', e.notes.filter(n => n.startsWith('行き違い'))]));
    // 頼みが届く前に席が送った判定は、行き違い。課題の担当が自分で続けて送った【ask-tpm】と、TPM 担当の【notify】は、相手の物に数えない
    expect(crossings[asking]).toEqual(['行き違い: これが届く前に、相手が 1 件送った（【review】12:12:00）']);
    expect(crossings[judged]).toEqual([]);
    // TPM 担当の【notify】の相手は課題の担当。届く前のじかの物（頼み・判定）は数えない
    at(w.se, '12:14:00');
    await askReview(w.se, { url: await w.put(w.se, 'plan') });
    expect(collect(w.tpm, 'AI-8').find(e => e.what.includes(`（id ${answered}）`))?.notes.filter(n => n.startsWith('行き違い'))).toEqual([]);
  });

  test('前の版が TPM 担当へ送った【ask-review】（じかの印の無い行）は、今までどおり「同じ Key で向きが逆」で数える', async () => {
    const w = await started();
    const line = (at: string, heading: string, from: string, to: string, id: string): void => w.tpm.state.append('log.jsonl', { at: `2026-11-20T${at}.000Z`, key: 'AI-8', heading, from, to, text: `【${heading}】x`, id, delivered: false });
    line('13:00:00', 'ask-review', SE_TITLE, 'file:tpm', 'old-ask');
    line('13:01:00', 'notify', 'Technical Program Manager', 'file:1', 'old-notify');
    w.tpm.state.append('deliveries.jsonl', { id: 'old-ask', deliveredAt: '2026-11-20T13:02:00.000Z' } satisfies MessageTrace);
    expect(collect(w.tpm, 'AI-8').find(e => e.what.includes('（id old-ask）'))?.notes.filter(n => n.startsWith('行き違い'))).toEqual(['行き違い: これが届く前に、相手が 1 件送った（【notify】13:01:00）']);
  });
});

describe('roster ask tpm --review（判定を受けずに上げる）', () => {
  test('本文にレビューのページの URL が入り、頼みの記録に上げた時刻が残る', async () => {
    const w = await asked();
    const page = await w.put(w.staff, 'review');
    w.staff.now = () => new Date('2026-11-20T12:07:00.000Z');
    await reportReview(w.staff, { url: page, verdict: 'reject', summary: '依頼と違う' });
    w.se.now = () => new Date('2026-11-20T12:15:00.000Z');
    expect(await askTpm(w.se, { text: '指摘 1 は依頼書の範囲の外。お勧め: 直さない', waitingFor: 'レビューの食い違い', review: 1 })).toEqual([
      '送った: 【ask-tpm】→ file:tpm（相手の手が空いた時に届く。送り直さない）',
      `置き場の印: 上げた（TPM 担当の返事待ち）にした ${page}`,
      '状態: 回答待ち(TPM): レビューの食い違い',
    ]);
    expect(texts(w, 'file:tpm')).toEqual([`【ask-tpm】レビュー #1（判定: 直すべき。${page}）を受けない: 指摘 1 は依頼書の範囲の外。お勧め: 直さない`]);
    expect(readReviews(w.tpm)[0]).toMatchObject({ n: 1, verdict: 'reject', escalatedAt: '2026-11-20T12:15:00.000Z' });
    // 2 度目に上げても、最初に上げた時刻を残す
    w.se.now = () => new Date('2026-11-20T12:40:00.000Z');
    await askTpm(w.se, { text: '訳を足す', waitingFor: 'レビューの食い違い', review: 1 });
    expect(readReviews(w.tpm)[0]?.escalatedAt).toBe('2026-11-20T12:15:00.000Z');
    expect(reviewList(w.tpm, { key: 'AI-8' })).toEqual([
      `#1  AI-8  直すべき・TPM 担当に上げた  ${w.plan}  11-20 12:00 に頼んだ・7 分で返った  ${page}`,
      '頼み 1 件: よい 0・気になる所あり 0・直すべき 1・見られなかった 0・まだ 0・TPM 担当に上げた 1',
    ]);
  });

  test('自分の課題の、「直すべき」が返った頼みの番号だけを受ける', async () => {
    const w = await asked();
    await expect(askTpm(w.se, { text: 'x', waitingFor: 'a', review: 1 })).rejects.toThrow(/レビュー #1 は、まだ判定が返っていません。送っていません/);
    await expect(askTpm(w.se, { text: 'x', waitingFor: 'a', review: 9 })).rejects.toThrow(/--review は、自分の課題（AI-8）のレビューの頼みの番号にしてください/);
    w.tpm.state.write('reviews/2.jsonc', { n: 2, key: 't-a3b4', url: PR, by: 'SWE t-a3b4', askedAt: '2026-11-20T11:59:00.000Z', verdict: 'reject', page: 'http://127.0.0.1:8801/p/t-a3b4/review-1.html' });
    await expect(askTpm(w.se, { text: 'x', waitingFor: 'a', review: 2 })).rejects.toThrow(/--review は、自分の課題（AI-8）のレビューの頼みの番号にしてください/);
    await reportReview(w.staff, { url: await w.put(w.staff, 'review'), verdict: 'concerns', summary: '気になる' });
    await expect(askTpm(w.se, { text: 'x', waitingFor: 'a', review: 1 })).rejects.toThrow(/レビュー #1 の判定は「気になる所あり」です。--review で上げるのは「直すべき」を受けない時だけです/);
    expect(texts(w, 'file:tpm')).toEqual([]);
  });
});

describe('roster review list', () => {
  test('頼みごとの行と、合わせた数を出す', async () => {
    const w = await asked();
    w.staff.now = () => new Date('2026-11-20T12:07:00.000Z');
    const page = await w.put(w.staff, 'review');
    await reportReview(w.staff, { url: page, verdict: 'concerns', summary: 'Key の形に抜けが 1 つ' });
    w.se.now = () => new Date('2026-11-20T12:10:00.000Z');
    await askReview(w.se, { url: PR });
    expect(reviewList(w.tpm, {})).toEqual([
      `#1  AI-8  気になる所あり  ${w.plan}  11-20 12:00 に頼んだ・7 分で返った  ${page}`,
      `#2  AI-8  まだ（席が見ている）  ${PR}  11-20 12:10 に頼んだ`,
      '頼み 2 件: よい 0・気になる所あり 1・直すべき 0・見られなかった 0・まだ 1・TPM 担当に上げた 0',
      '結果の【done】を出した課題 0 件のうち、レビューを頼んでいない課題: 0 件',
    ]);
    expect(reviewList(w.tpm, { key: 'AI-9' })).toEqual(['AI-9 のレビューの頼みは無い']);
  });

  test('レビューを頼まずに結果の【done】を出した課題を数える', async () => {
    const w = await asked();
    await assign(w.tpm, 't-x7k2', { role: 'software-engineer', title: '小さい直し', brief: BRIEF, wait: 0 });
    const other = { ...w.role('t-x7k2', 'file:3'), env: { ...w.role('t-x7k2', 'file:3').env, ROSTER_ROLE: 'software-engineer' } };
    await hello(other);
    reportDone(other, { url: await w.put(other, 'result'), kind: 'result', summary: '直した', remaining: 'なし', decisions: 'なし', points: [] });
    reportDone(w.se, { url: await w.put(w.se, 'result'), kind: 'result', summary: '入れた', remaining: 'なし', decisions: 'なし', points: [] });
    expect(reviewList(w.tpm, {}).at(-1)).toBe('結果の【done】を出した課題 2 件のうち、レビューを頼んでいない課題: 1 件（t-x7k2）');
    // 初めての頼みより前に出た【done】は数えない（レビューの仕組みが入る前の課題）
    w.tpm.state.append('log.jsonl', { at: '2026-11-19T10:00:00.000Z', key: 't-old1', heading: 'done', from: 'SWE t-old1', to: 'file:tpm', text: '【done】http://127.0.0.1:8801/p/t-old1/result-1.html 要点: 前の課題', id: 'old', delivered: true });
    expect(reviewList(w.tpm, {}).at(-1)).toBe('結果の【done】を出した課題 2 件のうち、レビューを頼んでいない課題: 1 件（t-x7k2）');
  });
});

describe('Staff の席の題と説明（reviewLabel）', () => {
  const ask = (n: number, url: string, focus?: string): Review => ({ n, key: 'AI-8', url, by: 'SWE AI-8: 題', askedAt: '2026-11-20T12:00:00.000Z', ...(focus === undefined ? {} : { focus }) });
  const page = (name: string): string => `http://127.0.0.1:8801/p/AI-8/${name}.html`;

  test('PR は PR #<番号>、置き場のページは種類の名と file の名', () => {
    expect(reviewLabel([ask(1, 'https://github.com/o/r/pull/180')])).toEqual({ target: 'PR #180' });
    expect(reviewLabel([ask(1, page('plan-2'))])).toEqual({ target: '計画 plan-2' });
    expect(reviewLabel([ask(1, page('proposal-1'))])).toEqual({ target: '提案 proposal-1' });
    expect(reviewLabel([ask(1, page('result-3'))])).toEqual({ target: '結果 result-3' });
    expect(reviewLabel([ask(1, page('confirm-1'))])).toEqual({ target: 'confirm-1' });
    // 節の印・問い・末尾の / は除く。読めない URL は元の字のまま
    expect(reviewLabel([ask(1, `${page('plan-2')}#risks`)])).toEqual({ target: '計画 plan-2' });
    expect(reviewLabel([ask(1, `${page('plan-2')}?v=1`)])).toEqual({ target: '計画 plan-2' });
    expect(reviewLabel([ask(1, 'http://127.0.0.1:8801/p/AI-8/')])).toEqual({ target: 'AI-8' });
    expect(reviewLabel([ask(1, 'not a url')])).toEqual({ target: 'not a url' });
  });

  test('頼みが 2 つ以上なら、番号の新しい頼みと +<残りの数>。説明も新しい頼みの見てほしい所', () => {
    expect(reviewLabel([ask(3, page('plan-1'), '古い'), ask(5, 'https://github.com/o/r/pull/9', '新しい'), ask(4, page('plan-2'))])).toEqual({ target: 'PR #9 +2', description: '新しい' });
  });

  test('長い見てほしい所は 24 字で切って「…」を付ける', () => {
    const long = 'あ'.repeat(30);
    expect(reviewLabel([ask(1, page('plan-1'), long)]).description).toBe(`${'あ'.repeat(24)}…`);
    expect(reviewLabel([ask(1, page('plan-1'), 'い'.repeat(24))]).description).toBe('い'.repeat(24));
  });
});

describe('置き場のレビューの印', () => {
  /** 置き場の中の、AI-8 のページの記録。 */
  const record = (w: World, page: string): PageRecord | undefined => w.store.pages.get(`/${basename(w.tpm.state.dir)}/AI-8/${page}.html`)?.record;
  /** 置き場の中の path（見た物に書く形）。 */
  const path = (w: World, url: string): string => url.replace('http://127.0.0.1:8801', '');

  test('頼むと、依頼書に見る物を書いてレビュー待ちにする。Product Manager の返事待ちには入らない', async () => {
    const w = await asked();
    expect(record(w, 'brief-1')).toMatchObject({ waits_on: 'review', targets: [path(w, w.plan)] });
    expect(record(w, 'brief-1')?.asked_at).toBeDefined();
    expect(await pageList(w.tpm, { key: 'AI-8', reply: 'waiting' })).toEqual(['合うページは無い']);
    expect((await pageList(w.tpm, { key: 'AI-8', reply: 'waiting', on: 'review' }))[0]).toMatch(/brief-1\.html/);
  });

  test('判定を返すと、レビューのページに判定と見た物を書き、依頼書をレビュー済みにする', async () => {
    const w = await asked();
    const page = await w.put(w.staff, 'review');
    await reportReview(w.staff, { url: page, verdict: 'concerns', summary: '1 つ' });
    expect(record(w, 'review-1')).toMatchObject({ verdict: 'concerns', targets: [path(w, w.plan)] });
    expect(record(w, 'brief-1')).toMatchObject({ waits_on: 'review' });
    expect(record(w, 'brief-1')?.answered_at).toBeDefined();
  });

  test('頼みが 2 つの依頼書は、見た物を 2 つ書く。起こし直しでは、新しい依頼書を待ちにし、前の依頼書の待ちを外す', async () => {
    const w = await asked();
    w.tpm.transport.close('file:2');
    w.se.now = () => new Date('2026-11-20T12:10:00.000Z');
    const out = await askReview(w.se, { url: PR, wait: 0 });
    expect(out).toContainEqual(expect.stringMatching(/^置き場の印: 置き換えたので、前の依頼書のレビュー待ちを外した .+\/brief-1\.html$/));
    expect(record(w, 'brief-2')).toMatchObject({ waits_on: 'review', targets: [path(w, w.plan), PR] });
    expect(record(w, 'brief-1')?.answered_at).toBeDefined();
    // 判定は、2 つの見た物をみな書く
    await hello(w.staffAt('file:3'));
    await reportReview(w.staffAt('file:3'), { url: await w.put(w.staffAt('file:3'), 'review'), verdict: 'approve', summary: 'よい' });
    expect(record(w, 'review-1')).toMatchObject({ verdict: 'approve', targets: [path(w, w.plan), PR] });
    expect(record(w, 'brief-2')?.answered_at).toBeDefined();
  });

  test('TPM 担当の起こし直し（roster assign --role staff-engineer）でも、新しい依頼書を待ちにし、前の依頼書の待ちを外す', async () => {
    const w = await asked();
    w.tpm.transport.close('file:2');
    const out = await assign(w.tpm, 'AI-8', STAFF);
    expect(out).toContainEqual(expect.stringMatching(/^置き場の印: レビュー待ちにした .+\/brief-2\.html$/));
    expect(record(w, 'brief-2')).toMatchObject({ waits_on: 'review', targets: [path(w, w.plan)] });
    expect(record(w, 'brief-1')?.answered_at).toBeDefined();
  });

  test('上げると、レビューのページを TPM 担当の待ち（上げた）にする。TPM 担当が --on tpm で外す', async () => {
    const w = await asked();
    const page = await w.put(w.staff, 'review');
    await reportReview(w.staff, { url: page, verdict: 'reject', summary: '依頼と違う' });
    await askTpm(w.se, { text: '受けない', waitingFor: 'レビューの食い違い', review: 1 });
    expect(record(w, 'review-1')).toMatchObject({ waits_on: 'tpm', verdict: 'reject' });
    expect((await pageList(w.tpm, { key: 'AI-8', reply: 'waiting', on: 'tpm' }))[0]).toMatch(/review-1\.html/);
    // 相手を違えて外そうとすると止まり、何も替えない
    await expect(pageReply(w.tpm, [page], { answered: true })).rejects.toThrow(/--on pm の相手の返事を待っていません/);
    expect(await pageReply(w.tpm, [page], { answered: true, on: 'tpm' })).toEqual([`決まったにした: ${page}`]);
    expect(record(w, 'review-1')?.answered_at).toBeDefined();
  });

  test('【dismiss】は、残ったレビュー待ち・上げた件も、待ちの相手ごとに並べる', async () => {
    const w = await asked();
    const out = await dismiss(w.tpm, 'AI-8', { handover: false, supersede: true });
    expect(out).toContain('置き場に、AI-8 のレビュー待ちの依頼書が 1 枚残っています:');
    expect(out).toContain('もう答えが要らなければ、roster page reply <URL>… --answered --on review で印を外す');
    expect(out.join('\n')).not.toMatch(/の返事待ちのページが/);
  });

  test('置き場が応えない時の直す手には、待ちの相手が付く', async () => {
    const w = await asked();
    const page = await w.put(w.staff, 'review');
    await reportReview(w.staff, { url: page, verdict: 'reject', summary: '依頼と違う' });
    w.store.down = true;
    const out = await askTpm(w.se, { text: '受けない', waitingFor: 'レビューの食い違い', review: 1 });
    expect(out).toContain(`置き場の印: 付けていない（置き場が応えない。メッセージは送った。後で TPM 担当が roster page reply ${page} --waiting --on tpm で直せる）`);
  });
});

describe('置き場の印を付けられない時（review-3 の指摘）', () => {
  /** 置き場の中の、AI-8 のページの記録。 */
  const record = (w: World, page: string): PageRecord | undefined => w.store.pages.get(`/${basename(w.tpm.state.dir)}/AI-8/${page}.html`)?.record;

  test('席を起こす前に止まった回は、依頼書をレビュー待ちにしない（頼みも消えるので、待ちが残り続けないように）', async () => {
    const w = await started();
    w.se.transport.spawn = () => {
      throw new Error('居場所を作れない');
    };
    await expect(askReview(w.se, { url: w.plan, wait: 0 })).rejects.toThrow('居場所を作れない');
    expect(record(w, 'brief-1')?.asked_at).toBeUndefined();
  });

  test('席が名乗らなかった回は、頼みが残るので依頼書をレビュー待ちにする', async () => {
    const w = await started();
    await expect(askReview(w.se, { url: w.plan, wait: 4 })).rejects.toThrow(/名乗りません/);
    expect(record(w, 'brief-1')).toMatchObject({ waits_on: 'review' });
  });

  test('送った後に置き場が誤りを返しても、命令は止めずに 1 行で知らせる（状態も書く）', async () => {
    const w = await asked();
    const page = await w.put(w.staff, 'review');
    w.store.markError = 500;
    const out = await reportReview(w.staff, { url: page, verdict: 'reject', summary: '依頼と違う' });
    expect(out[0]).toMatch(/^送った: 【review】/);
    expect(out).toContainEqual(expect.stringMatching(/^置き場の印: 判定と見た物を書いていない（置き場が断った: 500 置き場の中の誤り）$/));
    expect(out.at(-1)).toBe('状態: 回答待ち(レビュー): 次の頼み');
    expect(w.wire.status('file:2')?.wait).toBe('回答待ち(レビュー): 次の頼み');
    const escalated = await askTpm(w.se, { text: '受けない', waitingFor: 'レビューの食い違い', review: 1 });
    expect(escalated).toContainEqual(expect.stringMatching(/^置き場の印: 付けていない（置き場が誤りを返した: .+。メッセージは送った）$/));
    expect(escalated.at(-1)).toBe('状態: 回答待ち(TPM): レビューの食い違い');
  });

  test('置き場が応えない時、判定を返すと、外せなかった依頼書ごとに直す手を出す（判定と見た物は手で書けないと別に書く）', async () => {
    const w = await asked();
    const page = await w.put(w.staff, 'review');
    const brief = requireRole(w.tpm, 'AI-8.staff').brief ?? '';
    w.store.down = true;
    const out = await reportReview(w.staff, { url: page, verdict: 'approve', summary: 'よい' });
    expect(out).toContain('置き場の印: 付けていない（置き場が応えない。メッセージは送った。判定と見た物は手では書けない。roster review list と、レビューのページ・依頼書で見る）');
    expect(out).toContain(`  後で TPM 担当が直せる: roster page reply ${brief} --answered --on review`);
  });

  test('置き場が応えない時、依頼書の印は書かずに、直す手を（置き換えた前の依頼書の分も）みな並べる', async () => {
    const w = await asked();
    const brief = requireRole(w.tpm, 'AI-8.staff').brief ?? '';
    const old = brief.replace('/brief-1.html', '/brief-9.html');
    w.store.down = true;
    const before = w.store.requests.length;
    expect(await markBrief(w.se, brief, readReviews(w.tpm), [old])).toEqual([
      '置き場の印: 付けていない（置き場が応えない。メッセージは送った。判定と見た物は手では書けない。roster review list と、レビューのページ・依頼書で見る）',
      `  後で TPM 担当が直せる: roster page reply ${brief} --waiting --on review`,
      `  後で TPM 担当が直せる: roster page reply ${old} --answered --on review`,
    ]);
    // 応えないとわかったら、ほかの印は送らない。
    expect(w.store.requests).toHaveLength(before + 1);
  });

  test('ほかの相手を待っているページを --waiting で移そうとすると、待ちを移さないと止まる', async () => {
    const w = await asked();
    const brief = requireRole(w.tpm, 'AI-8.staff').brief ?? '';
    await expect(pageReply(w.tpm, [brief], { waiting: true })).rejects.toThrow(/今ほかの相手の返事を待っています（置き場は待ちを移さない。何も替えていない）/);
    expect(record(w, 'brief-1')).toMatchObject({ waits_on: 'review' });
  });
});
