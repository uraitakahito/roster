import { describe, expect, test } from 'vitest';
import { incidentAdd } from '../src/commands/incident.ts';
import { askTpm, notify, reportIncident, reportMerged, wait } from '../src/commands/messages.ts';
import { hello } from '../src/commands/role-side.ts';
import { collect, incidentTimeline } from '../src/commands/timeline.ts';
import { assign } from '../src/commands/tpm-side.ts';
import { readIncidents } from '../src/incidents.ts';
import { DELIVERED_FILE, type DeliveredLine } from '../src/mail.ts';
import { BRIEF, world, type World, MAIN_PASSED, REVIEW_NONE } from './helpers.ts';

const PR = 'https://github.com/o/r/pull/7';
const clock = (hhmmss: string) => (): Date => new Date(`2026-11-20T${hhmmss}.000Z`);

/** 行き違いのある 1 幕: 担当が 12:00:10 に問い、TPM 担当の「待て」（12:01:00 に送り、12:05:00 に届く）の前に、担当が 12:02:00 に【merged】を送った。 */
async function crossed(): Promise<World & { se: ReturnType<World['role']>, ask: string, note: string, merged: string }> {
  const w = world();
  await hello(w.tpm, { model: 'claude-opus-5-5', effort: 'medium' });
  await assign(w.tpm, 't-x7k2', { role: 'software-engineer', title: '計画と実装', brief: BRIEF, wait: 0 });
  const se = w.role('t-x7k2', 'file:1');
  await hello(se);
  se.now = clock('12:00:10');
  await askTpm(se, { text: 'tag を打ってよいか', waitingFor: '答え' });
  w.tpm.now = clock('12:01:00');
  const ask = w.posted('tpm')[0]?.id ?? '';
  await notify(w.tpm, 't-x7k2', { text: 'まだ打たないで待つこと', replyTo: ask });
  const note = w.posted('t-x7k2')[0]?.id ?? '';
  se.now = clock('12:02:00');
  await reportMerged(se, { pr: PR, note: '入れた' });
  se.now = clock('12:02:30');
  wait(se, 'work', 'tag を打つ');
  // 渡した記録を、この幕の時刻に書き直す（足場は、置いた時に渡した事にする）: 問いは 1 秒後、「待て」は 12:05:00 に hook が渡した。【merged】は、まだ渡っていない。
  w.tpm.state.remove(DELIVERED_FILE);
  w.tpm.state.append(DELIVERED_FILE, { at: '2026-11-20T12:00:11.000Z', id: ask, to: 'tpm', when: 'wake', nth: 1 } satisfies DeliveredLine);
  w.tpm.state.append(DELIVERED_FILE, { at: '2026-11-20T12:05:00.000Z', id: note, to: 't-x7k2', when: 'wake', nth: 1 } satisfies DeliveredLine);
  return { ...w, se, ask, note, merged: w.posted('tpm')[1]?.id ?? '' };
}

