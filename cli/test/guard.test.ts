import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { guard, infraApprove, infraList, infraRevoke, infraRun } from '../src/commands/infra.ts';
import type { InfraEnv } from '../src/config.ts';
import { commandOf, guardSettings, judge, touched, type Approval } from '../src/guard.ts';
import type { RoleName } from '../src/protocol.ts';
import { splitCommands } from '../src/shell.ts';
import { world } from './helpers.ts';

describe('splitCommands', () => {
  test('単純な命令に分け、引用を外し、頭の代入・前に付く語・path・redirect の先を外す', () => {
    expect(splitCommands('cd "/a b" && FOO=1 sudo -E /usr/bin/git commit -m \'x; y\' 2>&1 | tee log')).toEqual([
      ['cd', '/a b'],
      ['git', 'commit', '-m', 'x; y'],
      ['tee', 'log'],
    ]);
  });

  test('$(…)・`…`・sh -c の中の命令を（外の命令より先に）拾い、here-document の中身と注釈は拾わない', () => {
    expect(splitCommands('a=$(b c) d "`e`"\nbash -c \'f; g\'\ncat <<\'E\'\nh i\nE\nj # k')).toEqual([
      ['b', 'c'],
      ['e'],
      ['d', ''],
      ['f'],
      ['g'],
      ['cat'],
      ['j'],
    ]);
  });
});

const infra: Record<string, InfraEnv> = {
  'apple-container': { guard: 'free', match: ['container '] },
  'windmill': { guard: 'tpm', match: ['wmill '] },
  'aws-staging': { guard: 'pm', match: ['aws ', 'ssh staging'] },
};
const now = new Date('2026-11-20T12:00:00.000Z');
const open: Approval = { until: '2026-11-20T12:30:00.000Z' };
const expired: Approval = { until: '2026-11-20T11:59:59.000Z' };
const ask = (command: string, role?: RoleName, approval?: Approval, tracker: 'none' | 'github' = 'none') =>
  judge({ command, role, config: { infra, tracker }, approvals: { 'aws-staging': approval }, now });

describe('touched', () => {
  test('match のどれかを含む環境を返す', () => {
    expect(touched('cd /w && aws ecs update-service --cluster x', infra)).toEqual(['aws-staging']);
    expect(touched('ssh staging-01 uptime; container ls', infra)).toEqual(['apple-container', 'aws-staging']);
    expect(touched('git status', infra)).toEqual([]);
  });
});

describe('環境の手続き', () => {
  test.each<[string, string, RoleName | undefined, Approval | undefined, boolean]>([
    ['どの環境にも当たらない', 'git status', 'software-engineer', undefined, true],
    ['自由は、どの担当も', 'container restart web', 'software-engineer', undefined, true],
    ['自由は、TPM 担当も', 'container restart web', undefined, undefined, true],
    ['TPM に相談は、DevOps Engineer 担当だけ', 'wmill sync push', 'devops-engineer', undefined, true],
    ['TPM に相談を、Software Engineer 担当が打つ', 'wmill sync push', 'software-engineer', undefined, false],
    ['TPM に相談を、TPM 担当が打つ', 'wmill sync push', undefined, undefined, false],
    ['PM の承認が無い', 'aws ecs update-service', 'devops-engineer', undefined, false],
    ['PM の承認の期限の中', 'aws ecs update-service', 'devops-engineer', open, true],
    ['PM の承認が切れた', 'aws ecs update-service', 'devops-engineer', expired, false],
    ['承認があっても、DevOps Engineer 担当でない', 'aws ecs update-service', 'software-engineer', open, false],
    ['2 つの環境に触るなら、どちらも満たす', 'container ls && aws s3 ls', 'devops-engineer', undefined, false],
  ])('%s', (_, command, role, approval, allow) => {
    expect(ask(command, role, approval).allow).toBe(allow);
  });

  test('止めた訳に、次にすることを書く', () => {
    expect(ask('wmill sync push', 'software-engineer')).toEqual({ allow: false, reason: expect.stringContaining('tpm ask devops') as string });
    expect(ask('aws s3 rm x', 'devops-engineer')).toEqual({ allow: false, reason: expect.stringContaining('tpm infra approve aws-staging') as string });
    expect(ask('aws s3 rm x', 'devops-engineer', expired)).toEqual({ allow: false, reason: expect.stringContaining('承認は 2026-11-20T11:59:59.000Z で切れた') as string });
  });
});

