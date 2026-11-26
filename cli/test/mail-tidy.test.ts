// TPM 担当の側の片付け（渡せない・期限切れ・席を閉じる・名簿に無い取り口）と、roster inbox の NATS の形の試験。
import { describe, expect, test } from 'vitest';
import { mailPrompt, tidyMail } from '../src/commands/mail.ts';
import { messageRecordsSettled } from '../src/commands/message-record.ts';
import { askTpm, dismiss, notify, reportDone } from '../src/commands/messages.ts';
import { hello, inbox, inboxNow } from '../src/commands/role-side.ts';
import { close } from '../src/commands/tpm-side.ts';
import { deliveredLines, endedLines, readClaim } from '../src/mail.ts';
import { MemoryMailroom } from '../src/mailroom/memory.ts';
import { MAILROOM_LIMITS } from '../src/mailroom/types.ts';
import { ALL, claim, down, left, natsWorld, patched, TPM } from './mail-helpers.ts';

const HOURS = 3_600_000;
const stateOf = (w: { store: { messages: Map<string, { id: string, state: string, via?: string }> } }, id: string): unknown => {
  const m = [...w.store.messages.values()].find(r => r.id === id);
  return m === undefined ? undefined : [m.state, m.via];
};

describe('渡し直しの上限を超えた物（T2）', () => {
  test('TPM 担当の送る命令が、引いて「渡せない」と記録し、置き場に写し、結果に 1 通につき 1 度だけ出す', async () => {
    const w = await natsWorld();
    claim(w, w.se, 200);
    await notify(w.tpm, 't-x7k2', { text: '渡せなくなる物' });
    const id = left(w, 't-x7k2')[0]?.id ?? '';
    const broken = new MemoryMailroom(w.office);
    for (let i = 0; i < MAILROOM_LIMITS.maxDeliveries; i++) {
      await broken.take('t-x7k2', ALL);
      w.pass(MAILROOM_LIMITS.holdMs + 1000);
    }
    await broken.take('t-x7k2', ALL);
    expect(w.printed).toEqual([]);
    await notify(w.tpm, 't-x7k2', { text: '次の知らせ' });
    expect(w.printed).toEqual([`渡せない: 【notify】Technical Program Manager → t-x7k2（2026-11-20T12:00:00.000Z に送った。id ${id}。渡し直しの上限（5 度）を超えた。要る中身なら、送り直す）`]);
    expect(endedLines(w.tpm)).toMatchObject([{ id, to: 't-x7k2', how: 'undeliverable' }]);
    await messageRecordsSettled();
    expect(stateOf(w, id)).toEqual(['undeliverable', 'max-deliveries']);
    expect(left(w, 't-x7k2').map(s => s.text)).toEqual(['【notify】次の知らせ']);
    w.pass(31_000);
    await notify(w.tpm, 't-x7k2', { text: 'その次' });
    expect(w.printed).toHaveLength(1);
    // 済んでいない物の検査は、届かないまま終わった物として挙げる。
    await reportDone(w.se, { kind: 'result', summary: '済んだ', remaining: 'なし', decisions: 'なし', points: [] }).catch(() => undefined);
    await expect(dismiss(w.tpm, 't-x7k2', { handover: false })).rejects.toThrow(/--- 届かないまま終わった（渡せない・期限切れ。/);
  });

  test('担当の命令は片付けない。配りの口が応えなくても、呼んだ命令は止まらない', async () => {
    const w = await natsWorld();
    expect(await tidyMail(w.se, { sweep: true })).toEqual([]);
    expect(await tidyMail(down(w.tpm), { sweep: true })).toEqual([]);
    expect(await notify(down(w.tpm), 't-x7k2', { text: '担当は名乗っていないので cmux で届く' })).toHaveLength(1);
    expect((await hello(down(w.tpm), TPM)).some(l => l.startsWith('TPM 担当の宛先'))).toBe(true);
  });
});

