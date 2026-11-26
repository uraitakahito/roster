// メッセージを NATS で配る道の、手元の物の試験: 設定・受け手の名・Claude Code の pid・名乗り・席に付ける hook。
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { buildCommand, startTpm } from '../src/command.ts';
import { mailClaim, mailRelease } from '../src/commands/mail.ts';
import { notify, type Sent } from '../src/commands/messages.ts';
import { composeRolesConfig, readRolesConfig } from '../src/config.ts';
import { guardSettings } from '../src/guard.ts';
import { claimOf, claudePid, ownClaim, readClaim, recipientName, waiterFile } from '../src/mail.ts';
import { claudeArgs } from '../src/run-role.ts';
import type { RoleRecord } from '../src/roster.ts';
import { FakeProcs, world } from './helpers.ts';
import { left, natsWorld } from './mail-helpers.ts';

describe('設定の messages', () => {
  const file = (body: string): string => {
    const dir = mkdtempSync(join(tmpdir(), 'roster-mail-'));
    mkdirSync(join(dir, '.claude', 'roles'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'roles', 'config.jsonc'), body);
    return dir;
  };

  test('書かなければ欄は無く、nats と書けば入る（どちらも同じ動き）。cmux は外した事を伝える誤り。ほかの値も誤り', () => {
    expect(composeRolesConfig(file('{}')).messages).toBeUndefined();
    expect(composeRolesConfig(file('{ "messages": "nats" }')).messages).toBe('nats');
    expect(() => composeRolesConfig(file('{ "messages": "cmux" }'))).toThrow(/config\.jsonc の messages の cmux は外しました（メッセージは、いつも NATS JetStream で配ります）。この行を消してください$/);
    expect(() => readRolesConfig(join(file('{ "messages": "kafka" }'), '.claude', 'roles', 'config.jsonc'))).toThrow(/messages は nats のどれか/);
  });

  test('nats と書いても書かなくても、メッセージは配りの口（NATS）に置かれ、席には渡す hook が付く', async () => {
    for (const config of [{}, { messages: 'nats' }]) {
      const w = await natsWorld(config);
      await notify(w.tpm, 't-x7k2', { text: '知らせ' });
      expect(left(w, 't-x7k2').map(m => m.text)).toEqual(['【notify】知らせ']);
      expect(w.tpm.state.lines<Sent>('log.jsonl').at(-1)).toMatchObject({ carrier: 'nats', box: 't-x7k2' });
      expect((await startTpm(w.tpm)).line).toContain('mail wait');
    }
  });

  test('直下の folder の設定の messages は読まない（project の folder の設定だけ）', () => {
    const dir = file('{}');
    mkdirSync(join(dir, 'web', '.claude', 'roles'), { recursive: true });
    writeFileSync(join(dir, 'web', '.claude', 'roles', 'config.jsonc'), '{ "messages": "nats" }');
    expect(composeRolesConfig(dir).messages).toBeUndefined();
  });
});

describe('受け手の名', () => {
  test('英数字と - はそのまま。ほかの字は byte ごとに _ と 16 進 2 桁。起こした回は __ で続ける', () => {
    expect(recipientName({ key: 't-h83j' })).toBe('t-h83j');
    expect(recipientName({ key: 'tpm' })).toBe('tpm');
    expect(recipientName({ key: 'AI-25.staff' })).toBe('AI-25_2estaff');
    expect(recipientName({ key: 'a_b' })).toBe('a_5fb');
    expect(recipientName({ key: 'roster#12' })).toBe('roster_2312');
    expect(recipientName({ key: 'あ' })).toBe('_e3_81_82');
    expect(recipientName({ key: 't-1', launch: '5F0C2B8E-1111-4222-8333-444455556666' })).toBe('t-1__5F0C2B8E-1111-4222-8333-444455556666');
  });

  test('TPM 担当だけは、起こした回を付けない（起こし直した TPM 担当が、前の TPM 担当宛ての物を受け取る）', () => {
    expect(recipientName({ key: 'tpm', launch: '5F0C2B8E-1111-4222-8333-444455556666' })).toBe('tpm');
    expect(recipientName({ key: 'tpm', launch: 'L2' })).toBe(recipientName({ key: 'tpm' }));
  });

  test('違う組は、同じ名にならない。64 字を超える組は誤り', () => {
    const parties = [{ key: 'a' }, { key: 'a', launch: 'b' }, { key: 'a_' }, { key: 'a_5f' }, { key: 'a__b' }, { key: 'a', launch: '_b' }, { key: 'a.b' }, { key: 'a-b' }, { key: 'a_2eb' }];
    expect(new Set(parties.map(recipientName)).size).toBe(parties.length);
    for (const p of parties) expect(recipientName(p)).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(recipientName({ key: 'k'.repeat(26), launch: '5F0C2B8E-1111-4222-8333-444455556666' })).toHaveLength(64);
    expect(() => recipientName({ key: 'k'.repeat(27), launch: '5F0C2B8E-1111-4222-8333-444455556666' })).toThrow(/受け手の名が作れません/);
  });
});

