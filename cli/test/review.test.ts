// レビューの 1 周: 課題の担当が頼む（tpm ask review）→ TPM 担当が Staff の席を起こす（依頼書は頼みから作る）→ Staff が返す（tpm report review）→ 数える（tpm review list）。
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { askReview, notify, reportDone, reportReview } from '../src/commands/messages.ts';
import { pagePath, pagePut } from '../src/commands/page.ts';
import { reviewList } from '../src/commands/review.ts';
import { hello } from '../src/commands/role-side.ts';
import { assign } from '../src/commands/tpm-side.ts';
import type { Context } from '../src/context.ts';
import { readReviews, reviewLabel, type Review } from '../src/reviews.ts';
import { requireRole } from '../src/roster.ts';
import { BRIEF, staffRoot, world, type World } from './helpers.ts';

const TPM = { model: 'claude-opus-5-5', effort: 'medium' };
const STAFF = { role: 'staff-engineer', wait: 0 } as const;
const PR = 'https://github.com/o/r/pull/7';

interface Seats extends World { se: Context, plan: string, staffAt: (address: string) => Context, put: (ctx: Context, kind: string) => string }

/** TPM 担当と AI-8 の Software Engineer 担当（file:1）が名乗った世界。plan は、担当が置いた計画のページ。 */
function started(config: Record<string, unknown> = {}, issue?: string): Seats {
  const w = world(config);
  const tpm = { ...w.tpm, root: staffRoot() };
  hello(tpm, TPM);
  assign(tpm, 'AI-8', { role: 'software-engineer', title: '計画と実装', brief: BRIEF, wait: 0, ...(issue === undefined ? {} : { issue }) });
  const se = { ...w.role('AI-8', 'file:1'), env: { ...w.role('AI-8', 'file:1').env, TPM_ROLE: 'software-engineer' } };
  hello(se);
  const html = join(realpathSync(mkdtempSync(join(tmpdir(), 'tpm-review-'))), 'p.html');
  writeFileSync(html, '<title>試し</title>');
  const put = (ctx: Context, kind: string): string => pagePut(ctx, html, { kind }).find(l => l.startsWith('URL: '))?.slice(5) ?? '';
  const staffAt = (address: string): Context => {
    const base = w.role('AI-8.staff', address);
    return { ...base, env: { ...base.env, TPM_ROLE: 'staff-engineer' } };
  };
  return { ...w, tpm, se, plan: put(se, 'plan'), staffAt, put };
}

/** started に、頼み 1 つと、それで起きて名乗った Staff の席（file:2）を足した世界。 */
function asked(config: Record<string, unknown> = {}, issue?: string): Seats & { staff: Context } {
  const w = started(config, issue);
  askReview(w.se, { url: w.plan, focus: '名簿の Key の決め方' });
  w.wire.inbox('file:tpm');
  assign(w.tpm, 'AI-8', STAFF);
  const staff = w.staffAt('file:2');
  hello(staff);
  return { ...w, staff };
}

const texts = (w: World, address: string): string[] => w.wire.inbox(address).map(m => m.text);

