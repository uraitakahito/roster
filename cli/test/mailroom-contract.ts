// 配りの口（src/mailroom/types.ts の Mailroom）が守る振る舞いの試験。試験用の口（memory.ts）と本物の NATS の口（nats.ts）に、同じ物を流す。
// 2 つが同じ試験を通ることで、ほかの試験が試験用の口で確かめた事が、本物でも成り立つと言える。
import { describe, expect, test } from 'vitest';
import type { Mailroom, MailroomLimits } from '../src/mailroom/types.ts';

/** 試験で使う、短い段取りの値（本物の NATS でも待てる長さ）。 */
export const SHORT_LIMITS: MailroomLimits = {
  holdMs: 1500,
  maxDeliveries: 3,
  // 渡し直しの上限まで待つ試験（取り置きの期限 × 上限）より、十分に長くする（短いと、その試験の途中で物が期限で消える）。
  undeliveredTtlMs: 15_000,
  recordTtlMs: 60_000,
  duplicateWindowMs: 3000,
  maxHeld: 20,
};

/** 試験の 1 つ分の周り。open は、同じ箱を見る新しい口（別の process に当たる）を作る。pass は、時を ms 進める（本物は待つ）。 */
export interface Bench {
  open: () => Mailroom
  pass: (ms: number) => Promise<void>
}

const ALL = { max: 20, chars: 9000 };
let n = 0;
/** 試験ごとに違う受け手の名（本物の NATS では、箱を試験どうしで共有するため）。 */
const someone = (): string => `t-${process.pid}-${Date.now()}-${++n}`;
const letter = (to: string, id: string, text = `本文 ${id}`) => ({ id: `${to}-${id}`, from: 'Technical Program Manager', to, text });

