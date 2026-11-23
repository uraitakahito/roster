import { execFileSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { buildCommand } from '../src/command.ts';
import { guardSettings } from '../src/guard.ts';
import { shellQuote } from '../src/shell.ts';

// settings の中身は guard.test.ts が見る。ここは 1 行の組み方（引用）を見る。
const head = (root: string): string => `PATH=${root.includes(' ') ? `'${root}/cli/bin'` : `${root}/cli/bin`}:"$PATH" claude --model claude-opus-5-5 --effort medium --permission-mode bypassPermissions --settings ${shellQuote(guardSettings(`${root}/cli/bin/roster`))}`;

describe('buildCommand', () => {
  test('追加の skill セットが無ければ /tpm', () => {
    expect(buildCommand('/w', '/r', [], {})).toBe(`cd /w && ${head('/r')} --add-dir /r/skill-sets/core -- /tpm`);
  });

  test('追加の skill セットを --add-dir に足しても、最初の入力は /tpm のまま', () => {
    expect(buildCommand('/w', '/r', ['dependabot', 'x'], {})).toBe(
      `cd /w && ${head('/r')} --add-dir /r/skill-sets/core /r/skill-sets/dependabot /r/skill-sets/x -- /tpm`,
    );
  });

  test('TPM_MODEL などがあれば、旗にし、1 行の頭（PATH の隣）にも引用して写す', () => {
    const env = { TPM_MODEL: 'claude-fable-5-2', TPM_EFFORT: 'high', TPM_PERMISSION_MODE: 'accept edits' };
    expect(buildCommand('/w', '/r', [], env)).toMatch(
      /^cd \/w && PATH=\/r\/cli\/bin:"\$PATH" TPM_MODEL=claude-fable-5-2 TPM_EFFORT=high TPM_PERMISSION_MODE='accept edits' claude --model claude-fable-5-2 --effort high --permission-mode 'accept edits' --settings /,
    );
  });

  test('無い物・空の物は写さない', () => {
    expect(buildCommand('/w', '/r', [], { TPM_MODEL: '', TPM_EFFORT: 'high' })).toMatch(/^cd \/w && PATH=\/r\/cli\/bin:"\$PATH" TPM_EFFORT=high claude --model claude-opus-5-5 --effort high /);
  });

  test('空白を含む道も引用する', () => {
    expect(buildCommand('/my work', '/my repo', [], {})).toBe(
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