describe('tpm ask review', () => {
  test('TPM 担当に【ask-review】を送り、頼みを記録に書き、状態を回答待ちにする', () => {
    const w = started();
    expect(askReview(w.se, { url: w.plan, focus: '名簿の Key の決め方' })).toEqual(['送った: 【ask-review】→ file:tpm（届いた）', '状態: 回答待ち(TPM): レビュー']);
    expect(texts(w, 'file:tpm')).toEqual([`【ask-review】#1 ${w.plan} 見てほしい所: 名簿の Key の決め方`]);
    expect(readReviews(w.tpm)).toEqual([{ n: 1, key: 'AI-8', url: w.plan, focus: '名簿の Key の決め方', by: 'SWE AI-8: 計画と実装', askedAt: '2026-11-20T12:00:00.000Z' }]);
    // PR の URL も頼める。見てほしい所は書かなくてよい
    w.se.now = () => new Date('2026-11-20T12:01:00.000Z');
    askReview(w.se, { url: PR });
    expect(texts(w, 'file:tpm').at(-1)).toBe(`【ask-review】#2 ${PR}`);
  });

  test('見る物は、置き場のページか PR の URL。Staff と Auditor からは頼めない', () => {
    const w = asked();
    expect(() => askReview(w.se, { url: 'cli/src/guard.ts' })).toThrow(/--url は、置き場のページか PR の URL にしてください/);
    expect(() => askReview(w.staff, { url: w.plan })).toThrow(/Staff Engineer 担当は tpm ask review を打ちません/);
    const auditor = { ...w.se, env: { ...w.se.env, TPM_KEY: 'audit', TPM_ROLE: 'auditor' } };
    w.tpm.state.write('roles/audit.jsonc', { ...requireRole(w.tpm, 'AI-8'), key: 'audit', role: 'auditor', title: 'Audit' });
    expect(() => askReview(auditor, { url: w.plan })).toThrow(/Auditor は tpm ask review を打ちません/);
  });
});

describe('tpm assign --role staff-engineer（頼みから起こす）', () => {
  test('頼みから依頼書のページを作って置き、それで席を起こす', () => {
    const w = started({ tracker: 'jira' }, 'AI-8');
    askReview(w.se, { url: w.plan, focus: '名簿の Key の決め方' });
    w.wire.inbox('file:tpm');
    expect(assign(w.tpm, 'AI-8', STAFF)[0]).toBe('起こした: レビュー AI-8: 計画 plan-1（file:2・Opus 5.5 · high）');
    // 説明は見てほしい所、帯は紫
    expect(w.wire.look('file:2')).toEqual({ title: 'レビュー AI-8: 計画 plan-1', description: '名簿の Key の決め方', color: 'Purple' });
    const brief = requireRole(w.tpm, 'AI-8.staff').brief ?? '';
    expect(brief).toMatch(new RegExp(`/${basename(w.tpm.state.dir)}/AI-8/brief-1\\.html$`));
    const html = readFileSync(pagePath(w.tpm, brief)[0] ?? '', 'utf8');
    expect(html).toContain('<section id="summary">');
    for (const part of ['頼み #1', w.plan, '名簿の Key の決め方', 'SWE AI-8: 計画と実装', BRIEF]) expect(html, part).toContain(part);
    expect(readReviews(w.tpm)[0]).toMatchObject({ n: 1, brief });
  });

  test('頼みが無ければ止まる。同じ頼みを 2 度は依頼書にしない。--brief は書けない', () => {
    const w = started();
    expect(() => assign(w.tpm, 'AI-8', STAFF)).toThrow(/AI-8 に、まだ依頼書にしていないレビューの頼みがありません。頼むのは課題の担当（tpm ask review）/);
    expect(() => assign(w.tpm, 'AI-8', { ...STAFF, brief: BRIEF })).toThrow(/Staff Engineer 担当への依頼書は、レビューの頼み（tpm ask review）から命令が作ります。--brief は書かない/);
    askReview(w.se, { url: w.plan });
    w.wire.inbox('file:tpm');
    assign(w.tpm, 'AI-8', STAFF);
    hello(w.staffAt('file:2'));
    expect(() => assign(w.tpm, 'AI-8', STAFF)).toThrow(/まだ依頼書にしていないレビューの頼みがありません/);
    expect(w.wire.seats().map(s => s.address)).toEqual(['file:1', 'file:2']);
  });

  test('席が居れば、次の頼みは【brief】で同じ席に行く。前のレビューが返る前なら「済んでいない」で止まる', () => {
    const w = asked();
    w.se.now = () => new Date('2026-11-20T12:10:00.000Z');
    askReview(w.se, { url: PR });
    w.wire.inbox('file:tpm');
    expect(() => assign(w.tpm, 'AI-8', STAFF)).toThrow(/AI-8\.staff の担当に、まだ済んでいない物があります/);
    // 止まった回は、頼みを依頼書にした事にしない
    expect(readReviews(w.tpm)[1]?.brief).toBeUndefined();
    w.staff.now = () => new Date('2026-11-20T12:20:00.000Z');
    reportReview(w.staff, { url: w.put(w.staff, 'review'), verdict: 'approve', summary: 'このままでよい' });
    w.wire.inbox('file:tpm');
    expect(assign(w.tpm, 'AI-8', STAFF)).toEqual(['送った: 【brief】→ file:2（届いた）']);
    expect(texts(w, 'file:2').at(-1)).toMatch(/^【brief】http:\/\/127\.0\.0\.1:8801\/.+\/AI-8\/brief-2\.html 課題の写し: /);
    // 題と説明は、新しい依頼書の頼みに替わる（見てほしい所の無い頼みなので、前の説明は消える）。名簿の題も同じ字にする（通知のバナーが題で席を探す）
    expect(w.wire.look('file:2')).toEqual({ title: 'レビュー AI-8: PR #7', color: 'Purple' });
    expect(requireRole(w.tpm, 'AI-8.staff').title).toBe('レビュー AI-8: PR #7');
    // Staff の次のメッセージは、新しい題で届く
    w.staff.now = () => new Date('2026-11-20T12:30:00.000Z');
    reportReview(w.staff, { url: w.put(w.staff, 'review'), verdict: 'approve', summary: 'よい' });
    expect(w.wire.inbox('file:tpm').at(-1)?.from).toBe('レビュー AI-8: PR #7');
    expect(readReviews(w.tpm)[1]).toMatchObject({ n: 2, url: PR, brief: expect.stringMatching(/brief-2\.html$/) as string });
  });
});

