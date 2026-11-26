// cli と本物の NATS JetStream のつなぎの試験。$ROSTER_E2E_NATS_URL に動いている NATS の URL がある時だけ流す（CI の nats-e2e.yml）。
// 試験用の口と同じ試験（mailroom-contract.ts）を、本物の時を待って流す。ほかに、NATS の箱の作りに依る事を確かめる。
import { jetstreamManager } from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';
import { createServer, connect as tcp, type Socket } from 'node:net';
import { describe, expect, test } from 'vitest';
import { mailroomContract, SHORT_LIMITS } from './mailroom-contract.ts';
import { NatsMailroom } from '../src/mailroom/nats.ts';

const URL = process.env.ROSTER_E2E_NATS_URL ?? '';
const sleep = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});
/** 試験の回ごとに違う箱の名（前の回の箱と、段取りの値がぶつからないように）。 */
const SPACE = `e2e-${process.pid}-${Date.now()}`;

describe.skipIf(URL === '')('cli と NATS のつなぎ', () => {
  mailroomContract('NATS JetStream', () => {
    const probe = new NatsMailroom(URL, SPACE, SHORT_LIMITS);
    return {
      open: () => new NatsMailroom(URL, SPACE, SHORT_LIMITS),
      // 時を待った後、置いた物が配る箱に写し終わるまで待つ（決まった時間だけに頼らない）。
      pass: async (ms) => {
        await sleep(ms);
        for (let i = 0; i < 50 && await probe.lag() > 0; i++) await sleep(100);
      },
    };
  }, 15_000);

  test('2 つの口が、同時に初めて箱と取り口を作っても、どちらも進む', async () => {
    const space = `${SPACE}-race`;
    const rooms = [1, 2, 3, 4].map(() => new NatsMailroom(URL, space, SHORT_LIMITS));
    expect(await Promise.all(rooms.map(r => r.counts('same')))).toEqual(Array(4).fill({ waiting: 0, held: 0 }));
    await Promise.all(rooms.map(r => r.close()));
  }, 20_000);

  test('NATS との繋ぎが切れても、返す・閉じるは、決めた時間で返る', async () => {
    // 本物の NATS との間に、切れる中継を置く（NATS そのものは止めない）。
    const target = new globalThis.URL(URL.replace(/^nats:/, 'http:'));
    const sockets: Socket[] = [];
    const proxy = createServer((client) => {
      const upstream = tcp(Number(target.port), target.hostname);
      sockets.push(client, upstream);
      client.pipe(upstream).pipe(client);
      for (const s of [client, upstream]) s.on('error', () => undefined);
    });
    await new Promise<void>((resolve) => {
      proxy.listen(0, '127.0.0.1', resolve);
    });
    const port = (proxy.address() as { port: number }).port;
    const y = new NatsMailroom(`nats://127.0.0.1:${port}`, SPACE, SHORT_LIMITS);
    const to = `cut-${Date.now()}`;
    await y.counts(to);
    await y.put({ id: `${to}-a`, from: 'X', to, text: '切れる前に取り置く物' });
    await sleep(300);
    const taken = await y.take(to, { max: 20, chars: 9000 });
    expect(taken).toHaveLength(1);
    for (const s of sockets) s.destroy();
    proxy.close();
    const started = Date.now();
    await y.giveBack(taken);
    await y.close();
    expect(Date.now() - started).toBeLessThan(5000);
    // 切れた口が返せなかった物は、取り置きの期限の後に、ほかの口が取れる。
    const z = new NatsMailroom(URL, SPACE, SHORT_LIMITS);
    await sleep(SHORT_LIMITS.holdMs + 500);
    const again = await z.take(to, { max: 20, chars: 9000 });
    expect(again.map(t => t.id)).toEqual([`${to}-a`]);
    await z.done(again);
    await z.close();
  }, 20_000);

  test('来るまで待つ: 待っている間に置かれた物が、すぐ渡る', async () => {
    const x = new NatsMailroom(URL, SPACE, SHORT_LIMITS);
    const y = new NatsMailroom(URL, SPACE, SHORT_LIMITS);
    const to = `wait-${Date.now()}`;
    await y.counts(to);
    const started = Date.now();
    const waiting = y.wait(to, { max: 20, chars: 9000 }, 10_000);
    await sleep(500);
    await x.put({ id: `${to}-a`, from: 'X', to, text: '待っていた物' });
    const taken = await waiting;
    expect(taken.map(t => t.text)).toEqual(['待っていた物']);
    expect(Date.now() - started).toBeLessThan(3000);
    await y.done(taken);
    // 来なければ、待つ長さの後に空で返る。
    expect(await y.wait(to, { max: 20, chars: 9000 }, 1000)).toEqual([]);
    await x.close();
    await y.close();
  }, 20_000);

  test('配る箱を消して作り直しても、届いた物・古い物は渡り直さない', async () => {
    const space = `${SPACE}-rebuild`;
    const x = new NatsMailroom(URL, space, SHORT_LIMITS);
    const to = 'rebuild';
    await x.counts(to);
    await x.put({ id: 'old-1', from: 'X', to, text: '前に届いた物' });
    await sleep(200);
    await x.done(await x.take(to, { max: 20, chars: 9000 }));
    await x.close();
    // 配る箱だけを消す（volume を替えた・誤って消した時に当たる）。記録の箱は残る。
    const nc = await connect({ servers: URL });
    const jsm = await jetstreamManager(nc);
    await jsm.streams.delete(`roster-${space}-work`);
    await nc.close();
    const y = new NatsMailroom(URL, space, SHORT_LIMITS);
    await sleep(500);
    expect(await y.counts(to)).toEqual({ waiting: 0, held: 0 });
    expect((await y.record(new Date(Date.now() - 60_000))).map(s => s.id)).toEqual(['old-1']);
    await y.put({ id: 'new-1', from: 'X', to, text: '作り直した後の物' });
    await sleep(200);
    const taken = await y.take(to, { max: 20, chars: 9000 });
    expect(taken.map(t => t.id)).toEqual(['new-1']);
    await y.done(taken);
    await y.close();
  }, 20_000);

  test('NATS が応えない時は、置けずに誤りで止まる', async () => {
    const x = new NatsMailroom('nats://127.0.0.1:1', SPACE, SHORT_LIMITS);
    await expect(x.put({ id: 'a', from: 'X', to: 'nobody', text: 't' })).rejects.toThrow(/メッセージキュー.*応えません/);
    // 繋げなかった後も、口は同じ誤りを返す（中途半端に覚えて、別の誤りで落ちない）。
    await expect(x.counts('nobody')).rejects.toThrow(/メッセージキュー.*応えません/);
    await x.close();
  }, 10_000);
});