describe('Claude Code の pid', () => {
  const chain = (): FakeProcs => {
    const procs = new FakeProcs();
    // roster（4242）← hook の shell（300）← Claude Code（200）← roster run-role（100）
    procs.add(4242, 300, 'node');
    procs.add(300, 200, '/bin/sh');
    procs.add(200, 100, '/home/me/.local/bin/claude');
    procs.add(100, 1, 'node');
    return procs;
  };

  test('環境変数の pid が、自分の親の列に居れば、それ（cmux の物が先）', () => {
    expect(claudePid({ CMUX_CLAUDE_PID: '200', CLAUDE_PID: '100' }, chain())).toEqual({ pid: 200, from: 'CMUX_CLAUDE_PID' });
    expect(claudePid({ CLAUDE_PID: '200' }, chain())).toEqual({ pid: 200, from: 'CLAUDE_PID' });
  });

  test('環境変数の pid が親の列に居なければ使わず、親の列の claude を取る', () => {
    const procs = chain();
    procs.add(999, 1, 'claude');
    expect(claudePid({ CMUX_CLAUDE_PID: '999', CLAUDE_PID: 'x' }, procs)).toEqual({ pid: 200, from: 'parent' });
    expect(claudePid({}, procs)).toEqual({ pid: 200, from: 'parent' });
  });

  test('path に空白のある Claude Code も、親の列から見つける', () => {
    const procs = new FakeProcs();
    procs.add(4242, 300, 'node');
    procs.add(300, 200, '/bin/sh');
    procs.add(200, 1, '/Users/me/Application Support/Claude Code/claude');
    expect(claudePid({}, procs)).toEqual({ pid: 200, from: 'parent' });
    // 名が claude で終わるだけの物は、当てない。
    procs.add(200, 1, '/opt/tools/not claude/run');
    expect(claudePid({}, procs)).toBeUndefined();
  });

  test('どちらでも分からなければ undefined', () => {
    const procs = new FakeProcs();
    procs.add(4242, 300, 'node');
    procs.add(300, 1, '/bin/sh');
    expect(claudePid({ CLAUDE_PID: '200' }, procs)).toBeUndefined();
    expect(claudePid({}, new FakeProcs())).toBeUndefined();
  });
});

describe('名乗り（roster mail claim・release）', () => {
  const seat = (config: Record<string, unknown> = { messages: 'nats' }) => {
    const w = world(config);
    w.procs.add(4242, 200, 'node');
    w.procs.add(200, 1, 'claude');
    const se = { ...w.role('t-1', 'file:t-1'), env: { ...w.role('t-1', 'file:t-1').env, CMUX_CLAUDE_PID: '200', ROSTER_LAUNCH: 'L1' } };
    return { w, se };
  };

  test('session の始めに名乗りを書き、効いている間だけ引ける。終わりに消す', () => {
    const { w, se } = seat();
    mailClaim(se, JSON.stringify({ session_id: 's-1' }));
    expect(readClaim(se, 't-1__L1')).toEqual({ name: 't-1__L1', party: { key: 't-1', launch: 'L1' }, session: 's-1', pid: 200, started: 'started-200', from: 'CMUX_CLAUDE_PID', at: '2026-11-20T12:00:00.000Z' });
    expect(ownClaim(se)?.pid).toBe(200);
    expect(claimOf(w.tpm, { key: 't-1', launch: 'L1' })?.name).toBe('t-1__L1');
    // 起こした回の違う組・無い組は、別の受け手。
    expect(claimOf(w.tpm, { key: 't-1' })).toBeUndefined();
    expect(claimOf(w.tpm, { key: 't-1', launch: 'L2' })).toBeUndefined();
    expect(claimOf(w.tpm, { key: 't-2' })).toBeUndefined();
    mailRelease(se, JSON.stringify({ session_id: 's-1' }));
    expect(readClaim(se, 't-1__L1')).toBeUndefined();
    expect(ownClaim(se)).toBeUndefined();
  });

  test('pid の process が居ない・始まった時刻が違う名乗りは、効かない', () => {
    const { w, se } = seat();
    mailClaim(se, '{}');
    w.procs.alive.delete(200);
    expect(ownClaim(se)).toBeUndefined();
    expect(claimOf(w.tpm, { key: 't-1' })).toBeUndefined();
    // 同じ番号を、別の process が持った。
    w.procs.alive.set(200, { started: 'later', ppid: 1, command: 'vim' });
    expect(ownClaim(se)).toBeUndefined();
  });

  test('Claude Code の pid が分からなければ名乗らず、前の名乗りも消す', () => {
    const { w, se } = seat();
    mailClaim(se, '{}');
    expect(readClaim(se, 't-1__L1')).toBeDefined();
    w.procs.alive.delete(200);
    mailClaim(se, '{}');
    expect(readClaim(se, 't-1__L1')).toBeUndefined();
  });

  test('手伝いの中では、名乗らない', () => {
    const { se } = seat();
    mailClaim(se, JSON.stringify({ session_id: 's-1', agent_id: 'a-1' }));
    expect(readClaim(se, 't-1__L1')).toBeUndefined();
    mailClaim(se, 'JSON でない');
    expect(readClaim(se, 't-1__L1')?.session).toBeUndefined();
    mailRelease(se, JSON.stringify({ agent_id: 'a-1' }));
    expect(readClaim(se, 't-1__L1')).toBeDefined();
  });

  test('終わる session が書いた名乗りだけを消す（/clear の後の、次の session の名乗りは残す）。待つ命令も止める', () => {
    const { w, se } = seat();
    mailClaim(se, JSON.stringify({ session_id: 's-2' }));
    mailRelease(se, JSON.stringify({ session_id: 's-1' }));
    expect(readClaim(se, 't-1__L1')?.session).toBe('s-2');
    w.procs.add(700);
    se.state.write(waiterFile('t-1__L1'), { pid: 700, started: 'started-700' });
    mailRelease(se, JSON.stringify({ session_id: 's-2' }));
    expect(readClaim(se, 't-1__L1')).toBeUndefined();
    expect(w.procs.stopped).toEqual([700]);
    expect(se.state.read(waiterFile('t-1__L1'))).toBeUndefined();
  });

  test('TPM 担当も、TPM 担当の組で名乗る', () => {
    const w = world({ messages: 'nats' });
    w.procs.add(4242, 200, 'node');
    w.procs.add(200, 1, 'claude');
    mailClaim(w.tpm, JSON.stringify({ session_id: 's-t' }));
    expect(claimOf(w.role('t-1', 'file:t-1'), { key: 'tpm' })?.name).toBe('tpm');
    // 起こした回があっても、TPM 担当の名は 1 つ。起こし直した session の名乗りが、前の物を書き替える。
    w.procs.add(300, 1, 'claude');
    const again = { ...w.tpm, env: { ...w.tpm.env, ROSTER_LAUNCH: 'L2', CMUX_CLAUDE_PID: '300' } };
    w.procs.add(4242, 300, 'node');
    mailClaim(again, JSON.stringify({ session_id: 's-t2' }));
    expect(readClaim(w.tpm, 'tpm')).toMatchObject({ party: { key: 'tpm', launch: 'L2' }, session: 's-t2', pid: 300 });
    expect(claimOf(w.tpm, { key: 'tpm', launch: 'L1' })?.pid).toBe(300);
    // 前の session の終わりの hook は、新しい session の名乗りを消さない。
    mailRelease(w.tpm, JSON.stringify({ session_id: 's-t' }));
    expect(readClaim(w.tpm, 'tpm')?.session).toBe('s-t2');
  });
});

