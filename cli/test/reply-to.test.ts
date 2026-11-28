// 返事の先（Sent の replyTo）を、返事を送る命令が自分で引いて付ける（t-sf5x 段 1）。
// 旗（--reply-to）を打った時にだけ付く作りでは、返事の 96% に先が無かった。頼みは送った記録（log.jsonl）と頼みの記録（reviews/）から引く。
// 席を起こす時の頼みの行（launch）は、段 2 が書く。ここでは、行が在る時の読み方（数えを崩さない・id を借りる）を見る。
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { answer, askPm, dismiss, notify, reportDone, reportEnd, reportMerged, type DoneOptions, type Sent } from '../src/commands/messages.ts';
import { pagePut } from '../src/commands/page.ts';
import { hello } from '../src/commands/role-side.ts';
import { askReview, reportReview } from '../src/commands/staff.ts';
import { time } from '../src/commands/time.ts';
import { collect } from '../src/commands/timeline.ts';
import { assign } from '../src/commands/tpm-side.ts';
import type { Context } from '../src/context.ts';
import { HEADINGS, TPM_TITLE, type HeadingId } from '../src/protocol.ts';
import { readReviews } from '../src/reviews.ts';
import { BRIEF, staffRoot, world, type World } from './helpers.ts';

const TPM = { model: 'claude-opus-5-5', effort: 'medium' };
const KEY = 'AI-8';
const PR = 'https://github.com/o/r/pull/7';
const B = (n: number): string => BRIEF.replace('brief-1', `brief-${n}`);
const DONE: Omit<DoneOptions, 'summary'> = { kind: 'result', remaining: 'なし', decisions: 'なし', points: [] };

interface Seats extends World { se: Context, put: (ctx: Context, kind: string) => Promise<string>, staffAt: (address: string) => Context }

/** TPM 担当と AI-8 の Software Engineer 担当（file:1）が名乗った世界（Staff Engineer 担当の skill が在る root）。 */
async function started(): Promise<Seats> {
  const w = world();
  const tpm = { ...w.tpm, root: staffRoot() };
  await hello(tpm, TPM);
  await assign(tpm, KEY, { role: 'software-engineer', title: '計画と実装', brief: BRIEF, wait: 0 });
  const se = { ...w.role(KEY, 'file:1'), root: staffRoot(), env: { ...w.role(KEY, 'file:1').env, ROSTER_ROLE: 'software-engineer' } };
  await hello(se);
  const html = join(realpathSync(mkdtempSync(join(tmpdir(), 'roster-reply-to-'))), 'p.html');
  writeFileSync(html, '<title>試し</title>');
  const put = async (ctx: Context, kind: string): Promise<string> => (await pagePut(ctx, html, { kind })).find(l => l.startsWith('URL: '))?.slice(5) ?? '';
  const staffAt = (address: string): Context => {
    const base = w.role(`${KEY}.staff`, address);
    return { ...base, env: { ...base.env, ROSTER_ROLE: 'staff-engineer' } };
  };
  return { ...w, tpm, se, put, staffAt };
}

const log = (w: World): Sent[] => w.tpm.state.lines<Sent>('log.jsonl');
/** 見出しごとの、送った行（古い順）。 */
const rows = (w: World, heading: HeadingId): Sent[] => log(w).filter(l => l.heading === heading);
const last = (w: World, heading: HeadingId): Sent | undefined => rows(w, heading).at(-1);
/** 行の id（行が無ければ、試験を落とす。undefined どうしの比べで通さない）。 */
function idOf(row: Sent | undefined): string {
  if (row === undefined) throw new Error('行が無い');
  return row.id;
}

/** 席を起こす時の頼みの行（段 2 が書く形）を、送った記録に足す。 */
function launchRow(w: World, id: string, url: string = BRIEF): void {
  w.tpm.state.append('log.jsonl', { at: '2026-11-20T11:59:00.000Z', key: KEY, heading: 'brief', from: TPM_TITLE, to: 'file:1', text: `【brief】${url}`, id, carrier: 'launch', launch: true } satisfies Sent);
}

describe('見出しの表の役（turn）', () => {
  test('返事の見出しは、返事の先の見出しを表に持つ。どれも頼みの見出し', () => {
    const answers = Object.fromEntries(Object.entries(HEADINGS).flatMap(([id, h]) => typeof h.turn === 'object' ? [[id, [...h.turn.answers]]] : []));
    expect(answers).toEqual({ done: ['brief'], end: ['dismiss'], review: ['ask-review'], answer: ['ask-pm'], notify: ['ask-tpm', 'ask-devops', 'ask-lead'] });
    const turns: Record<string, unknown> = Object.fromEntries(Object.entries(HEADINGS).map(([id, h]) => [id, h.turn]));
    for (const asked of Object.values(answers).flat()) expect(turns[asked]).toBe('request');
  });
});

