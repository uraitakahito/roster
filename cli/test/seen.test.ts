import { describe, expect, test } from 'vitest';
import { seenTimes, shownFile } from '../src/seen.ts';
import type { MessageTrace } from '../src/transport/types.ts';
import { world } from './helpers.ts';

const T = (hhmmss: string): string => `2026-11-20T${hhmmss}.000Z`;
const sent = (id: string, at: string, extra: { delivered?: boolean } = {}) => ({ id, at: T(at), to: 'file:1', ...extra });

describe('見た時刻の口', () => {
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
    // d: 前の版が送った時に「届いた」と書いた行
    expect(seen(sent('d', '12:00:40', { delivered: true }))).toEqual({ at: T('12:00:40'), by: 'legacy' });
  });

  test('道具の history() にあれば使い、無くても写し（deliveries.jsonl）にあれば使う（history() の 1,000 件より古い物）', () => {
    const w = world();
    const id = w.wire.send('file:1', 'TPM', '【notify】x').id;
    w.wire.hold('file:1');
    w.wire.release('file:1', T('12:00:09'));
    const held = w.wire.send('file:1', 'TPM', '【notify】y').id;
    w.wire.hold('file:1');
    const late = w.wire.send('file:1', 'TPM', '【notify】z').id;
    w.wire.release('file:1', T('12:00:20'));
    w.tpm.state.append('deliveries.jsonl', { id: 'old', deliveredAt: T('11:00:05') } satisfies MessageTrace);
    const seen = seenTimes(w.tpm, { live: true });
    expect(seen(sent(late, '12:00:10'))).toEqual({ at: T('12:00:20'), by: 'delivered' });
    expect(seen(sent('old', '11:00:00'))).toEqual({ at: T('11:00:05'), by: 'delivered' });
    // 時刻を返さない道具の分（hold していない時に送った物）は、queued に無いので送った時刻に倒す
    expect(seen(sent(id, '12:00:00'))).toEqual({ at: T('12:00:00'), by: 'assumed' });
    expect(seen(sent(held, '12:00:00'))).toEqual({ at: T('12:00:00'), by: 'assumed' });
  });

  test('検査用（live）: 時刻が無く queued にある物はまだ見ていない。記録用: queued を見ず、時刻が無ければ分からない（倒さない）', () => {
    const w = world();
    w.wire.hold('file:1');
    const id = w.wire.send('file:1', 'TPM', '【notify】x').id;
    expect(seenTimes(w.tpm, { live: true })(sent(id, '12:00:00'))).toBeUndefined();
    expect(seenTimes(w.tpm, { live: false })(sent(id, '12:00:00'))).toBeUndefined();
    // queued に無い（道具が時刻を返さない）物も、記録用では倒さない
    expect(seenTimes(w.tpm, { live: false })(sent('gone', '12:00:00'))).toBeUndefined();
    // 見せれば、配られていなくても見た
    w.tpm.state.write(shownFile('file:1'), [{ id, at: T('12:00:30') }]);
    expect(seenTimes(w.tpm, { live: true })(sent(id, '12:00:00'))).toEqual({ at: T('12:00:30'), by: 'shown' });
  });

  test('見せた物は、受け手の宛先の shown/ だけで見る', () => {
    const w = world();
    w.wire.hold('file:2');
    const id = w.wire.send('file:2', 'TPM', '【notify】x').id;
    w.tpm.state.write(shownFile('file:1'), [{ id, at: T('12:00:30') }]);
    expect(seenTimes(w.tpm, { live: true })({ id, at: T('12:00:00'), to: 'file:2' })).toBeUndefined();
  });
});
