import { describe, expect, test } from 'vitest';
import { recordDelivered } from '../src/mail.ts';
import { seenTimes, shownFile, type MessageTrace } from '../src/seen.ts';
import { world } from './helpers.ts';

const T = (hhmmss: string): string => `2026-11-20T${hhmmss}.000Z`;
const sent = (id: string, at: string, extra: { delivered?: boolean } = {}) => ({ id, at: T(at), to: 'file:1', ...extra });

// 古い行（carrier の無い行）は、前の版で連携の道具（cmux）が運んだ物。deliveries.jsonl・shown/・returned.jsonl は、もう増えない古い記録（読むだけ）。
describe('見た時刻の口（古い行）', () => {
  test('配った時刻・見せた時刻・前の版の delivered のうち、いちばん早い物を出どころと返す', () => {
    const w = world();
    w.tpm.state.append('deliveries.jsonl', { id: 'a', deliveredAt: T('12:05:00') } satisfies MessageTrace);
    w.tpm.state.append('deliveries.jsonl', { id: 'b', deliveredAt: T('12:01:00') } satisfies MessageTrace);
    w.tpm.state.write(shownFile('file:1'), [{ id: 'a', at: T('12:02:00') }, { id: 'b', at: T('12:03:00') }, 'c']);
    const seen = seenTimes(w.tpm, { live: true });
    // a: 配る（12:05）より前に見せた（12:02）
    expect(seen(sent('a', '12:00:00'))).toEqual({ at: T('12:02:00'), by: 'shown' });
    // b: 見せる前に配った
    expect(seen(sent('b', '12:00:00'))).toEqual({ at: T('12:01:00'), by: 'delivered' });
    // c: 前の版が時刻を書かずに覚えた見せた物は、送った時刻に見せた物とする
    expect(seen(sent('c', '12:00:30'))).toEqual({ at: T('12:00:30'), by: 'shown' });
    // 記録用（時系列）では、時刻の無い項目は作った時刻になるので使わない
    expect(seenTimes(w.tpm, { live: false })(sent('c', '12:00:30'))).toBeUndefined();
    // d: 前の版が送った時に「届いた」と書いた行
    expect(seen(sent('d', '12:00:40', { delivered: true }))).toEqual({ at: T('12:00:40'), by: 'legacy' });
  });

  test('道具の記録の写し（deliveries.jsonl）のいちばん早い配った時刻を使う。配った時刻の無い行は使わない', () => {
    const w = world();
    w.tpm.state.append('deliveries.jsonl', { id: 'old', sentAt: T('11:00:00') } satisfies MessageTrace);
    w.tpm.state.append('deliveries.jsonl', { id: 'old', deliveredAt: T('11:00:09') } satisfies MessageTrace);
    w.tpm.state.append('deliveries.jsonl', { id: 'old', deliveredAt: T('11:00:05'), readAt: T('11:00:06') } satisfies MessageTrace);
    w.tpm.state.append('deliveries.jsonl', { id: 'sent-only', sentAt: T('11:00:00') } satisfies MessageTrace);
    const seen = seenTimes(w.tpm, { live: true });
    expect(seen(sent('old', '11:00:00'))).toEqual({ at: T('11:00:05'), by: 'delivered' });
    expect(seen(sent('sent-only', '11:00:00'))).toEqual({ at: T('11:00:00'), by: 'assumed' });
  });

  test('どの記録にも無い行: 検査用（live）は送った時刻に倒す（受け手の席は、もう残っていない）。記録用は分からない（倒さない）。手元の渡した記録は見ない', () => {
    const w = world();
    expect(seenTimes(w.tpm, { live: true })(sent('gone', '12:00:00'))).toEqual({ at: T('12:00:00'), by: 'assumed' });
    expect(seenTimes(w.tpm, { live: false })(sent('gone', '12:00:00'))).toBeUndefined();
    recordDelivered(w.tpm, 'gone', 't-x7k2', 'wake');
    expect(seenTimes(w.tpm, { live: true })(sent('gone', '12:00:00'))).toEqual({ at: T('12:00:00'), by: 'assumed' });
    // 見せた記録があれば、見せた時刻
    w.tpm.state.write(shownFile('file:1'), [{ id: 'gone', at: T('12:00:30') }]);
    expect(seenTimes(w.tpm, { live: true })(sent('gone', '12:00:00'))).toEqual({ at: T('12:00:30'), by: 'shown' });
    expect(seenTimes(w.tpm, { live: false })(sent('gone', '12:00:00'))).toEqual({ at: T('12:00:30'), by: 'shown' });
  });

  test('届け違いで返した物（returned.jsonl）は、配られていても・見せていても、まだ見ていない（宛先の担当は見ていない。t-4q2b）', () => {
    const w = world();
    w.tpm.state.append('deliveries.jsonl', { id: 'r', deliveredAt: T('12:00:05'), readAt: T('12:00:06') } satisfies MessageTrace);
    w.tpm.state.write(shownFile('file:1'), [{ id: 'r', at: T('12:00:07') }]);
    w.tpm.state.append('returned.jsonl', { at: T('12:00:06'), id: 'r', incident: 1 });
    expect(seenTimes(w.tpm, { live: true })(sent('r', '12:00:00'))).toBeUndefined();
    expect(seenTimes(w.tpm, { live: false })(sent('r', '12:00:00'))).toBeUndefined();
  });

  test('見せた物は、受け手の宛先の shown/ だけで見る', () => {
    const w = world();
    w.tpm.state.write(shownFile('file:1'), [{ id: 'x', at: T('12:00:30') }]);
    expect(seenTimes(w.tpm, { live: true })({ id: 'x', at: T('12:00:00'), to: 'file:2' })).toEqual({ at: T('12:00:00'), by: 'assumed' });
    expect(seenTimes(w.tpm, { live: false })({ id: 'x', at: T('12:00:00'), to: 'file:2' })).toBeUndefined();
  });
});

describe('見た時刻の口（NATS で運んだ行）', () => {
  test('手元の渡した記録だけで決める。古い記録（deliveries.jsonl・shown/・delivered: true）は見ない。記録が無ければ、検査用でも倒さない', () => {
    const w = world();
    const line = { ...sent('n', '12:00:00', { delivered: true }), carrier: 'nats' as const };
    w.tpm.state.append('deliveries.jsonl', { id: 'n', deliveredAt: T('12:00:05') } satisfies MessageTrace);
    w.tpm.state.write(shownFile('file:1'), [{ id: 'n', at: T('12:00:07') }]);
    expect(seenTimes(w.tpm, { live: true })(line)).toBeUndefined();
    w.pass(60_000);
    recordDelivered(w.tpm, 'n', 't-x7k2', 'output');
    expect(seenTimes(w.tpm, { live: true })(line)).toEqual({ at: T('12:01:00'), by: 'shown' });
    w.pass(60_000);
    recordDelivered(w.tpm, 'n', 't-x7k2', 'wake');
    expect(seenTimes(w.tpm, { live: false })(line)).toEqual({ at: T('12:01:00'), by: 'shown' });
  });
});