describe('席に付ける hook（guardSettings）', () => {
  type Hooks = Record<string, { matcher?: string, hooks: Record<string, unknown>[] }[]>;
  const hooks = (settings: string): Hooks => (JSON.parse(settings) as { hooks: Hooks }).hooks;
  const BIN = '/r/cli/bin/roster';
  const record = { key: 't-1', role: 'software-engineer', title: 't', cwd: '/w', addDirs: ['/s'], model: 'm', effort: 'e', permissionMode: 'p' } as RoleRecord;

  test('どの席にも、渡す hook が付く。届け違いを見る hook（returned check）は付かない', () => {
    const h = hooks(guardSettings(BIN, 'auditor'));
    const waiting = { type: 'command', async: true, asyncRewake: true, timeout: 86400, command: `${BIN} mail wait` };
    expect(Object.keys(h)).toEqual(['PreToolUse', 'SessionStart', 'SessionEnd', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'UserPromptSubmit']);
    expect(h.SessionStart?.[0]?.hooks.map(c => c.command)).toEqual([`${BIN} audit fresh`, `${BIN} castlist session-start`, `${BIN} mail claim`, `${BIN} mail wait`]);
    expect(h.SessionStart?.[0]?.hooks.at(-1)).toEqual(waiting);
    expect(h.SessionEnd?.[0]?.hooks.map(c => c.command)).toEqual([`${BIN} castlist session-end`, `${BIN} mail release`]);
    expect(h.PostToolUseFailure).toEqual([{ matcher: 'Bash', hooks: [{ type: 'command', command: `${BIN} mail gate` }] }]);
    // 結果を pipe で切ると、止まった命令も「成功」になるので、成功の後にも付ける。
    expect(h.PostToolUse).toEqual(h.PostToolUseFailure);
    expect(h.Stop).toEqual([{ hooks: [waiting] }]);
    expect(h.UserPromptSubmit).toEqual([{ hooks: [{ type: 'command', command: `${BIN} mail prompt` }] }]);
    // TPM 担当の席（役割なし）・担当の席にも同じ hook が付く。
    expect(hooks(guardSettings(BIN)).SessionStart?.[0]?.hooks.map(c => c.command)).toEqual([`${BIN} castlist session-start`, `${BIN} mail claim`, `${BIN} mail wait`]);
    for (const settings of [guardSettings(BIN), guardSettings(BIN, 'auditor'), guardSettings(BIN, 'software-engineer')]) expect(settings).not.toContain('returned check');
    expect(claudeArgs(record, '/r')[1]).toBe(guardSettings(BIN, 'software-engineer'));
    expect(buildCommand('/w', '/r', [], {})).toContain('mail wait');
  });
});