describe('道具の直打ち', () => {
  test.each([
    'cmux agent message workspace:1 --from x -- "【done】…"',
    'cmux set-status wait "作業中: 読む" --icon hourglass',
    'cmux workspace create --name x --cwd /w --command y',
    'cd /w && cmux workspace close workspace:3 --force',
    'acli jira workitem comment create --key SKILLS-1 --body-file f.json',
    'acli jira workitem transition --key SKILLS-1 --status "完了" --yes',
    // 命令の頭が道具なら、前に何が付いても、どこに並んでも止める。
    'true; acli jira workitem transition --key A',
    'ls | cmux set-status wait x',
    'false || cmux set-status wait x',
    'echo a\ncmux set-status wait x',
    'FOO=1 BAR=2 acli jira workitem transition --key A',
    'env -i PATH=/bin acli jira workitem transition --key A',
    'sudo -E cmux set-status wait x',
    '/opt/homebrew/bin/acli jira workitem comment create --key A',
    '"acli" jira workitem transition --key A',
    'cmux set-status wait x 2>&1 >/dev/null',
    'if true; then cmux set-status wait x; fi',
    '{ cmux set-status wait x; }',
    '(cd /w && cmux set-status wait x)',
    'x=$(acli jira workitem transition --key A)',
    'echo "$(cmux set-status wait x)"',
    'echo `cmux set-status wait x`',
    'bash -c \'acli jira workitem transition --key A\'',
    'sh -lc "cmux set-status wait x"',
    'eval cmux set-status wait x',
    'cat <<EOF\nhi\nEOF\ncmux set-status wait x',
  ])('止める: %s', (command) => {
    expect(ask(command, 'software-engineer')).toEqual({ allow: false, reason: expect.stringContaining('代わりに: tpm ') as string });
  });

  test.each([
    'cmux identify',
    'cmux --json workspace list',
    'cmux read-screen --workspace workspace:3',
    'cmux --json agent inbox --surface workspace:1 --limit 3',
    'acli jira workitem view SKILLS-1 --fields comment --json',
    'gh pr create --title x',
    'tpm report done --summary "cmux の adapter を直した"',
    // 道具の名が、命令でない字（文・型・中身）に入るだけなら止めない。
    'git commit -m "acli jira workitem comment create と cmux set-status を止める"',
    'git commit -F msg.txt && git push',
    'echo \'cmux agent message を使わない\'',
    'grep -rn "acli jira workitem transition" cli/src',
    'grep -n cmux\\ set-status f',
    'printf \'%s\\n\' "gh issue close 12"',
    'cat > f.md <<\'EOF\'\nacli jira workitem transition --key A\ncmux set-status wait x\nEOF',
    'python3 - <<EOF\nprint("cmux set-status")\nEOF\nls',
    'cat <<-EOF\n\tcmux set-status wait x\n\tEOF',
    'ls # cmux set-status wait x',
    'tpm ask tpm "acli jira workitem transition を打ってよいか"',
    'echo hi > cmux',
  ])('通す: %s', (command) => {
    expect(ask(command, 'software-engineer').allow).toBe(true);
  });

  test('gh issue を止めるのは、課題管理が GitHub の Issue の project だけ', () => {
    expect(ask('gh issue close 12', 'software-engineer', undefined, 'none').allow).toBe(true);
    expect(ask('gh issue close 12', 'software-engineer', undefined, 'github').allow).toBe(false);
    expect(ask('gh issue view 12 --json comments', 'software-engineer', undefined, 'github').allow).toBe(true);
    expect(ask('git commit -m "gh issue close 12 で閉じる"', 'software-engineer', undefined, 'github').allow).toBe(true);
    expect(ask('cd /w && gh issue comment 12 --body x', 'software-engineer', undefined, 'github').allow).toBe(false);
  });

  test('共有の環境は、今までどおり字全体で見る（文に書いただけでも止める）', () => {
    expect(ask('git commit -m "aws s3 rm を足す"', 'software-engineer').allow).toBe(false);
    expect(ask('echo "$(wmill sync push)"', 'software-engineer').allow).toBe(false);
  });

  test('TPM_RAW=1 を付けた直打ちは通すが、環境の手続きには効かない', () => {
    expect(ask('TPM_RAW=1 cmux workspace close workspace:3 --force', 'software-engineer').allow).toBe(true);
    expect(ask('TPM_RAW=1 aws s3 rm x', 'software-engineer').allow).toBe(false);
  });
});

/** settings の hook の命令。 */
const hookCommand = (settings: string): string =>
  (JSON.parse(settings) as { hooks: { PreToolUse: { hooks: { command: string }[] }[] } }).hooks.PreToolUse[0]!.hooks[0]!.command;