describe('届かないまま期限で消えた物（T3）', () => {
  test('TPM 担当が名乗る時に「期限切れ」と記録し、置き場に写し、1 度だけ出す。届いた物・まだ残っている物は数えない', async () => {
    const w = await natsWorld();
    claim(w, w.se, 200);
    await notify(w.tpm, 't-x7k2', { text: '届く物' });
    await mailPrompt(w.role('t-x7k2', 'file:1'), '{}');
    w.pass(60_000);
    await notify(w.tpm, 't-x7k2', { text: '届かない物' });
    const id = left(w, 't-x7k2')[0]?.id ?? '';
    w.pass(71 * HOURS);
    expect((await hello(w.tpm, TPM)).filter(l => l.startsWith('期限切れ'))).toEqual([]);
    await notify(w.tpm, 't-x7k2', { text: 'まだ残っている物' });
    w.pass(2 * HOURS);
    const lines = (await hello(w.tpm, TPM)).filter(l => l.startsWith('期限切れ'));
    expect(lines).toEqual([`期限切れ: 【notify】Technical Program Manager → t-x7k2（2026-11-20T12:01:00.000Z に送った。id ${id}。届かないまま 72 時間で消えた。要る中身なら、送り直す）`]);
    expect(endedLines(w.tpm).map(l => [l.id, l.how])).toEqual([[id, 'expired']]);
    await messageRecordsSettled();
    expect(stateOf(w, id)).toEqual(['expired', 'ttl']);
    expect((await hello(w.tpm, TPM)).filter(l => l.startsWith('期限切れ'))).toEqual([]);
  });

  test('写しの遅れがある間は判じない。送る命令の時に判じ直すのは、1 時間に 1 度', async () => {
    const w = await natsWorld();
    claim(w, w.se, 200);
    await notify(w.tpm, 't-x7k2', { text: '届かない物' });
    w.pass(73 * HOURS);
    w.procs.add(200, 1, 'claude');
    let reads = 0;
    const counting = async (lag: number) => {
      const room = new MemoryMailroom(w.office);
      return patched({ ...w.tpm, mailroom: () => Promise.resolve(room) }, {
        lag: () => Promise.resolve(lag),
        record: (since) => {
          reads += 1;
          return room.record(since);
        },
      });
    };
    expect(await tidyMail(await counting(2), { sweep: false })).toEqual([]);
    expect(reads).toBe(0);
    expect(await tidyMail(await counting(0), { sweep: false })).toHaveLength(1);
    expect(reads).toBe(1);
    w.pass(HOURS - 1000);
    await tidyMail(await counting(0), { sweep: false });
    expect(reads).toBe(1);
    w.pass(1000);
    await tidyMail(await counting(0), { sweep: false });
    expect(reads).toBe(2);
    // 名乗る時は、いつも判じる。
    await tidyMail(await counting(0), { sweep: true });
    expect(reads).toBe(3);
  });
});

