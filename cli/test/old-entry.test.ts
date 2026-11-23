// 道具の古い名の入口（cli/bin/tpm）。切り替えの間だけ残し、hook と居場所の命令だけを roster に渡す（t-v28j）。
// 全部の席を起こし直した後の PR で、入口と一緒にこの file を消す。
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { staleHook } from '../src/commands/banner.ts';

const cli = join(import.meta.dirname, '..');
const OLD_ENTRY = join(cli, 'bin', 'tpm');
const NEW_ENTRY = join(cli, 'bin', 'roster');
// cmux の app が hook に渡す PATH。TPM_* と cmux の変数は渡さない（本物の project と cmux に触らない）。
const APP_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
const NODE = `exec '${process.execPath}' "$@"`;

/** 一時の home（状態・設定もここ）と、node の shim を置いた nodenv の root。 */
function sandbox(): { home: string, env: NodeJS.ProcessEnv } {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'roster-old-entry-')));
  const nodenv = join(home, 'nodenv');
  mkdirSync(join(nodenv, 'shims'), { recursive: true });
  writeFileSync(join(nodenv, 'shims', 'node'), `#!/bin/sh\n${NODE}\n`);
  chmodSync(join(nodenv, 'shims', 'node'), 0o755);
  return { home, env: { PATH: APP_PATH, HOME: home, NODENV_ROOT: nodenv, XDG_STATE_HOME: home, XDG_CONFIG_HOME: home } };
}

const run = (entry: string, args: string[], env: NodeJS.ProcessEnv, input = '') =>
  spawnSync(entry, args, { input, encoding: 'utf8', cwd: '/', env });

const bash = (command: string): string => JSON.stringify({ tool_name: 'Bash', tool_input: { command } });

describe('古い入口は hook の命令を roster に渡す', () => {
  test('guard: 止める・通すと、exit の値と出力が roster と同じ', () => {
    const { env } = sandbox();
    for (const command of ['roster audit start', 'cmux set-status x', 'ls']) {
      const old = run(OLD_ENTRY, ['guard'], env, bash(command));
      const now = run(NEW_ENTRY, ['guard'], env, bash(command));
      expect({ status: old.status, stdout: old.stdout, stderr: old.stderr }, command).toEqual({ status: now.status, stdout: now.stdout, stderr: now.stderr });
    }
    expect(run(OLD_ENTRY, ['guard'], env, bash('roster audit start')).status).toBe(2);
    expect(run(OLD_ENTRY, ['guard'], env, bash('ls')).status).toBe(0);
  });

  test('banner hook: cmux の app と同じ既定の PATH でも新しいコードに届き、標準出力に何も足さない', () => {
    const { env } = sandbox();
    const input = JSON.stringify({ notification: { workspaceId: 'X' }, agent: { category: 'custom' } });
    const r = run(OLD_ENTRY, ['banner', 'hook'], env, input);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('{}\n');
  });

  test('symlink から呼んでも、隣の roster を見つける', () => {
    const { home, env } = sandbox();
    const link = join(home, 'old-link');
    symlinkSync(OLD_ENTRY, link);
    const r = run(link, ['guard'], env, bash('roster audit start'));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Audit の席を起こすのは Product Manager です');
  });

  test('ほかの hook の命令（returned check・audit fresh・castlist session-start|session-end）と run-role も渡す', () => {
    const { env } = sandbox();
    for (const args of [['returned', 'check'], ['audit', 'fresh'], ['castlist', 'session-start'], ['castlist', 'session-end'], ['run-role']]) {
      const old = run(OLD_ENTRY, args, env, '{}');
      const now = run(NEW_ENTRY, args, env, '{}');
      expect({ status: old.status, stdout: old.stdout, stderr: old.stderr }, args.join(' ')).toEqual({ status: now.status, stdout: now.stdout, stderr: now.stderr });
      expect(old.stderr, args.join(' ')).not.toContain('道具の名は roster に替わりました');
    }
  });
});

describe('古い入口は、人と担当が打つ命令を止めて新しい名を案内する', () => {
  test.each([['hello'], ['audit', 'start'], ['report', 'done', '--url', 'x'], ['start'], []])('%s', (...args) => {
    const { env } = sandbox();
    const r = run(OLD_ENTRY, args, env);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain(`道具の名は roster に替わりました。${['roster', ...args].join(' ')} を打ってください（入口: ${NEW_ENTRY}）`);
  });

  test('案内の命令は、空白や引用符を含む引数を引用して、写して打てる形で出す', () => {
    const { env } = sandbox();
    const r = run(OLD_ENTRY, ['ask', 'tpm', 'CI が落ちる 訳は不明', 'it\'s'], env);
    expect(r.stderr).toContain(`roster ask tpm 'CI が落ちる 訳は不明' 'it'\\''s' を打ってください`);
  });

  test('$TPM_KEY が無い（TPM 担当の居場所か Product Manager の shell）なら起こし直しは Product Manager、あれば TPM 担当に頼む', () => {
    const { env } = sandbox();
    expect(run(OLD_ENTRY, ['hello'], env).stderr).toContain('Product Manager が roster start の 1 行で起こし直す');
    expect(run(OLD_ENTRY, ['hello'], { ...env, TPM_KEY: 't-x7k2' }).stderr).toContain('TPM 担当に起こし直しを頼む');
  });
});

describe('バナーの hook の命令が古い入口を指していれば、張り直すよう知らせる', () => {
  test('古い入口・repo を移した・合っている、を見分ける', () => {
    const root = '/opt/roster';
    expect(staleHook(`${OLD_ENTRY} banner hook`, root, {})).toMatch(/古い入口です/);
    expect(staleHook(`"${OLD_ENTRY}" banner hook`, root, {})).toMatch(/古い入口です/);
    expect(staleHook('/elsewhere/cli/bin/roster banner hook', root, {})).toMatch(/在り処と違います/);
    expect(staleHook('/opt/roster/cli/bin/roster banner hook', root, {})).toBeUndefined();
    // 後ろに書き足してあっても、入口（1 語目）で見分ける
    expect(staleHook('/opt/roster/cli/bin/roster banner hook 2>/dev/null', root, {})).toMatch(/在り処と違います/);
    expect(staleHook(`'${OLD_ENTRY}' banner hook 2>/dev/null`, root, {})).toMatch(/古い入口です/);
    expect(staleHook('"$HOME/r/cli/bin/roster" banner hook 2>/dev/null', root, {})).toMatch(/在り処と違います/);
  });
});