describe('hook の入力と settings', () => {
  test('Bash の命令だけを取り出す', () => {
    expect(commandOf(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: '/w' }))).toBe('ls');
    expect(commandOf(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/x' } }))).toBeUndefined();
  });

  test('settings は Bash の前に tpm guard を呼ぶ hook', () => {
    expect(JSON.parse(guardSettings('/r/cli/bin/tpm'))).toEqual({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/r/cli/bin/tpm guard' }] }] } });
  });

  test('path に空白などがあれば、hook の命令の中で引用する', () => {
    expect(hookCommand(guardSettings('/my repo/cli/bin/tpm'))).toBe('\'/my repo/cli/bin/tpm\' guard');
  });

  // Claude Code は hook の命令を shell で動かす。空白・引用符・$ を含む folder に置いた tpm でも、guard として動くこと。
  test('空白・引用符・$ を含む path の tpm でも、hook の命令が guard として動く', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'tpm-guard-')), 'my repo', 'it\'s $HOME');
    mkdirSync(dir, { recursive: true });
    const tpmBin = join(dir, 'tpm');
    symlinkSync(realpathSync(join(import.meta.dirname, '..', 'bin', 'tpm')), tpmBin);
    const command = hookCommand(guardSettings(tpmBin));
    const env = { ...process.env, TPM_PROJECT: undefined, TPM_STATE: undefined, TPM_KEY: undefined, TPM_ROLE: undefined };
    const run = (cmd: string) => spawnSync('/bin/sh', ['-c', command], { cwd: dir, env, encoding: 'utf8', input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: cmd } }) });
    const denied = run(['cmux', 'set-status', 'x'].join(' '));
    expect(denied.stderr).toContain('tpm wait');
    expect(denied.status).toBe(2);
    expect(run('ls').status).toBe(0);
  });
});

describe('tpm infra と tpm guard', () => {
  const hook = (command: string): string => JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
  const devops = (w: ReturnType<typeof world>) => ({ ...w.role('devops', 'file:1'), env: { TPM_KEY: 'devops', TPM_ROLE: 'devops-engineer' } });

  test('承認を書くと通り、消すと止まる', () => {
    const w = world({ infra });
    expect(guard(devops(w), hook('aws s3 ls')).allow).toBe(false);
    expect(infraApprove(w.tpm, 'aws-staging', { minutes: 30, note: 'deploy' })).toEqual(['承認を書いた: aws-staging（2026-11-20T12:30:00.000Z まで）']);
    expect(guard(devops(w), hook('aws s3 ls')).allow).toBe(true);
    expect(guard(w.role('t-x7k2', 'file:2'), hook('aws s3 ls')).allow).toBe(false);
    expect(infraList(w.tpm)).toEqual([
      '- apple-container  自由  match: "container "',
      '- windmill  TPM に相談（DevOps Engineer 担当だけ）  match: "wmill "',
      '- aws-staging  PM の承認（DevOps Engineer 担当だけ）  承認あり（2026-11-20T12:30:00.000Z まで・deploy）  match: "aws " "ssh staging"',
    ]);
    infraRevoke(w.tpm, 'aws-staging');
    expect(guard(devops(w), hook('aws s3 ls')).allow).toBe(false);
    expect(infraList(w.tpm)[2]).toContain('承認なし');
  });

  test('承認を書けるのは TPM 担当だけ。手続きが PM の承認の環境だけ', () => {
    const w = world({ infra });
    expect(() => infraApprove(devops(w), 'aws-staging', { minutes: 30 })).toThrow(/承認を書くのは TPM 担当/);
    expect(() => infraApprove(w.tpm, 'windmill', { minutes: 30 })).toThrow(/承認は要りません/);
    expect(() => infraApprove(w.tpm, 'nope', { minutes: 30 })).toThrow(/環境がありません: nope/);
    expect(() => infraApprove(w.tpm, 'aws-staging', { minutes: 0 })).toThrow(/--minutes/);
  });

  test('infra run は手続きを見てから打ち、記録を残す', () => {
    const w = world({ infra });
    expect(() => infraRun(devops(w), 'aws-staging', ['deploy.sh'])).toThrow(/Product Manager の承認が要ります/);
    expect(w.calls).toEqual([]);
    infraApprove(w.tpm, 'aws-staging', { minutes: 30 });
    expect(infraRun(devops(w), 'aws-staging', ['deploy.sh', '--env', 'staging']).status).toBe(0);
    expect(w.calls).toEqual([{ cmd: 'deploy.sh', args: ['--env', 'staging'] }]);
    expect(w.tpm.state.lines('infra.jsonl')).toEqual([{ at: '2026-11-20T12:00:00.000Z', env: 'aws-staging', role: 'devops-engineer', key: 'devops', command: ['deploy.sh', '--env', 'staging'], status: 0 }]);
  });

  test('宣言が無ければ、そう出す。Bash でない道具は通す', () => {
    const w = world();
    expect(infraList(w.tpm)).toEqual(['環境の宣言は無い（設定の infra に書く）']);
    expect(guard(w.tpm, JSON.stringify({ tool_name: 'Edit', tool_input: {} })).allow).toBe(true);
  });
});