describe('席を閉じる時・名簿に無い取り口（N1）', () => {
  test('roster close は、その受け手の取り口と残りを消し、残っていた物を「期限切れ（席を閉じた）」と記録して写す', async () => {
    const w = await natsWorld();
    claim(w, w.se, 200);
    await notify(w.tpm, 't-x7k2', { text: '閉じる前に届かなかった物' });
    const id = left(w, 't-x7k2')[0]?.id ?? '';
    await (await w.se.mailroom()).counts('t-x7k2');
    expect(w.office.consumers.has('t-x7k2')).toBe(true);
    const out = await close(w.tpm, 't-x7k2');
    expect(out.filter(l => l.startsWith('期限切れ'))).toEqual([`期限切れ（席を閉じた）: 【notify】Technical Program Manager → t-x7k2（2026-11-20T12:00:00.000Z に送った。id ${id}。届かないまま、受け手の取り口を片付けた。要る中身なら、送り直す）`]);
    expect(w.office.work).toEqual([]);
    expect(w.office.consumers.has('t-x7k2')).toBe(false);
    expect(readClaim(w.tpm, 't-x7k2')).toBeUndefined();
    expect(endedLines(w.tpm).map(l => [l.id, l.how])).toEqual([[id, 'closed']]);
    await messageRecordsSettled();
    expect(stateOf(w, id)).toEqual(['expired', 'closed']);
  });

  test('担当の交代（dismiss --handover）の後の close では、残りを消さない。配りの口が応えなくても、close は済む', async () => {
    const w = await natsWorld();
    await reportDone(w.se, { kind: 'result', summary: '済んだ', remaining: 'なし', decisions: 'なし', points: [] });
    await dismiss(w.tpm, 't-x7k2', { handover: true });
    claim(w, w.se, 200);
    await notify(w.tpm, 't-x7k2', { text: '次の担当が継ぐ物' });
    expect((await close(w.tpm, 't-x7k2')).some(l => l.startsWith('期限切れ'))).toBe(false);
    expect(left(w, 't-x7k2')).toHaveLength(1);

    const v = await natsWorld();
    const out = await close(down(v.tpm), 't-x7k2');
    expect(out[0]).toMatch(/^閉じた: /);
    expect(out.some(l => l.startsWith('メッセージキューが応えないので、t-x7k2 の取り口を片付けられなかった'))).toBe(true);
  });

  test('TPM 担当が名乗る時に、名簿に無い受け手の取り口を掃く（名簿の受け手・名乗りが効いている受け手・自分は残す）', async () => {
    const w = await natsWorld();
    claim(w, w.se, 200);
    claim(w, w.tpm, 100);
    const room = await w.tpm.mailroom();
    for (const name of ['t-x7k2', 'tpm', 't-gone__L0']) await room.counts(name);
    await room.put({ id: 'ghost-1', from: 'Technical Program Manager', to: 't-gone__L0', text: '【notify】前の席宛て' });
    const out = await hello(w.tpm, TPM);
    expect(out.filter(l => /取り口|期限切れ/.test(l))).toEqual([
      '期限切れ（席を閉じた）: 【notify】Technical Program Manager → t-gone__L0（2026-11-20T12:00:00.000Z に送った。id ghost-1。届かないまま、受け手の取り口を片付けた。要る中身なら、送り直す）',
      '名簿に無い受け手の取り口を片付けた: t-gone__L0（残っていた物 1 通）',
    ]);
    expect([...w.office.consumers].sort()).toEqual(['t-x7k2', 'tpm']);
  });
});

describe('roster inbox（設定が nats で、名乗っている session）', () => {
  test('自分宛てを出すだけ。取り置かず、届いたにも、見せたにもしない（送る前の検査は、その後も止める）', async () => {
    const w = await natsWorld();
    claim(w, w.se, 200);
    expect(await inboxNow(w.se)).toEqual(['まだ届いていないメッセージは無い']);
    await notify(w.tpm, 't-x7k2', { text: '区切りに見る物' });
    const id = left(w, 't-x7k2')[0]?.id ?? '';
    expect(await inboxNow(w.se)).toEqual([`--- Technical Program Manager（id ${id}）`, '【notify】区切りに見る物', '--- ここまで（出しただけ。届いたとは記録していない。hook が、この後で渡す）']);
    expect(w.office.work.map(i => i.deliveries)).toEqual([0]);
    expect(deliveredLines(w.se)).toEqual([]);
    await expect(askTpm(w.se, { text: '相談', waitingFor: '案' })).rejects.toThrow(/まだ渡っていないメッセージが 1 件/);
    await expect(inboxNow(down(w.se))).rejects.toThrow(/応えません/);
  });

  test('名乗っていない session・設定が cmux の session では、今のとおり', async () => {
    const w = await natsWorld();
    w.wire.hold('file:1');
    await notify(w.tpm, 't-x7k2', { text: 'cmux で待っている物' });
    expect(await inboxNow(w.se)).toEqual(inbox(w.se));
    expect((await inboxNow(w.se))[1]).toBe('【notify】cmux で待っている物');
  });
});