describe('時系列を集める', () => {
  test('Key の記録を時刻の順に並べ、届いた時刻と行き違いの印を付ける', async () => {
    const w = await crossed();
    const events = collect(w.tpm, 't-x7k2', { from: '2026-11-20T12:00:05.000Z', to: '2026-11-20T12:10:00.000Z' }, w.note);
    expect(events.map(e => [e.at.slice(11, 19), e.kind, e.what, e.notes, e.trigger ?? false])).toEqual([
      ['12:00:10', 'メッセージ', `【ask-tpm】tag を打ってよいか（id ${w.ask}）`, ['届いた: 12:00:11（1 秒後）'], false],
      ['12:00:10', 'wait', '回答待ち(TPM): 答え', [], false],
      ['12:01:00', 'メッセージ', `【notify】まだ打たないで待つこと（id ${w.note}）`, ['届いた: 12:05:00（240 秒後）', `返事の先: ${w.ask}`, '行き違い: これが届く前に、相手が 1 件送った（【merged】12:02:00）'], true],
      ['12:02:00', 'メッセージ', `【merged】${PR} 入れた${MAIN_PASSED}${REVIEW_NONE}（id ${w.merged}）`, ['届いた時刻: 分からない'], false],
      ['12:02:30', 'wait', '作業中: tag を打つ', [], false],
    ]);
    // ほかの Key の記録は入らない
    expect(collect(w.tpm, 't-b2c3')).toEqual([]);
  });

  test('配られる前に roster が見せていれば「見た」と出し、見た後に相手が送った物は行き違いにしない（台帳 #110）', async () => {
    const w = await crossed();
    // 担当は 12:01:30 に、送る前の検査で【notify】を見た（hook が渡したのは 12:05:00）
    const shown = (at: string): void => w.tpm.state.append(DELIVERED_FILE, { at, id: w.note, to: 't-x7k2', when: 'output', nth: 0 } satisfies DeliveredLine);
    const notes = (): string[] | undefined => collect(w.tpm, 't-x7k2').find(e => e.what.includes(`（id ${w.note}）`))?.notes;
    shown('2026-11-20T12:01:30.000Z');
    expect(notes()).toEqual(['見た: 12:01:30（30 秒後。届く前に roster が見せた）', `返事の先: ${w.ask}`]);
    // 見る前に相手が送っていれば、「見る前に」の行き違い
    const v = await crossed();
    v.tpm.state.append(DELIVERED_FILE, { at: '2026-11-20T12:03:00.000Z', id: v.note, to: 't-x7k2', when: 'output', nth: 0 } satisfies DeliveredLine);
    expect(collect(v.tpm, 't-x7k2').find(e => e.what.includes(`（id ${v.note}）`))?.notes.at(-1)).toBe('行き違い: これを見る前に、相手が 1 件送った（【merged】12:02:00）');
  });

  test('前の版の行（送った時に delivered を書いた）は、今までの字で出す。届け違いで返した物は「返した」と出す', async () => {
    const w = await crossed();
    const old = { at: '2026-11-20T12:03:00.000Z', key: 't-x7k2', heading: 'notify', from: 'Technical Program Manager', to: 'file:1' };
    w.tpm.state.append('log.jsonl', { ...old, text: '【notify】a', id: 'old-yes', delivered: true });
    w.tpm.state.append('log.jsonl', { ...old, text: '【notify】b', id: 'old-no', delivered: false });
    w.tpm.state.append('returned.jsonl', { at: '2026-11-20T12:06:00.000Z', id: w.note, incident: 1 });
    const notes = (id: string): string[] | undefined => collect(w.tpm, 't-x7k2').find(e => e.what.includes(`（id ${id}）`))?.notes;
    expect(notes('old-yes')).toEqual(['送った時に届いた']);
    expect(notes('old-no')).toEqual(['届いた時刻: 分からない（送った時は、まだ届いていない）']);
    expect(notes(w.note)?.[0]).toBe('届け違いで返した（宛先の担当は見ていない。roster returned show）');
  });

  test('guard・入口の検査・課題管理・台帳の行も入る', async () => {
    const w = await crossed();
    w.prs.set(PR, 'OPEN');
    w.se.now = clock('12:03:00');
    await expect(reportMerged(w.se, { pr: PR, note: '2 本目' })).rejects.toThrow(/merge されていません/);
    w.tpm.state.append('guard.jsonl', { at: '2026-11-20T12:03:10.000Z', by: 't-x7k2', role: 'software-engineer', command: 'acli jira workitem transition', reason: '直に打たない' });
    w.tpm.state.append('tracker.jsonl', { at: '2026-11-20T12:03:20.000Z', by: 't-x7k2', role: 'software-engineer', issue: 'AI-8', op: 'close', ok: true });
    w.se.now = clock('12:03:30');
    await reportIncident(w.se, { text: 'tag を「待て」の前に打った', type: 'reliability', tags: [], severe: false });
    expect(collect(w.tpm, 't-x7k2').filter(e => e.at >= '2026-11-20T12:03').map(e => [e.kind, e.what])).toEqual([
      ['入口の検査', '送るのを止めた（not-merged）'],
      ['guard', '止めた: acli jira workitem transition'],
      ['課題管理', 'AI-8 に「済み」'],
      ['メッセージ', `【incident】#1 信頼性: tag を「待て」の前に打った（id ${w.posted('tpm')[2]?.id ?? ''}）`],
      ['台帳', '#1 信頼性 t-x7k2 11-20 12:03「tag を「待て」の前に打った」'],
    ]);
  });
});