describe('頼みと依頼書を取り違えない', () => {
  /** 頼み #1 を Staff が見ている間に、課題の担当が PR のレビュー（#2）を頼んだ世界。 */
  function second(): ReturnType<typeof asked> {
    const w = asked();
    w.se.now = () => new Date('2026-11-20T12:10:00.000Z');
    askReview(w.se, { url: PR });
    w.wire.inbox('file:tpm');
    return w;
  }

  test('--after で渡した 2 つ目の頼みは、1 つ目のレビューでは閉じない。2 つ目も返せる', () => {
    const w = second();
    assign(w.tpm, 'AI-8', { ...STAFF, after: true });
    w.staff.now = () => new Date('2026-11-20T12:20:00.000Z');
    const first = w.put(w.staff, 'review');
    reportReview(w.staff, { url: first, verdict: 'reject', summary: '依頼と違う' });
    expect(texts(w, 'file:tpm').at(-1)).toMatch(/／頼み: #1$/);
    expect(readReviews(w.tpm).map(r => [r.n, r.verdict])).toEqual([[1, 'reject'], [2, undefined]]);
    w.staff.now = () => new Date('2026-11-20T12:30:00.000Z');
    reportReview(w.staff, { url: w.put(w.staff, 'review'), verdict: 'approve', summary: 'よい' });
    expect(texts(w, 'file:tpm').at(-1)).toMatch(/／頼み: #2$/);
    expect(readReviews(w.tpm).map(r => [r.n, r.verdict, r.page === first])).toEqual([[1, 'reject', true], [2, 'approve', false]]);
    // 済んでいない依頼書は残らない（次の頼みを、旗なしで渡せる）
    w.se.now = () => new Date('2026-11-20T12:40:00.000Z');
    askReview(w.se, { url: w.put(w.se, 'plan') });
    w.wire.inbox('file:tpm');
    expect(assign(w.tpm, 'AI-8', STAFF)).toEqual(['送った: 【brief】→ file:2（届いた）']);
  });

  test('--supersede で取り消した依頼書の頼みは、新しい依頼書に入れ直す', () => {
    const w = second();
    assign(w.tpm, 'AI-8', { ...STAFF, supersede: true });
    const [one, two] = readReviews(w.tpm);
    expect(one?.brief).toMatch(/brief-2\.html$/);
    expect(two?.brief).toBe(one?.brief);
    // 頼みが 2 つの依頼書は、新しい方の頼みと +1
    expect(w.wire.look('file:2')?.title).toBe('レビュー AI-8: PR #7 +1');
    w.staff.now = () => new Date('2026-11-20T12:20:00.000Z');
    reportReview(w.staff, { url: w.put(w.staff, 'review'), verdict: 'concerns', summary: '2 つとも見た' });
    expect(texts(w, 'file:tpm').at(-1)).toMatch(/／頼み: #1 #2$/);
  });

  test('【ask-review】を送れなかった回は、頼みを書かない（打ち直せる）', () => {
    const w = started();
    w.tpm.state.remove('tpm.jsonc');
    expect(() => askReview(w.se, { url: w.plan })).toThrow(/TPM 担当の宛先がありません/);
    expect(readReviews(w.tpm)).toEqual([]);
    hello(w.tpm, TPM);
    expect(askReview(w.se, { url: w.plan })[0]).toBe('送った: 【ask-review】→ file:tpm（届いた）');
    expect(readReviews(w.tpm).map(r => r.n)).toEqual([1]);
  });

  test('居る席への【brief】を送れなかった回は、頼みを依頼書にした事にしない（打ち直せる）', () => {
    const w = asked();
    reportReview(w.staff, { url: w.put(w.staff, 'review'), verdict: 'approve', summary: 'よい' });
    w.se.now = () => new Date('2026-11-20T12:10:00.000Z');
    askReview(w.se, { url: PR });
    w.wire.inbox('file:tpm');
    const send = w.tpm.transport.send.bind(w.tpm.transport);
    w.tpm.transport.send = () => {
      throw new Error('送れない');
    };
    expect(() => assign(w.tpm, 'AI-8', STAFF)).toThrow('送れない');
    expect(readReviews(w.tpm)[1]?.brief).toBeUndefined();
    w.tpm.transport.send = send;
    expect(assign(w.tpm, 'AI-8', STAFF)).toEqual(['送った: 【brief】→ file:2（届いた）']);
  });

  test('頼みの番号は、同じ番号の file を「在れば失敗」で作って決める（同時に頼んでも重ならない）', () => {
    const w = started();
    // 別の担当が、番号を読んだ後・書く前に #1 を取った形
    w.tpm.state.write('reviews/1.jsonc', { n: 1, key: 't-a3b4', url: PR, by: 'SWE t-a3b4', askedAt: '2026-11-20T11:59:00.000Z' });
    askReview(w.se, { url: w.plan });
    expect(readReviews(w.tpm).map(r => [r.n, r.key])).toEqual([[1, 't-a3b4'], [2, 'AI-8']]);
  });

  test('別の課題のレビューのページでは返せない', () => {
    const w = asked();
    const other = w.put(w.staff, 'review').replace('/AI-8/', '/AI-9/');
    expect(() => reportReview(w.staff, { url: other, verdict: 'approve', summary: 'x' })).toThrow(/AI-8 のレビューのページにしてください/);
  });
});

describe('tpm report review', () => {
  test('TPM 担当に【review】を送り、判定を記録に書き、次のレビューを待つ', () => {
    const w = asked();
    const page = w.put(w.staff, 'review');
    expect(page).toMatch(/\/AI-8\/review-1\.html$/);
    w.staff.now = () => new Date('2026-11-20T12:07:00.000Z');
    expect(reportReview(w.staff, { url: page, verdict: 'concerns', summary: 'Key の形に抜けが 1 つ' })).toEqual(['送った: 【review】→ file:tpm（届いた）', '状態: 回答待ち(TPM): 次のレビュー']);
    expect(texts(w, 'file:tpm').at(-1)).toBe(`【review】${page} 判定: 気になる所あり（concerns）／一言: Key の形に抜けが 1 つ／頼み: #1`);
    expect(readReviews(w.tpm)[0]).toMatchObject({ n: 1, verdict: 'concerns', page, summary: 'Key の形に抜けが 1 つ', reviewedAt: '2026-11-20T12:07:00.000Z' });
    expect(w.wire.status('file:2')?.wait).toBe('回答待ち(TPM): 次のレビュー');
    // TPM 担当は、結果を課題の担当に回す
    expect(notify(w.tpm, 'AI-8', { text: `${page} 判定: 気になる所あり` })).toEqual(['送った: 【notify】→ file:1（届いた）']);
  });

  test('課題があれば、記録「レビュー」を書く', () => {
    const w = asked({ tracker: 'jira' }, 'AI-8');
    const out = reportReview(w.staff, { url: w.put(w.staff, 'review'), verdict: 'reject', summary: '依頼と違う' });
    expect(out[0]).toBe('記録を書いた: AI-8【レビュー】');
    expect(w.tpm.state.lines<{ issue: string, kind: string, by: string }>('tracker.jsonl').at(-1)).toMatchObject({ issue: 'AI-8', kind: 'レビュー', by: 'AI-8.staff' });
  });

  test('打てるのは Staff だけ。判定は 4 つの語、ページは置き場のレビューのページ、返す頼みが要る', () => {
    const w = asked();
    const page = w.put(w.staff, 'review');
    expect(() => reportReview(w.se, { url: page, verdict: 'approve', summary: 'x' })).toThrow(/tpm report review は Staff Engineer 担当（Staff の席）が打ちます/);
    expect(() => reportReview(w.staff, { url: page, verdict: 'ok', summary: 'x' })).toThrow(/--verdict は approve・concerns・reject・not-assessed のどれかにしてください/);
    expect(() => reportReview(w.staff, { url: w.plan, verdict: 'approve', summary: 'x' })).toThrow(/--url は、tpm page put --kind review で置いたレビューのページの URL にしてください/);
    reportReview(w.staff, { url: page, verdict: 'not-assessed', summary: 'PR が読めない' });
    w.staff.now = () => new Date('2026-11-20T12:30:00.000Z');
    expect(() => reportReview(w.staff, { url: page, verdict: 'approve', summary: '2 度目' })).toThrow(/AI-8 に、返していないレビューの頼みがありません/);
  });
});

describe('tpm review list', () => {
  test('頼みごとの行と、合わせた数を出す', () => {
    const w = asked();
    w.staff.now = () => new Date('2026-11-20T12:07:00.000Z');
    const page = w.put(w.staff, 'review');
    reportReview(w.staff, { url: page, verdict: 'concerns', summary: 'Key の形に抜けが 1 つ' });
    w.se.now = () => new Date('2026-11-20T12:10:00.000Z');
    askReview(w.se, { url: PR });
    expect(reviewList(w.tpm, {})).toEqual([
      `#1  AI-8  気になる所あり  ${w.plan}  11-20 12:00 に頼んだ・7 分で返った  ${page}`,
      `#2  AI-8  まだ（席に渡していない）  ${PR}  11-20 12:10 に頼んだ`,
      '頼み 2 件: よい 0・気になる所あり 1・直すべき 0・見られなかった 0・まだ 1',
      '結果の【done】を出した課題 0 件のうち、レビューを頼んでいない課題: 0 件',
    ]);
    expect(reviewList(w.tpm, { key: 'AI-9' })).toEqual(['AI-9 のレビューの頼みは無い']);
  });

  test('レビューを頼まずに結果の【done】を出した課題を数える', () => {
    const w = asked();
    assign(w.tpm, 't-x7k2', { role: 'software-engineer', title: '小さい直し', brief: BRIEF, wait: 0 });
    const other = { ...w.role('t-x7k2', 'file:3'), env: { ...w.role('t-x7k2', 'file:3').env, TPM_ROLE: 'software-engineer' } };
    hello(other);
    reportDone(other, { url: w.put(other, 'result'), kind: 'result', summary: '直した', remaining: 'なし', decisions: 'なし', points: [] });
    reportDone(w.se, { url: w.put(w.se, 'result'), kind: 'result', summary: '入れた', remaining: 'なし', decisions: 'なし', points: [] });
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