describe('【done】の返事の先は、済ませる依頼書', () => {
  test('続きの依頼書の【done】は、その【brief】を先にする。先の無い最初の依頼書（前の版で起こした席）の【done】は、先を持たない', async () => {
    const w = await started();
    await reportDone(w.se, { ...DONE, summary: '1 つ目' });
    expect(last(w, 'done')?.replyTo).toBeUndefined();
    await assign(w.tpm, KEY, { role: 'software-engineer', brief: B(2), wait: 0 });
    await reportDone(w.se, { ...DONE, summary: '2 つ目' });
    expect(last(w, 'done')?.replyTo).toBe(idOf(last(w, 'brief')));
    // 置いた物にも、返事の先が載る
    expect(w.posted('file:tpm').at(-1)?.replyTo).toBe(idOf(last(w, 'brief')));
  });

  test('--after で積んだ依頼書は、古い順に 1 つずつ先になる（roster の済ませ方と同じ）', async () => {
    const w = await started();
    await assign(w.tpm, KEY, { role: 'software-engineer', brief: B(2), wait: 0, after: true });
    await assign(w.tpm, KEY, { role: 'software-engineer', brief: B(3), wait: 0, after: true });
    const [b2, b3] = rows(w, 'brief');
    for (const summary of ['1', '2', '3']) await reportDone(w.se, { ...DONE, summary });
    expect(rows(w, 'done').map(l => l.replyTo)).toEqual([undefined, idOf(b2), idOf(b3)]);
  });

  test('--briefs でいくつも済ませた【done】は、送った id の分かるいちばん古い 1 つを先にする', async () => {
    const w = await started();
    await assign(w.tpm, KEY, { role: 'software-engineer', brief: B(2), wait: 0, after: true });
    await assign(w.tpm, KEY, { role: 'software-engineer', brief: B(3), wait: 0, after: true });
    await reportDone(w.se, { ...DONE, summary: 'みな', briefs: ['brief-1', 'brief-2', 'brief-3'] });
    expect(last(w, 'done')?.replyTo).toBe(idOf(rows(w, 'brief')[0]));
    // 間を飛ばして名指せば、名指した物が先
    const v = await started();
    await assign(v.tpm, KEY, { role: 'software-engineer', brief: B(2), wait: 0, after: true });
    await assign(v.tpm, KEY, { role: 'software-engineer', brief: B(3), wait: 0, after: true });
    await reportDone(v.se, { ...DONE, summary: '3 だけ', briefs: ['brief-3'] });
    expect(last(v, 'done')?.replyTo).toBe(idOf(rows(v, 'brief')[1]));
  });

  test('片道の知らせ（【merged】）は、先を持たない', async () => {
    const w = await started();
    await assign(w.tpm, KEY, { role: 'software-engineer', brief: B(2), wait: 0, after: true });
    await reportMerged(w.se, { pr: PR, note: '入れた', unchecked: '試験' });
    expect(last(w, 'merged')?.replyTo).toBeUndefined();
  });
});

