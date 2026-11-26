// 送る所（deliver）と送る前の検査（assertRead）の試験（置かれた物は、試験が hook の命令を呼ぶまで配りの口に残る世界）。hook が渡す所は mail-hooks.test.ts。
import { describe, expect, test } from 'vitest';
import { answer, askDevops, askTpm, assertRead, dismiss, notify, reportDone, reportIncident, type Sent } from '../src/commands/messages.ts';
import { assign } from '../src/commands/tpm-side.ts';
import { hello } from '../src/commands/role-side.ts';
import { deliveredLines, gateFile, passedIds, recordDelivered, type GateMark } from '../src/mail.ts';
import { MAILROOM_LIMITS } from '../src/mailroom/types.ts';
import { readIncidents } from '../src/incidents.ts';
import { readShown, seenTimes } from '../src/seen.ts';
import { MemoryMailroom } from '../src/mailroom/memory.ts';
import { BRIEF, world } from './helpers.ts';
import { ALL, claim, down, handed, left, natsWorld, patched, TPM, FROM_SE, FROM_TPM } from './mail-helpers.ts';

const log = (w: { tpm: { state: { lines: <T>(name: string) => T[] } } }): Sent[] => w.tpm.state.lines<Sent>('log.jsonl');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ask = { text: '案 A と B で迷う', waitingFor: '案' };

