import { describe, expect, test } from 'vitest';
import type { Exec, ExecResult } from '../src/exec.ts';
import { TpmError } from '../src/skill-sets.ts';
import { CmuxTransport } from '../src/transport/cmux.ts';

const ID = '8f467603-61d6-4ead-a735-1f46bfbd0969';

/** 打たれた命令を覚え、引数の頭が合う答えを返す偽の exec。 */
function fake(answers: [prefix: string, result: Partial<ExecResult> | (() => Partial<ExecResult>)][]) {
  const calls: { args: string[], input?: string }[] = [];
  const exec: Exec = (cmd, args, options) => {
    expect(cmd).toBe('cmux');
    calls.push({ args, ...(options?.input === undefined ? {} : { input: options.input }) });
    const line = args.join(' ');
    const hit = answers.find(([prefix]) => line.startsWith(prefix));
    const result = typeof hit?.[1] === 'function' ? hit[1]() : hit?.[1];
    return { status: 0, stdout: '', stderr: '', ...result };
  };
  return { exec, calls, transport: new CmuxTransport(exec, () => undefined) };
}
const json = (value: unknown): Partial<ExecResult> => ({ stdout: JSON.stringify(value) });

describe('CmuxTransport', () => {
  test('whoami は identify の caller の workspace', () => {
    const { transport } = fake([['--json identify', json({ caller: { workspace_ref: 'workspace:7', surface_ref: 'surface:9' } })]]);
    expect(transport.whoami()).toBe('workspace:7');
  });

  test('cmux の外では whoami が TpmError', () => {
    const { transport } = fake([['--json identify', json({})]]);
    expect(() => transport.whoami()).toThrow(TpmError);
  });

  test('send は本文を標準入力で渡し、inbox で届いたかを見る', () => {
    const { transport, calls } = fake([
      ['agent message', { stdout: `Queued message ${ID} for TPM (surface:1).\n` }],
      ['--json agent inbox', json({ messages: [{ id: ID, state: 'delivered' }] })],
    ]);
    expect(transport.send('workspace:1', 'SE t-x: 題', '【完成】- で始まらない本文')).toEqual({ id: ID, delivered: true });
    expect(calls[0]).toEqual({ args: ['agent', 'message', 'workspace:1', '--from', 'SE t-x: 題', '-'], input: '【完成】- で始まらない本文' });
    expect(calls[1]?.args).toEqual(['--json', 'agent', 'inbox', '--surface', 'workspace:1', '--limit', '20']);
  });

  test('返事は --reply-to で送る', () => {
    const { transport, calls } = fake([
      ['agent message', { stdout: `Queued message ${ID} for TPM.\n` }],
      ['--json agent inbox', json({ messages: [{ id: ID, state: 'read' }] })],
    ]);
    expect(transport.send('workspace:1', 'TPM', '受け取った', 'abc').delivered).toBe(true);
    expect(calls[0]?.args).toEqual(['agent', 'message', '--reply-to', 'abc', '--from', 'TPM', '-']);
  });

  test('queued のままなら、何度か見てから delivered: false を返す', () => {
    const { transport, calls } = fake([
      ['agent message', { stdout: `Queued message ${ID} for TPM.\n` }],
      ['--json agent inbox', json({ messages: [{ id: ID, state: 'queued' }] })],
    ]);
    expect(transport.send('workspace:1', 'SE', '本文')).toEqual({ id: ID, delivered: false });
    expect(calls.filter(c => c.args.includes('inbox'))).toHaveLength(4);
  });

  test('pending は自分宛ての queued のメッセージを、既読にせずに読む', () => {
    const { transport, calls } = fake([
      ['--json identify', json({ caller: { workspace_ref: 'workspace:7' } })],
      ['--json agent inbox', json({ messages: [{ id: ID, sender_name: 'Technical Program Manager', body: '【brief】u', state: 'queued' }] })],
    ]);
    expect(transport.pending()).toEqual([{ id: ID, from: 'Technical Program Manager', text: '【brief】u' }]);
    expect(calls[1]?.args).toEqual(['--json', 'agent', 'inbox', '--surface', 'workspace:7', '--state', 'queued']);
  });

  test('spawn は居場所を作って宛先を返し、focus を奪わない', () => {
    const { transport, calls } = fake([['--json workspace create', json({ workspace_ref: 'workspace:12', surface_ref: 'surface:3' })]]);
    expect(transport.spawn({ title: 'Software Engineer t-x: 題', cwd: '/w', command: 'tpm run-role t-x' })).toBe('workspace:12');
    expect(calls[0]?.args).toEqual(['--json', 'workspace', 'create', '--name', 'Software Engineer t-x: 題', '--cwd', '/w', '--command', 'tpm run-role t-x', '--focus', 'false']);
  });

  test('1,024 バイトを超える命令は起こさずに TpmError', () => {
    const { transport, calls } = fake([]);
    expect(() => transport.spawn({ title: 't', cwd: '/w', command: 'あ'.repeat(342) })).toThrow(/1024 バイト/);
    expect(calls).toHaveLength(0);
  });

  test('seats は workspace の ref と題', () => {
    const { transport } = fake([['--json workspace list', json({ workspaces: [{ ref: 'workspace:1', title: 'Technical Program Manager', index: 0 }] })]]);
    expect(transport.seats()).toEqual([{ address: 'workspace:1', title: 'Technical Program Manager' }]);
  });

  test('status は状態の行だけを読み、字の中の空白と = を保つ', () => {
    const { transport } = fake([['sidebar-state', {
      stdout: [
        'tab=A3CC',
        'cwd=/w',
        'status_count=3',
        '  model=Fable 5.2 · medium icon=sparkle priority=90',
        '  wait=回答待ち(TPM): merge（a=b icon=x まで） icon=hourglass priority=80',
        '  claude_code=Running icon=bolt.fill color=#4C8DFF work=running',
        'log_count=0',
      ].join('\n'),
    }]]);
    expect(transport.status('workspace:1')).toEqual({
      model: 'Fable 5.2 · medium',
      wait: '回答待ち(TPM): merge（a=b icon=x まで）',
      claude_code: 'Running',
    });
  });

  test('無い居場所の status は undefined', () => {
    const { transport } = fake([['sidebar-state', { status: 1, stderr: 'Error: Workspace ref not found' }]]);
    expect(transport.status('workspace:999')).toBeUndefined();
  });

  test('setStatus は鍵ごとの icon と priority を付ける', () => {
    const { transport, calls } = fake([]);
    transport.setStatus('wait', '作業中: 読む');
    transport.setStatus('model', 'Opus 5.5 · medium');
    expect(calls.map(c => c.args)).toEqual([
      ['set-status', 'wait', '作業中: 読む', '--icon', 'hourglass', '--priority', '80'],
      ['set-status', 'model', 'Opus 5.5 · medium', '--icon', 'sparkle', '--priority', '90'],
    ]);
  });

  test('setTitle は自分の workspace の題を替える', () => {
    const { transport, calls } = fake([['--json identify', json({ caller: { workspace_ref: 'workspace:7' } })]]);
    transport.setTitle('Technical Program Manager');
    expect(calls[1]?.args).toEqual(['workspace', 'rename', 'workspace:7', '--title', 'Technical Program Manager']);
  });

  test('show は自分の居場所で開き、close は --force を付ける', () => {
    const { transport, calls } = fake([['--json identify', json({ caller: { workspace_ref: 'workspace:7' } })]]);
    transport.show('https://example.com/a');
    transport.close('workspace:12');
    expect(calls.map(c => c.args)).toEqual([
      ['--json', 'identify'],
      ['open', 'https://example.com/a', '--workspace', 'workspace:7'],
      ['workspace', 'close', 'workspace:12', '--force'],
    ]);
  });

  test('cmux が失敗したら、命令と出力を添えた TpmError', () => {
    const { transport } = fake([['workspace close', { status: 1, stderr: 'Error: Workspace ref not found: workspace:999\n' }]]);
    expect(() => transport.close('workspace:999')).toThrow(/cmux workspace close workspace:999 --force が失敗しました（1）: Error: Workspace ref not found/);
  });
});