describe('席を起こす時の頼みの行（launch）の読み方', () => {
  test('最初の依頼書は 1 つだけ数える（行と名簿の firstBrief で 2 つにしない）。行の id が、最初の【done】の先になる', async () => {
    const w = await started();
    launchRow(w, 'launch-1');
    // 済んでいないのは 1 つ
    await expect(dismiss(w.tpm, KEY, { handover: false })).rejects.toThrow(`--- 【done】が返っていない依頼書: brief-1（${BRIEF}）\n--- ここまで`);
    await reportDone(w.se, { ...DONE, summary: '1 つ目' });
    expect(last(w, 'done')?.replyTo).toBe('launch-1');
    // 【done】1 つで 0 になる（dismiss が通る）
    expect((await dismiss(w.tpm, KEY, { handover: false }))[0]).toMatch(/^送った: 【dismiss】/);
  });

  test('行は「まだ見ていない物」に数えない。続きの依頼書の数えも変わらない', async () => {
    const w = await started();
    launchRow(w, 'launch-1');
    await reportDone(w.se, { ...DONE, summary: '1 つ目' });
    // 続きの assign は、済んでいない物が無いので、旗無しで通る
    expect(await assign(w.tpm, KEY, { role: 'software-engineer', brief: B(2), wait: 0 })).toEqual(['送った: 【brief】→ file:1（相手の手が空いた時に届く。送り直さない）']);
    await expect(dismiss(w.tpm, KEY, { handover: false })).rejects.toThrow(`--- 【done】が返っていない依頼書: brief-2（${B(2)}）\n`);
    await reportDone(w.se, { ...DONE, summary: '2 つ目' });
    expect(last(w, 'done')?.replyTo).toBe(idOf(last(w, 'brief')));
  });

  test('別の依頼書の行・別の宛先の行（前の担当の分）からは、id を借りない', async () => {
    const w = await started();
    launchRow(w, 'launch-old', B(9));
    w.tpm.state.append('log.jsonl', { at: '2026-11-20T11:00:00.000Z', key: KEY, heading: 'brief', from: TPM_TITLE, to: 'file:0', text: `【brief】${BRIEF}`, id: 'launch-before', carrier: 'launch', launch: true } satisfies Sent);
    await reportDone(w.se, { ...DONE, summary: '1 つ目' });
    expect(last(w, 'done')?.replyTo).toBeUndefined();
  });

  test('Staff Engineer 担当の席を起こす時の頼みの行（【ask-review】）も積まない: 開いている頼みは 1 つで、【review】1 つで済む', async () => {
    const w = await started();
    const plan = await w.put(w.se, 'plan');
    await askReview(w.se, { url: plan, wait: 0 });
    const staff = w.staffAt('file:2');
    await hello(staff);
    const brief = readReviews(w.tpm)[0]?.brief ?? '';
    w.tpm.state.append('log.jsonl', { at: '2026-11-20T11:59:30.000Z', key: KEY, heading: 'ask-review', from: 'SWE AI-8: 計画と実装', to: 'file:2', text: `【ask-review】${brief} 頼み: #1 ${plan}`, id: 'launch-ask', carrier: 'launch', launch: true, peer: true } satisfies Sent);
    staff.now = () => new Date('2026-11-20T12:05:00.000Z');
    await reportReview(staff, { url: await w.put(staff, 'review'), verdict: 'approve', summary: 'よい' });
    // 返していない頼みは、頼みの記録（reviews/）で数える。行が在っても 2 つにならず、次の【review】は送れない
    staff.now = () => new Date('2026-11-20T12:06:00.000Z');
    await expect(reportReview(staff, { url: await w.put(staff, 'review'), verdict: 'approve', summary: 'もう 1 度' })).rejects.toThrow(/返していないレビューの頼みがありません/);
    expect(rows(w, 'review')).toHaveLength(1);
  });
});

describe('席を起こす時の頼みの行（launch）を、記録を読む命令が読む', () => {
  test('時系列は、行を「起こす時に渡した頼み」と出す（届いた時刻を「分からない」にしない）。時間の分けは、行が在っても数えられる', async () => {
    const w = await started();
    launchRow(w, 'launch-1');
    await reportDone(w.se, { ...DONE, summary: '1 つ目' });
    const row = collect(w.tpm, KEY).find(e => e.what.includes('id launch-1'));
    expect(row?.notes).toEqual(['席を起こす時の依頼書で渡した頼み（メッセージとしては送っていない）']);
    expect(collect(w.tpm, KEY).find(e => e.what.startsWith('【done】'))?.notes).toContain('返事の先: launch-1');
    expect(time(w.tpm, KEY).join('\n')).toMatch(/作業中/);
  });
});

describe('【end】の返事の先は、受けた【dismiss】', () => {
  test('いちばん新しい【dismiss】を先にする', async () => {
    const w = await started();
    await reportDone(w.se, { ...DONE, summary: '済み' });
    await dismiss(w.tpm, KEY, { handover: false });
    await reportEnd(w.se, { prs: [], removed: [], left: 'なし' });
    expect(last(w, 'end')?.replyTo).toBe(idOf(last(w, 'dismiss')));
  });

  test('後から足された行（file の末尾に入る）が在っても、送った時刻の順で引く', async () => {
    const w = await started();
    await reportDone(w.se, { ...DONE, summary: '済み' });
    await dismiss(w.tpm, KEY, { handover: false });
    const real = idOf(last(w, 'dismiss'));
    w.tpm.state.append('log.jsonl', { at: '2026-11-20T10:00:00.000Z', key: KEY, heading: 'dismiss', from: TPM_TITLE, to: 'file:1', text: '【dismiss】前の物', id: 'old-dismiss', carrier: 'nats' } satisfies Sent);
    await reportEnd(w.se, { prs: [], removed: [], left: 'なし' });
    expect(last(w, 'end')?.replyTo).toBe(real);
  });
});