describe('送る所（いつも配りの口に置く）', () => {
  test('配りの口の、受け手の名の箱に置く。記録に運んだ道を残し、置き場の記録は waiting', async () => {
    const w = await natsWorld();
    claim(w, w.se, 200);
    expect(await notify(w.tpm, 't-x7k2', { text: 'A で進める' })).toEqual(['送った: 【notify】→ file:1（相手の手が空いた時に届く。送り直さない）']);
    const sent = log(w).at(-1);
    expect(sent).toMatchObject({ heading: 'notify', from: FROM_TPM, to: 'file:1', text: '【notify】A で進める', carrier: 'nats', box: 't-x7k2', sender: { key: 'tpm' }, recipient: { key: 't-x7k2' } });
    expect(sent?.id).toMatch(UUID);
    expect(left(w, 't-x7k2')).toEqual([{ id: sent?.id, from: FROM_TPM, to: 't-x7k2', text: '【notify】A で進める', at: '2026-11-20T12:00:00.000Z', labels: { key: 't-x7k2', heading: 'notify', from: 'tpm', to: 't-x7k2', at: '2026-11-20T12:00:00.000Z', sent: expect.any(String) as string } }]);
    // 置く物は、送った記録の行（本文と id のほか）も持つ（置いた直後に落ちた時に、TPM 担当の側の片付けが足す）。
    expect({ ...JSON.parse(left(w, 't-x7k2')[0]?.labels?.sent ?? '{}') as object, text: sent?.text, id: sent?.id }).toEqual(sent);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect([...w.store.messages.values()].at(-1)).toMatchObject({ id: sent?.id, state: 'waiting', from: 'tpm', to: 't-x7k2' });
  });

  test('受け手が名乗っていない・名乗りが効いていない時も、配りの口に置く（連携の道具でメッセージを送る口は無い）', async () => {
    const w = await natsWorld();
    // 周りに、メッセージの口は無い（居場所の口だけ）。
    expect('messages' in w.tpm).toBe(false);
    await notify(w.tpm, 't-x7k2', { text: '1 通目' });
    expect(left(w, 't-x7k2').map(m => m.text)).toEqual(['【notify】1 通目']);
    expect(log(w).at(-1)).toMatchObject({ carrier: 'nats', box: 't-x7k2', recipient: { key: 't-x7k2' } });
    claim(w, w.se, 200);
    w.procs.alive.delete(200);
    await notify(w.tpm, 't-x7k2', { text: '2 通目' });
    expect(left(w, 't-x7k2').map(m => m.text)).toEqual(['【notify】1 通目', '【notify】2 通目']);
    expect(log(w).at(-1)).toMatchObject({ carrier: 'nats', box: 't-x7k2' });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect([...w.store.messages.values()].at(-1)).toMatchObject({ state: 'waiting' });
    // 連携の道具（file）には、居場所と状態のほかは何も書かれない。
    expect(w.tpm.state.list('file-transport/inbox')).toEqual([]);
  });

  test('担当から TPM 担当へも同じ（受け手の名は、TPM 担当は tpm）', async () => {
    const w = await natsWorld();
    await askTpm(w.se, ask);
    expect(left(w, 'tpm').map(s => [s.from, s.text])).toEqual([[FROM_SE, '【ask-tpm】案 A と B で迷う']]);
    expect(log(w).at(-1)).toMatchObject({ carrier: 'nats', box: 'tpm' });
  });

  test('返事（--reply-to）でも、届く担当は名指した担当のまま。その箱に、返事の先を付けて置く', async () => {
    const w = await natsWorld();
    await askTpm(w.se, ask);
    const asked = log(w).at(-1);
    await handed(w.tpm);
    await answer(w.tpm, 't-x7k2', { text: 'A', replyTo: asked?.id ?? '' });
    expect(log(w).at(-1)).toMatchObject({ heading: 'answer', replyTo: asked?.id, carrier: 'nats', box: 't-x7k2', recipient: { key: 't-x7k2' } });
    w.pass(60_000);
    await notify(w.tpm, 't-x7k2', { text: '補足', replyTo: asked?.id ?? '' });
    expect(left(w, 't-x7k2').map(s => [s.text, s.replyTo])).toEqual([['【answer】A', asked?.id], ['【notify】補足', asked?.id]]);
    // 記録に無い id への返事でも、名指した担当の箱に置く。
    await notify(w.tpm, 't-x7k2', { text: '人への返事', replyTo: 'not-in-log' });
    expect(left(w, 't-x7k2').at(-1)).toMatchObject({ to: 't-x7k2', replyTo: 'not-in-log' });
  });

  test('受け手の名が作れない組（長い）は、置かずに誤り（送っていない）', async () => {
    const w = await natsWorld();
    const long = 'k'.repeat(65);
    await assign(w.tpm, long, { role: 'software-engineer', title: '長い Key', brief: BRIEF, wait: 0 });
    const lines = log(w).length;
    await expect(notify(w.tpm, long, { text: '置けない' })).rejects.toThrow(/受け手の名が作れません（64 字まで/);
    expect(log(w)).toHaveLength(lines);
    expect(w.office.log.some(m => m.text.includes('置けない'))).toBe(false);
  });

  test('本文が 8,000 字を超える時は、送らずに誤り', async () => {
    const w = await natsWorld();
    claim(w, w.se, 200);
    const long = 'あ'.repeat(8000);
    const lines = log(w).length;
    await expect(notify(w.tpm, 't-x7k2', { text: `${long}い` })).rejects.toThrow(/本文が長すぎます（8009 字。.*長い本文はページに書いて（roster page put）、URL を送ってください。送っていません/);
    expect(w.office.work).toEqual([]);
    expect(log(w)).toHaveLength(lines);
    // 見出しを合わせて 8,000 字なら送れる。
    await notify(w.tpm, 't-x7k2', { text: 'あ'.repeat(8000 - '【notify】'.length) });
    expect(left(w, 't-x7k2')).toHaveLength(1);
    // 字は、hook が渡す字の上限と同じ数え方（UTF-16）で数える: 符号位置では 4,100 字でも、絵文字は 2 つに数えるので送れない。
    w.pass(60_000);
    await expect(notify(w.tpm, 't-x7k2', { text: '😀'.repeat(4100) })).rejects.toThrow(/本文が長すぎます（8208 字。/);
    expect(left(w, 't-x7k2')).toHaveLength(1);
  });

  test('配りの口が誤りの時は「メッセージキューが応えません。送っていません」で止まり、居場所の状態に出す', async () => {
    const w = await natsWorld();
    claim(w, w.se, 200);
    const lines = log(w).length;
    await expect(notify(down(w.tpm), 't-x7k2', { text: '届かない' })).rejects.toThrow(/メッセージキューが応えません。送っていません/);
    expect(w.wire.status('file:tpm')?.wait).toBe('メッセージキューが応えません');
    expect(log(w)).toHaveLength(lines);
    expect(w.posted('file:1').some(m => m.text.includes('届かない'))).toBe(false);
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

  test('T8 の見分け: 取り置き中の物があっても、印から取り置きの長さ＋少しの間を過ぎたら (b)（命令の結果に出して通す）', async () => {
    const w = await waiting();
    await expect(askTpm(w.se, ask)).rejects.toThrow(/まだ渡っていない/);
    // 落ちた hook の取り置きが、何度も渡し直されて残り続ける形（取り置き中の数は 1 のまま）。
    const stuck = new MemoryMailroom(w.office);
    await stuck.take('t-x7k2', ALL);
    w.pass(10_000);
    await expect(askTpm(w.se, ask)).rejects.toThrow(/渡している途中です/);
    w.pass(25_000);
    await stuck.take('t-x7k2', ALL);
    w.pass(5000);
    // 印から 40 秒後。取り置き中の物はあるが、もう (a) にしない。
    expect(await (await w.se.mailroom()).counts('t-x7k2')).toEqual({ waiting: 0, held: 1 });
    expect(await askTpm(w.se, ask)).toHaveLength(2);
    expect(w.printed.join('\n')).toContain('【notify】先に読んでほしい事');
    expect(deliveredLines(w.se).map(l => l.when)).toEqual(['output']);
  });

  test('名乗る前に置かれた物も、名乗った後は同じ箱の物として、hook に渡させる形で止まる（本文は出さない）', async () => {
    const w = await natsWorld();
    await notify(w.tpm, 't-x7k2', { text: '名乗る前に置かれた物' });
    claim(w, w.se, 200);
    await notify(w.tpm, 't-x7k2', { text: '名乗った後に置かれた物' });
    const first = await askTpm(w.se, ask).catch((e: unknown) => (e as Error).message);
    expect(first).toMatch(/^相手から、まだ渡っていないメッセージが 2 件あります（【notify】Technical Program Manager・【notify】Technical Program Manager）。送っていません。/);
    expect(first).not.toContain('置かれた物');
    expect(w.se.state.read(gateFile('t-x7k2'))).toBeDefined();
    // shown/（前の版の記録）には、もう書かない。
    expect(readShown(w.se, 'file:1')).toEqual([]);
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
    await handed(w.tpm);
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

    test('設定に messages を書いていない席でも、同じく止める。名乗りが効いていない session では、この検査を通らない', async () => {
      const w = await natsWorld({});
      recordDelivered(w.se, 'm-1', 't-x7k2', 'gate', undefined, 's-200');
      w.pass(1000);
      // 名乗りが効いていない（渡す hook を持たない）: 直前に渡した記録があっても、止めない。
      expect(await askTpm(w.se, ask)).toHaveLength(2);
      claim(w, w.se, 200);
      recordDelivered(w.se, 'm-2', 't-x7k2', 'gate', undefined, 's-200');
      w.pass(1000);
      await expect(askTpm(w.se, { text: '次の相談', waitingFor: '案' })).rejects.toThrow(/直前に、hook がメッセージを渡しました/);
    });
  });
});

describe('送る前の検査（名乗りが効いていない session。渡す hook を持たない）', () => {
  test('自分宛てが残っていれば、本文を出して 1 度止まり、打ち直しで通る。見せた物は「検査では止めない」の印と、渡した記録の output に残る', async () => {
    const w = await natsWorld();
    await notify(w.tpm, 't-x7k2', { text: '先に読んでほしい事' });
    const id = left(w, 't-x7k2')[0]?.id ?? '';
    w.pass(5000);
    await expect(askTpm(w.se, ask)).rejects.toThrow([
      '相手から、まだ読んでいないメッセージが 1 件あります。送っていません。',
      `--- Technical Program Manager（id ${id}）`,
      '【notify】先に読んでほしい事',
      '--- ここまで',
      '読んだうえで、同じ命令を打ち直せば送ります（事情が変わっていたら、中身を変えて打つ）。',
    ].join('\n'));
    // 止めた回は送らない。hook に渡させる印（GateMark）は書かない（渡す hook が無い）。箱の物は消さない（期限で消える）。
    expect(log(w).at(-1)?.heading).toBe('notify');
    expect(w.se.state.read(gateFile('t-x7k2'))).toBeUndefined();
    expect(left(w, 't-x7k2').map(m => m.id)).toEqual([id]);
    expect([...passedIds(w.se, 't-x7k2')]).toEqual([id]);
    expect(deliveredLines(w.se)).toEqual([{ at: '2026-11-20T12:00:05.000Z', id, to: 't-x7k2', when: 'output', nth: 0 }]);
    expect(w.se.state.lines<{ gate: string, detail: string }>('gate.jsonl').at(-1)).toMatchObject({ gate: 'unread', detail: id });
    expect(readShown(w.se, 'file:1')).toEqual([]);
    // 打ち直しは通る。命令の結果に、本文をもう 1 度は出さない。
    expect(await askTpm(w.se, ask)).toContain('送った: 【ask-tpm】→ file:tpm（相手の手が空いた時に届く。送り直さない）');
    expect(w.printed).toEqual([]);
    // 新しく来た物では、また 1 度止まる（前に見せた物は出さない）。
    await handed(w.tpm);
    await notify(w.tpm, 't-x7k2', { text: '2 通目' });
    const again = await askTpm(w.se, { text: '次の相談', waitingFor: '案' }).catch((e: unknown) => (e as Error).message);
    expect(again).toMatch(/^相手から、まだ読んでいないメッセージが 1 件あります。[\s\S]*【notify】2 通目/);
    expect(again).not.toContain('先に読んでほしい事');
    // ページを置く命令の検査は、字が替わる。
    await notify(w.tpm, 't-x7k2', { text: '3 通目' });
    await expect(assertRead(w.se, '相手', undefined, 'put')).rejects.toThrow(/ページを置いていません。[\s\S]*読んだうえで、同じ命令を打ち直せば置きます/);
  });

  test('見せた物は、見た時刻の口が「見せた」と読む: 続きの assign・dismiss の検査が、見た物として数える', async () => {
    const w = await natsWorld();
    const done = { kind: 'result' as const, summary: '済んだ', remaining: 'なし', decisions: 'なし', points: [] };
    await reportDone(w.se, done);
    await handed(w.tpm);
    await assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: 'https://claude.ai/artifact/b2', wait: 0 });
    const brief = log(w).at(-1);
    if (brief === undefined) throw new Error('送った記録が無い');
    // まだ見せていない: 見た時刻は無く、dismiss は止まる。
    expect(seenTimes(w.tpm, { live: true })(brief)).toBeUndefined();
    await expect(dismiss(w.tpm, 't-x7k2', { handover: false })).rejects.toThrow(/まだ済んでいない物があります[\s\S]*まだ見ていない[\s\S]*【done】が返っていない依頼書: b2/);
    // 担当の送る前の検査が、依頼書を見せて 1 度止める。
    w.pass(60_000);
    await expect(reportDone(w.se, { ...done, summary: '2 つ目' })).rejects.toThrow(/まだ読んでいないメッセージが 1 件あります[\s\S]*【brief】https:\/\/claude\.ai\/artifact\/b2/);
    expect(seenTimes(w.tpm, { live: true })(brief)).toEqual({ at: '2026-11-20T12:01:00.000Z', by: 'shown' });
    expect(seenTimes(w.tpm, { live: false })(brief)).toEqual({ at: '2026-11-20T12:01:00.000Z', by: 'shown' });
    // 見せた後の【done】は、その依頼書の分に数える。続きの assign も dismiss も止まらない。
    w.pass(60_000);
    await reportDone(w.se, { ...done, summary: '2 つ目' });
    await handed(w.tpm);
    expect((await assign(w.tpm, 't-x7k2', { role: 'software-engineer', brief: 'https://claude.ai/artifact/b3', wait: 0 }))[0]).toMatch(/^送った: 【brief】/);
    w.pass(60_000);
    await expect(reportDone(w.se, { ...done, summary: '3 つ目' })).rejects.toThrow(/まだ読んでいないメッセージが 1 件/);
    await reportDone(w.se, { ...done, summary: '3 つ目' });
    await handed(w.tpm);
    expect((await dismiss(w.tpm, 't-x7k2', { handover: false }))[0]).toBe('送った: 【dismiss】→ file:1（相手の手が空いた時に届く。送り直さない）');
  });

  test('送り手で絞る・配りの口が応えない・写しが遅れている時の扱いは、名乗っている時と同じ', async () => {
    const w = await natsWorld();
    await assign(w.tpm, 't-b2c3', { role: 'software-engineer', title: '別の課題', brief: BRIEF, wait: 0 });
    const other = w.role('t-b2c3', 'file:2');
    await hello(other);
    await askTpm(other, { text: '別の課題の問い', waitingFor: 'a' });
    // TPM 担当が t-x7k2 に送る時は、t-b2c3 からの物では止まらない。
    expect((await notify(w.tpm, 't-x7k2', { text: '知らせ' }))[0]).toMatch(/^送った: 【notify】/);
    await expect(notify(w.tpm, 't-b2c3', { text: '答え' })).rejects.toThrow(/^t-b2c3 の担当から、まだ読んでいないメッセージが 1 件あります。/);
    await expect(askTpm(down(w.se), ask)).rejects.toThrow(/^メッセージキューが応えません。送っていません/);
    expect(w.wire.status('file:1')?.wait).toBe('メッセージキューが応えません');
    const lagging = await patched(w.se, { lag: () => Promise.resolve(3) });
    await expect(askTpm(lagging, ask)).rejects.toThrow(/メッセージキューの写しが遅れています（まだ写されていない物が 3 通）。送っていません/);
  });
});

