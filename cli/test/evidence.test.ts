import { describe, expect, test } from 'vitest';
import { guard } from '../src/commands/infra.ts';
import { answer, askTpm, notify, reportDone, reportMerged, wait } from '../src/commands/messages.ts';
import { hello } from '../src/commands/role-side.ts';
import { assign } from '../src/commands/tpm-side.ts';
import { type GateStop, type GuardStop, type WaitChange } from '../src/evidence.ts';
import type { TrackerWrite } from '../src/tracker/recorded.ts';
import { BRIEF, world, type World } from './helpers.ts';

const PR = 'https://github.com/o/r/pull/7';
const AT = '2026-11-20T12:00:00.000Z';

async function started(config: Record<string, unknown> = {}, issue?: string): Promise<World & { se: ReturnType<World['role']> }> {
  const w = world(config);
  await hello(w.tpm, { model: 'claude-opus-5-5', effort: 'medium' });
  await assign(w.tpm, 't-x7k2', { role: 'software-engineer', title: '計画と実装', brief: BRIEF, wait: 0, ...(issue === undefined ? {} : { issue }) });
  const se = w.role('t-x7k2', 'file:1');
  await hello(se);
  return { ...w, se };
}

describe('課題管理への書き込み（tracker.jsonl）', () => {
  test('コメントと「済み」を、打った担当と一緒に残す。読むだけの命令は残さない', async () => {
    const w = await started({ tracker: 'github' }, 'gh-12');
    await reportDone(w.se, { kind: 'plan', summary: '計画', remaining: 'なし', decisions: 'なし', points: [] });
    await answer(w.tpm, 't-x7k2', { text: '案 A' });
    w.se.tracker.close('gh-12');
    expect(w.tpm.state.lines<TrackerWrite>('tracker.jsonl').map(({ at, ...rest }) => ({ ...rest, at: typeof at }))).toEqual([
      { by: 't-x7k2', role: 'tpm', issue: 'gh-12', op: 'comment', kind: '計画', ok: true, at: 'string' },
      { by: 'tpm', role: 'tpm', issue: 'gh-12', op: 'comment', kind: '決定', ok: true, at: 'string' },
      { by: 't-x7k2', role: 'tpm', issue: 'gh-12', op: 'close', ok: true, at: 'string' },
    ]);
  });

  test('書き込みが失敗しても 1 行残し、誤りはそのまま投げる', () => {
    // github だけを宣言した project で Jira の Key に書くと、書く先が無くて失敗する。
    const broken = world({ tracker: 'github' });
    expect(() => broken.tpm.tracker.comment('AI-1', { kind: '決定', role: 'TPM', summary: 's', links: [], points: [] })).toThrow(/課題管理の課題ではありません/);
    expect(broken.tpm.state.lines<TrackerWrite>('tracker.jsonl')).toMatchObject([{ issue: 'AI-1', op: 'comment', kind: '決定', ok: false, error: '課題管理の課題ではありません: AI-1' }]);
  });
});

describe('guard が止めた命令（guard.jsonl）', () => {
  const bash = (command: string): string => JSON.stringify({ tool_name: 'Bash', tool_input: { command } });

  test('止めた命令だけを残す。長い命令は頭の 300 字', async () => {
    const w = await started();
    expect((await guard(w.se, bash('git status'))).allow).toBe(true);
    expect((await guard(w.se, bash(`cmux agent message x ${'あ'.repeat(400)}`))).allow).toBe(false);
    const stops = w.tpm.state.lines<GuardStop>('guard.jsonl');
    expect(stops).toMatchObject([{ at: AT, by: 't-x7k2', reason: expect.stringMatching(/道具を直に打つと/) as string }]);
    expect(stops[0]?.command).toHaveLength(300);
  });
});

describe('入口の検査が止めた回（gate.jsonl）と、返事の先（log.jsonl）', () => {
  test('読んでいないメッセージ・merge していない PR・読めない PR を残す', async () => {
    const w = await started();
    w.hold('file:1');
    await notify(w.tpm, 't-x7k2', { text: '待つこと' });
    await expect(askTpm(w.se, { text: 'q', waitingFor: 'a' })).rejects.toThrow(/読んでいない/);
    w.prs.set(PR, 'OPEN');
    await expect(reportMerged(w.se, { pr: PR, note: 'n' })).rejects.toThrow(/merge されていません/);
    w.prs.set(PR, undefined);
    await expect(reportMerged(w.se, { pr: PR, note: 'n' })).rejects.toThrow(/読めません/);
    expect(w.tpm.state.lines<GateStop>('gate.jsonl')).toEqual([
      { at: AT, by: 't-x7k2', role: 'tpm', gate: 'unread', detail: w.posted('t-x7k2')[0]?.id },
      { at: AT, by: 't-x7k2', role: 'tpm', gate: 'not-merged', detail: `${PR} OPEN` },
      { at: AT, by: 't-x7k2', role: 'tpm', gate: 'pr-unreadable', detail: PR },
    ]);
  });

  test('--reply-to の id を log.jsonl に残す', async () => {
    const w = await started();
    await askTpm(w.se, { text: 'q', waitingFor: 'a' });
    const asked = w.posted('tpm')[0]?.id ?? '';
    await notify(w.tpm, 't-x7k2', { text: 'a', replyTo: asked });
    expect(w.tpm.state.lines<{ heading: string, replyTo?: string }>('log.jsonl').map(l => [l.heading, l.replyTo])).toEqual([['brief', undefined], ['ask-tpm', undefined], ['notify', asked]]);
    // 返事の先は、置く物にも残る。届く担当は、呼ぶ側が名指した担当のまま。
    expect(w.posted('t-x7k2').at(-1)).toMatchObject({ text: '【notify】a', replyTo: asked });
  });
});

describe('wait の移り（waits.jsonl）', () => {
  test('roster wait と、【done】の後の待ちを順に残す', async () => {
    const w = await started();
    wait(w.se, 'work', '実装');
    await reportDone(w.se, { kind: 'result', summary: 's', remaining: 'なし', decisions: 'なし', points: [] });
    wait(w.tpm, 'pm', '指示');
    expect(w.tpm.state.lines<WaitChange>('waits.jsonl').map(l => [l.by, l.address, l.text])).toEqual([
      // 担当の名乗り（roster hello）の状態も残す（roster time が、名乗りから数え始める）。
      ['t-x7k2', 'file:1', '作業中: 依頼書を読む'],
      ['t-x7k2', 'file:1', '作業中: 実装'],
      ['t-x7k2', 'file:1', '回答待ち(TPM): 次の依頼'],
      ['tpm', 'file:tpm', '回答待ち(PM): 指示'],
    ]);
  });
});
