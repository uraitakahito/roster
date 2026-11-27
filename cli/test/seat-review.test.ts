// repo の席のレビューは、親の課題の Tech Lead 担当が見る（AI-45 の段 4）。Tech Lead 担当自身と、分けない課題の頼みは、今までどおり Staff Engineer 担当へ。
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { dismiss, reportDone, reportEnd } from '../src/commands/messages.ts';
import { pagePut } from '../src/commands/page.ts';
import { reviewList } from '../src/commands/review.ts';
import { hello } from '../src/commands/role-side.ts';
import { seatAdd, seatClose } from '../src/commands/seat.ts';
import { askReview, reportReview } from '../src/commands/staff.ts';
import { collect } from '../src/commands/timeline.ts';
import { assign } from '../src/commands/tpm-side.ts';
import type { Context } from '../src/context.ts';
import { DELIVERED_FILE, type DeliveredLine } from '../src/mail.ts';
import { readReviews } from '../src/reviews.ts';
import { allRoles, readRole, writeRole } from '../src/roster.ts';
import { BRIEF, staffRoot, world, type World } from './helpers.ts';

const PR1 = 'https://github.com/o/pagetray/pull/7';
const PR2 = 'https://github.com/o/castlist/pull/3';

interface Split extends World { lead: Context, pagetray: Context, castlist: Context, put: (ctx: Context, kind: string) => Promise<string>, texts: (address: string) => string[] }

/** Tech Lead 担当（AI-36・file:1）と、名乗った repo の席 2 つ（pagetray は file:2、castlist は file:3）。 */
async function split(): Promise<Split> {
  const w = world();
  const root = staffRoot();
  const tpm = { ...w.tpm, root };
  await hello(tpm);
  await assign(tpm, 'AI-36', { role: 'tech-lead', title: '3 つの repo', brief: BRIEF, wait: 0, seats: 2 });
  const lead = { ...w.role('AI-36', 'file:1'), root };
  await hello(lead);
  await seatAdd(lead, 'pagetray', { brief: BRIEF, wait: 0 });
  await seatAdd(lead, 'castlist', { brief: BRIEF, wait: 0 });
  const pagetray = { ...w.role('AI-36.pagetray', 'file:2'), root };
  const castlist = { ...w.role('AI-36.castlist', 'file:3'), root };
  await hello(pagetray);
  await hello(castlist);
  const html = join(realpathSync(mkdtempSync(join(tmpdir(), 'roster-seat-review-'))), 'p.html');
  writeFileSync(html, '<title>試し</title>');
  const put = async (ctx: Context, kind: string): Promise<string> => (await pagePut(ctx, html, { kind })).find(l => l.startsWith('URL: '))?.slice(5) ?? '';
  return { ...w, tpm, lead, pagetray, castlist, put, texts: address => w.posted(address).map(m => m.text) };
}

