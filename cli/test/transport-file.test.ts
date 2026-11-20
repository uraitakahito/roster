import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { State } from '../src/state.ts';
import { FileTransport } from '../src/transport/file.ts';

let state: State;
const at = (self: string): FileTransport => new FileTransport(state, self);

beforeEach(() => {
  state = new State(realpathSync(mkdtempSync(join(tmpdir(), 'tpm-file-transport-'))));
});

describe('FileTransport', () => {
  test('送った知らせは、相手の inbox に届いた順に並ぶ', () => {
    const first = at('file:1').send('file:tpm', 'SE t-x', '【完成】a');
    at('file:1').send('file:tpm', 'SE t-x', '【終わり】b', first.id);
    expect(first.delivered).toBe(true);
    expect(at('file:tpm').inbox('file:tpm')).toEqual([
      { id: first.id, from: 'SE t-x', text: '【完成】a' },
      { id: expect.any(String) as string, from: 'SE t-x', text: '【終わり】b', replyTo: first.id },
    ]);
    expect(at('file:tpm').inbox('file:1')).toEqual([]);
  });

  test('spawn は別々の宛先を返し、命令は動かさずに覚える', () => {
    const tpm = at('file:tpm');
    const a = tpm.spawn({ title: 'Software Engineer t-a: 題', cwd: '/w', command: 'tpm run-role t-a' });
    const b = tpm.spawn({ title: 'DevOps Engineer', cwd: '/w', command: 'tpm run-role devops' });
    expect(a).not.toBe(b);
    expect(tpm.seats()).toEqual([{ address: a, title: 'Software Engineer t-a: 題' }, { address: b, title: 'DevOps Engineer' }]);
    expect(tpm.command(a)).toBe('tpm run-role t-a');
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
    const a = tpm.spawn({ title: 'Sustaining Engineer app#12', cwd: '/w', command: 'c' });
    at(a).setTitle('Sustaining Engineer app#15');
    tpm.setTitle('Technical Program Manager');
    expect(tpm.seats()).toEqual([{ address: a, title: 'Sustaining Engineer app#15' }]);
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
