// NATS で運んだメッセージの「届いた時刻」（seen.ts）と、置き場の記録への書き足しの試験。
import { describe, expect, test } from 'vitest';
import { mailGate, mailPrompt, mailWait } from '../src/commands/mail.ts';
import { MESSAGE_RECORDS_FILE } from '../src/commands/message-record.ts';
import { askTpm, dismiss, notify, reportDone, type Sent } from '../src/commands/messages.ts';
import { assign } from '../src/commands/tpm-side.ts';
import { recordDelivered } from '../src/mail.ts';
import { seenTimes } from '../src/seen.ts';
import { messageRecordsSettled } from '../src/commands/message-record.ts';
import { claim, left, natsWorld } from './mail-helpers.ts';

const ask = { text: '案 A と B で迷う', waitingFor: '案' };
const done = { kind: 'result' as const, summary: '済んだ', remaining: 'なし', decisions: 'なし', points: [] };

describe('届いた時刻（NATS で運んだ行）', () => {
  test('hook が渡した記録の、いちばん早い時刻に「届いた」。記録が無ければ、まだ届いていない', async () => {
    const w = await natsWorld();
    claim(w, w.se, 200);
    await notify(w.tpm, 't-x7k2', { text: '届くまで' });
    const sent = w.tpm.state.lines<Sent>('log.jsonl').at(-1);
    if (sent === undefined) throw new Error('送った記録が無い');
    expect(seenTimes(w.tpm, { live: true })(sent)).toBeUndefined();
    expect(seenTimes(w.tpm, { live: false })(sent)).toBeUndefined();
    w.pass(60_000);
    await mailPrompt(w.role('t-x7k2', 'file:1'), '{}');
    w.pass(60_000);
    recordDelivered(w.se, sent.id, 't-x7k2', 'wake');
    expect(seenTimes(w.tpm, { live: true })(sent)).toEqual({ at: '2026-11-20T12:01:00.000Z', by: 'delivered' });
    expect(seenTimes(w.tpm, { live: false })(sent)).toEqual({ at: '2026-11-20T12:01:00.000Z', by: 'delivered' });
  });

  test('命令の結果に出した物（output）は、届いたに数えず「見せた」。後で hook が渡せば、届いた時刻も付く', async () => {
    const w = await natsWorld();
    claim(w, w.se, 200);
    await notify(w.tpm, 't-x7k2', { text: 'hook が働かない時' });
    const sent = w.tpm.state.lines<Sent>('log.jsonl').at(-1);
    if (sent === undefined) throw new Error('送った記録が無い');
    await expect(askTpm(w.se, ask)).rejects.toThrow(/まだ渡っていない/);
    w.pass(5000);
    await askTpm(w.se, ask);
    expect(seenTimes(w.tpm, { live: true })(sent)).toEqual({ at: '2026-11-20T12:00:05.000Z', by: 'shown' });
    w.pass(5000);
    expect((await mailWait(w.role('t-x7k2', 'file:1'), '{}', new AbortController().signal)).code).toBe(2);
    expect(seenTimes(w.tpm, { live: true })(sent)).toEqual({ at: '2026-11-20T12:00:05.000Z', by: 'shown' });
    expect(w.tpm.state.lines<{ when: string }>('delivered.jsonl').map(l => l.when)).toEqual(['output', 'wake']);
  });

  test('cmux で運んだ行は、今までどおり連携の道具の時刻で決まる（渡した記録は見ない）', async () => {
    const w = await natsWorld();
    await notify(w.tpm, 't-x7k2', { text: 'cmux で届く' });
    const sent = w.tpm.state.lines<Sent>('log.jsonl').at(-1);
    if (sent === undefined) throw new Error('送った記録が無い');
    recordDelivered(w.se, sent.id, 't-x7k2', 'wake');
    expect(seenTimes(w.tpm, { live: true })(sent)).toEqual({ at: sent.at, by: 'assumed' });
  });

  test('TPM 担当の「済んでいない物」の検査と依頼書の数えは、渡した記録で、今と同じ意味に動く', async () => {
    const w = await natsWorld();
    claim(w, w.se, 200);
    await reportDone(w.se, done);
    await assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: 'https://claude.ai/artifact/b2', wait: 0 });
    expect(left(w, 't-x7k2').map(s => s.text)).toEqual(['【brief】https://claude.ai/artifact/b2']);
    // まだ届いていない依頼書がある: dismiss は止まる。届く前の【done】は、その依頼書の分に数えない。
    await expect(dismiss(w.tpm, 't-x7k2', { handover: false })).rejects.toThrow(/まだ済んでいない物があります[\s\S]*【done】が返っていない依頼書: b2/);
    await expect(reportDone(w.se, { ...done, summary: '行き違い' })).rejects.toThrow(/まだ渡っていない/);
    w.pass(60_000);
    expect(await mailGate(w.role('t-x7k2', 'file:1'), '{}')).toContain('【brief】https://claude.ai/artifact/b2');
    w.pass(60_000);
    await reportDone(w.se, { ...done, summary: '2 つ目も済んだ' });
    expect((await dismiss(w.tpm, 't-x7k2', { handover: false }))[0]).toBe('送った: 【dismiss】→ file:1（相手の手が空いた時に届く。送り直さない）');
  });
});