describe('メッセージキューが応えない時', () => {
  const devops = { what: 'メッセージキューを起こす', why: '応えない', urgent: true };
  const incident = { text: 'メッセージキューが応えない', type: 'reliability', tags: [], severe: false };
  const gates = (w: { tpm: { state: { lines: <T>(name: string) => T[] } } }): string[] => w.tpm.state.lines<{ gate: string, detail: string }>('gate.jsonl').map(l => `${l.gate} ${l.detail}`);
  const NOT_SENT = 'メッセージキューが応えないので、TPM 担当には送っていない（台帳には書いた。打ち直さない。TPM 担当にも送れないので、止まった事を返答に書く）';

  test('roster ask devops は、ほかの送る命令と同じく止まる（送っていない）', async () => {
    for (const claimed of [true, false]) {
      const w = await natsWorld();
      if (claimed) claim(w, w.se, 200);
      const se = down(w.se);
      await expect(askTpm(se, ask)).rejects.toThrow(/メッセージキューが応えません。送っていません/);
      const lines = log(w).length;
      await expect(askDevops(se, devops)).rejects.toThrow(/^メッセージキューが応えません。送っていません（.*）。TPM 担当にも送れないので、止まった事を返答に書き（メッセージキュー（NATS）が動いているかは、Product Manager が確かめる）、動いてから同じ命令を打ち直してください$/);
      expect(log(w)).toHaveLength(lines);
      expect(w.office.work).toEqual([]);
      expect(w.wire.status('file:1')?.wait).toBe('メッセージキューが応えません');
      expect(gates(w).at(-1)).toMatch(/^queue down: /);
      // 応える時は、配りの口に置く。
      await askDevops(w.se, devops);
      expect(left(w, 'tpm').map(s => s.text.slice(0, 12))).toEqual(['【ask-devops】']);
    }
  });

  test('roster report incident は、応えなくても台帳に書き、誤りにせず終わる（送っていない事を出し、状態と gate.jsonl に残す。送った記録は増えない）', async () => {
    for (const claimed of [true, false]) {
      const w = await natsWorld();
      if (claimed) claim(w, w.se, 200);
      const lines = log(w).length;
      const out = await reportIncident(down(w.se), incident);
      expect(out).toEqual([expect.stringMatching(/^台帳に書いた: #1 /) as string, NOT_SENT]);
      expect(readIncidents(w.tpm).map(i => [i.n, i.key, i.source, i.text])).toEqual([[1, 't-x7k2', 'report', 'メッセージキューが応えない']]);
      expect(log(w)).toHaveLength(lines);
      expect(w.office.work).toEqual([]);
      expect(w.wire.status('file:1')?.wait).toBe('メッセージキューが応えません');
      expect(gates(w)).toEqual([expect.stringMatching(/^queue down: /) as string]);
    }
  });

  test('roster report incident: 台帳に書いた後の送りが、ほかの訳（本文が長すぎる）で止まっても、誤りにせず、送っていない事と訳を出す', async () => {
    const w = await natsWorld();
    const out = await reportIncident(w.se, { ...incident, text: 'あ'.repeat(8100) });
    expect(out).toEqual([expect.stringMatching(/^台帳に書いた: #1 /) as string, expect.stringMatching(/^TPM 担当には送っていない（台帳には書いた。打ち直さない）: 本文が長すぎます/) as string]);
    expect(readIncidents(w.tpm)).toHaveLength(1);
    expect(log(w).some(l => l.heading === 'incident')).toBe(false);
  });

  test('TPM 担当が送る時の字は、Product Manager に確かめる', async () => {
    const w = await natsWorld();
    await expect(notify(down(w.tpm), 't-x7k2', { text: 'x' })).rejects.toThrow(/メッセージキュー（NATS）が動いているかを Product Manager に確かめ、動いてから同じ命令を打ち直してください$/);
  });

  test('roster report incident: 検査は通り、置く所だけが応えない時も、台帳に書いて誤りにしない。応える時は、台帳に書いて送る', async () => {
    const w = await natsWorld();
    const failing = await patched(w.se, { put: () => Promise.reject(new Error('timeout')) });
    expect(await reportIncident(failing, incident)).toEqual([expect.stringMatching(/^台帳に書いた: #1 /) as string, NOT_SENT]);
    expect(gates(w)).toEqual(['queue down: timeout']);
    expect(log(w).some(l => l.heading === 'incident')).toBe(false);
    w.pass(60_000);
    expect(await reportIncident(w.se, incident)).toEqual([expect.stringMatching(/^台帳に書いた: #2 /) as string, '送った: 【incident】→ file:tpm（相手の手が空いた時に届く。送り直さない）']);
    expect(left(w, 'tpm').map(s => s.text)).toEqual(['【incident】#2 信頼性: メッセージキューが応えない']);
    expect(readIncidents(w.tpm)).toHaveLength(2);
  });

  test('roster report incident: まだ渡っていない物があって検査が止めた時は、台帳にも書かない（打ち直しで書く）', async () => {
    const w = await natsWorld();
    await notify(w.tpm, 't-x7k2', { text: '先に読んでほしい事' });
    await expect(reportIncident(w.se, incident)).rejects.toThrow(/まだ読んでいないメッセージが 1 件あります/);
    expect(readIncidents(w.tpm)).toEqual([]);
    expect((await reportIncident(w.se, incident)).at(-1)).toMatch(/^送った: 【incident】/);
    expect(readIncidents(w.tpm)).toHaveLength(1);
  });

  test('課題に記録を書く命令は、記録を書く前に止まる（置けるかを先に確かめる）', async () => {
    const w = world({ tracker: 'jira' }, {}, {}, { handOver: false });
    await hello(w.tpm, TPM);
    await assign(w.tpm, 't-x7k2', { role: 'software-engineer', title: '計画と実装', brief: BRIEF, issue: 'AI-1', noIssueCopy: '試験', wait: 0 });
    const se = w.role('t-x7k2', 'file:1');
    await hello(se);
    const done = { kind: 'result' as const, summary: '済んだ', remaining: 'なし', decisions: 'なし', points: [] };
    const written = (): number => w.tpm.state.lines('tracker.jsonl').length;
    const before = written();
    await expect(reportDone(down(se), done)).rejects.toThrow(/メッセージキューが応えません。送っていません/);
    expect(written()).toBe(before);
    expect(w.wire.status('file:1')?.wait).toBe('メッセージキューが応えません');
    // 応える時は、記録を書いて送る。
    await reportDone(se, done);
    expect(written()).toBe(before + 1);
    expect(left(w, 'tpm')).toHaveLength(1);
  });
});
