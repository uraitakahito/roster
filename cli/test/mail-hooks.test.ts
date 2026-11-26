// メッセージを NATS で渡す hook の命令（roster mail gate・wait・prompt）の試験。試験用の配りの口（memory.ts）で流す。
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Context } from '../src/context.ts';
import { mailGate, mailPrompt, mailWait } from '../src/commands/mail.ts';
import { askTpm, notify } from '../src/commands/messages.ts';
import { deliveredLines, gateFile, waiterFile, type GateMark } from '../src/mail.ts';
import { MemoryMailroom } from '../src/mailroom/memory.ts';
import { TpmError } from '../src/skill-sets.ts';
import type { World } from './helpers.ts';
import { ALL, claim, down, left, natsWorld, patched, TPM_FROM } from './mail-helpers.ts';

const ask = { text: '案 A と B で迷う', waitingFor: '案' };
type W = World & { se: Context };

/** 担当が名乗っている世界。hook は、命令とは別の process（別の口）で動く。 */
async function seated(): Promise<W & { hook: () => Context }> {
  const w = await natsWorld();
  claim(w, w.se, 200);
  return { ...w, hook: () => w.role('t-x7k2', 'file:1') };
}

/** 会話の記録（n 行）の file。 */
function transcript(n: number): string {
  const file = join(mkdtempSync(join(tmpdir(), 'roster-transcript-')), 't.jsonl');
  writeFileSync(file, Array.from({ length: n }, (_, i) => `${JSON.stringify({ type: 'user', n: i })}\n`).join(''));
  return file;
}

const context = (out: string | undefined): string => (JSON.parse(out ?? '{}') as { hookSpecificOutput?: { additionalContext?: string } }).hookSpecificOutput?.additionalContext ?? '';

/** 待つ命令を、sleep を n 回数えた所で止める周り。slept は、待った長さ（ミリ秒）の並び。 */
function stopping(ctx: Context, n: number): { ctx: Context, signal: AbortSignal, slept: number[] } {
  const stop = new AbortController();
  const slept: number[] = [];
  return {
    signal: stop.signal,
    slept,
    ctx: {
      ...ctx,
      sleep: (ms) => {
        slept.push(ms);
        if (slept.length >= n) stop.abort();
        return Promise.resolve();
      },
    },
  };
}

