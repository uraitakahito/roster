// 送る所（deliver）と送る前の検査（assertRead）の、NATS の形の試験（設定の messages が nats）。hook が渡す所は mail-hooks.test.ts。
import { describe, expect, test } from 'vitest';
import { answer, askTpm, assertRead, notify, type Sent } from '../src/commands/messages.ts';
import { assign } from '../src/commands/tpm-side.ts';
import { hello } from '../src/commands/role-side.ts';
import { deliveredLines, gateFile, passedIds, recordDelivered, type GateMark } from '../src/mail.ts';
import { MAILROOM_LIMITS } from '../src/mailroom/types.ts';
import { MemoryMailroom } from '../src/mailroom/memory.ts';
import { BRIEF } from './helpers.ts';
import { ALL, claim, down, left, natsWorld, patched, FROM_SE, FROM_TPM } from './mail-helpers.ts';

const log = (w: { tpm: { state: { lines: <T>(name: string) => T[] } } }): Sent[] => w.tpm.state.lines<Sent>('log.jsonl');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ask = { text: '案 A と B で迷う', waitingFor: '案' };

describe('送り分け（名乗った受け手には NATS、名乗っていない受け手には cmux）', () => {
  test('受け手の名乗りが効いていれば、配りの口に置き、cmux では送らない。記録に運んだ道を残し、置き場の記録は waiting', async () => {
    const w = await natsWorld();
    claim(w, w.se, 200);
    const before = w.wire.inbox('file:1').length;
    expect(await notify(w.tpm, 't-x7k2', { text: 'A で進める' })).toEqual(['送った: 【notify】→ file:1（相手の手が空いた時に届く。送り直さない）']);
    expect(w.wire.inbox('file:1')).toHaveLength(before);
    const sent = log(w).at(-1);
    expect(sent).toMatchObject({ heading: 'notify', from: FROM_TPM, to: 'file:1', text: '【notify】A で進める', carrier: 'nats', box: 't-x7k2', sender: { key: 'tpm' }, recipient: { key: 't-x7k2' } });
    expect(sent?.id).toMatch(UUID);
    expect(left(w, 't-x7k2')).toEqual([{ id: sent?.id, from: FROM_TPM, to: 't-x7k2', text: '【notify】A で進める', at: '2026-11-20T12:00:00.000Z' }]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect([...w.store.messages.values()].at(-1)).toMatchObject({ id: sent?.id, state: 'waiting', from: 'tpm', to: 't-x7k2' });
  });

  test('受け手が名乗っていない・名乗りが効いていない時は、今のとおり cmux で送る（置き場の記録は carried）', async () => {
    const w = await natsWorld();
    await notify(w.tpm, 't-x7k2', { text: '1 通目' });
    expect(w.wire.inbox('file:1').at(-1)?.text).toBe('【notify】1 通目');
    expect(log(w).at(-1)?.carrier).toBeUndefined();
    claim(w, w.se, 200);
    w.procs.alive.delete(200);
    await notify(w.tpm, 't-x7k2', { text: '2 通目' });
    expect(w.wire.inbox('file:1').at(-1)?.text).toBe('【notify】2 通目');
    expect(w.office.work).toEqual([]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect([...w.store.messages.values()].at(-1)).toMatchObject({ state: 'carried' });
  });

  test('設定が cmux なら、名乗りが書いてあっても cmux で送り、検査も今の形', async () => {
    const w = await natsWorld({});
    claim(w, w.se, 200);
    claim(w, w.tpm, 100);
    w.wire.hold('file:1');
    await notify(w.tpm, 't-x7k2', { text: 'cmux で' });
    expect(w.wire.inbox('file:1').at(-1)?.text).toBe('【notify】cmux で');
    expect(w.office.work).toEqual([]);
    // 今の検査: 本文を出して 1 度止まる。
    await expect(askTpm(w.se, ask)).rejects.toThrow(/まだ読んでいないメッセージが \d 件あります。送っていません。\n--- Technical Program Manager/);
  });

  test('担当から TPM 担当へも、TPM 担当が名乗っていれば NATS（受け手の名は、TPM 担当は tpm）', async () => {
    const w = await natsWorld();
    claim(w, w.tpm, 100);
    const before = w.wire.inbox('file:tpm').length;
    await askTpm(w.se, ask);
    expect(w.wire.inbox('file:tpm')).toHaveLength(before);
    expect(left(w, 'tpm').map(s => [s.from, s.text])).toEqual([[FROM_SE, '【ask-tpm】案 A と B で迷う']]);
    expect(log(w).at(-1)).toMatchObject({ carrier: 'nats', box: 'tpm' });
  });

  test('返事（--reply-to）は、元のメッセージの送り手の箱に置く。cmux で返す先が NATS の物なら、cmux には返事の形を付けない', async () => {
    const w = await natsWorld();
    claim(w, w.tpm, 100);
    await askTpm(w.se, ask);
    const asked = log(w).at(-1);
    // 担当は名乗っていない: TPM 担当の返事は cmux で届く。元の id は cmux の知らない id なので、返事の形は付けない。
    await answer(w.tpm, 't-x7k2', { text: 'A', replyTo: asked?.id ?? '' }).catch(() => undefined);
    await w.tpm.mailroom().then(async room => room.done(await room.take('tpm', ALL)));
    await answer(w.tpm, 't-x7k2', { text: 'A', replyTo: asked?.id ?? '' });
    expect(w.wire.inbox('file:1').at(-1)).toMatchObject({ text: '【answer】A' });
    expect(w.wire.inbox('file:1').at(-1)?.replyTo).toBeUndefined();
    expect(log(w).at(-1)).toMatchObject({ heading: 'answer', replyTo: asked?.id });
    expect(log(w).at(-1)?.carrier).toBeUndefined();
    // 担当が名乗った後の返事は、元の送り手（担当）の箱に、返事の先を付けて置く。
    claim(w, w.se, 200);
    await notify(w.tpm, 't-x7k2', { text: '補足', replyTo: asked?.id ?? '' });
    expect(left(w, 't-x7k2').map(s => [s.text, s.replyTo])).toEqual([['【notify】補足', asked?.id]]);
  });

  test('NATS で送る本文が 8,000 字を超える時は、送らずに誤り（cmux の道では止めない）', async () => {
    const w = await natsWorld();
    const long = 'あ'.repeat(8000);
    await notify(w.tpm, 't-x7k2', { text: long });
    claim(w, w.se, 200);
    const lines = log(w).length;
    await expect(notify(w.tpm, 't-x7k2', { text: `${long}い` })).rejects.toThrow(/本文が長すぎます（8009 字。.*長い本文はページに書いて（roster page put）、URL を送ってください。送っていません/);
    expect(w.office.work).toEqual([]);
    expect(log(w)).toHaveLength(lines);
    // 見出しを合わせて 8,000 字なら送れる（字は符号位置で数える）。
    await notify(w.tpm, 't-x7k2', { text: '𠮷'.repeat(8000 - '【notify】'.length) });
    expect(left(w, 't-x7k2')).toHaveLength(1);
  });

  test('配りの口が誤りの時は「メッセージキューが応えません。送っていません」で止まり、居場所の状態に出す', async () => {
    const w = await natsWorld();
    claim(w, w.se, 200);
    const lines = log(w).length;
    await expect(notify(down(w.tpm), 't-x7k2', { text: '届かない' })).rejects.toThrow(/メッセージキューが応えません。送っていません/);
    expect(w.wire.status('file:tpm')?.wait).toBe('メッセージキューが応えません');
    expect(log(w)).toHaveLength(lines);
    expect(w.wire.inbox('file:1').some(m => m.text.includes('届かない'))).toBe(false);
    expect(w.tpm.state.lines<{ gate: string }>('gate.jsonl').at(-1)?.gate).toBe('queue');
  });
});

describe('送る前の検査（自分が名乗っている session）', () => {
  /** 担当が名乗り、TPM 担当からの 1 通が配りの口に残っている世界。 */
  const waiting = async () => {
    const w = await natsWorld();
    claim(w, w.se, 200);
    await notify(w.tpm, 't-x7k2', { text: '先に読んでほしい事' });
    return w;
  };

  test('自分宛てが残っていれば止める。本文は出さず、見出しと送り手を並べ、止めた事を印と gate.jsonl に残す', async () => {
    const w = await waiting();
    const id = left(w, 't-x7k2')[0]?.id ?? '';
    const stopped = await askTpm(w.se, ask).catch((e: unknown) => (e as Error).message);
    expect(stopped).toBe('相手から、まだ渡っていないメッセージが 1 件あります（【notify】Technical Program Manager）。送っていません。\nこの後すぐ、hook が本文を渡します。渡された物を読んでから、同じ命令を打ち直せば送ります（事情が変わっていたら、中身を変えて打つ）。');
    expect(stopped).not.toContain('先に読んでほしい事');
    expect(w.printed).toEqual([]);
    expect(w.se.state.read<GateMark>(gateFile('t-x7k2'))).toEqual({ at: '2026-11-20T12:00:00.000Z', ids: [id], reason: '送る前の検査が止めた: 相手から、まだ渡っていないメッセージが 1 件あった（送っていません）' });
    expect(w.se.state.lines<{ gate: string, detail: string }>('gate.jsonl').at(-1)).toMatchObject({ gate: 'unread', detail: id });
    expect(log(w).at(-1)?.heading).toBe('notify');
    // 取り置いても、渡した回数に数えてもいない。
    expect(await (await w.se.mailroom()).counts('t-x7k2')).toEqual({ waiting: 1, held: 0 });
    // ページを置く命令の検査は、字が替わる。
    w.se.state.remove(gateFile('t-x7k2'));
    await expect(assertRead(w.se, '相手', undefined, 'put')).rejects.toThrow(/ページを置いていません。\n.*同じ命令を打ち直せば置きます/);
  });

  test('自分宛てが無ければ通す。自分が送って相手にまだ渡っていない物では止まらない', async () => {
    const w = await natsWorld();
    claim(w, w.se, 200);
    claim(w, w.tpm, 100);
    await askTpm(w.se, ask);
    await askTpm(w.se, { text: '2 通目', waitingFor: '案' });
    expect(left(w, 'tpm')).toHaveLength(2);
  });

  test('T8 (a): 止めた後の打ち直しで、取り置き中の物がある間は、何度打ち直しても通らない。渡せたと返った後は通る', async () => {
    const w = await waiting();
    await expect(askTpm(w.se, ask)).rejects.toThrow(/まだ渡っていない/);
    // hook が取り置いた所（まだ「渡せた」を返していない）。
    const hook = new MemoryMailroom(w.office);
    const taken = await hook.take('t-x7k2', ALL);
    for (let i = 0; i < 3; i++) {
      await expect(askTpm(w.se, ask)).rejects.toThrow('相手からのメッセージ 1 件を、渡している途中です。送っていません。長くて 30 秒待って、同じ命令を打ち直してください');
    }
    expect(w.printed).toEqual([]);
    await hook.done(taken);
    expect(await askTpm(w.se, ask)).toContain('送った: 【ask-tpm】→ file:tpm（相手の手が空いた時に届く。送り直さない）');
    expect(w.se.state.read(gateFile('t-x7k2'))).toBeUndefined();
  });

  test('T8 (b): 止めた後の打ち直しで、取り置き中が無ければ、本文を命令の結果に出して通す。届いたとは記録せず、配りの口にも残す', async () => {
    const w = await waiting();
    const id = left(w, 't-x7k2')[0]?.id ?? '';
    await expect(askTpm(w.se, ask)).rejects.toThrow(/まだ渡っていない/);
    expect(await askTpm(w.se, ask)).toContain('送った: 【ask-tpm】→ file:tpm（相手の手が空いた時に届く。送り直さない）');
    expect(w.printed).toEqual([
      '相手から、まだ渡っていないメッセージが 1 件あります。渡す hook が働いていないようなので、ここに出します（届いたとは記録しません）。読んだうえで進めてください。',
      `--- Technical Program Manager（id ${id}）`,
      '【notify】先に読んでほしい事',
      '--- ここまで',
    ]);
    expect(deliveredLines(w.se)).toEqual([{ at: '2026-11-20T12:00:00.000Z', id, to: 't-x7k2', when: 'output', nth: 0 }]);
    expect(left(w, 't-x7k2').map(s => s.id)).toEqual([id]);
    expect(w.se.state.read(gateFile('t-x7k2'))).toBeUndefined();
    // 「検査では止めない」の印: 次の送りでは、同じ 1 通で止まらない（出しもしない）。
    expect([...passedIds(w.se, 't-x7k2')]).toEqual([id]);
    w.pass(31_000);
    await askTpm(w.se, { text: '次の相談', waitingFor: '案' });
    expect(w.printed).toHaveLength(4);
    // 新しく来た物では、また止まる（印の付いた物は、数えも並べもしない）。
    await notify(w.tpm, 't-x7k2', { text: '新しい知らせ' });
    w.pass(31_000);
    await expect(askTpm(w.se, { text: '3 つ目', waitingFor: '案' })).rejects.toThrow(/まだ渡っていないメッセージが 1 件あります（【notify】Technical Program Manager）/);
  });

  test('送り手で絞る: TPM 担当が担当に送る時は、その担当からの物だけで止まる', async () => {
    const w = await natsWorld();
    claim(w, w.tpm, 100);
    await assign(w.tpm, 't-y9z1', { role: 'software-engineer', title: '別の課題', brief: BRIEF, wait: 0 });
    await hello(w.role('t-y9z1', 'file:2'));
    await askTpm(w.se, ask);
    expect(await notify(w.tpm, 't-y9z1', { text: '別の担当へ' })).toHaveLength(1);
    await expect(notify(w.tpm, 't-x7k2', { text: '同じ担当へ' })).rejects.toThrow(/^t-x7k2 の担当から、まだ渡っていないメッセージが 1 件あります（【ask-tpm】SWE t-x7k2: 計画と実装）。送っていません。/);
    // 別の担当への送りは、止めた印を消さない（印の物は、まだ残っている）。
    await notify(w.tpm, 't-y9z1', { text: '別の担当へ、もう 1 通' });
    expect(w.tpm.state.read(gateFile('tpm'))).toBeDefined();
  });

  test('渡し直しの上限を超えた物しか残っていない時は、止めない（片付けるのは TPM 担当の命令）', async () => {
    const w = await waiting();
    const hook = new MemoryMailroom(w.office);
    for (let i = 0; i < MAILROOM_LIMITS.maxDeliveries; i++) {
      await hook.take('t-x7k2', ALL);
      w.pass(MAILROOM_LIMITS.holdMs + 1000);
    }
    await hook.take('t-x7k2', ALL);
    expect(left(w, 't-x7k2')).toHaveLength(1);
    expect(await askTpm(w.se, ask)).toHaveLength(2);
  });

  test('N4: 写しの遅れが、長くて 2 秒待っても残れば「写しが遅れている。送っていません」で止め、居場所の状態に出す', async () => {
    const w = await waiting();
    const slept = w.slept();
    let lag = 3;
    const late = await patched(w.se, { lag: () => Promise.resolve(lag) });
    await expect(askTpm(late, ask)).rejects.toThrow('メッセージキューの写しが遅れています（まだ写されていない物が 3 通）。送っていません。少し待って、同じ命令を打ち直してください');
    expect(w.slept() - slept).toBe(20);
    expect(w.wire.status('file:1')?.wait).toBe('メッセージキューの写しが遅れています');
    expect(w.se.state.read(gateFile('t-x7k2'))).toBeUndefined();
    // 待つ間に追いつけば、続けて検査する。
    const catching = await patched(w.se, { lag: () => Promise.resolve(lag--) });
    await expect(askTpm(catching, ask)).rejects.toThrow(/まだ渡っていないメッセージが 1 件/);
  });

  test('検査の時に配りの口が誤りなら「メッセージキューが応えません。送っていません」で止め、居場所の状態に出す', async () => {
    const w = await waiting();
    await expect(askTpm(down(w.se), ask)).rejects.toThrow(/メッセージキューが応えません。送っていません/);
    expect(w.wire.status('file:1')?.wait).toBe('メッセージキューが応えません');
    await expect(assertRead(down(w.se), '相手', undefined, 'put')).rejects.toThrow(/メッセージキューが応えません。ページを置いていません/);
  });

  describe('hook が渡した直後の送り（1 度の返答で並べた命令）', () => {
    /** 担当が名乗り、hook が 1 通を渡した所（配りの口には、もう残っていない）。 */
    const handed = async (when: 'gate' | 'prompt' | 'wake' | 'output', session?: string, to = 't-x7k2') => {
      const w = await natsWorld();
      claim(w, w.se, 200);
      recordDelivered(w.se, 'm-1', to, when, undefined, session);
      return w;
    };

    test('渡した記録から 2 秒の内の送りは、1 度止める。本文は出さず、印も書かず、gate.jsonl に fresh と残す。2 秒を過ぎれば通る', async () => {
      for (const when of ['gate', 'prompt', 'wake'] as const) {
        const w = await handed(when, 's-200');
        w.pass(1000);
        await expect(askTpm(w.se, ask)).rejects.toThrow('直前に、hook がメッセージを渡しました（1 件）。渡された物を読んでから、同じ命令を打ち直してください（送っていません）');
        expect(w.printed).toEqual([]);
        expect(w.se.state.read(gateFile('t-x7k2'))).toBeUndefined();
        expect(w.se.state.lines<{ gate: string, detail: string }>('gate.jsonl').at(-1)).toMatchObject({ gate: 'fresh', detail: 'm-1' });
        expect(log(w).some(l => l.heading === 'ask-tpm')).toBe(false);
        // ページを置く命令の検査は、字が替わる。配りの口が応えなくても、この止まりは出る（配りの口に聞かない）。
        await expect(assertRead(down(w.se), '相手', undefined, 'put')).rejects.toThrow(/直前に、hook がメッセージを渡しました（1 件）。.*（ページを置いていません）/);
        w.pass(2000);
        expect(await askTpm(w.se, ask)).toHaveLength(2);
      }
    });

    test('命令の結果に出した記録（output）・別の session の記録・別の受け手の記録では、止まらない', async () => {
      for (const w of [await handed('output', 's-200'), await handed('gate', 's-other'), await handed('gate', 's-200', 'tpm')]) {
        w.pass(1000);
        expect(await askTpm(w.se, ask)).toHaveLength(2);
      }
      // session の id の分からない記録は、同じ session の物と見る。
      const w = await handed('gate');
      w.pass(1000);
      await expect(askTpm(w.se, ask)).rejects.toThrow(/直前に、hook がメッセージを渡しました/);
    });

    test('設定が cmux の時は、この検査を通らない', async () => {
      const w = await natsWorld({});
      claim(w, w.se, 200);
      recordDelivered(w.se, 'm-1', 't-x7k2', 'gate', undefined, 's-200');
      w.pass(1000);
      expect(await askTpm(w.se, ask)).toHaveLength(2);
    });
  });
});
