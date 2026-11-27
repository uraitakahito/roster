import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { buildCommand, REPLY_LANGUAGE } from '../src/command.ts';
import { guardSettings } from '../src/guard.ts';
import { shellQuote } from '../src/shell.ts';

// settings の中身は guard.test.ts が見る。ここは 1 行の組み方（引用）を見る。
const head = (root: string): string => `PATH=${root.includes(' ') ? `'${root}/cli/bin'` : `${root}/cli/bin`}:"$PATH" claude --model claude-opus-5-5 --effort medium --permission-mode bypassPermissions --settings ${shellQuote(guardSettings(`${root}/cli/bin/roster`))} --append-system-prompt ${shellQuote(REPLY_LANGUAGE)}`;

describe('buildCommand', () => {
  test('追加の skill セットが無ければ /tpm', () => {
    expect(buildCommand('/w', '/r', [], {})).toBe(`cd /w && ${head('/r')} --add-dir /r/skill-sets/core -- /tpm`);
  });

  test('追加の skill セットを --add-dir に足しても、最初の入力は /tpm のまま', () => {
    expect(buildCommand('/w', '/r', ['dependabot', 'x'], {})).toBe(
      `cd /w && ${head('/r')} --add-dir /r/skill-sets/core /r/skill-sets/dependabot /r/skill-sets/x -- /tpm`,
    );
  });

  test('ROSTER_MODEL などがあれば、旗にし、1 行の頭（PATH の隣）にも引用して写す', () => {
    const env = { ROSTER_MODEL: 'claude-fable-5-2', ROSTER_EFFORT: 'high', ROSTER_PERMISSION_MODE: 'accept edits' };
    expect(buildCommand('/w', '/r', [], env)).toMatch(
      /^cd \/w && PATH=\/r\/cli\/bin:"\$PATH" ROSTER_MODEL=claude-fable-5-2 ROSTER_EFFORT=high ROSTER_PERMISSION_MODE='accept edits' claude --model claude-fable-5-2 --effort high --permission-mode 'accept edits' --settings /,
    );
  });

  test('無い物・空の物は写さない', () => {
    expect(buildCommand('/w', '/r', [], { ROSTER_MODEL: '', ROSTER_EFFORT: 'high' })).toMatch(/^cd \/w && PATH=\/r\/cli\/bin:"\$PATH" ROSTER_EFFORT=high claude --model claude-opus-5-5 --effort high /);
  });

  test('空白を含む道も引用する', () => {
    expect(buildCommand('/my work', '/my repo', [], {})).toBe(
      `cd '/my work' && ${head('/my repo')} --add-dir '/my repo/skill-sets/core' -- /tpm`,
    );
  });

  test('返事の言葉の 1 文を、--append-system-prompt の 1 語として渡す（--add-dir の前）', () => {
    const line = buildCommand('/w', '/r', [], {});
    const argv = execFileSync('/bin/sh', ['-c', `set -- ${line.slice(line.indexOf(' claude ') + ' claude '.length)}; for a; do printf '%s\\0' "$a"; done`], { encoding: 'utf8' }).split('\0').slice(0, -1);
    const at = argv.indexOf('--append-system-prompt');
    expect(argv[at + 1]).toBe(REPLY_LANGUAGE);
    expect(at).toBeLessThan(argv.indexOf('--add-dir'));
  });

  test('返事の言葉の 1 文は、TPM 担当の手順書の「返事の言葉」と同じ', () => {
    const skill = readFileSync(join(import.meta.dirname, '../../skill-sets/core/.claude/skills/tpm/SKILL.md'), 'utf8');
    expect(skill).toContain(`**返事の言葉**: ${REPLY_LANGUAGE}`);
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