describe('検査が止めた後に渡す（roster mail gate）', () => {
  test('R2: 検査が止める → 本文は出ない → hook が渡して記録 → 打ち直しが通る', async () => {
    const w = await seated();
    await notify(w.tpm, 't-x7k2', { text: '先に読んでほしい事' });
    const id = left(w, 't-x7k2')[0]?.id ?? '';
    const stopped = await askTpm(w.se, ask).catch((e: unknown) => (e as Error).message);
    expect(stopped).toMatch(/まだ渡っていないメッセージが 1 件あります/);
    expect(stopped).not.toContain('先に読んでほしい事');
    const out = await mailGate(w.hook(), JSON.stringify({ session_id: 's-200', hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', transcript_path: transcript(7) }));
    expect(JSON.parse(out ?? '{}')).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PostToolUseFailure',
        additionalContext: [
          '送る前の検査が止めた: 相手から、まだ渡っていないメッセージが 1 件あった（送っていません）',
          '次が、まだ渡っていなかったメッセージです。読んだうえで、止まった命令を打ち直してください（事情が変わっていたら、中身を変えて打つ）。',
          `--- Technical Program Manager（id ${id}）`,
          '【notify】先に読んでほしい事',
          '--- ここまで',
        ].join('\n'),
      },
    });
    expect(deliveredLines(w.se)).toEqual([{ at: '2026-11-20T12:00:00.000Z', id, to: 't-x7k2', when: 'gate', nth: 1, lines: 7, session: 's-200' }]);
    expect(w.office.work).toEqual([]);
    expect(w.se.state.read(gateFile('t-x7k2'))).toBeUndefined();
    expect(await askTpm(w.se, ask)).toContain('送った: 【ask-tpm】→ file:tpm（相手の手が空いた時に届く。送り直さない）');
    expect(w.printed).toEqual([]);
  });

  test('止めた印が無ければ、配りの口に聞かずに終わる（1 字も出さない）', async () => {
    const w = await seated();
    await notify(w.tpm, 't-x7k2', { text: '検査が止めていない時は、渡さない' });
    expect(await mailGate(down(w.hook()), '{}')).toBeUndefined();
    expect(await mailGate(w.hook(), '{}')).toBeUndefined();
    expect(left(w, 't-x7k2')).toHaveLength(1);
    expect(deliveredLines(w.se)).toEqual([]);
  });

  test('印があっても、自分宛てが無ければ 1 字も出さない。取り置けない間は、印を残す', async () => {
    const w = await seated();
    await notify(w.tpm, 't-x7k2', { text: '取り置き中の物' });
    await expect(askTpm(w.se, ask)).rejects.toThrow(/まだ渡っていない/);
    const other = new MemoryMailroom(w.office);
    const held = await other.take('t-x7k2', ALL);
    expect(await mailGate(w.hook(), '{}')).toBeUndefined();
    expect(w.se.state.read(gateFile('t-x7k2'))).toBeDefined();
    await other.done(held);
    expect(await mailGate(w.hook(), '{}')).toBeUndefined();
  });

  test('手伝い（subagent）の中では、何もしない', async () => {
    const w = await seated();
    await notify(w.tpm, 't-x7k2', { text: '担当に渡す物' });
    await expect(askTpm(w.se, ask)).rejects.toThrow(/まだ渡っていない/);
    const input = JSON.stringify({ session_id: 's-200', agent_id: 'agent-1', agent_type: 'general-purpose' });
    expect(await mailGate(w.hook(), input)).toBeUndefined();
    expect(await mailPrompt(w.hook(), input)).toBeUndefined();
    expect(await mailWait(w.hook(), input, new AbortController().signal)).toEqual({ code: 0 });
    expect(left(w, 't-x7k2')).toHaveLength(1);
    expect(w.se.state.read(gateFile('t-x7k2'))).toBeDefined();
    expect(w.procs.stopped).toEqual([]);
  });

  test('束の頭が渡し直しの物なら、その 1 通だけを渡す（後ろの物は取り置かず、渡した回数も増やさない）', async () => {
    const w = await seated();
    for (const text of ['1 通目', '2 通目', '3 通目']) {
      w.pass(1000);
      await notify(w.tpm, 't-x7k2', { text });
    }
    // 前の hook が、頭の 1 通を取り置いたまま落ちた。
    await new MemoryMailroom(w.office).take('t-x7k2', { max: 1, chars: 9000 });
    w.pass(31_000);
    const mark: GateMark = { at: 'x', ids: left(w, 't-x7k2').map(s => s.id), reason: '止めた訳' };
    w.se.state.write(gateFile('t-x7k2'), mark);
    const first = context(await mailGate(w.hook(), '{}'));
    expect(first).toContain('【notify】1 通目');
    expect(first).not.toContain('2 通目');
    expect(w.office.work.map(i => [i.stored.text, i.deliveries])).toEqual([['【notify】2 通目', 0], ['【notify】3 通目', 0]]);
    // 残りは、次の回にまとめて渡る。
    w.se.state.write(gateFile('t-x7k2'), mark);
    const second = context(await mailGate(w.hook(), '{}'));
    expect(second).toContain('【notify】2 通目');
    expect(second).toContain('【notify】3 通目');
    expect(w.office.work).toEqual([]);
  });

  test('「渡し直し n 度目」は、手元の渡した記録の回数から出す（道具の数える回数ではない）', async () => {
    const w = await seated();
    await notify(w.tpm, 't-x7k2', { text: '2 度渡る物' });
    const id = left(w, 't-x7k2')[0]?.id ?? '';
    // 取り置いて返しただけの回（道具は 1 度に数える）は、渡した回に数えない。
    const other = new MemoryMailroom(w.office);
    await other.giveBack(await other.take('t-x7k2', ALL));
    w.se.state.write(gateFile('t-x7k2'), { at: 'x', ids: [id], reason: '止めた訳' } satisfies GateMark);
    // 1 度目: 渡した記録は書いたが、「渡せた」が配りの口に届かなかった。
    const lost = await patched(w.hook(), { done: () => Promise.reject(new TpmError('届かない')) });
    const first = context(await mailGate(lost, '{}'));
    expect(first).toContain(`--- Technical Program Manager（id ${id}）`);
    expect(first).not.toContain('渡し直し');
    expect(left(w, 't-x7k2')).toHaveLength(1);
    w.pass(31_000);
    const second = context(await mailPrompt(w.hook(), '{}'));
    expect(second).toContain(`--- Technical Program Manager（id ${id}・渡し直し 2 度目（前にも渡したかもしれない））`);
    expect(deliveredLines(w.se).map(l => [l.when, l.nth])).toEqual([['gate', 1], ['prompt', 2]]);
    expect(w.office.work).toEqual([]);
  });

  test('渡す字は、1 万字を超えない（超える分は返して、次の回に渡す）', async () => {
    const w = await seated();
    for (let i = 0; i < 20; i++) await notify(w.tpm, 't-x7k2', { text: `${i} `.padEnd(430, 'あ') });
    w.se.state.write(gateFile('t-x7k2'), { at: 'x', ids: left(w, 't-x7k2').map(s => s.id), reason: '止めた訳' } satisfies GateMark);
    const text = context(await mailGate(w.hook(), '{}'));
    expect(text.length).toBeLessThanOrEqual(9800);
    const delivered = deliveredLines(w.se).length;
    expect(delivered).toBeGreaterThan(10);
    expect(delivered).toBeLessThan(20);
    expect(left(w, 't-x7k2')).toHaveLength(20 - delivered);
    // 返した物は、すぐ取り直せる。
    expect(context(await mailPrompt(w.hook(), '{}'))).toContain('【notify】19 ');
    expect(w.office.work).toEqual([]);
  });

  test('配りの口が応えない時は、誤りを投げる（命令の入口が、何も出さずに exit 0 にする）。印は残る', async () => {
    const w = await seated();
    await notify(w.tpm, 't-x7k2', { text: '後で渡る' });
    await expect(askTpm(w.se, ask)).rejects.toThrow(/まだ渡っていない/);
    await expect(mailGate(down(w.hook()), '{}')).rejects.toThrow(/応えません/);
    expect(w.se.state.read(gateFile('t-x7k2'))).toBeDefined();
  });
});

