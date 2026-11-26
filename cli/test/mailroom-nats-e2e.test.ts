// cli と本物の NATS JetStream のつなぎの試験。$ROSTER_E2E_NATS_URL に動いている NATS の URL がある時だけ流す（CI の nats-e2e.yml）。
// 試験用の口と同じ試験（mailroom-contract.ts）を、本物の時を待って流す。ほかに、NATS の箱の作りに依る事を確かめる。
import { jetstreamManager } from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';
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
  mailroomContract('NATS JetStream', () => ({ open: () => new NatsMailroom(URL, SPACE, SHORT_LIMITS), pass: sleep }), 15_000);

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
  }, 10_000);
});