describe('置き場の記録への書き足し', () => {
  test('hook が渡すと、置き場の記録が delivered になり、届いた時刻・道・回数が入る（送り手は替えない）', async () => {
    const w = await natsWorld({ messages: 'nats' });
    claim(w, w.se, 200);
    await notify(w.tpm, 't-x7k2', { text: '画面に出る物' });
    await messageRecordsSettled();
    const id = left(w, 't-x7k2')[0]?.id ?? '';
    const name = [...w.store.messages.keys()].find(k => k.endsWith(`/${id}`)) ?? '';
    expect(w.store.messages.get(name)).toMatchObject({ state: 'waiting' });
    w.pass(90_000);
    await mailPrompt(w.role('t-x7k2', 'file:1'), '{}');
    await messageRecordsSettled();
    expect(w.store.messages.get(name)).toMatchObject({ id, heading: 'notify', from: 'tpm', to: 't-x7k2', text: '【notify】画面に出る物', state: 'delivered', deliveredAt: '2026-11-20T12:01:30.000Z', via: 'prompt', deliveries: 1 });
    // 受け手の側の書き込みには、送り手の付随する id を付けない。
    expect(w.store.messagePuts.at(-1)?.query).not.toHaveProperty('actorRef');
  });

  test('置き場に写せなくても、渡すのは止めない（写しの記録に 1 行残す）。送った記録に行が無い物も、配りの口の中身から写す', async () => {
    const w = await natsWorld();
    claim(w, w.se, 200);
    await (await w.tpm.mailroom()).put({ id: 'orphan-1', from: 'Technical Program Manager', to: 't-x7k2', text: '【notify】記録の無い 1 通' });
    w.store.down = true;
    expect(await mailPrompt(w.role('t-x7k2', 'file:1'), '{}')).toContain('記録の無い 1 通');
    await messageRecordsSettled();
    expect(w.tpm.state.lines<{ id: string, reason: string }>(MESSAGE_RECORDS_FILE).at(-1)).toMatchObject({ id: 'orphan-1' });
    w.store.down = false;
    await notify(w.tpm, 't-x7k2', { text: '次の 1 通' }).catch(() => undefined);
    await (await w.tpm.mailroom()).put({ id: 'orphan-2', from: 'Technical Program Manager', to: 't-x7k2', text: '【notify】もう 1 通' });
    await mailPrompt(w.role('t-x7k2', 'file:1'), '{}');
    await messageRecordsSettled();
    expect([...w.store.messages.values()].find(m => m.id === 'orphan-2')).toMatchObject({ heading: 'notify', from: 'Technical Program Manager', to: 't-x7k2', state: 'delivered', via: 'prompt' });
  });
});
