import { execFileSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { buildCommand, shellQuote } from '../src/command.js';

const head = 'claude --model claude-opus-5-5 --effort medium --permission-mode bypassPermissions';

describe('buildCommand', () => {
  test('追加の skill セットが無ければ /tpm', () => {
    expect(buildCommand('/w', '/r', [])).toBe(`cd /w && ${head} --add-dir /r/core -- /tpm`);
  });

  test('追加の skill セットを --add-dir に足しても、最初の入力は /tpm のまま', () => {
    expect(buildCommand('/w', '/r', ['dependabot', 'x'])).toBe(
      `cd /w && ${head} --add-dir /r/core /r/dependabot /r/x -- /tpm`,
    );
  });

  test('空白を含む道も引用する', () => {
    expect(buildCommand('/my work', '/my repo', [])).toBe(
      `cd '/my work' && ${head} --add-dir '/my repo/core' -- /tpm`,
    );
  });
});

describe('shellQuote', () => {
  test.each(['/a/b-c_d.e', 'x=1,2', '--add-dir'])('安全な字だけの %s はそのまま', (word) => {
    expect(shellQuote(word)).toBe(word);
  });

  test.each(['a b', 'it\'s', '$HOME', 'a;b', '', '\'\''])('sh に通すと元の %j に戻る', (word) => {
    const echoed = execFileSync('/bin/sh', ['-c', `printf %s ${shellQuote(word)}`], { encoding: 'utf8' });
    expect(echoed).toBe(word);
  });
});