describe('roster incident timeline', () => {
  test('件の番号: 引き金のメッセージの前後を拾ってページを置き、件に URL を結ぶ', async () => {
    const w = await crossed();
    w.tpm.now = clock('12:30:00');
    incidentAdd(w.tpm, 't-x7k2', { text: '「待て」の前に先へ進んだ', type: 'reliability', tags: [], msg: w.note, severe: false });
    const out = await incidentTimeline(w.tpm, '#1', { minutes: 1 });
    const url = readIncidents(w.tpm)[0]?.timeline ?? '';
    expect(url).toMatch(/\/t-x7k2\/timeline-1\.html$/);
    expect(out).toEqual([`時系列を置いた（6 行）: ${url}`, '件に結んだ: #1']);
    const page = [...w.store.pages.values()].find(p => p.record.kind === 'timeline');
    expect(page?.record).toMatchObject({ key: 't-x7k2', kind: 'timeline', role: 'tpm', title: '台帳 #1（t-x7k2）の時系列' });
    const html = page?.body.toString() ?? '';
    expect(html).toContain('引き金のメッセージ（12:01:00）の前後 1 分の、t-x7k2 の記録（6 行）。');
    expect(html).toContain('<tr class="trigger"><td class="t">2026-11-20<br>12:01:00</td>');
    expect(html).toContain('<span class="cross">行き違い: これが届く前に、相手が 1 件送った（【merged】12:02:00）</span>');
    // 前後 1 分の外（12:02:30 の wait）は入らない。字は HTML として安全にする
    expect(html).not.toContain('作業中: tag を打つ');
    expect(html).not.toContain('<script');
  });

  test('課題の Key: その Key の記録をみな拾う。件には結ばない', async () => {
    const w = await crossed();
    expect((await incidentTimeline(w.tpm, 't-x7k2'))[0]).toMatch(/^時系列を置いた（7 行）: .*\/t-x7k2\/timeline-1\.html$/);
    expect((await incidentTimeline(w.se, 't-x7k2'))[0]).toMatch(/timeline-2\.html$/);
  });

  test('引き金のメッセージが無い件は、Key の初めから、件を書いた少し後までを拾う（件は出来事の後で書かれる）。記録が無い Key・無い番号・誤った分は止まる', async () => {
    const w = await crossed();
    // 出来事（12:00〜12:02）の 1 時間後に、引き金を書かずに件を書く。
    w.tpm.now = clock('13:00:00');
    incidentAdd(w.tpm, 't-x7k2', { text: 'x', type: 'safety', tags: [], severe: false });
    incidentAdd(w.tpm, 't-x7k2', { text: 'y', type: 'safety', tags: [], msg: 'no-such-id', severe: false });
    expect((await incidentTimeline(w.tpm, '1', { minutes: 5 }))[0]).toMatch(/^時系列を置いた（9 行）/);
    await incidentTimeline(w.tpm, '2', { minutes: 5 });
    const [first, second] = [...w.store.pages.values()].filter(p => p.record.kind === 'timeline').map(p => p.body.toString());
    expect(first).toContain('引き金のメッセージが書かれていないので、t-x7k2 の初めから、件を書いた時刻（13:00:00）の 5 分後までの記録を並べた（9 行）。');
    expect(first).toContain('【ask-tpm】tag を打ってよいか');
    expect(second).toContain('引き金のメッセージが（id no-such-id）log.jsonl に無いので、');
    await expect(incidentTimeline(w.tpm, 't-zzzz')).rejects.toThrow(/t-zzzz の記録がありません/);
    await expect(incidentTimeline(w.tpm, '9')).rejects.toThrow('台帳に #9 はありません');
    await expect(incidentTimeline(w.tpm, '1', { minutes: 0 })).rejects.toThrow(/--minutes/);
  });
});
