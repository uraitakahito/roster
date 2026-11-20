import { describe, expect, test } from 'vitest';
import { exec } from '../src/exec.ts';

describe('exec', () => {
  test('標準出力・標準エラー・終了コードを返す', () => {
    expect(exec('/bin/sh', ['-c', 'echo out; echo err >&2; exit 3'])).toEqual({ status: 3, stdout: 'out\n', stderr: 'err\n' });
  });

  test('標準入力と cwd を渡せる', () => {
    expect(exec('/bin/sh', ['-c', 'cat; pwd'], { input: 'in\n', cwd: '/' }).stdout).toBe('in\n/\n');
  });

  test('無い命令は status 127', () => {
    expect(exec('/nope/nope', []).status).toBe(127);
  });
});
