import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { State } from '../src/state.ts';
import { FileTransport } from '../src/transport/file.ts';

let state: State;
const at = (self: string): FileTransport => new FileTransport(state, self);

beforeEach(() => {
  state = new State(realpathSync(mkdtempSync(join(tmpdir(), 'roster-file-transport-'))));
});

describe('FileTransport', () => {
  test('spawn は別々の宛先を返し、命令は動かさずに覚える', () => {
    const tpm = at('file:tpm');
    const a = tpm.spawn({ title: 'SWE t-a3b4: 題', cwd: '/w', command: 'roster run-role t-a3b4' });
    const b = tpm.spawn({ title: 'DevOps', cwd: '/w', command: 'roster run-role devops' });
    expect(a).not.toBe(b);
    expect(tpm.seats()).toEqual([{ address: a, title: 'SWE t-a3b4: 題' }, { address: b, title: 'DevOps' }]);
    expect(tpm.command(a)).toBe('roster run-role t-a3b4');
  });

  test('状態は自分の居場所に出し、ほかの居場所から読める', () => {
    const tpm = at('file:tpm');
    const a = tpm.spawn({ title: 't', cwd: '/w', command: 'c' });
    expect(tpm.status(a)).toBeUndefined();
    at(a).setStatus('model', 'Opus 5.5 · medium');
    at(a).setStatus('wait', '作業中: 読む');
    at(a).setStatus('wait', '回答待ち(TPM): 次の依頼');
    expect(tpm.status(a)).toEqual({ model: 'Opus 5.5 · medium', wait: '回答待ち(TPM): 次の依頼' });
  });

  test('setTitle は自分の居場所の題を替える', () => {
    const tpm = at('file:tpm');
    const a = tpm.spawn({ title: 'Sustaining app#12', cwd: '/w', command: 'c' });
    at(a).setTitle('Sustaining app#15');
    tpm.setTitle('Technical Program Manager');
    expect(tpm.seats()).toEqual([{ address: a, title: 'Sustaining app#15' }]);
  });

  test('spawn は説明を、setColor は色を覚える。relabel はほかの居場所の題と説明を替え、説明が無ければ消す', () => {
    const tpm = at('file:tpm');
    const a = tpm.spawn({ title: 'レビュー t-a3b4: 計画 plan-1', cwd: '/w', command: 'c', description: '名簿の Key' });
    tpm.setColor(a, 'Purple');
    const b = tpm.spawn({ title: 'SWE t-a3b4: 題', cwd: '/w', command: 'c' });
    expect(tpm.look(a)).toEqual({ title: 'レビュー t-a3b4: 計画 plan-1', description: '名簿の Key', color: 'Purple' });
    expect(tpm.look(b)).toEqual({ title: 'SWE t-a3b4: 題' });
    tpm.relabel(a, { title: 'レビュー t-a3b4: PR #7' });
    expect(tpm.look(a)).toEqual({ title: 'レビュー t-a3b4: PR #7', color: 'Purple' });
    tpm.relabel(a, { title: 'レビュー t-a3b4: PR #8', description: '試験' });
    expect(tpm.look(a)).toEqual({ title: 'レビュー t-a3b4: PR #8', description: '試験', color: 'Purple' });
    expect(tpm.look('file:99')).toBeUndefined();
  });

  test('close した居場所は一覧と状態から消える', () => {
    const tpm = at('file:tpm');
    const a = tpm.spawn({ title: 't', cwd: '/w', command: 'c' });
    at(a).setStatus('wait', '作業中: 読む');
    tpm.close(a);
    expect(tpm.seats()).toEqual([]);
    expect(tpm.status(a)).toBeUndefined();
  });
});