describe('repo の席の roster ask review', () => {
  test('親の課題の Tech Lead 担当の席へ、じかに届く。Staff Engineer 担当の席は起こさない。依頼書は親の課題の folder に置く', async () => {
    const w = await split();
    const out = await askReview(w.pagetray, { url: PR1, focus: '境の取り決めどおりか' });
    expect(out[0]).toBe('送った: 【ask-review】→ file:1（相手の手が空いた時に届く。送り直さない）');
    expect(out.at(-1)).toBe('状態: 回答待ち(レビュー): PR #7');
    const [sent] = w.texts('file:1');
    expect(sent).toMatch(/^【ask-review】\S+\/AI-36\/brief-\d+\.html 頼み: #1 https:\/\/github\.com\/o\/pagetray\/pull\/7 見てほしい所: 境の取り決めどおりか$/);
    expect(readReviews(w.tpm)).toMatchObject([{ n: 1, key: 'AI-36.pagetray', url: PR1, reviewer: 'tech-lead' }]);
    expect(allRoles(w.tpm).map(r => r.key).sort()).toEqual(['AI-36', 'AI-36.castlist', 'AI-36.pagetray']);
    expect(w.wire.seats()).toHaveLength(3);
  });

  test('頼みの後も、Tech Lead 担当の題と依頼書（名簿の行）は変わらない', async () => {
    const w = await split();
    await askReview(w.pagetray, { url: PR1 });
    expect(readRole(w.tpm, 'AI-36')).toMatchObject({ title: 'Lead AI-36: 3 つの repo', brief: BRIEF });
    expect(w.wire.look('file:1')?.title).toBe('Lead AI-36: 3 つの repo');
  });

  test('Tech Lead 担当の席が無ければ、頼まずに止まる（頼みの記録も残さない）', async () => {
    const w = await split();
    w.wire.close('file:1');
    await expect(askReview(w.pagetray, { url: PR1 })).rejects.toThrow(/^AI-36 の Tech Lead 担当の席がありません。レビューは頼んでいません。roster ask tpm で TPM 担当に知らせてください/);
    expect(readReviews(w.tpm)).toEqual([]);
  });

  test('Tech Lead 担当自身の頼みは、今までどおり Staff Engineer 担当の席へ（席を起こす）', async () => {
    const w = await split();
    const plan = await w.put(w.lead, 'plan');
    const out = await askReview(w.lead, { url: plan, wait: 0 });
    expect(out[0]).toMatch(/^起こした: レビュー AI-36: 計画 plan-1/);
    expect(readRole(w.tpm, 'AI-36.staff')?.role).toBe('staff-engineer');
    expect(readReviews(w.tpm)[0]?.reviewer).toBeUndefined();
  });
});

describe('Tech Lead 担当の roster report review', () => {
  test('返していない頼みがいくつもあれば、--review で名指させる。名指した頼みの席へ届き、ほかの頼みは残る。状態は替えない', async () => {
    const w = await split();
    await askReview(w.castlist, { url: PR2 });
    await askReview(w.pagetray, { url: PR1 });
    await expect(reportReview(w.lead, { url: await w.put(w.lead, 'review'), verdict: 'approve', summary: 'よい' })).rejects.toThrow(/^返していないレビューの頼みが、いくつもあります。どの頼みへの判定かを --review <番号> で名指してください。送っていません。\n#1 AI-36\.castlist \S+pull\/3\n#2 AI-36\.pagetray \S+pull\/7$/);
    // 後の頼み（#2）を先に返す。
    const first = await reportReview(w.lead, { url: await w.put(w.lead, 'review'), verdict: 'reject', summary: '欄の名が違う', review: 2 });
    expect(first).toContain('送った: 【review】→ file:2（相手の手が空いた時に届く。送り直さない）');
    expect(first).toContain(`届けた先: AI-36.pagetray（頼み #2 ${PR1}）`);
    expect(first.at(-1)).toBe('返していない頼みが、あと 1 件あります（roster review list）');
    expect(w.texts('file:2').at(-1)).toMatch(/^【review】\S+\/AI-36\/review-\d+\.html 判定: 直すべき（reject）／一言: 欄の名が違う／頼み: #2$/);
    expect(w.texts('file:3').some(t => t.startsWith('【review】'))).toBe(false);
    expect(w.wire.status('file:1')?.wait).not.toMatch(/回答待ち\(レビュー\)/);
    expect(readReviews(w.tpm).map(r => [r.key, r.verdict])).toEqual([['AI-36.castlist', undefined], ['AI-36.pagetray', 'reject']]);
    // 残りが 1 つなら、名指さなくてよい。
    const second = await reportReview(w.lead, { url: await w.put(w.lead, 'review'), verdict: 'approve', summary: 'よい' });
    expect(second).toContain('送った: 【review】→ file:3（相手の手が空いた時に届く。送り直さない）');
    await expect(reportReview(w.lead, { url: await w.put(w.lead, 'review'), verdict: 'approve', summary: 'x' })).rejects.toThrow(/返していないレビューの頼みがありません/);
  });

  test.each([
    ['起こしの id が無い（受け箱は Key だけ）', false],
    // castlist を設定した実の形。受け箱は起こした回ごとに分かれ、前の回に届いた【ask-review】は新しい席の受け箱に無い。
    ['起こしの id がある（受け箱が起こした回ごと）', true],
  ])('起こし直した Tech Lead 担当は、前の席に届いた頼みを hello で受け取り、新しい席から返せる（t-7j37。%s）', async (_, launched) => {
    const w = await split();
    const launch = (ctx: Context, id: string): Context => {
      if (!launched) return ctx;
      writeRole(w.tpm, { ...readRole(w.tpm, 'AI-36')!, launch: id });
      return { ...ctx, env: { ...ctx.env, ROSTER_LAUNCH: id } };
    };
    const first = launch(w.lead, 'L1');
    await askReview(w.pagetray, { url: PR1, focus: '境の取り決めどおりか' });
    await askReview(w.castlist, { url: PR2 });
    // 今の席の名乗りにも並ぶ。
    expect((await hello(first)).some(l => l.startsWith('返していないレビューの頼み'))).toBe(true);
    // 頼みは、渡した席の起こしの id を持つ（t-9tac）。今の回に渡した頼みは「見ている」。
    expect(readReviews(w.tpm).map(r => r.launch)).toEqual(launched ? ['L1', 'L1'] : [undefined, undefined]);
    expect(reviewList(w.tpm, { key: 'AI-36' })[0]).toContain('まだ（Tech Lead 担当が見ている）');
    w.wire.close('file:1');
    await assign(w.tpm, 'AI-36', { role: 'tech-lead', brief: BRIEF, wait: 0 });
    const address = readRole(w.tpm, 'AI-36')?.address ?? '';
    expect(address).not.toBe('file:1');
    const relaunched = launch({ ...w.role('AI-36', address), root: w.lead.root }, 'L2');
    const asks = w.office.log.filter(m => m.text.startsWith('【ask-review】')).map(m => m.to);
    expect(asks).toEqual(launched ? ['AI-36__L1', 'AI-36__L1'] : ['AI-36', 'AI-36']);
    // 起こしの id があれば、前の回の頼みは新しい席の受け箱に無い（直したい不具合の形）。
    if (launched) expect(w.texts(address).filter(t => t.startsWith('【ask-review】'))).toEqual([]);
    // review list は、前の回に渡した頼みを「見ている」と出さない（起こしの id が無い形は、受け箱が Key ごとで今の回に届くので、今までどおり）。
    expect(reviewList(w.tpm, { key: 'AI-36' })[0]).toContain(launched ? 'まだ（前の回の Tech Lead 担当に渡した。今の回には roster hello が並べる）' : 'まだ（Tech Lead 担当が見ている）');
    const out = await hello(relaunched);
    const at = out.findIndex(l => l.startsWith('返していないレビューの頼み'));
    expect(out[at]).toBe('返していないレビューの頼み: 2 件（前の回の席に届いた物も。/tech-lead の 6 のとおり見て、roster report review --review <番号> で返す）');
    expect(out[at + 1]).toMatch(/^ {2}#1 AI-36\.pagetray 見る物: https:\/\/github\.com\/o\/pagetray\/pull\/7 依頼書: \S+\/AI-36\/brief-\d+\.html 見てほしい所: 境の取り決めどおりか$/);
    expect(out[at + 2]).toMatch(/^ {2}#2 AI-36\.castlist 見る物: https:\/\/github\.com\/o\/castlist\/pull\/3 依頼書: \S+\/AI-36\/brief-\d+\.html$/);
    const sent = await reportReview(relaunched, { url: await w.put(relaunched, 'review'), verdict: 'approve', summary: 'よい', review: 1 });
    expect(sent).toContain('送った: 【review】→ file:2（相手の手が空いた時に届く。送り直さない）');
    // 返した頼みは並ばなくなる。
    const again = await hello(relaunched);
    expect(again.find(l => l.startsWith('返していないレビューの頼み'))).toBe('返していないレビューの頼み: 1 件（前の回の席に届いた物も。/tech-lead の 6 のとおり見て、roster report review --review <番号> で返す）');
    expect(again.some(l => l.startsWith('  #1 '))).toBe(false);
  });

  test('hello が頼みを並べるのは Tech Lead 担当だけ。頼みが無ければ並べない', async () => {
    const w = await split();
    expect((await hello(w.lead)).some(l => l.startsWith('返していないレビューの頼み'))).toBe(false);
    // Tech Lead 担当自身の頼み（Staff Engineer 担当が見る）は並べない。
    await askReview(w.lead, { url: await w.put(w.lead, 'plan'), wait: 0 });
    expect((await hello(w.lead)).some(l => l.startsWith('返していないレビューの頼み'))).toBe(false);
    // 頼んだ repo の席の名乗りにも出ない。
    await askReview(w.pagetray, { url: PR1 });
    expect((await hello(w.pagetray)).some(l => l.startsWith('返していないレビューの頼み'))).toBe(false);
  });

  test('--review は、返していない頼みの番号だけ。Staff Engineer 担当には付けられない', async () => {
    const w = await split();
    await askReview(w.pagetray, { url: PR1 });
    await expect(reportReview(w.lead, { url: await w.put(w.lead, 'review'), verdict: 'approve', summary: 'x', review: 9 })).rejects.toThrow(/^--review の #9 は、返していない頼みにありません。送っていません。\n#1 AI-36\.pagetray/);
    await askReview(w.lead, { url: await w.put(w.lead, 'plan'), wait: 0 });
    const staff = { ...w.role('AI-36.staff', 'file:4'), root: w.lead.root };
    await hello(staff);
    await expect(reportReview(staff, { url: await w.put(staff, 'review'), verdict: 'approve', summary: 'x', review: 2 })).rejects.toThrow(/^--review は、Tech Lead 担当が、返す頼みを名指す時だけに付ける/);
  });

  test('頼んだ席を閉じる: 居る席は、返っていない頼みがあれば閉じない。居場所の無い席の頼みは取り下げる', async () => {
    const w = await split();
    await askReview(w.pagetray, { url: PR1 });
    writeRole(w.tpm, { ...readRole(w.tpm, 'AI-36.pagetray')!, dismissed: 'done' });
    await reportEnd(w.pagetray, { prs: [], removed: [], left: 'なし' });
    await expect(seatClose(w.lead, 'pagetray')).rejects.toThrow(/^AI-36\.pagetray の席が頼んだレビューが、まだ返っていません（#1）。閉じていません/);
    w.wire.close('file:2');
    const out = await seatClose(w.lead, 'pagetray');
    expect(out).toContain('返っていなかったレビューの頼みを取り下げた: #1');
    expect(readReviews(w.tpm)[0]).toMatchObject({ verdict: 'not-assessed', summary: '頼んだ席を閉じたので、返していない' });
    await expect(reportReview(w.lead, { url: await w.put(w.lead, 'review'), verdict: 'approve', summary: 'x' })).rejects.toThrow(/返していないレビューの頼みがありません/);
  });

  test('時系列の行き違いは、送り手と受け手の組で見る（repo の席の頼みと、Tech Lead 担当の判定）', async () => {
    const w = await split();
    const at = (hms: string) => (): Date => new Date(`2026-11-20T${hms}.000Z`);
    w.pagetray.now = at('12:00:00');
    await askReview(w.pagetray, { url: PR1 });
    w.lead.now = at('12:01:00');
    await reportReview(w.lead, { url: await w.put(w.lead, 'review'), verdict: 'approve', summary: 'よい' });
    const verdict = w.posted('file:2').find(m => m.text.startsWith('【review】'))?.id ?? '';
    w.pagetray.now = at('12:02:00');
    await askReview(w.pagetray, { url: PR1.replace('/7', '/8') });
    // 渡した記録を書き直す: 判定は、repo の席が次の頼みを送った後の 12:05:00 に渡った（行き違い）。
    const lines = w.tpm.state.lines<DeliveredLine>(DELIVERED_FILE);
    w.tpm.state.remove(DELIVERED_FILE);
    for (const l of lines) w.tpm.state.append(DELIVERED_FILE, l.id === verdict ? { ...l, at: '2026-11-20T12:05:00.000Z' } : l);
    const review = collect(w.tpm, 'AI-36').find(e => e.what.startsWith('【review】'));
    expect(review?.notes.at(-1)).toBe('行き違い: これが届く前に、相手が 1 件送った（【ask-review】12:02:00）');
  });

  test('Tech Lead 担当の【done】は TPM 担当の依頼書だけを、【review】はレビューの頼みだけを済ませる', async () => {
    const w = await split();
    await askReview(w.pagetray, { url: PR1 });
    // 【review】を返しても、TPM 担当の依頼書（brief-1）は済まない。
    await reportReview(w.lead, { url: await w.put(w.lead, 'review'), verdict: 'approve', summary: 'よい' });
    await expect(dismiss(w.tpm, 'AI-36', { handover: false })).rejects.toThrow(/【done】が返っていない依頼書: brief-1/);
    // 頼みが返っていない間の【done】は、TPM 担当の依頼書を済ませ、頼みは残る。
    await askReview(w.castlist, { url: PR2 });
    await reportDone(w.lead, { kind: 'plan', summary: '計画', remaining: 'なし', decisions: 'なし', points: [] });
    expect(readReviews(w.tpm).filter(r => r.verdict === undefined).map(r => r.key)).toEqual(['AI-36.castlist']);
    expect((await dismiss(w.tpm, 'AI-36', { handover: false }))[0]).toMatch(/^送った: 【dismiss】/);
  });

  test('roster review list は、見る者を出す', async () => {
    const w = await split();
    await askReview(w.pagetray, { url: PR1 });
    expect(reviewList(w.tpm, { key: 'AI-36.pagetray' })[0]).toContain('まだ（Tech Lead 担当が見ている）');
    // 課題の Key で引くと、その repo の席の頼みも出る。席を閉じた後も、見る者（Tech Lead 担当）の有無は変わらない。
    expect(reviewList(w.tpm, { key: 'AI-36' })[0]).toMatch(/^#1 {2}AI-36\.pagetray {2}まだ（Tech Lead 担当が見ている）/);
  });

  test('repo の席は roster report review を打てない', async () => {
    const w = await split();
    await askReview(w.pagetray, { url: PR1 });
    await expect(reportReview(w.castlist, { url: await w.put(w.lead, 'review'), verdict: 'approve', summary: 'x' })).rejects.toThrow(/^roster report review は、Staff Engineer 担当（Staff の席）か、repo の席の頼みを受けた Tech Lead 担当が打ちます/);
  });
});