describe('頼みが前の頼みを閉じる時も、先を付ける', () => {
  test('前の依頼書を取り消す【brief】（--supersede）は、取り消した依頼書を先にする', async () => {
    const w = await started();
    await reportDone(w.se, { ...DONE, summary: '1 つ目' });
    await assign(w.tpm, KEY, { role: 'software-engineer', brief: B(2), wait: 0 });
    await assign(w.tpm, KEY, { role: 'software-engineer', brief: B(3), wait: 0, supersede: true });
    const [b2, b3] = rows(w, 'brief');
    expect(b2?.replyTo).toBeUndefined();
    expect(b3?.replyTo).toBe(idOf(b2));
  });

  test('【answer】は、答えた確認を送った【ask-pm】を先にする。置き換える【ask-pm】（--supersede）は、置き換えた【ask-pm】を先にする', async () => {
    const w = await started();
    const c1 = await w.put(w.se, 'confirm');
    await askPm(w.se, { url: c1, items: ['案の選択'], waitingFor: '案' });
    const c2 = await w.put(w.se, 'confirm');
    await askPm(w.se, { url: c2, items: ['案の選択（直した）'], waitingFor: '案', supersede: [c1] });
    const [first, second] = rows(w, 'ask-pm');
    expect(first?.replyTo).toBeUndefined();
    expect(second?.replyTo).toBe(idOf(first));
    await answer(w.tpm, KEY, { text: 'A で' });
    expect(last(w, 'answer')?.replyTo).toBe(idOf(second));
    // 旗があれば、旗が勝つ
    w.tpm.now = () => new Date('2026-11-20T13:00:00.000Z');
    await answer(w.tpm, KEY, { text: 'やはり B で', urls: [c2], replyTo: first?.id ?? '' });
    expect(last(w, 'answer')?.replyTo).toBe(idOf(first));
  });

  test('確認のページが置き場に無い（返事待ちが引けない）【answer】は、先を持たずに送る（止めない）', async () => {
    const w = await started();
    await askPm(w.se, { url: 'https://claude.ai/artifact/c1', items: ['案'], waitingFor: '案' });
    expect((await answer(w.tpm, KEY, { text: 'A で' })).at(-1)).toMatch(/^送った: 【answer】/);
    expect(last(w, 'answer')?.replyTo).toBeUndefined();
  });
});

describe('【review】の返事の先は、頼みを渡した【ask-review】', () => {
  test('席が居る時の頼みは、送った id を頼みの記録に書き、判定がそれを先にする。席を起こした時の頼み（まだ行が無い）の判定は、先を持たない', async () => {
    const w = await started();
    const plan = await w.put(w.se, 'plan');
    await askReview(w.se, { url: plan, wait: 0 });
    const staff = w.staffAt('file:2');
    await hello(staff);
    staff.now = () => new Date('2026-11-20T12:05:00.000Z');
    await reportReview(staff, { url: await w.put(staff, 'review'), verdict: 'approve', summary: 'よい' });
    expect(last(w, 'review')?.replyTo).toBeUndefined();
    w.se.now = () => new Date('2026-11-20T12:10:00.000Z');
    await askReview(w.se, { url: PR });
    const asked = last(w, 'ask-review');
    expect(readReviews(w.tpm)[1]).toMatchObject({ n: 2, ask: idOf(asked) });
    staff.now = () => new Date('2026-11-20T12:30:00.000Z');
    await reportReview(staff, { url: await w.put(staff, 'review'), verdict: 'concerns', summary: '気になる' });
    expect(last(w, 'review')?.replyTo).toBe(idOf(asked));
  });
});

describe('2 度送りの検査', () => {
  test('命令が先を引く返事も、同じ本文を 30 秒の内に 2 度送ると止まる（1 度目が頼みを済ませて、2 度目の先が替わっても）', async () => {
    const w = await started();
    await reportDone(w.se, { ...DONE, summary: '1 つ目' });
    await assign(w.tpm, KEY, { role: 'software-engineer', brief: B(2), wait: 0 });
    await reportDone(w.se, { ...DONE, summary: '同じ' });
    await expect(reportDone(w.se, { ...DONE, summary: '同じ' })).rejects.toThrow(/^同じ【done】を/);
    expect(rows(w, 'done')).toHaveLength(2);
  });

  test('返事の先を名指した【notify】は、先が違えば同じ本文でも送る（今までどおり）', async () => {
    const w = await started();
    await notify(w.tpm, KEY, { text: '了解', replyTo: 'm-1' });
    await notify(w.tpm, KEY, { text: '了解', replyTo: 'm-2' });
    await expect(notify(w.tpm, KEY, { text: '了解', replyTo: 'm-2' })).rejects.toThrow(/^同じ【notify】を/);
    expect(rows(w, 'notify').map(l => l.replyTo)).toEqual(['m-1', 'm-2']);
  });
});