/** 配りの口の試験を、bench が作る口に流す。slow は、本物の時を待つ試験の時間切れ（ミリ秒）。 */
export function mailroomContract(name: string, bench: () => Bench | Promise<Bench>, slow = 5000): void {
  describe(`配りの口の振る舞い（${name}）`, () => {
    test('置くと「残り」に入り、同じ id の置き直しは 1 通のまま', async () => {
      const b = await bench();
      const x = b.open();
      const y = b.open();
      const to = someone();
      expect(await y.counts(to)).toEqual({ waiting: 0, held: 0 });
      expect(await x.put(letter(to, 'a'))).toEqual({ duplicate: false });
      expect(await x.put(letter(to, 'a'))).toEqual({ duplicate: true });
      await b.pass(200);
      expect(await y.counts(to)).toEqual({ waiting: 1, held: 0 });
      await x.close();
      await y.close();
    }, slow);

    test('古い順に取り置け、渡せたと返すと箱から外れる。記録には残る', async () => {
      const b = await bench();
      const x = b.open();
      const y = b.open();
      const to = someone();
      const since = new Date(Date.now() - 1000);
      await y.counts(to);
      await x.put(letter(to, 'a'));
      await x.put({ ...letter(to, 'b'), replyTo: 'r-1' });
      await b.pass(200);
      const taken = await y.take(to, ALL);
      expect(taken.map(t => [t.id, t.from, t.to, t.text, t.deliveries, t.replyTo])).toEqual([
        [`${to}-a`, 'Technical Program Manager', to, '本文 a', 1, undefined],
        [`${to}-b`, 'Technical Program Manager', to, '本文 b', 1, 'r-1'],
      ]);
      expect(await y.counts(to)).toEqual({ waiting: 0, held: 2 });
      await y.done(taken);
      expect(await y.counts(to)).toEqual({ waiting: 0, held: 0 });
      expect([...await y.outstanding()].filter(id => id.startsWith(to))).toEqual([]);
      expect((await y.record(since)).filter(s => s.to === to).map(s => s.id)).toEqual([`${to}-a`, `${to}-b`]);
      await x.close();
      await y.close();
    }, slow);

    test('取り置き中は、ほかの口に渡らない。期限の後に、同じ物が後ろの物より先に、もう 1 度渡る', async () => {
      const b = await bench();
      const x = b.open();
      const first = b.open();
      const second = b.open();
      const to = someone();
      await first.counts(to);
      await x.put(letter(to, 'a'));
      await b.pass(200);
      expect((await first.take(to, { max: 1, chars: 9000 })).map(t => t.id)).toEqual([`${to}-a`]);
      await x.put(letter(to, 'b'));
      await b.pass(200);
      // 口が落ちた形: first は渡せたと返さない。
      expect(await second.counts(to)).toEqual({ waiting: 1, held: 1 });
      await b.pass(SHORT_LIMITS.holdMs + 500);
      const again = await second.take(to, ALL);
      expect(again.map(t => [t.id, t.deliveries])).toEqual([[`${to}-a`, 2], [`${to}-b`, 1]]);
      await second.done(again);
      expect(await second.counts(to)).toEqual({ waiting: 0, held: 0 });
      await expect(second.done([{ ...again[0]!, id: 'nope' }])).rejects.toThrow(/取り置いていない/);
      await x.close();
      await second.close();
    }, slow + SHORT_LIMITS.holdMs);

    test('返した物は、期限を待たずに取り直せる', async () => {
      const b = await bench();
      const x = b.open();
      const y = b.open();
      const to = someone();
      await y.counts(to);
      await x.put(letter(to, 'a'));
      await b.pass(200);
      const taken = await y.take(to, ALL);
      await y.giveBack(taken);
      await b.pass(200);
      const again = await y.take(to, ALL);
      expect(again.map(t => [t.id, t.deliveries])).toEqual([[`${to}-a`, 2]]);
      await y.done(again);
      await x.close();
      await y.close();
    }, slow);

    test('渡し直しの上限を超えた物は渡すのをやめ、引いて片付けられる。後ろの物は届く', async () => {
      const b = await bench();
      const x = b.open();
      const y = b.open();
      const to = someone();
      await y.counts(to);
      await x.put(letter(to, 'bad'));
      await x.put(letter(to, 'good'));
      await b.pass(200);
      for (let i = 1; i <= SHORT_LIMITS.maxDeliveries; i++) {
        expect((await y.take(to, { max: 1, chars: 9000 })).map(t => [t.id, t.deliveries])).toEqual([[`${to}-bad`, i]]);
        await b.pass(SHORT_LIMITS.holdMs + 300);
      }
      const rest = await y.take(to, ALL);
      expect(rest.map(t => t.id)).toEqual([`${to}-good`]);
      await y.done(rest);
      expect(await y.counts(to)).toEqual({ waiting: 0, held: 0 });
      const dead = (await y.undeliverable()).filter(u => u.to === to);
      expect(dead.map(u => [u.deliveries, u.stored?.id, u.stored?.text])).toEqual([[SHORT_LIMITS.maxDeliveries, `${to}-bad`, '本文 bad']]);
      expect((await y.undeliverable()).filter(u => u.to === to)).toEqual([]);
      expect([...await y.outstanding()].filter(id => id.startsWith(to))).toEqual([]);
      await x.close();
      await y.close();
    }, slow + (SHORT_LIMITS.holdMs + 300) * SHORT_LIMITS.maxDeliveries);

    test('上限まで渡した物は、取りに行くまで「取り置き中」に数えられ、取りに行った時に外れて、引けるようになる', async () => {
      // 送る前の検査は、この「取り置き中」の数で止めるかを決める。取りに行かなければ数は減らないので、検査の後には必ず取りに行く。
      const b = await bench();
      const x = b.open();
      const y = b.open();
      const to = someone();
      await y.counts(to);
      await x.put(letter(to, 'bad'));
      await b.pass(200);
      // 同じ口が、自分の取り置きの期限が切れた物を取り直せる。
      for (let i = 1; i <= SHORT_LIMITS.maxDeliveries; i++) {
        expect((await y.take(to, ALL)).map(t => t.deliveries)).toEqual([i]);
        await b.pass(SHORT_LIMITS.holdMs + 300);
      }
      expect(await y.counts(to)).toEqual({ waiting: 0, held: 1 });
      expect((await y.undeliverable()).filter(u => u.to === to)).toEqual([]);
      expect(await y.take(to, ALL)).toEqual([]);
      expect(await y.counts(to)).toEqual({ waiting: 0, held: 0 });
      expect((await y.undeliverable()).filter(u => u.to === to).map(u => u.stored?.id)).toEqual([`${to}-bad`]);
      await x.close();
      await y.close();
    }, slow + (SHORT_LIMITS.holdMs + 300) * SHORT_LIMITS.maxDeliveries + 2000);

    test('1 つの口で 2 人の受け手を扱っても、片方の取り置きが、もう片方の取り直しを妨げない', async () => {
      const b = await bench();
      const x = b.open();
      const y = b.open();
      const a = someone();
      const c = someone();
      await y.counts(a);
      await y.counts(c);
      await x.put(letter(a, 'a1'));
      await x.put(letter(c, 'c1'));
      await b.pass(200);
      const heldA = await y.take(a, ALL);
      expect(heldA.map(t => t.id)).toEqual([`${a}-a1`]);
      // c の物を取って返す。a の物を取り置いたままでも、c の物はすぐ取り直せる。
      await y.giveBack(await y.take(c, ALL));
      await b.pass(200);
      const again = await y.take(c, ALL);
      expect(again.map(t => [t.id, t.deliveries])).toEqual([[`${c}-c1`, 2]]);
      await y.done([...heldA, ...again]);
      expect(await y.counts(a)).toEqual({ waiting: 0, held: 0 });
      expect(await y.counts(c)).toEqual({ waiting: 0, held: 0 });
      await x.close();
      await y.close();
    }, slow);

    test('重なり除けの窓を過ぎた置き直しは、2 通になる。受け手の名に使えない字は断る', async () => {
      const b = await bench();
      const x = b.open();
      const y = b.open();
      const to = someone();
      await y.counts(to);
      await x.put(letter(to, 'a'));
      await b.pass(SHORT_LIMITS.duplicateWindowMs + 1500);
      expect(await x.put(letter(to, 'a'))).toEqual({ duplicate: false });
      await b.pass(200);
      const taken = await y.take(to, ALL);
      expect(taken.map(t => t.id)).toEqual([`${to}-a`, `${to}-a`]);
      // 預かった時刻は、記録の箱と配る箱で同じ。
      const at = (await y.record(new Date(Date.now() - 60_000))).filter(s => s.to === to).map(s => s.at);
      expect(taken.map(t => t.at)).toEqual(at);
      await y.done(taken.slice(0, 1));
      await y.giveBack(taken.slice(1));
      await expect(x.put({ id: 'x', from: 'X', to: 'a.b', text: 't' })).rejects.toThrow(/受け手の名に使えない字/);
      await expect(y.counts('a b')).rejects.toThrow(/受け手の名に使えない字/);
      await x.close();
      await y.close();
    }, slow + SHORT_LIMITS.duplicateWindowMs + 1500);

    test('届かないまま期限を過ぎた物は、配る箱から消える。記録には残る', async () => {
      const b = await bench();
      const x = b.open();
      const y = b.open();
      const to = someone();
      const since = new Date(Date.now() - 1000);
      await y.counts(to);
      await x.put(letter(to, 'a'));
      await b.pass(200);
      expect([...await y.outstanding()].filter(id => id.startsWith(to))).toEqual([`${to}-a`]);
      await b.pass(SHORT_LIMITS.undeliveredTtlMs + 1500);
      expect(await y.counts(to)).toEqual({ waiting: 0, held: 0 });
      expect(await y.take(to, ALL)).toEqual([]);
      expect([...await y.outstanding()].filter(id => id.startsWith(to))).toEqual([]);
      expect((await y.record(since)).filter(s => s.to === to).map(s => s.id)).toEqual([`${to}-a`]);
      await x.close();
      await y.close();
    }, slow + SHORT_LIMITS.undeliveredTtlMs + 1500);

    test('1 度に取るのは、字の上限まで。入りきらない物は次の回の頭で取れる', async () => {
      const b = await bench();
      const x = b.open();
      const y = b.open();
      const to = someone();
      await y.counts(to);
      for (const id of ['a', 'b', 'c']) await x.put(letter(to, id, 'あ'.repeat(40)));
      await b.pass(200);
      const one = await y.take(to, { max: 20, chars: 100 });
      expect(one.map(t => t.id)).toEqual([`${to}-a`, `${to}-b`]);
      await y.done(one);
      await b.pass(200);
      const two = await y.take(to, { max: 20, chars: 100 });
      expect(two.map(t => t.id)).toEqual([`${to}-c`]);
      await y.done(two);
      // 頭の 1 通は、上限を超えていても取る（取れない物を作らない）。
      await x.put(letter(to, 'long', 'あ'.repeat(300)));
      await b.pass(200);
      const long = await y.take(to, { max: 20, chars: 100 });
      expect(long.map(t => t.text.length)).toEqual([300]);
      await y.done(long);
      await x.close();
      await y.close();
    }, slow);

    test('受け手を片付けると、取り口と残りが消え、残っていた物が返る', async () => {
      const b = await bench();
      const x = b.open();
      const y = b.open();
      const to = someone();
      await y.counts(to);
      expect(await y.recipients()).toContain(to);
      await x.put(letter(to, 'a'));
      await b.pass(200);
      expect((await y.clear(to)).map(s => s.id)).toEqual([`${to}-a`]);
      expect(await y.recipients()).not.toContain(to);
      expect(await y.counts(to)).toEqual({ waiting: 0, held: 0 });
      expect(await y.lag()).toBe(0);
      await x.close();
      await y.close();
    }, slow);
  });
}
