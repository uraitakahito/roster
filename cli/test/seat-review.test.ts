// repo の席のレビューは、親の課題の Tech Lead 担当が見る（AI-45 の段 4）。Tech Lead 担当自身と、分けない課題の頼みは、今までどおり Staff Engineer 担当へ。
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { dismiss, reportDone } from '../src/commands/messages.ts';
import { pagePut } from '../src/commands/page.ts';
import { reviewList } from '../src/commands/review.ts';
import { hello } from '../src/commands/role-side.ts';
import { seatAdd } from '../src/commands/seat.ts';
import { askReview, reportReview } from '../src/commands/staff.ts';
import { assign } from '../src/commands/tpm-side.ts';
import type { Context } from '../src/context.ts';
import { readReviews } from '../src/reviews.ts';
import { allRoles, readRole } from '../src/roster.ts';
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
  test('repo の席の頼みを古い順に返す。判定は頼んだ席へ届き、状態は替えない', async () => {
    const w = await split();
    await askReview(w.castlist, { url: PR2 });
    await askReview(w.pagetray, { url: PR1 });
    const first = await reportReview(w.lead, { url: await w.put(w.lead, 'review'), verdict: 'approve', summary: 'よい' });
    expect(first).toContain('送った: 【review】→ file:3（相手の手が空いた時に届く。送り直さない）');
    expect(first.at(-1)).toBe('返していない頼みが、あと 1 件あります（roster review list）');
    expect(w.texts('file:3').at(-1)).toMatch(/^【review】\S+\/AI-36\/review-1\.html 判定: よい（approve）／一言: よい／頼み: #1$/);
    expect(w.wire.status('file:1')?.wait).not.toMatch(/回答待ち\(レビュー\)/);
    const second = await reportReview(w.lead, { url: await w.put(w.lead, 'review'), verdict: 'concerns', summary: '欄の名が違う' });
    expect(second).toContain('送った: 【review】→ file:2（相手の手が空いた時に届く。送り直さない）');
    expect(readReviews(w.tpm).map(r => [r.key, r.verdict])).toEqual([['AI-36.castlist', 'approve'], ['AI-36.pagetray', 'concerns']]);
    await expect(reportReview(w.lead, { url: await w.put(w.lead, 'review'), verdict: 'approve', summary: 'x' })).rejects.toThrow(/返していないレビューの頼みがありません/);
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
  });

  test('repo の席は roster report review を打てない', async () => {
    const w = await split();
    await askReview(w.pagetray, { url: PR1 });
    await expect(reportReview(w.castlist, { url: await w.put(w.lead, 'review'), verdict: 'approve', summary: 'x' })).rejects.toThrow(/^roster report review は、Staff Engineer 担当（Staff の席）か、repo の席の頼みを受けた Tech Lead 担当が打ちます/);
  });
});
