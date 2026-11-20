import { execFileSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { buildCommand } from '../src/command.ts';
import { shellQuote } from '../src/shell.ts';

const head = (root: string): string => `PATH=${root.includes(' ') ? `'${root}/cli/bin'` : `${root}/cli/bin`}:"$PATH" claude --model claude-opus-5-5 --effort medium --permission-mode bypassPermissions --settings '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"${root.includes(' ') ? `'\\''${root}/cli/bin/tpm'\\''` : `${root}/cli/bin/tpm`} guard"}]}]}}'`;

describe('buildCommand', () => {
  test('追加の skill セットが無ければ /tpm', () => {
    expect(buildCommand('/w', '/r', [])).toBe(`cd /w && ${head('/r')} --add-dir /r/skill-sets/core -- /tpm`);
  });

  test('追加の skill セットを --add-dir に足しても、最初の入力は /tpm のまま', () => {
    expect(buildCommand('/w', '/r', ['dependabot', 'x'])).toBe(
      `cd /w && ${head('/r')} --add-dir /r/skill-sets/core /r/skill-sets/dependabot /r/skill-sets/x -- /tpm`,
    );
  });

  test('空白を含む道も引用する', () => {
    expect(buildCommand('/my work', '/my repo', [])).toBe(
      `cd '/my work' && ${head('/my repo')} --add-dir '/my repo/skill-sets/core' -- /tpm`,
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
