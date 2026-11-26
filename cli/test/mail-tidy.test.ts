// TPM 担当の側の片付け（渡せない・期限切れ・席を閉じる・名簿に無い取り口）と、roster inbox の NATS の形の試験。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { mailLeft, mailPrompt, tidyMail } from '../src/commands/mail.ts';
import { messageRecordsSettled } from '../src/commands/message-record.ts';
import { askTpm, dismiss, notify, reportDone, TPM_PARTY, type Sent } from '../src/commands/messages.ts';
import { hello, inboxNow } from '../src/commands/role-side.ts';
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

  test('担当の命令は片付けない。配りの口が応えなくても、片付けは呼んだ命令を止めない（送る命令は、置けないので止まる）', async () => {
    const w = await natsWorld();
    expect(await tidyMail(w.se, { sweep: true })).toEqual([]);
    expect(await tidyMail(down(w.tpm), { sweep: true })).toEqual([]);
    await expect(notify(down(w.tpm), 't-x7k2', { text: '置けない物' })).rejects.toThrow(/^メッセージキューが応えません。送っていません/);
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
    // TPM 担当は渡す hook を持たない（名乗っていない）ので、送る前の検査が【done】を見せて 1 度止まる。打ち直しで送る。
    await expect(dismiss(w.tpm, 't-x7k2', { handover: true })).rejects.toThrow(/まだ読んでいないメッセージが 1 件/);
    await dismiss(w.tpm, 't-x7k2', { handover: true });
    claim(w, w.se, 200);
    await notify(w.tpm, 't-x7k2', { text: '次の担当が継ぐ物' });
    expect((await close(w.tpm, 't-x7k2')).some(l => l.startsWith('期限切れ'))).toBe(false);
    // 【dismiss】と、その後の【notify】（どちらも、次の担当が継ぐ）。
    expect(left(w, 't-x7k2')).toHaveLength(2);

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

describe('起こし直した TPM 担当', () => {
  test('前の TPM 担当宛てで届いていなかった物を受け取る。名乗る時に、自分の取り口は掃かない', async () => {
    const w = await natsWorld();
    const first = { ...w.tpm, env: { ...w.tpm.env, ROSTER_LAUNCH: 'L1' } };
    claim(w, first, 100);
    await askTpm(w.se, { text: '前の TPM 担当に送った相談', waitingFor: '案' });
    expect(left(w, 'tpm')).toHaveLength(1);
    await (await first.mailroom()).counts('tpm');
    // 前の session が落ち、起こした回の違う TPM 担当が起きた。
    w.procs.alive.delete(100);
    const second = { ...w.role('t-x7k2', 'file:tpm'), env: { ...w.tpm.env, ROSTER_LAUNCH: 'L2' } };
    const out = await hello(second, TPM);
    expect(out.filter(l => /取り口|期限切れ/.test(l))).toEqual([]);
    expect(w.office.consumers.has('tpm')).toBe(true);
    expect(left(w, 'tpm')).toHaveLength(1);
    claim(w, second, 300);
    expect(await mailPrompt(second, '{}')).toContain('【ask-tpm】前の TPM 担当に送った相談');
    expect(left(w, 'tpm')).toEqual([]);
    // 前の TPM 担当に宛てた物への返事も、今の TPM 担当の名乗りで道が決まる（担当 → TPM 担当は NATS）。
    await askTpm(w.se, { text: '次の相談', waitingFor: '案' });
    expect(left(w, 'tpm').map(s => s.text)).toEqual(['【ask-tpm】次の相談']);
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

  test('名乗りが効いていない session では、残っている物を出し、見せたと覚える（次の送る前の検査は止まらない。届いたには数えない）', async () => {
    const w = await natsWorld();
    await notify(w.tpm, 't-x7k2', { text: '区切りに見る物' });
    const id = left(w, 't-x7k2')[0]?.id ?? '';
    expect(await inboxNow(w.se)).toEqual([`--- Technical Program Manager（id ${id}）`, '【notify】区切りに見る物', '--- ここまで']);
    // 箱には残る（期限で消える）。渡した記録には output と残る（届いたには数えない）。
    expect(left(w, 't-x7k2').map(m => m.id)).toEqual([id]);
    expect(deliveredLines(w.se)).toMatchObject([{ id, to: 't-x7k2', when: 'output', nth: 0 }]);
    // 見せた物は、もう 1 度は出さない。送る前の検査も止まらない。
    expect(await inboxNow(w.se)).toEqual(['まだ届いていないメッセージは無い']);
    expect((await askTpm(w.se, { text: '相談', waitingFor: '案' }))[0]).toMatch(/^送った: 【ask-tpm】/);
  });
});

describe('roster mail left（NATS に残っている物を見る）', () => {
  test('残っている物を、受け手ごとに数と、見出し・送り手・置いた時刻で出す。取り置かない。取り口が無くても出る', async () => {
    const w = await natsWorld();
    expect(await mailLeft(w.tpm)).toEqual(['メッセージキューに、残っている物は無い']);
    claim(w, w.se, 200);
    claim(w, w.tpm, 100);
    await notify(w.tpm, 't-x7k2', { text: '1 通目' });
    w.pass(60_000);
    await notify(w.tpm, 't-x7k2', { text: '2 通目' });
    await askTpm(w.se, { text: '相談', waitingFor: '案' }).catch(() => undefined);
    const ids = left(w, 't-x7k2').map(s => s.id);
    const expected = [
      't-x7k2: 2 通',
      `- 【notify】Technical Program Manager（2026-11-20T12:00:00.000Z に置いた。id ${ids[0]}）`,
      `- 【notify】Technical Program Manager（2026-11-20T12:01:00.000Z に置いた。id ${ids[1]}）`,
      '中身は、受け手の席の roster inbox か、送った記録（log.jsonl）の同じ id の行で読む',
    ];
    expect(await mailLeft(w.tpm)).toEqual(expected);
    expect(w.office.work.map(i => i.deliveries)).toEqual([0, 0]);
    // 取り口が無くても、送った記録の受け手の名から引ける。
    w.office.consumers.clear();
    expect(await mailLeft(w.tpm)).toEqual(expected);
  });

  test('NATS が応えなければ、そう出す。担当の席からは打てない', async () => {
    const w = await natsWorld();
    expect(await mailLeft(down(w.tpm))).toEqual([expect.stringMatching(/^メッセージキューが応えません（.*）。残りは分かりません$/) as string]);
    await expect(mailLeft(w.se)).rejects.toThrow(/roster mail left は TPM 担当の命令です/);
  });
});

describe('命令の結果に見せた物（渡す hook を持たない session）', () => {
  test('期限を過ぎても、期限切れに数えない（受け手は読んでいる。送り直しを勧めない）', async () => {
    const w = await natsWorld();
    await notify(w.tpm, 't-x7k2', { text: '見せた物' });
    expect((await inboxNow(w.se))[1]).toBe('【notify】見せた物');
    expect(deliveredLines(w.se).map(l => l.when)).toEqual(['output']);
    w.pass(73 * HOURS);
    expect((await hello(w.tpm, TPM)).filter(l => l.startsWith('期限切れ'))).toEqual([]);
    expect(endedLines(w.tpm)).toEqual([]);
  });
});

describe('送った記録の抜け（置いた直後に、送る命令が落ちた）', () => {
  /** 送った記録（log.jsonl）から、その id の行を抜く（置いた後・記録を書く前に落ちた形）。抜いた行を返す。 */
  const drop = (w: { tpm: { state: { dir: string } } }, id: string): Sent => {
    const file = join(w.tpm.state.dir, 'log.jsonl');
    const lines = readFileSync(file, 'utf8').split('\n').filter(l => l !== '');
    const gone = lines.find(l => (JSON.parse(l) as Sent).id === id) ?? '';
    writeFileSync(file, lines.filter(l => l !== gone).map(l => `${l}\n`).join(''));
    return JSON.parse(gone) as Sent;
  };

  test('TPM 担当が名乗る時に、置いた物が持つ行から足し、結果に 1 度だけ出す（足した行は、元の行と同じ。recovered の印が付く）', async () => {
    const w = await natsWorld();
    claim(w, w.se, 200);
    await askTpm(w.se, { text: '置いた直後に落ちた送り', waitingFor: '答え' });
    const id = left(w, 'tpm')[0]?.id ?? '';
    const gone = drop(w, id);
    expect([gone.heading, gone.recipient]).toEqual(['ask-tpm', { key: TPM_PARTY }]);
    // 置かれてすぐは、まだ書いている途中かもしれないので足さない。
    expect((await hello(w.tpm, TPM)).filter(l => l.startsWith('送った記録の抜け'))).toEqual([]);
    w.pass(61_000);
    const lines = (await hello(w.tpm, TPM)).filter(l => l.startsWith('送った記録の抜け'));
    expect(lines).toEqual([`送った記録の抜けを足した: 【ask-tpm】${gone.from} → ${gone.recipient?.key ?? ''}（${gone.at} に送った。id ${id}。送る命令が、置いた直後に落ちていた）`]);
    expect(w.tpm.state.lines<Sent>('log.jsonl').filter(l => l.id === id)).toEqual([{ ...gone, recovered: true }]);
    // 2 度は足さない。
    expect((await hello(w.tpm, TPM)).filter(l => l.startsWith('送った記録の抜け'))).toEqual([]);
    expect(w.tpm.state.lines<Sent>('log.jsonl').filter(l => l.id === id)).toHaveLength(1);
  });

  test('送った記録にある物・行を持たない物（前の版が置いた物）は、足さない', async () => {
    const w = await natsWorld();
    await notify(w.tpm, 't-x7k2', { text: '記録のある物' });
    await (await w.tpm.mailroom()).put({ id: 'old-1', from: 'Technical Program Manager', to: 't-x7k2', text: '【notify】前の版が置いた物', labels: { key: 't-x7k2', heading: 'notify' } });
    await (await w.tpm.mailroom()).put({ id: 'bad-1', from: 'Technical Program Manager', to: 't-x7k2', text: '【notify】行が読めない物', labels: { sent: '{' } });
    const before = w.tpm.state.lines<Sent>('log.jsonl').length;
    w.pass(61_000);
    expect((await hello(w.tpm, TPM)).filter(l => l.startsWith('送った記録の抜け'))).toEqual([]);
    expect(w.tpm.state.lines<Sent>('log.jsonl')).toHaveLength(before);
  });
});