describe('人が入力した時に渡す（roster mail prompt）', () => {
  test('自分宛てがあれば、UserPromptSubmit の JSON で渡し、記録を書いて「渡せた」を返す', async () => {
    const w = await seated();
    await notify(w.tpm, 't-x7k2', { text: '入力の前に届いた物' });
    const id = left(w, 't-x7k2')[0]?.id ?? '';
    const out = JSON.parse(await mailPrompt(w.hook(), JSON.stringify({ session_id: 's-200', transcript_path: transcript(3) })) ?? '{}') as { hookSpecificOutput: { hookEventName: string, additionalContext: string } };
    expect(out.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
    expect(out.hookSpecificOutput.additionalContext).toBe(['roster: 人の入力の前に届いていたメッセージです（メッセージキューから渡した）。人の入力と合わせて扱ってください。', `--- ${TPM_FROM}（id ${id}）`, '【notify】入力の前に届いた物', '--- ここまで'].join('\n'));
    expect(deliveredLines(w.se)).toEqual([{ at: '2026-11-20T12:00:00.000Z', id, to: 't-x7k2', when: 'prompt', nth: 1, lines: 3, session: 's-200' }]);
    expect(w.office.work).toEqual([]);
  });

  test('自分宛てが無い時は 1 字も出さない。名乗りが効いていなければ、取り置かない', async () => {
    const w = await seated();
    expect(await mailPrompt(w.hook(), '{}')).toBeUndefined();
    await notify(w.tpm, 't-x7k2', { text: '名乗りが切れた後' });
    w.procs.alive.delete(200);
    expect(await mailPrompt(w.hook(), '{}')).toBeUndefined();
    expect(left(w, 't-x7k2')).toHaveLength(1);
  });

  test('人の入力の後は、待つ命令が止まっている（配りの口が応えなくても）', async () => {
    const w = await seated();
    w.procs.add(700);
    w.se.state.write(waiterFile('t-x7k2'), { pid: 700, started: 'started-700' });
    await expect(mailPrompt(down(w.hook()), '{}')).rejects.toThrow(/応えません/);
    expect(w.procs.stopped).toEqual([700]);
    expect(w.se.state.read(waiterFile('t-x7k2'))).toBeUndefined();
  });
});

describe('手を止めている間に待つ（roster mail wait）', () => {
  test('自分宛てが来たら、本文を stderr に出す字にして code 2 で返る。記録を書き、「渡せた」を返す', async () => {
    const w = await seated();
    await notify(w.tpm, 't-x7k2', { text: '手が空いたら読む物' });
    const id = left(w, 't-x7k2')[0]?.id ?? '';
    const r = await mailWait(w.hook(), JSON.stringify({ session_id: 's-200', transcript_path: transcript(5) }), new AbortController().signal);
    expect(r).toEqual({ code: 2, stderr: ['roster: 手を止めている間に届いたメッセージです（メッセージキューから渡した）。', `--- ${TPM_FROM}（id ${id}）`, '【notify】手が空いたら読む物', '--- ここまで'].join('\n') });
    expect(deliveredLines(w.se)).toEqual([{ at: '2026-11-20T12:00:00.000Z', id, to: 't-x7k2', when: 'wake', nth: 1, lines: 5, session: 's-200' }]);
    expect(w.office.work).toEqual([]);
    expect(w.se.state.read(waiterFile('t-x7k2'))).toBeUndefined();
  });

  test('来なければ終わらない（止められるまで待ち続け、止められたら code 0）。待つ間は、自分を印に書く', async () => {
    const w = await seated();
    const s = stopping(w.hook(), 40);
    let marked: unknown;
    const watching = await patched(s.ctx, {
      wait: () => {
        marked = w.se.state.read(waiterFile('t-x7k2'));
        return Promise.resolve([]);
      },
    });
    w.procs.add(4242);
    expect(await mailWait(watching, '{}', s.signal)).toEqual({ code: 0 });
    expect(s.slept.length).toBe(40);
    expect(marked).toEqual({ pid: 4242, started: 'started-4242' });
    expect(w.se.state.read(waiterFile('t-x7k2'))).toBeUndefined();
  });

  test('止められたら、取り置いていた物を返して code 0 で終わる（渡した記録は書かない）', async () => {
    const w = await seated();
    await notify(w.tpm, 't-x7k2', { text: '取った瞬間に止められた物' });
    const stop = new AbortController();
    const room = new MemoryMailroom(w.office);
    const ctx = await patched({ ...w.hook(), mailroom: () => Promise.resolve(room) }, {
      wait: async (to, limit) => {
        const taken = await room.take(to, limit);
        stop.abort();
        return taken;
      },
    });
    expect(await mailWait(ctx, '{}', stop.signal)).toEqual({ code: 0 });
    expect(deliveredLines(w.se)).toEqual([]);
    // 返した物は、期限を待たずに取り直せる。
    expect((await new MemoryMailroom(w.office).take('t-x7k2', ALL)).map(t => t.deliveries)).toEqual([2]);
  });

  test('Claude Code が居なくなったら終わる（T7）。名乗っていなければ、待たずに終わる', async () => {
    const w = await seated();
    let ticks = 0;
    const ctx: Context = {
      ...w.hook(),
      sleep: () => {
        ticks += 1;
        if (ticks === 5) w.procs.alive.delete(200);
        return Promise.resolve();
      },
    };
    expect(await mailWait(ctx, '{}', new AbortController().signal)).toEqual({ code: 0 });
    expect(ticks).toBeGreaterThanOrEqual(5);
    expect(ticks).toBeLessThan(10);
    // もう名乗りが効いていない: 名乗りを少し待って（10 回）、終わる。
    const s = stopping(w.hook(), 1000);
    expect(await mailWait(s.ctx, '{}', s.signal)).toEqual({ code: 0 });
    expect(s.slept).toEqual(Array(10).fill(500));
    expect(w.se.state.read(waiterFile('t-x7k2'))).toBeUndefined();
  });

  test('待つ者は 1 つ（T4）: 動き出す時に前の待つ命令を止め、自分の印がほかの物に替わったら終わる', async () => {
    const w = await seated();
    w.procs.add(700);
    w.se.state.write(waiterFile('t-x7k2'), { pid: 700, started: 'started-700' });
    let ticks = 0;
    const ctx: Context = {
      ...w.hook(),
      sleep: () => {
        ticks += 1;
        // 次の待つ命令が、印を書き替えた（止める合図は届かなかった）。
        if (ticks === 3) w.se.state.write(waiterFile('t-x7k2'), { pid: 800, started: 'started-800' });
        return Promise.resolve();
      },
    };
    expect(await mailWait(ctx, '{}', new AbortController().signal)).toEqual({ code: 0 });
    expect(w.procs.stopped).toEqual([700]);
    expect(w.se.state.read(waiterFile('t-x7k2'))).toEqual({ pid: 800, started: 'started-800' });
  });

  test('始まった時刻が違う pid（番号の使い回し）は、前の待つ命令として止めない', async () => {
    const w = await seated();
    w.procs.add(700);
    w.se.state.write(waiterFile('t-x7k2'), { pid: 700, started: '別の時刻' });
    const s = stopping(w.hook(), 3);
    await mailWait(s.ctx, '{}', s.signal);
    expect(w.procs.stopped).toEqual([]);
  });
});

describe('トークンの試験（空で起こさない）', () => {
  test('(a) 自分宛てが無いまま、ほかの受け手宛てが置かれ、配りの口が誤りを返して戻っても、待つ命令は code 2 で終わらない', async () => {
    const w = await seated();
    claim(w, w.tpm, 100);
    await askTpm(w.se, ask);
    expect(left(w, 'tpm')).toHaveLength(1);
    const s = stopping(w.hook(), 30);
    let calls = 0;
    let closed = 0;
    const room = new MemoryMailroom(w.office);
    const flaky = await patched({ ...s.ctx, mailroom: () => Promise.resolve(room) }, {
      wait: (to, limit) => {
        calls += 1;
        return calls <= 6 ? Promise.reject(new TpmError('メッセージキュー（NATS）が応えません')) : room.take(to, limit);
      },
      close: () => {
        closed += 1;
        return Promise.resolve();
      },
    });
    expect(await mailWait(flaky, '{}', s.signal)).toEqual({ code: 0 });
    // 応えない間は、間を空けて試し直す（1 秒から倍々、長くて 30 秒）。繋ぎは、そのたびに閉じる。
    expect(s.slept.filter(ms => ms >= 1000 && ms !== 2000).slice(0, 5)).toEqual([1000, 4000, 8000, 16000, 30000]);
    expect(s.slept.filter(ms => ms === 30000).length).toBe(1);
    expect(closed).toBe(6);
    expect(calls).toBeGreaterThan(6);
    expect(left(w, 'tpm')).toHaveLength(1);
    expect(deliveredLines(w.se)).toEqual([]);
  });

  test('(b) n 通置いた時、待つ命令が code 2 で終わる回数は、本文を取り置いて渡した回数と同じ', async () => {
    const w = await seated();
    for (const text of ['い', 'ろ', 'は']) await notify(w.tpm, 't-x7k2', { text });
    // 頭の 1 通は渡し直しの物（1 通だけで渡る）。残りの 2 通は、次の回にまとめて渡る。
    await new MemoryMailroom(w.office).take('t-x7k2', { max: 1, chars: 9000 });
    w.pass(31_000);
    const woke: string[] = [];
    for (let i = 0; i < 6; i++) {
      const s = stopping(w.hook(), 10);
      const r = await mailWait(s.ctx, '{}', s.signal);
      if (r.code === 2) woke.push(r.stderr ?? '');
    }
    expect(woke).toHaveLength(2);
    expect(woke.map(text => (text.match(/^--- Technical Program Manager/gm) ?? []).length)).toEqual([1, 2]);
    expect(new Set(deliveredLines(w.se).map(l => l.at + l.id)).size).toBe(3);
    expect(w.office.work).toEqual([]);
  });

  test('(c) 検査が止めた後の hook と、人の入力の時の hook は、自分宛てが無い時に 1 字も出さない', async () => {
    const w = await seated();
    claim(w, w.tpm, 100);
    await askTpm(w.se, ask);
    w.se.state.write(gateFile('t-x7k2'), { at: 'x', ids: ['gone'], reason: '止めた訳' } satisfies GateMark);
    expect(await mailGate(w.hook(), '{}')).toBeUndefined();
    expect(await mailPrompt(w.hook(), '{}')).toBeUndefined();
    expect(left(w, 'tpm')).toHaveLength(1);
  });

  test('(d) 人の入力の後は、待つ命令が止まっている', async () => {
    const w = await seated();
    w.procs.add(700);
    w.se.state.write(waiterFile('t-x7k2'), { pid: 700, started: 'started-700' });
    expect(await mailPrompt(w.hook(), '{}')).toBeUndefined();
    expect(w.procs.stopped).toEqual([700]);
    expect(w.se.state.read(waiterFile('t-x7k2'))).toBeUndefined();
  });

  test('待つ・人の入力をくり返しても、後から来た物の渡した回数（道具の数え）は増えない', async () => {
    const w = await seated();
    for (let i = 0; i < 5; i++) {
      const s = stopping(w.hook(), 3);
      expect(await mailWait(s.ctx, '{}', s.signal)).toEqual({ code: 0 });
      expect(await mailPrompt(w.hook(), '{}')).toBeUndefined();
    }
    await notify(w.tpm, 't-x7k2', { text: '1 度だけ渡る' });
    expect((await new MemoryMailroom(w.office).take('t-x7k2', ALL)).map(t => t.deliveries)).toEqual([1]);
  });
});
