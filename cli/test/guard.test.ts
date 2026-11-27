import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { guard, infraApprove, infraList, infraRevoke, infraRun } from '../src/commands/infra.ts';
import { readRolesConfig, type ConfigSource, type InfraEnv } from '../src/config.ts';
import { commandOf, guardSettings, judge, hitsWords, judgeWrite, touched, writeOf, type Approval } from '../src/guard.ts';
import type { RoleName } from '../src/protocol.ts';
import { splitCommands, splitCommandsMarked, SUBSTITUTED } from '../src/shell.ts';
import { world } from './helpers.ts';
import { withoutRosterEnv } from '../src/env.ts';

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

  test('置き換えの跡の印は splitCommandsMarked だけが残す（頭は印を除いた字で整える）', () => {
    expect(splitCommands('sudo$(true) pkill$(true) -f x"$(y)":/d')).toEqual([['true'], ['true'], ['y'], ['pkill', '-f', 'x:/d']]);
    expect(splitCommandsMarked('sudo$(true) pkill$(true) -f x"$(y)":/d')).toEqual([['true'], ['true'], ['y'], ['pkill', '-f', `x${SUBSTITUTED}:/d`]]);
  });
});

const infra: Record<string, InfraEnv> = {
  'apple-container': { guard: 'free', match: ['container '] },
  'windmill': { guard: 'tpm', match: ['wmill '] },
  'aws-staging': { guard: 'pm', match: ['aws ', 'ssh staging'] },
  'castlist': { guard: 'pm-only', match: ['container stop castlist'] },
};
const now = new Date('2026-11-20T12:00:00.000Z');
const open: Approval = { until: '2026-11-20T12:30:00.000Z' };
const expired: Approval = { until: '2026-11-20T11:59:59.000Z' };
/** github を宣言した設定（guard は、1 つでもあるかだけを見る）。 */
const githubSource: ConfigSource = { name: 'web', dir: '/w/web', file: '/w/web/.claude/roles/config.jsonc', exists: true, written: ['tracker'], config: { tracker: 'github', transport: 'cmux', infra: {}, roles: {} } };
const ask = (command: string, role?: RoleName, approval?: Approval, tracker: 'none' | 'github' = 'none') =>
  judge({ command, role, config: { infra, trackers: { jira: [], github: tracker === 'github' ? [githubSource] : [] } }, approvals: { 'aws-staging': approval, 'castlist': approval }, now });

describe('touched', () => {
  test('match のどれかを含む環境を返す', () => {
    expect(touched('cd /w && aws ecs update-service --cluster x', infra)).toEqual(['aws-staging']);
    expect(touched('ssh staging-01 uptime; container ls', infra)).toEqual(['apple-container', 'aws-staging']);
    expect(touched('git status', infra)).toEqual([]);
  });
});

describe('touched: 命令の語で当てる（t-7j37。台帳 #253）', () => {
  // 4 つの repo の設定と同じ形（* の項目は、今の項目と並べて足した物）。
  const real: Record<string, InfraEnv> = {
    callboard: { guard: 'tpm', match: ['--name callboard', 'container stop callboard', 'container rm callboard', '--name=callboard'] },
    castlist: { guard: 'pm-only', match: ['--name castlist.box', 'container stop castlist.box', 'container volume delete castlist-data', 'container volume rm castlist-data', '-v castlist-data', 'container volume delete castlist-data*', 'container volume rm castlist-data*', '-v castlist-data*'] },
    pagetray: { guard: 'tpm', match: ['--name pagetray', 'container stop pagetray', 'container volume rm pagetray-data', '-v pagetray-data', 'container volume rm pagetray-data*', '-v pagetray-data*'] },
  };
  const hit = (command: string): string[] => touched(command, real);

  test.each<[string, string[]]>([
    // 当たり過ぎだった物（今は通す）。
    ['roster file put x.png --reviewed --name callboard-x.png', []],
    ['roster file put x.png --reviewed --name callboard-x.png 2>&1', []],
    ['git commit -m "container stop callboard を足す"', []],
    ['git commit -m "a" -m "bash で container stop callboard"', []],
    ['grep -rn "container stop callboard" docs', []],
    ['rg -- "-v castlist-data" .', []],
    ['roster ask devops --what "container stop pagetray" --why "版を上げる"', []],
    ['container run --name smoke-callboard img', []],
    // 語で当たる物。
    ['container stop callboard', ['callboard']],
    ['container stop -t 10 callboard', ['callboard']],
    ['sudo container rm -f callboard', ['callboard']],
    ['container run -d --name callboard img', ['callboard']],
    ['container run -d --name=callboard img', ['callboard']],
    ['echo container stop callboard', ['callboard']],
    ['timeout 60 container volume delete castlist-data-v1', ['castlist']],
    ['sudo -u root container stop pagetray', ['pagetray']],
    ['nice -n 5 container stop pagetray', ['pagetray']],
    ['caffeinate -i container stop pagetray', ['pagetray']],
    ['container volume rm pagetray-data-v1', ['pagetray']],
    ['container run -v pagetray-data-v1:/data img', ['pagetray']],
    ['sh -c \'container stop pagetray\'', ['pagetray']],
    ['roster infra run pagetray -- container stop pagetray', ['pagetray']],
    // 語では当たらないが、字の含みで止める物（字を命令として動かしうる命令がある）。
    ['container stop callboard-old', ['callboard']],
    ['bash <<\'X\'\ncontainer stop pagetray\nX', ['pagetray']],
    ['cat <<X | sh\ncontainer stop pagetray\nX', ['pagetray']],
    ['bash <<< \'container stop pagetray\'', ['pagetray']],
    ['timeout 60 sh -c \'container volume delete castlist-data-v1\'', ['castlist']],
    ['timeout 60 /bin/sh -c \'container volume delete castlist-data-v1\'', ['castlist']],
    ['sudo -u root bash -c \'container stop pagetray\'', ['pagetray']],
    ['echo \'container stop pagetray\' | sh', ['pagetray']],
    ['sh <(echo \'container stop pagetray\')', ['pagetray']],
    ['watch -n 5 \'container stop pagetray\'', ['pagetray']],
    ['fish -c \'container stop pagetray\'', ['pagetray']],
    ['env -S \'container stop pagetray\'', ['pagetray']],
    ['su root -c \'container stop pagetray\'', ['pagetray']],
    ['trap \'container stop pagetray\' EXIT', ['pagetray']],
    ['echo \'container stop pagetray\' > /tmp/x.sh && chmod +x /tmp/x.sh && /tmp/x.sh', ['pagetray']],
    ['echo \'container stop pagetray\' | at now', ['pagetray']],
    ['git rebase -x \'container stop pagetray\' HEAD~1', ['pagetray']],
    ['tmux new -d \'container stop pagetray\'', ['pagetray']],
    ['awk \'BEGIN{system("container stop pagetray")}\'', ['pagetray']],
    ['ssh host \'container stop pagetray\'', ['pagetray']],
    // 通す命令でも、頭の代入・前置き・path の付いた名・git の間の旗・書き出しがあれば止める。
    ['GIT_EDITOR=\'container stop pagetray\' git commit --amend', ['pagetray']],
    ['git -c core.editor=\'container stop pagetray\' commit', ['pagetray']],
    ['env FOO=1 roster ask devops --what "container stop pagetray"', ['pagetray']],
    ['/tmp/roster ask devops --what "container stop pagetray"', ['pagetray']],
    ['roster file put x --reviewed --name callboard-x.png > log', ['callboard']],
    ['git commit -m "$(container stop pagetray)"', ['pagetray']],
    // 命令の置き換えの中は、頭の代入・path を見られないので、通す命令だけでも字の含みで止める（review-15）。
    ['git commit -m "$(GIT_EDITOR=\'container stop pagetray\' git commit --amend)"', ['pagetray']],
    ['git commit -m "$(/tmp/grep \'container stop pagetray\')"', ['pagetray']],
    ['git commit -m "`/tmp/grep \'container stop pagetray\'`"', ['pagetray']],
    ['roster file put x --reviewed --name callboard-x.png >& log', ['callboard']],
    ['roster file put x --reviewed --name callboard-x.png &> log', ['callboard']],
    ['roster file put x --reviewed --name callboard-x.png >&2', []],
    ['roster file put x --reviewed --name callboard-x.png 2>/dev/null', []],
  ])('%s', (command, expected) => {
    expect(hit(command)).toEqual(expected);
  });

  test('hitsWords: 頭が旗の項目は続けて、頭が旗でない項目は順に（間に何が挟まってもよい）', () => {
    expect(hitsWords(['container', 'run', '--name', 'x', 'callboard'], '--name callboard')).toBe(false);
    expect(hitsWords(['container', 'stop', 'x', 'callboard'], 'container stop callboard')).toBe(true);
    expect(hitsWords(['container', 'callboard', 'stop'], 'container stop callboard')).toBe(false);
    expect(hitsWords(['a', '-v', 'pagetray-data-v1:/data'], '-v pagetray-data*')).toBe(true);
    expect(hitsWords(['a', '-v', 'pagetray-data-v1:/data'], '-v pagetray-data')).toBe(false);
  });
});

describe('touched: 名を書かずに的を選ぶ命令（t-9tac）', () => {
  const real: Record<string, InfraEnv> = {
    callboard: { guard: 'tpm', match: ['--name callboard', 'container start callboard', 'container stop callboard', 'container kill callboard', 'container rm callboard'] },
    castlist: { guard: 'pm-only', match: ['--name castlist.box', 'container stop castlist.box', 'container delete castlist.box', 'container volume delete castlist-data*', 'container v rm castlist-data*', '-v castlist-data*'] },
    builder: { guard: 'tpm', match: ['--name buildkit', 'container builder start', 'container builder stop', 'container stop buildkit'] },
  };
  const hit = (command: string): string[] => touched(command, real);

  test.each<[string, string[]]>([
    // 名を書かない形は、その動詞を持つ環境にみな当たる。
    ['container stop --all', ['callboard', 'castlist', 'builder']],
    ['container stop -a', ['callboard', 'castlist', 'builder']],
    ['container stop -t 5 --all', ['callboard', 'castlist', 'builder']],
    ['container --debug stop --all', ['callboard', 'castlist', 'builder']],
    ['container kill -a', ['callboard']],
    ['container delete -af', ['castlist']],
    ['container delete -fa', ['castlist']],
    ['container stop $(container ls -q)', ['callboard', 'castlist', 'builder']],
    ['container stop `container ls -q`', ['callboard', 'castlist', 'builder']],
    ['container ls -q | xargs container stop', ['callboard', 'castlist', 'builder']],
    ['container ls -q | xargs -n1 container rm -f', ['callboard']],
    ['container ls -q | xargs -I{} container rm -f {}', ['callboard']],
    ['container ls -q | xargs -I % container stop %', ['callboard', 'castlist', 'builder']],
    ['container ls -q | xargs container stop -t 5', ['callboard', 'castlist', 'builder']],
    ['container ls -q | xargs container kill -s KILL', ['callboard']],
    ['container stop --all mytest', ['callboard', 'castlist', 'builder']],
    ['for c in a b; do container stop "$c"; done', ['callboard', 'castlist', 'builder']],
    ['container stop callboard-*', ['callboard', 'castlist', 'builder']],
    ['container volume delete --all', ['castlist']],
    ['container v rm $(container v ls -q)', ['castlist']],
    ['sudo container stop --all', ['callboard', 'castlist', 'builder']],
    // 名を書いた自分の container・読むだけ・help・別の動詞は通す。
    ['container stop mytest', []],
    ['container rm -f mytest other', []],
    ['container start -a mytest', []],
    ['container stop -t 5 mytest', []],
    ['container stop --help', []],
    ['container ls -a', []],
    ['container logs $(cat id)', []],
    ['container builder status', []],
    // 名を宣言しない項目・終わりの語が名でない項目からは動詞を引かない（review-1 の指摘 2）。
    ['container volume inspect $V', []],
    ['container volume', []],
    ['container builder status $(x)', []],
    // 動詞の語は続けて並ぶ物だけ（container の中で打つ命令は当てない。review-1 の指摘 3）。
    ['container exec mytest rm -f /tmp/*.log', []],
    ['container run --rm alpine rm -rf /w/*', []],
    ['container run --rm alpine kill -a', []],
    ['container stop -t 5 -s TERM mytest', []],
    ['container image prune -a', []],
    ['container run --rm -d img', []],
    ['grep -rn "container stop --all" docs', []],
    ['git commit -m "container stop --all を止める"', []],
    ['roster ask tpm "container stop $(container ls -q) を打ちたい"', []],
    // 動詞の間に旗でない語が挟まる形は、別の動詞（builder stop は builder の項目だけに当たる）。
    ['container builder stop', ['builder']],
  ])('%s', (command, expected) => {
    expect(hit(command)).toEqual(expected);
  });

  test('名を宣言しない環境の項目も、旗の値が挟まる形には当たる（ssh -p 22 staging）', () => {
    const plain: Record<string, InfraEnv> = { staging: { guard: 'tpm', match: ['ssh staging'] } };
    expect(touched('ssh -p 22 staging uptime', plain)).toEqual(['staging']);
    expect(touched('ssh staging uptime', plain)).toEqual(['staging']);
  });

  test('名を書かない命令を止めた訳には、名を書いて打つ案内が付く', () => {
    const verdict = judge({ command: 'container stop --all', role: 'software-engineer', config: { infra: real, trackers: { jira: [], github: [] } }, approvals: {}, now: new Date() });
    expect(verdict.allow).toBe(false);
    if (!verdict.allow) expect(verdict.reason).toContain('名を書いて打って');
    const named = judge({ command: 'container stop callboard', role: 'software-engineer', config: { infra: real, trackers: { jira: [], github: [] } }, approvals: {}, now: new Date() });
    if (!named.allow) expect(named.reason).not.toContain('名を書いて打って');
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
    ['PM だけを、Software Engineer 担当が打つ', 'container stop castlist', 'software-engineer', undefined, false],
    ['PM だけを、TPM 担当が打つ', 'container stop castlist', undefined, undefined, false],
    ['PM だけを、DevOps Engineer 担当が打つ', 'container stop castlist', 'devops-engineer', undefined, false],
    ['PM だけは、承認があっても DevOps Engineer 担当が打てない', 'container stop castlist', 'devops-engineer', open, false],
    ['PM だけを、Auditor が打つ', 'container stop castlist', 'auditor', undefined, false],
  ])('%s', (_, command, role, approval, allow) => {
    expect(ask(command, role, approval).allow).toBe(allow);
  });

  test('止めた訳に、次にすることを書く', () => {
    expect(ask('wmill sync push', 'software-engineer')).toEqual({ allow: false, reason: expect.stringContaining('roster ask devops') as string });
    expect(ask('aws s3 rm x', 'devops-engineer')).toEqual({ allow: false, reason: expect.stringContaining('roster infra approve aws-staging') as string });
    expect(ask('aws s3 rm x', 'devops-engineer', expired)).toEqual({ allow: false, reason: expect.stringContaining('承認は 2026-11-20T11:59:59.000Z で切れた') as string });
    expect(ask('container stop castlist', 'devops-engineer')).toEqual({ allow: false, reason: expect.stringContaining('Product Manager が自分の terminal で') as string });
    expect(ask('container stop castlist', 'devops-engineer')).toEqual({ allow: false, reason: expect.stringContaining('roster ask pm') as string });
  });
});

describe('道具の直打ち', () => {
  test.each([
    'cmux agent message workspace:1 --from x -- "【done】…"',
    'cmux set-status wait "作業中: 読む" --icon hourglass',
    'cmux workspace create --name x --cwd /w --command y',
    'cd /w && cmux workspace close workspace:3 --force',
    'acli jira workitem comment create --key AI-1 --body-file f.json',
    'acli jira workitem transition --key AI-1 --status "完了" --yes',
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
    expect(ask(command, 'software-engineer')).toEqual({ allow: false, reason: expect.stringContaining('代わりに: roster ') as string });
  });

  test.each([
    'cmux identify',
    'cmux --json workspace list',
    'cmux read-screen --workspace workspace:3',
    'cmux --json agent inbox --surface workspace:1 --limit 3',
    'acli jira workitem view AI-1 --fields comment --json',
    'gh pr create --title x',
    'roster report done --summary "cmux の adapter を直した"',
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
    'roster ask tpm "acli jira workitem transition を打ってよいか"',
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

  test('共有の環境は、字の含みだけの当たりも止める。通すのは、引数の字を動かさない命令（roster・git commit・grep・rg）だけの時', () => {
    expect(ask('echo "$(wmill sync push)"', 'software-engineer').allow).toBe(false);
    expect(ask('echo "aws s3 rm を足す"', 'software-engineer').allow).toBe(false);
    expect(ask('git commit -m "aws s3 rm を足す"', 'software-engineer').allow).toBe(true);
  });

  test('ROSTER_RAW=1 を付けた直打ちは通すが、環境の手続きには効かない', () => {
    expect(ask('ROSTER_RAW=1 cmux workspace close workspace:3 --force', 'software-engineer').allow).toBe(true);
    expect(ask('ROSTER_RAW=1 aws s3 rm x', 'software-engineer').allow).toBe(false);
    // 前の名の印（TPM_RAW=1）は効かない（t-cmf2 で外した）。
    expect(ask('TPM_RAW=1 cmux workspace close workspace:3 --force', 'software-engineer').allow).toBe(false);
  });
});

/** settings の hook の命令。 */
const hookCommand = (settings: string): string =>
  (JSON.parse(settings) as { hooks: { PreToolUse: { hooks: { command: string }[] }[] } }).hooks.PreToolUse[0]!.hooks[0]!.command;

describe('置き場のページを消す curl', () => {
  const url = '\'http://127.0.0.1:8801/api/pages?project=p&key=t-x\'';
  test('担当が直に送る DELETE は止め、TPM 担当に頼むよう言う', () => {
    for (const command of [`curl -sS -X DELETE ${url}`, `curl -XDELETE ${url}`, `curl --request=DELETE ${url}`, `cd /w && curl -s --request DELETE ${url} | jq .`]) {
      const verdict = ask(command, 'software-engineer');
      expect(verdict.allow, command).toBe(false);
      expect(verdict.allow ? '' : verdict.reason).toContain('TPM 担当だけ');
    }
  });

  test('TPM 担当・置き場の外への DELETE・ほかの要求・ROSTER_RAW=1 は通す', () => {
    expect(ask(`curl -X DELETE ${url}`).allow).toBe(true);
    expect(ask('curl -X DELETE https://example.com/x', 'software-engineer').allow).toBe(true);
    expect(ask(`curl -sS ${url}`, 'devops-engineer').allow).toBe(true);
    expect(ask(`echo "curl -X DELETE ${url}"`, 'software-engineer').allow).toBe(true);
    expect(ask(`ROSTER_RAW=1 curl -X DELETE ${url}`, 'software-engineer').allow).toBe(true);
  });

  test('file を消す DELETE（/api/files）も止める', () => {
    const files = '\'http://127.0.0.1:8801/api/files?project=p&key=t-x&name=screen.png&n=1\'';
    for (const command of [`curl -sS -X DELETE ${files}`, `curl --request DELETE ${files}`]) {
      const verdict = ask(command, 'software-engineer');
      expect(verdict.allow, command).toBe(false);
      expect(verdict.allow ? '' : verdict.reason).toContain('TPM 担当だけ');
    }
    expect(ask(`curl -X DELETE ${files}`).allow).toBe(true);
    expect(ask(`curl -sS ${files}`, 'software-engineer').allow).toBe(true);
  });
});

describe('置き場の CLI（pagetray）の消す命令', () => {
  const url = 'http://127.0.0.1:8801/p/t-x/plan-1.html';
  test('担当の page delete と api の DELETE は止め、TPM 担当に頼むよう言う', () => {
    for (const command of [
      `pagetray page delete ${url} --yes`,
      `pagetray page delete ${url}`,
      'pagetray page delete --project p --key t-x --yes',
      `pagetray --url http://127.0.0.1:8801 page delete ${url} --yes`,
      `~/.local/bin/pagetray page delete ${url} --yes`,
      `cd /w && pagetray page delete ${url} --yes | cat`,
      'pagetray api -X DELETE /api/pages -f project=p',
      'pagetray api /api/pages -XDELETE -f project=p',
      'pagetray api --method delete /api/pages -f project=p',
      'pagetray api --method=DELETE /api/pages -f project=p',
      'pagetray file delete http://127.0.0.1:8801/p/t-x/files/screen-1.png --yes',
      'pagetray file delete --project p --key t-x --yes',
      'pagetray api -X DELETE /api/files -f project=p',
    ]) {
      const verdict = ask(command, 'software-engineer');
      expect(verdict.allow, command).toBe(false);
      expect(verdict.allow ? '' : verdict.reason).toContain('TPM 担当だけ');
    }
  });

  test('TPM 担当・読む命令と置く命令・命令でない字・ROSTER_RAW=1 は通す', () => {
    expect(ask(`pagetray page delete ${url} --yes`).allow).toBe(true);
    for (const command of [
      'pagetray page list --key t-x',
      `pagetray page view ${url}`,
      'pagetray page put x.html --project p --key t-x --kind plan',
      'pagetray api /api/pages -f project=p',
      'pagetray api -X POST /api/pages --input x.html -f project=p',
      'pagetray status',
      'pagetray file list --key t-x',
      'pagetray file put screen.png --project p --key t-x --reviewed',
      `echo "pagetray page delete ${url} --yes"`,
      'git commit -m "docs: pagetray page delete の使い方"',
      `ROSTER_RAW=1 pagetray page delete ${url} --yes`,
    ]) expect(ask(command, 'software-engineer').allow, command).toBe(true);
  });
});

describe('hook の入力と settings', () => {
  test('Bash の命令だけを取り出す', () => {
    expect(commandOf(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: '/w' }))).toBe('ls');
    expect(commandOf(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/x' } }))).toBeUndefined();
  });

  test('settings は Bash の前に roster guard を呼ぶ hook と、session の始まりと終わりに roster castlist を呼ぶ hook と、メッセージを渡す hook（roster mail …）', () => {
    const waiting = { type: 'command', async: true, asyncRewake: true, timeout: 86400, command: '/r/cli/bin/roster mail wait' };
    const gate = [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/r/cli/bin/roster mail gate' }] }];
    expect(JSON.parse(guardSettings('/r/cli/bin/roster'))).toEqual({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/r/cli/bin/roster guard' }] }], SessionStart: [{ hooks: [{ type: 'command', command: '/r/cli/bin/roster castlist session-start' }, { type: 'command', command: '/r/cli/bin/roster mail claim' }, waiting] }], SessionEnd: [{ hooks: [{ type: 'command', command: '/r/cli/bin/roster castlist session-end' }, { type: 'command', command: '/r/cli/bin/roster mail release' }] }], PostToolUse: gate, PostToolUseFailure: gate, Stop: [{ hooks: [waiting] }], UserPromptSubmit: [{ hooks: [{ type: 'command', command: '/r/cli/bin/roster mail prompt' }] }] } });
  });

  test('path に空白などがあれば、hook の命令の中で引用する', () => {
    expect(hookCommand(guardSettings('/my repo/cli/bin/roster'))).toBe('\'/my repo/cli/bin/roster\' guard');
  });

  // Claude Code は hook の命令を shell で動かす。空白・引用符・$ を含む folder に置いた roster でも、guard として動くこと。
  test('空白・引用符・$ を含む path の roster でも、hook の命令が guard として動く', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'roster-guard-')), 'my repo', 'it\'s $HOME');
    mkdirSync(dir, { recursive: true });
    const tpmBin = join(dir, 'roster');
    symlinkSync(realpathSync(join(import.meta.dirname, '..', 'bin', 'roster')), tpmBin);
    const command = hookCommand(guardSettings(tpmBin));
    // 止めた記録（guard.jsonl）を、roster を動かす機械の本物の状態の folder でなく、一時の folder に書かせる。
    const state = mkdtempSync(join(tmpdir(), 'roster-guard-state-'));
    const env = { ...withoutRosterEnv(process.env), XDG_STATE_HOME: state };
    const run = (cmd: string) => spawnSync('/bin/sh', ['-c', command], { cwd: dir, env, encoding: 'utf8', input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: cmd } }) });
    const denied = run(['cmux', 'set-status', 'x'].join(' '));
    expect(denied.stderr).toContain('roster wait');
    expect(denied.status).toBe(2);
    expect(run('ls').status).toBe(0);
    expect(existsSync(join(state, 'roster'))).toBe(true);
  });

  test('Auditor の席の settings は、file を書き替える道具の前にも roster guard を呼ぶ', () => {
    const matcher = (role?: RoleName): string => (JSON.parse(guardSettings('/r/cli/bin/roster', role)) as { hooks: { PreToolUse: { matcher: string }[] } }).hooks.PreToolUse[0]?.matcher ?? '';
    expect(matcher('auditor')).toBe('Bash|Edit|Write|NotebookEdit');
    expect(matcher('software-engineer')).toBe('Bash');
  });

  test('file を書き替える道具の、書く先を取り出す', () => {
    expect(writeOf(JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/x/a.md', content: 'a' } }))).toEqual({ tool: 'Write', path: '/x/a.md' });
    expect(writeOf(JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: '/x/a.md' } }))).toEqual({ tool: 'Edit', path: '/x/a.md' });
    expect(writeOf(JSON.stringify({ tool_name: 'NotebookEdit', tool_input: { notebook_path: '/x/a.ipynb' } }))).toEqual({ tool: 'NotebookEdit', path: '/x/a.ipynb' });
    expect(writeOf(JSON.stringify({ tool_name: 'NotebookEdit', tool_input: {} }))).toEqual({ tool: 'NotebookEdit', path: undefined });
    expect(writeOf(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }))).toBeUndefined();
    expect(writeOf(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/x' } }))).toBeUndefined();
  });
});

describe('Audit の席を起こす命令', () => {
  test('TPM 担当と担当が道具として打つ roster audit start は止める（ROSTER_RAW=1 も効かない）。ほかの roster audit は通す', () => {
    for (const role of [undefined, 'software-engineer', 'devops-engineer', 'auditor'] as const) {
      expect(ask('roster audit start', role), String(role)).toEqual({ allow: false, reason: expect.stringContaining('Audit の席を起こすのは Product Manager です') as string });
    }
    for (const command of ['cd /w && /r/cli/bin/roster audit start --model claude-opus-5-5', 'ROSTER_RAW=1 roster audit start', 'sh -c "roster audit start"']) expect(ask(command).allow, command).toBe(false);
    for (const command of ['roster audit begin', 'roster audit begin 7 9', 'echo "roster audit start"', 'grep -rn "roster audit start" docs-site', 'roster roles']) expect(ask(command).allow, command).toBe(true);
  });
});

describe('pattern で process に合図を送る命令（台帳 #89・#92）', () => {
  // 試験は字を judge に渡すだけで、命令は打たない。
  test.each([
    'pkill -f "castlist-server" -n',
    'pkill node',
    'killall Finder',
    '/usr/bin/pkill -9 -f x',
    'sudo pkill -f x',
    'nohup killall x',
    'cd /w && pkill -f x',
    'true; pkill -f x',
    'sh -c "pkill -f x"',
    'x=$(killall -s x)',
    'ROSTER_RAW=1 pkill -f x',
    // 命令の名・前置き・-c の途中の置き換え（t-ta2b の review-2 の指摘 2・review-3 の指摘 1）。
    'pkill$(true) -f foo',
    'sudo$(true) pkill -f x',
    'nohup$(true) pkill -f x',
    'pgrep x | xargs$(true) kill',
    'sh -c$(true) \'pkill -f x\'',
    // 的の語の途中の置き換え（review-4 の指摘 4）。
    'kill 1$(pgrep -f x)',
    // kill でも、的を名指さない物は、pattern で選んだ物にまとめて送るのと同じ。
    'pgrep -f x | xargs kill',
    'pgrep -f x | xargs kill -9',
    'kill $(pgrep -f x)',
    'kill -9 "$(pgrep -f x)"',
    'kill `pgrep -f x`',
    'kill 0',
    'kill -9 -1',
    'kill -- -123',
    'kill -TERM -1234',
    'kill',
    'kill 123 x',
    'kill foo',
    // 的の後ろの -l は合図の一覧の旗でない（kill は先に的へ送る）。
    'kill 0 -l',
    'kill -9 0 -l',
    'kill $(pgrep -f x) -l',
    'pgrep -f x | xargs -I{} kill {}',
    // 誤って止まる物（docs に書いた）。pid の file は読んで、数字を書く。
    'kill $(cat x.pid)',
    'command -v pkill',
  ])('止める: %s', (command) => {
    for (const role of [undefined, 'software-engineer', 'devops-engineer', 'staff-engineer'] as const) {
      expect(ask(command, role), String(role)).toEqual({ allow: false, reason: expect.stringContaining('pgrep -fl') as string });
    }
  });

  test.each([
    'kill 12345',
    'kill -9 12345 12346',
    'kill -TERM 12345',
    'kill -s TERM 12345',
    'kill -n 9 12345',
    'kill %1',
    'kill $pid',
    'kill -9 "$PID"',
    'kill ${PID}',
    'python3 -m http.server 8931 & sleep 1; kill $!',
    'kill -9 $$',
    'kill $1',
    'kill -- 12345',
    'kill -l',
    'kill -l 15',
    'pgrep -fl castlist-server',
    'ps -o pid,command -p 12345',
    'git commit -m "pkill と killall を止める"',
    'grep -rn "pkill\\|killall" skill-sets',
    'cat <<EOF\npkill -f x\nEOF',
    'echo killall',
    // この repo の設定の infra にある字（頭は container）と、operations.md の調べ方の 1 行（型は引用の中）。
    'container kill buildkit',
    'jq -r \'.message.content[]? | (.input.command? // "") | select(test("\\\\b(pkill|killall|kill)\\\\b"))\' "$f"',
    // すり抜ける物（guard の限り。docs に書いた）: pgrep の出力を変数に入れて渡す形。
    'pid=$(pgrep -f x -n); kill $pid',
  ])('通す: %s', (command) => {
    expect(ask(command, 'software-engineer')).toEqual({ allow: true });
  });

  test('止めた訳の命令の字に、$(…) の跡の空の語を残さない', () => {
    expect(ask('kill $(pgrep -f x)', 'software-engineer')).toEqual({ allow: false, reason: expect.stringContaining('止めます（kill）') as string });
  });
});

describe('Auditor は repo を変えない', () => {
  test.each<[string, boolean]>([
    ['git status', true],
    ['git log --oneline -5 origin/main', true],
    ['git -C /w/skills diff main...origin/main', true],
    ['git fetch origin', true],
    ['git show 813d86d:cli/src/guard.ts', true],
    ['git branch -a', true],
    ['git branch --show-current', true],
    ['git tag -l', true],
    ['git worktree list', true],
    ['gh pr view 141 --json state', true],
    ['gh pr list', true],
    ['gh api repos/o/r/pulls/141', true],
    ['gh api -X GET repos/o/r/rulesets', true],
    ['grep -rn "git push" docs-site', true],
    ['git commit -m x', false],
    ['git -C /w/skills pull --ff-only', false],
    ['cd /w/skills && git push origin main', false],
    ['git checkout main', false],
    ['git switch -c t-x/y', false],
    ['git stash', false],
    ['git reset --hard origin/main', false],
    ['git branch -D t-x/y', false],
    ['git branch t-x/y', false],
    ['git tag v1.0.0', false],
    ['git worktree add ../w t-x/y', false],
    ['gh pr create --title x', false],
    ['gh pr merge 141 --squash', false],
    ['gh release create v1', false],
    ['gh api -X POST repos/o/r/rulesets', false],
    ['gh api --method=PUT repos/o/r/pages', false],
    ['gh api repos/o/r/labels -f name=x', false],
    ['ROSTER_RAW=1 git push', false],
    // castlist を読むだけの命令（監査の検索）は通す
    ['roster castlist find --label tpm.key:t-23zs --active-from 2026-11-22T11:00:00+09:00', true],
    ['roster castlist show t-23zs-swe.1', true],
    ['roster castlist lineage 019a0000-0000-7000-8000-000000000000 --direction up', true],
    ['roster castlist events --type exited --type cleared', true],
    ['roster castlist settings --mismatch', true],
  ])('%s', (command, allow) => {
    expect(ask(command, 'auditor').allow).toBe(allow);
  });

  test('ほかの担当と TPM 担当の git・gh は止めない。止めた訳に、勧告に書くよう言う', () => {
    expect(ask('git commit -m x && git push', 'software-engineer').allow).toBe(true);
    expect(ask('gh pr merge 141 --squash').allow).toBe(true);
    expect(ask('git -C /w/skills pull --ff-only', 'auditor')).toEqual({ allow: false, reason: expect.stringContaining('Auditor は repo を変えません（git -C /w/skills）。直すことは、監査のページの勧告に') as string });
  });

  const roots = (base: string) => [{ name: 'project の folder', dir: join(base, 'project') }, { name: '状態の folder', dir: join(base, 'state') }];

  test('project と状態の folder の下への書き込みを止め、外への書き込みは通す', () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'roster-audit-')));
    mkdirSync(join(base, 'project', 'skills'), { recursive: true });
    const write = (path: string | undefined) => judgeWrite({ tool: 'Write', path }, 'auditor', roots(base));
    expect(write(join(base, 'project', 'skills', 'README.md'))).toEqual({ allow: false, reason: expect.stringMatching(/^Auditor は、project の folder の下を書き替えません.*roster page put/) as string });
    // まだ無い folder の中の file と、状態の folder（まだ無い）も止める。
    expect(write(join(base, 'project', 'new', 'dir', 'a.md')).allow).toBe(false);
    expect(write(join(base, 'state', 'incidents', '1.jsonc')).allow).toBe(false);
    expect(write(join(base, 'project')).allow).toBe(false);
    expect(write(join(base, 'scratch', 'audit.html')).allow).toBe(true);
    // 名が頭で重なるだけの隣の folder は、下ではない。
    expect(write(join(base, 'project-notes', 'a.md')).allow).toBe(true);
    expect(write(undefined)).toEqual({ allow: false, reason: expect.stringContaining('書く先を読めない') as string });
  });

  test('symbolic link を通した書き込みも止める。ほかの担当と TPM 担当は通す', () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'roster-audit-')));
    mkdirSync(join(base, 'project'), { recursive: true });
    symlinkSync(join(base, 'project'), join(base, 'link'));
    expect(judgeWrite({ tool: 'Edit', path: join(base, 'link', 'a.md') }, 'auditor', roots(base)).allow).toBe(false);
    expect(judgeWrite({ tool: 'Edit', path: join(base, 'project', 'a.md') }, 'software-engineer', roots(base)).allow).toBe(true);
    expect(judgeWrite({ tool: 'Edit', path: join(base, 'project', 'a.md') }, undefined, roots(base)).allow).toBe(true);
  });
});

describe('Staff Engineer 担当は repo を変えない', () => {
  test.each<[string, boolean]>([
    ['git fetch origin', true],
    ['git show origin/ai-8/impl:cli/src/guard.ts', true],
    ['git diff origin/main...origin/ai-8/impl', true],
    ['gh pr diff 141', true],
    ['gh pr view 141 --json files', true],
    ['gh pr checks 141', true],
    ['roster page put /tmp/review.html --kind result', true],
    ['git commit -m x', false],
    ['git checkout ai-8/impl', false],
    ['git worktree add ../w ai-8/impl', false],
    ['git push origin ai-8/impl', false],
    ['gh pr review 141 --approve', false],
    ['gh pr comment 141 --body x', false],
    ['gh pr merge 141 --squash', false],
    ['ROSTER_RAW=1 git push', false],
    // 命令の名の途中の置き換え（t-ta2b の review-2 の指摘 2）。
    ['git$(true) push', false],
    ['git push$(true)', false],
    ['gh pr$(true) merge 141 --squash', false],
  ])('%s', (command, allow) => {
    expect(ask(command, 'staff-engineer').allow).toBe(allow);
  });

  test('止めた訳に、レビューのページの指摘に書くよう言う', () => {
    expect(ask('gh pr review 141 --approve', 'staff-engineer')).toEqual({ allow: false, reason: expect.stringContaining('Staff Engineer 担当は repo を変えません（gh pr review）。直すことは、レビューのページの指摘に') as string });
  });

  test('project の folder の下への書き込みを止め、外への書き込みは通す', () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'roster-staff-')));
    mkdirSync(join(base, 'project'), { recursive: true });
    const roots = [{ name: 'project の folder', dir: join(base, 'project') }];
    const write = (path: string | undefined) => judgeWrite({ tool: 'Edit', path }, 'staff-engineer', roots);
    expect(write(join(base, 'project', 'cli', 'src', 'guard.ts'))).toEqual({ allow: false, reason: expect.stringMatching(/^Staff Engineer 担当は、project の folder の下を書き替えません.*レビューのページの file は一時の folder/) as string });
    expect(write(join(base, 'scratch', 'review.html')).allow).toBe(true);
    expect(write(undefined)).toEqual({ allow: false, reason: expect.stringContaining('Staff Engineer 担当の Edit の書く先を読めない') as string });
  });

  test('席の settings は、file を書き替える道具の前にも roster guard を呼ぶ。audit fresh は Auditor の席だけ', () => {
    const settings = (role: RoleName) => JSON.parse(guardSettings('/r/cli/bin/roster', role)) as { hooks: { PreToolUse: { matcher: string }[], SessionStart: { hooks: { command: string }[] }[] } };
    expect(settings('staff-engineer').hooks.PreToolUse[0]?.matcher).toBe('Bash|Edit|Write|NotebookEdit');
    expect(settings('staff-engineer').hooks.SessionStart[0]?.hooks.map(h => h.command)).toEqual(['/r/cli/bin/roster castlist session-start', '/r/cli/bin/roster mail claim', '/r/cli/bin/roster mail wait']);
    expect(settings('auditor').hooks.SessionStart[0]?.hooks.map(h => h.command)).toEqual(['/r/cli/bin/roster audit fresh', '/r/cli/bin/roster castlist session-start', '/r/cli/bin/roster mail claim', '/r/cli/bin/roster mail wait']);
  });
});

describe('roster infra と roster guard', () => {
  const hook = (command: string): string => JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
  const devops = (w: ReturnType<typeof world>) => ({ ...w.role('devops', 'file:1'), env: { ROSTER_KEY: 'devops', ROSTER_ROLE: 'devops-engineer' } });

  test('承認を書くと通り、消すと止まる', async () => {
    const w = world({ infra });
    expect((await guard(devops(w), hook('aws s3 ls'))).allow).toBe(false);
    expect(infraApprove(w.tpm, 'aws-staging', { minutes: 30, note: 'deploy' })).toEqual(['承認を書いた: aws-staging（2026-11-20T12:30:00.000Z まで）']);
    expect((await guard(devops(w), hook('aws s3 ls'))).allow).toBe(true);
    expect((await guard(w.role('t-x7k2', 'file:2'), hook('aws s3 ls'))).allow).toBe(false);
    expect(infraList(w.tpm)).toEqual([
      '- apple-container  自由  match: "container "',
      '- windmill  TPM に相談（DevOps Engineer 担当だけ）  match: "wmill "',
      '- aws-staging  PM の承認（DevOps Engineer 担当だけ）  承認あり（2026-11-20T12:30:00.000Z まで・deploy）  match: "aws " "ssh staging"',
      '- castlist  PM だけ（どの担当も打てない）  match: "container stop castlist"',
    ]);
    infraRevoke(w.tpm, 'aws-staging');
    expect((await guard(devops(w), hook('aws s3 ls'))).allow).toBe(false);
    expect(infraList(w.tpm)[2]).toContain('承認なし');
  });

  test('承認を書けるのは TPM 担当だけ。手続きが PM の承認の環境だけ', () => {
    const w = world({ infra });
    expect(() => infraApprove(devops(w), 'aws-staging', { minutes: 30 })).toThrow(/承認を書くのは TPM 担当/);
    expect(() => infraApprove(w.tpm, 'windmill', { minutes: 30 })).toThrow(/承認は要りません/);
    expect(() => infraApprove(w.tpm, 'nope', { minutes: 30 })).toThrow(/環境がありません: nope/);
    expect(() => infraApprove(w.tpm, 'aws-staging', { minutes: 0 })).toThrow(/--minutes/);
    expect(() => infraApprove(w.tpm, 'castlist', { minutes: 30 })).toThrow(/Product Manager だけ/);
  });

  test('PM だけの環境は、infra run でも打てない（どの担当も）', () => {
    const w = world({ infra });
    expect(() => infraRun(devops(w), 'castlist', ['container', 'stop', 'castlist'])).toThrow(/Product Manager が自分の terminal で/);
    expect(() => infraRun(w.tpm, 'castlist', ['container', 'stop', 'castlist'])).toThrow(/Product Manager が自分の terminal で/);
    expect(w.calls).toEqual([]);
    expect(w.tpm.state.lines('infra.jsonl')).toEqual([]);
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

  test('宣言が無ければ、そう出す。Bash でない道具は通す', async () => {
    const w = world();
    expect(infraList(w.tpm)).toEqual(['環境の宣言は無い（設定の infra に書く）']);
    expect((await guard(w.tpm, JSON.stringify({ tool_name: 'Edit', tool_input: {} }))).allow).toBe(true);
  });

  test('Auditor の書き込みと git の変える命令は hook で止まり、記録に残る', async () => {
    const w = world();
    // 控えの folder は一時の folder にする（試験を流す機械の本物の控えを見ない）。
    const data = mkdtempSync(join(tmpdir(), 'roster-guard-data-'));
    const auditor = { ...w.role('audit', 'file:9'), env: { ROSTER_KEY: 'audit', ROSTER_ROLE: 'auditor', XDG_DATA_HOME: data } };
    const write = (path: string): string => JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path, content: 'x' } });
    expect((await guard(auditor, write(join(w.tpm.project, 'README.md')))).allow).toBe(false);
    expect((await guard(auditor, write(join(w.tpm.state.dir, 'log.jsonl')))).allow).toBe(false);
    expect((await guard(auditor, write(join(tmpdir(), 'audit-page.html')))).allow).toBe(true);
    expect((await guard(auditor, hook('git pull --ff-only'))).allow).toBe(false);
    expect((await guard(auditor, hook('git log -1'))).allow).toBe(true);
    // Software Engineer 担当の書き込みは見ない。
    expect((await guard({ ...w.role('t-x7k2', 'file:1'), env: { ROSTER_KEY: 't-x7k2', ROSTER_ROLE: 'software-engineer', XDG_DATA_HOME: data } }, write(join(w.tpm.project, 'README.md')))).allow).toBe(true);
    expect(w.tpm.state.lines<{ by: string, role: string, command: string }>('guard.jsonl').map(l => [l.by, l.role, l.command.split(' ')[0]])).toEqual([
      ['audit', 'auditor', 'Write'],
      ['audit', 'auditor', 'Write'],
      ['audit', 'auditor', 'git'],
    ]);
  });
});

describe('直下の folder の設定の infra', () => {
  const hook = (command: string): string => JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
  const store = { store: { guard: 'tpm', match: ['container stop store'] } };

  test('上の folder で起きた担当にも、直下の folder の宣言が効く。止めた文と roster infra list に、宣言した設定を出す', async () => {
    const w = world({}, {}, { skills: { infra: store }, web: {} });
    const verdict = await guard({ ...w.role('t-x7k2', 'file:1'), env: { ROSTER_KEY: 't-x7k2', ROSTER_ROLE: 'software-engineer' } }, hook('cd web && container stop store'));
    expect(verdict).toEqual({ allow: false, reason: '環境 store（skills の設定） を変えてよいのは DevOps Engineer 担当だけです。roster ask devops --what … --why … で TPM 担当に頼んでください。' });
    expect(infraList(w.tpm)).toEqual(['- store  TPM に相談（DevOps Engineer 担当だけ）  match: "container stop store"  宣言: skills']);
  });

  test('gh issue の直打ちは、github を宣言した設定が直下に 1 つでもあれば止まる', async () => {
    const se = (w: ReturnType<typeof world>) => ({ ...w.role('t-x7k2', 'file:1'), env: { ROSTER_KEY: 't-x7k2', ROSTER_ROLE: 'software-engineer' } });
    expect((await guard(se(world({}, {}, { web: { tracker: 'github' } })), hook('gh issue close 12'))).allow).toBe(false);
    expect((await guard(se(world({}, {}, { skills: { tracker: 'jira' } })), hook('gh issue close 12'))).allow).toBe(true);
  });
});

describe('この repo の設定の builder（手元で image を build する buildkit の container）', () => {
  const own = readRolesConfig(join(import.meta.dirname, '..', '..', '.claude', 'roles', 'config.jsonc')).infra;
  const judgeOwn = (command: string, role: RoleName | undefined) =>
    judge({ command, role, config: { infra: own, trackers: { jira: [], github: [] } }, approvals: {}, now }).allow;
  const stops = [
    'container builder start',
    'container builder start -c 4 -m 4G',
    'container builder stop',
    'container builder delete',
    'container builder delete --force',
    'container builder rm',
    'container stop buildkit',
    'container kill buildkit',
    'container delete buildkit',
    'container rm buildkit',
    'container run -d --name buildkit x',
  ];

  test('手続きは TPM に相談（DevOps Engineer 担当だけ）', () => {
    expect(own.builder?.guard).toBe('tpm');
  });

  test.each(stops)('%s を、DevOps Engineer 担当のほかは止める', (command) => {
    expect(judgeOwn(command, 'software-engineer')).toBe(false);
    expect(judgeOwn(command, 'sustaining-engineer')).toBe(false);
    expect(judgeOwn(command, undefined)).toBe(false);
    expect(judgeOwn(command, 'devops-engineer')).toBe(true);
  });

  test.each([
    'container build -t x .',
    'container build --no-cache -f Containerfile -t ghcr.io/u/x:1 .',
    'cd /w && container build .',
    'container builder status',
    'container logs buildkit',
    'container ls -a',
  ])('%s は、どの担当も通す', (command) => {
    expect(judgeOwn(command, 'software-engineer')).toBe(true);
    expect(judgeOwn(command, undefined)).toBe(true);
  });
});

describe('この repo の設定の、名を書かない命令と container-system（t-9tac）', () => {
  const own = readRolesConfig(join(import.meta.dirname, '..', '..', '.claude', 'roles', 'config.jsonc')).infra;
  const judgeOwn = (command: string, role: RoleName | undefined) =>
    judge({ command, role, config: { infra: own, trackers: { jira: [], github: [] } }, approvals: {}, now }).allow;

  test('container-system の手続きは PM だけ', () => {
    expect(own['container-system']?.guard).toBe('pm-only');
  });

  test.each([
    'container system stop',
    'container s stop',
    'container prune',
    'container clean x',
    'container volume prune',
    'container v prune',
    'container network prune',
    'container n delete --all',
    'container v rm pagetray-data-v1',
    'container v delete roster-nats-data',
  ])('%s を、DevOps Engineer 担当も止める', (command) => {
    expect(judgeOwn(command, 'software-engineer')).toBe(false);
    // 略の v で名を書いた pagetray・nats の volume は、今までどおり TPM に相談（DevOps Engineer 担当は通る）。
    expect(judgeOwn(command, 'devops-engineer')).toBe(/^container v (?:rm|delete) /.test(command));
  });

  // pagetray の container の名は pagetray.box（pagetray 1.2.0 から。同じ network の callboard が名で引く。AI-32）。
  // 新しい名の命令を、宣言に名指しで書く（前の名の項目も残す。前の名で動かしている間と、前の名で起こし直す試みを止めるため）。
  test.each(['--name pagetray.box', 'container start pagetray.box', 'container stop pagetray.box', 'container kill pagetray.box', 'container delete pagetray.box', 'container rm pagetray.box'])(
    'pagetray の宣言に %s がある（前の名の項目も残る）',
    (entry) => {
      expect(own.pagetray?.match).toContain(entry);
      expect(own.pagetray?.match).toContain(entry.replace('pagetray.box', 'pagetray'));
    },
  );

  test.each([
    'container stop pagetray.box',
    'container rm -f pagetray.box',
    'container run -d --name pagetray.box -p 127.0.0.1:8801:8080 -v pagetray-data-v1:/data ghcr.io/uraitakahito/pagetray:v1.2.0',
    'sudo -u root container kill pagetray.box',
    // 名を = で繋ぎ、volume を長い旗で付ける（か、付けない）形（review-18）。
    'container run -d --name=pagetray.box --volume pagetray-data-v1:/data ghcr.io/uraitakahito/pagetray:v1.2.0',
    'container run -d --name=pagetray.box ghcr.io/uraitakahito/pagetray:v1.2.0',
    'container run -d --name=pagetray -p 127.0.0.1:8801:8080 ghcr.io/uraitakahito/pagetray:v1.2.0',
    'container run --rm --volume pagetray-data-v1:/data docker.io/library/rust:1.100.0-alpine sh',
    // 前の名（付け直す時に、止めて消す）。
    'container stop pagetray',
    'container delete pagetray',
    // t-9tac で足した、volume の略の v。
    'container v rm pagetray-data-v1',
    'container v delete pagetray-data-v1',
  ])('%s は、ほかの担当を止め、DevOps Engineer 担当は通す（TPM に相談）', (command) => {
    expect(judgeOwn(command, 'software-engineer')).toBe(false);
    expect(judgeOwn(command, 'devops-engineer')).toBe(true);
  });

  test.each([
    'container stop --all',
    'container rm -af',
    'container stop $(container ls -q)',
    'container ls -q | xargs container rm -f',
    'container volume delete --all',
    'container v rm $(container v ls -q)',
    // 語の途中の置き換え（t-ta2b の review-1 の指摘 1。前は跡を残さず、字の名 pagetray に見えて通った）。
    'container stop pagetray$(echo .box)',
    'container stop x`echo y`',
  ])('%s（名を書かない）は、その動詞を持つ環境に当たり、ほかの担当を止める', (command) => {
    expect(judgeOwn(command, 'software-engineer')).toBe(false);
  });

  test.each([
    'container stop mytest',
    'container rm -f mytest',
    'container v rm mytest-data',
    'container system status',
    'container system df',
    'container volume ls',
    'container network ls',
    'container builder status',
  ])('%s は、どの担当も通す', (command) => {
    expect(judgeOwn(command, 'software-engineer')).toBe(true);
  });

  // 名を宣言しない環境の項目は、語が続けて並ぶ時だけ当たる（間は旗とその値だけ。review-2 の指摘 1）。
  test.each([
    'container image prune -a',
    'container exec mybox make clean',
    'container run --rm img npm run clean',
    'container build --target clean .',
    'container exec mybox git worktree prune',
  ])('%s は、container-system に当たらず通す', (command) => {
    expect(judgeOwn(command, 'software-engineer')).toBe(true);
  });

  test.each([
    'container --debug system stop',
    'timeout 60 /opt/homebrew/bin/container stop --all',
    'container ls -q | xargs -I {} /opt/homebrew/bin/container rm -f {}',
  ])('%s は止める', (command) => {
    expect(judgeOwn(command, 'software-engineer')).toBe(false);
  });
});

// 隣の repo の本物の宣言。guard は、TPM 担当を起こした folder の直下の folder の宣言も読むので、本体の checkout の file が効く。
// worktree からでも本体を指すよう、git の common dir（<本体>/.git。絶対の path で取る）の親の親を、repo を並べた folder とみなす。
// 隣の repo の本体の checkout が無い時は飛ぶ（CI では飛ぶ。手元で流す試験）。git には GIT_DIR などを渡さない（hook の中で流れても読み違えない）。
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: import.meta.dirname, encoding: 'utf8', env: gitEnv }).stdout?.trim() ?? '';
const sibling = (repo: string): string => join(dirname(dirname(common)), repo, '.claude', 'roles', 'config.jsonc');
const hasSibling = (repo: string): boolean => common !== '' && existsSync(sibling(repo));

// 名を = で繋ぐ形（--name=…）と、volume を付ける長い旗（--volume …）で起こす命令（t-vp6r。台帳 #291）。
// pagetray の宣言は PR #256（review-18）で塞いだ。同じ形を、nats・builder と、隣の repo（castlist・pagetray）の宣言にも足す。
describe('名を = で繋ぐ形と、volume の長い旗（t-vp6r。台帳 #291）', () => {
  const judgeIn = (infra: Record<string, InfraEnv>) => (command: string, role: RoleName | undefined) =>
    judge({ command, role, config: { infra, trackers: { jira: [], github: [] } }, approvals: {}, now }).allow;
  const judgeOwn = judgeIn(readRolesConfig(join(import.meta.dirname, '..', '..', '.claude', 'roles', 'config.jsonc')).infra);

  test.each([
    'container run -d --name=roster-nats -p 127.0.0.1:4222:4222 --volume roster-nats-data:/data docker.io/library/nats:2.12 -js',
    'container run -d --name=roster-nats docker.io/library/nats:2.12 -js',
    'container run --rm --volume roster-nats-data:/data docker.io/library/alpine:3.22 sh',
    'container run -d --name=buildkit x',
  ])('この repo の設定: %s は、ほかの担当を止め、DevOps Engineer 担当は通す（TPM に相談）', (command) => {
    expect(judgeOwn(command, 'software-engineer')).toBe(false);
    expect(judgeOwn(command, 'devops-engineer')).toBe(true);
  });

  test.each([
    'container run --rm --name=mytest --volume mytest-data:/data docker.io/library/alpine:3.22 sh',
    'container volume inspect roster-nats-data',
    'container logs roster-nats',
  ])('この repo の設定: %s（関わりの無い・読むだけの命令）は、どの担当も通す', (command) => {
    expect(judgeOwn(command, 'software-engineer')).toBe(true);
  });

  describe.skipIf(common === '' || !existsSync(sibling('castlist')))('castlist の repo の宣言（PM だけ。隣の repo の本体の checkout が無い時は飛ぶ）', () => {
    const castlist = readRolesConfig(sibling('castlist')).infra;
    const judgeCastlist = judgeIn(castlist);
    test('手続きは PM だけ', () => {
      expect(castlist.castlist?.guard).toBe('pm-only');
    });
    test.each([
      'container run -d --name=castlist.box -p 127.0.0.1:8802:8080 --volume castlist-data-v1:/data ghcr.io/uraitakahito/castlist:v2.0.0',
      'container run -d --name=castlist.box ghcr.io/uraitakahito/castlist:v2.0.0',
      'container run -d --name=castlist -p 127.0.0.1:8802:8080 ghcr.io/uraitakahito/castlist:v2.0.0',
      'container run --rm --volume castlist-data-v1:/data docker.io/library/rust:1.100.0-alpine sh',
      // 前からの形も、今までどおり止まる。
      'container stop castlist.box',
      'container run -d --name castlist.box -p 127.0.0.1:8802:8080 -v castlist-data-v1:/data ghcr.io/uraitakahito/castlist:v2.0.0',
    ])('%s は、どの担当も止める（DevOps Engineer 担当・TPM 担当も）', (command) => {
      expect(judgeCastlist(command, 'software-engineer')).toBe(false);
      expect(judgeCastlist(command, 'devops-engineer')).toBe(false);
      expect(judgeCastlist(command, 'auditor')).toBe(false);
      // TPM 担当（と roster が起こしていない session）は役が無い。
      expect(judgeCastlist(command, undefined)).toBe(false);
    });
    test.each([
      'container run --rm --name=mytest --volume mytest-data:/data docker.io/library/alpine:3.22 sh',
      'container logs castlist.box',
    ])('%s は、どの担当も通す', (command) => {
      expect(judgeCastlist(command, 'software-engineer')).toBe(true);
    });
  });

  describe.skipIf(common === '' || !existsSync(sibling('pagetray')))('pagetray の repo の宣言（TPM に相談。隣の repo の本体の checkout が無い時は飛ぶ）', () => {
    const judgePagetray = judgeIn(readRolesConfig(sibling('pagetray')).infra);
    test.each([
      'container run -d --name=pagetray.box --volume pagetray-data-v1:/data ghcr.io/uraitakahito/pagetray:v1.2.0',
      'container run -d --name=pagetray.box ghcr.io/uraitakahito/pagetray:v1.2.0',
      'container run -d --name=pagetray -p 127.0.0.1:8801:8080 ghcr.io/uraitakahito/pagetray:v1.2.0',
      'container run --rm --volume pagetray-data-v1:/data docker.io/library/rust:1.100.0-alpine sh',
      'container rm -f pagetray.box',
    ])('%s は、ほかの担当を止め、DevOps Engineer 担当は通す', (command) => {
      expect(judgePagetray(command, 'software-engineer')).toBe(false);
      expect(judgePagetray(command, 'devops-engineer')).toBe(true);
    });
    test.each([
      'container run --rm --name=mytest --volume mytest-data:/data docker.io/library/alpine:3.22 sh',
      'container logs pagetray.box',
    ])('%s は、どの担当も通す', (command) => {
      expect(judgePagetray(command, 'software-engineer')).toBe(true);
    });
  });
});

// 旗の書き方をそろえて読む（t-ta2b。台帳 #300）。container の命令の語と宣言の項目を、比べる前に 1 つの形にそろえる:
// 旗の = を割る・--volume を -v に・-v の値の付け方（-v=・続けて書く・束ねる）・--mount の source を -v と読む。
// 名と volume を変数・置き換えで渡す形は、値の分からない所を何でも当たるとみなす。宣言の項目は足さない。
describe('旗の書き方をそろえて読む（t-ta2b。台帳 #300）', () => {
  const judgeIn = (infra: Record<string, InfraEnv>) => (command: string, role: RoleName | undefined) =>
    judge({ command, role, config: { infra, trackers: { jira: [], github: [] } }, approvals: {}, now });
  const allowIn = (infra: Record<string, InfraEnv>) => (command: string, role: RoleName | undefined) => judgeIn(infra)(command, role).allow;
  const own = readRolesConfig(join(import.meta.dirname, '..', '..', '.claude', 'roles', 'config.jsonc')).infra;
  const judgeOwn = allowIn(own);

  test.each([
    'container run --rm --volume=roster-nats-data:/data docker.io/library/alpine:3.22 sh',
    'container run --rm --mount type=volume,source=roster-nats-data,target=/data docker.io/library/alpine:3.22 sh',
    'container run --rm -v=roster-nats-data:/data docker.io/library/alpine:3.22 sh',
    'container run --rm -vroster-nats-data:/data docker.io/library/alpine:3.22 sh',
    'container run -d --name "$N" docker.io/library/nats:2.12 -js',
    'container run --rm --volume=pagetray-data-v1:/data docker.io/library/alpine:3.22 sh',
  ])('この repo の設定: %s は、ほかの担当を止め、DevOps Engineer 担当は通す（TPM に相談）', (command) => {
    expect(judgeOwn(command, 'software-engineer')).toBe(false);
    expect(judgeOwn(command, 'devops-engineer')).toBe(true);
  });

  test('変数で渡した名を止めた訳には、名を字で書く案内が付く', () => {
    const verdict = judgeIn(own)('container run -d --name "$N" img', 'software-engineer');
    expect(verdict.allow).toBe(false);
    if (!verdict.allow) expect(verdict.reason).toContain('名を字で書いて');
    const named = judgeIn(own)('container run -d --name roster-nats img', 'software-engineer');
    expect(named.allow).toBe(false);
    if (!named.allow) expect(named.reason).not.toContain('名を字で書いて');
  });

  // 本物の宣言で止める形。castlist は PM だけなので、どの担当も止まる。
  const castlistStops = [
    // (1) volume の長い旗を = で繋ぐ。
    'container run --rm --volume=castlist-data-v1:/data docker.io/library/alpine:3.22 sh',
    'container create --volume=castlist-data-v1:/data docker.io/library/alpine:3.22',
    // (2) --mount の source（= で繋ぐ形・src・type の無い形も）。
    'container run --rm --mount type=volume,source=castlist-data-v1,target=/data docker.io/library/alpine:3.22 sh',
    'container run --rm --mount=type=volume,source=castlist-data-v1,target=/data docker.io/library/alpine:3.22 sh',
    'container run --rm --mount source=castlist-data-v1,target=/data docker.io/library/alpine:3.22 sh',
    'container run --rm --mount type=volume,src=castlist-data-v1,dst=/data,readonly docker.io/library/alpine:3.22 sh',
    // (3) 短い旗 -v を = で繋ぐ・続けて書く・束ねる。
    'container run --rm -v=castlist-data-v1:/data docker.io/library/alpine:3.22 sh',
    'container run --rm -vcastlist-data-v1:/data docker.io/library/alpine:3.22 sh',
    'container run --rm -dv castlist-data-v1:/data docker.io/library/alpine:3.22 sh',
    'container run --rm -dvcastlist-data-v1:/data docker.io/library/alpine:3.22 sh',
    // = は最初の 1 つで割る（review-1 の指摘 6）。
    'container run --rm -v=castlist-data-v1:/data:ro docker.io/library/alpine:3.22 sh',
    // (4) 名・volume を変数・置き換えで渡す（同じ行の代入は読まない）。
    'container run -d --name "$N" ghcr.io/uraitakahito/castlist:v2.0.0',
    'container run -d --name="$N" ghcr.io/uraitakahito/castlist:v2.0.0',
    'container run -d --name "${N}.box" ghcr.io/uraitakahito/castlist:v2.0.0',
    'container run -d --name "$(cat name)" ghcr.io/uraitakahito/castlist:v2.0.0',
    'container run -d --name `cat name` ghcr.io/uraitakahito/castlist:v2.0.0',
    'N=castlist.box; container run -d --name "$N" ghcr.io/uraitakahito/castlist:v2.0.0',
    'container run --rm -v "$V":/data docker.io/library/alpine:3.22 sh',
    'container run --rm -v "${V}:/data" docker.io/library/alpine:3.22 sh',
    'container run --rm --volume="castlist-$S:/data" docker.io/library/alpine:3.22 sh',
    'container run --rm --mount "type=volume,source=$V,target=/data" docker.io/library/alpine:3.22 sh',
    'container run --rm --mount "$M" docker.io/library/alpine:3.22 sh',
    // 語の途中の置き換え（review-1 の指摘 1）。
    'container run --rm -v "$(cat f)":/data docker.io/library/alpine:3.22 sh',
    'container run -d --name "$(echo castlist).box" ghcr.io/uraitakahito/castlist:v2.0.0',
    'container run --rm -v `cat f`:/data docker.io/library/alpine:3.22 sh',
    // 字の頭が項目の頭より短い（review-1 の指摘 5）。
    'container run --rm -v cast"$X":/data docker.io/library/alpine:3.22 sh',
    // xargs・find の置き場と、値の無い旗（review-1 の指摘 2）。
    'echo castlist.box | xargs -I{} container run -d --name {} ghcr.io/uraitakahito/castlist:v2.0.0',
    'echo castlist.box | xargs -I % container run -d --name % ghcr.io/uraitakahito/castlist:v2.0.0',
    'echo castlist.box | xargs container run -d --name',
    'find . -name x -exec container run --rm -v {}:/data docker.io/library/alpine:3.22 sh \\;',
    // brace の展開（review-1 の指摘 8）。
    'container run -d --name=castlist.{box,box} ghcr.io/uraitakahito/castlist:v2.0.0',
    // 同じ行で path の変数を替える（review-1 の指摘 4）。
    'HOME=castlist-data-v1; container run --rm -v "$HOME":/data docker.io/library/alpine:3.22 sh',
    'export PWD=castlist-data-v1 && container run --rm -v "${PWD}:/data" docker.io/library/alpine:3.22 sh',
    // 前置き・path の付いた名・sh -c の中。
    'timeout 60 /opt/homebrew/bin/container run --rm --volume=castlist-data-v1:/data docker.io/library/alpine:3.22 sh',
    'sh -c \'container run --rm -v=castlist-data-v1:/data docker.io/library/alpine:3.22 sh\'',
    // 字の含みの当たり（here-document・ssh の引数）にも、同じそろえ方を使う。
    'bash <<\'X\'\ncontainer run --rm --volume=castlist-data-v1:/data docker.io/library/alpine:3.22 sh\nX',
    'ssh host \'container run --rm --mount type=volume,source=castlist-data-v1,target=/data docker.io/library/alpine:3.22 sh\'',
    'ssh host \'container run -d --name "$N" ghcr.io/uraitakahito/castlist:v2.0.0\'',
    // 字の含みは、そろえる前の項目の字のまま（container の語の無い包みも、今までどおり止まる。review-1 の指摘 7）。
    './up.sh --name=castlist.box',
    // 前の区切りに exec か -- のある container の命令があっても、後ろの ssh の中を読む（review-2 の指摘 1）。
    'container exec web ls; ssh host \'container run --rm --mount type=volume,source=castlist-data-v1,target=/data docker.io/library/alpine:3.22 sh\'',
    'container run --rm docker.io/library/alpine:3.22 -- true; ssh host \'container run --rm -v=castlist-data-v1:/data docker.io/library/alpine:3.22 sh\'',
    // 命令の名の途中の置き換え（review-2 の指摘 2）。
    'container$(true) stop castlist.box',
    'timeout 60 container$(true) stop castlist.box',
    // 動詞・旗の途中の置き換え（review-3 の指摘 1）。
    'container stop$(true) castlist.box',
    'container run -d --name$(true) castlist.box ghcr.io/uraitakahito/castlist:v2.0.0',
    'container run -d --name$(true) "$N" ghcr.io/uraitakahito/castlist:v2.0.0',
    // source の無い mount の値の途中の変数（review-3 の指摘 2）。
    'container run --rm --mount "type=volume,target=/data,$S" docker.io/library/alpine:3.22 sh',
    // \ と改行で続けた here-document・ssh の中（review-3 の指摘 3）。
    'bash <<\'X\'\ncontainer run --rm \\\n  --volume=castlist-data-v1:/data docker.io/library/alpine:3.22 sh\nX',
    'ssh host \'container run --rm \\\n  --mount type=volume,source=castlist-data-v1,target=/data docker.io/library/alpine:3.22 sh\'',
    'ssh host \'container run --rm \\\n  -v "$V":/data docker.io/library/alpine:3.22 sh\'',
    // 引用しない here-document の中の置き換え（shell が動かす。review-4 の指摘 1）。
    'git commit -F - <<EOF\n$(container run --rm --volume=castlist-data-v1:/data docker.io/library/alpine:3.22 cat /data/x)\nEOF',
    'cat <<EOF > out.txt\n`container run --rm -v "$V":/data docker.io/library/alpine:3.22 cat /data/x`\nEOF',
    // sh -c と eval の中の語の途中の置き換え（review-4 の指摘 2）。
    'sh -c "container run -d --name castlist$(echo .box) ghcr.io/uraitakahito/castlist:v2.0.0"',
    'eval container run --rm -v castlist$(echo -data-v1):/data docker.io/library/alpine:3.22 sh',
    // 本文を送るだけでない gh（review-4 の指摘 3）。
    'gh cs ssh -c mycs -- \'container run --rm -v=castlist-data-v1:/data docker.io/library/alpine:3.22 sh\'',
    'gh ext exec foo \'container run --rm -v=castlist-data-v1:/data docker.io/library/alpine:3.22 sh\'',
    // 字を出す命令でも、字を動かす命令と並べば読む。
    'cat <<\'X\' | sh\ncontainer run --rm --volume=castlist-data-v1:/data docker.io/library/alpine:3.22 sh\nX',
    // 値の無い --mount（review-2 の指摘 3）。
    'echo \'type=volume,source=castlist-data-v1,target=/data docker.io/library/alpine:3.22 sh\' | xargs container run --rm --mount',
    // 空でありうる path の変数の後ろに字が続く（review-2 の指摘 4）。
    'container run --rm -v "${OLDPWD}castlist-data-v1:/data" docker.io/library/alpine:3.22 sh',
    'container run --rm -v "${TMPDIR}castlist-data-v1:/data" docker.io/library/alpine:3.22 sh',
    // image より後ろの語（container の中の命令）もそろえて読む（image の位置は、値を取る旗を知らないと決まらない。-- を挟めばそろえない。review-2 の指摘 5）。
    'container run --rm docker.io/library/alpine:3.22 tar -xzv castlist-data-v1.tgz',
  ];
  // 関わりの無い命令・読むだけの命令・文と検索。
  const castlistPasses = [
    'container run --rm --name=mytest --volume=mytest-data:/data docker.io/library/alpine:3.22 sh',
    'container run --rm --mount type=volume,source=mytest-data,target=/data docker.io/library/alpine:3.22 sh',
    'container run --rm --mount type=bind,source=/tmp/x,target=/x docker.io/library/alpine:3.22 sh',
    'container run --rm -v "$PWD:/w" docker.io/library/alpine:3.22 sh',
    'container run --rm -v "$HOME/x:/x" docker.io/library/alpine:3.22 sh',
    'container run --rm -v "${TMPDIR}/x:/x" docker.io/library/alpine:3.22 sh',
    'container run --rm -v "$OLDPWD:/x" docker.io/library/alpine:3.22 sh',
    // 区切りの外の命令の旗は、container の旗と読まない（review-2 の指摘 1）。
    'container logs mytest 2>&1 | grep -v "$X"',
    'container ls | grep -v "$PAT"',
    'for n in a b; do container logs "$n" | grep -v "$n"; done',
    'container ls; echo "--name $N"',
    'mkdir -pv "$OUT" && container ls',
    // PR の本文と commit の文（字を動かさない命令の引数と here-document。review-3 の指摘 4）。
    'gh pr create --title x --body "container run -d --name \\"$N\\" は止まる"',
    'gh pr create --title x --body \'container run --volume=castlist-data-v1:/data は止まる\'',
    'git commit -F - <<\'EOF\'\ncontainer run -v "$V":/data を止める\nEOF',
    'gh pr create --title x --body "$(cat <<\'EOF\'\ncontainer run -d --name "$N" は止まる\nEOF\n)"',
    'gh issue comment 12 --body \'container run --volume=castlist-data-v1:/data は止まる\'',
    // source の無い mount の、ほかの key の値の変数（review-4 の指摘 6）。
    'container run --rm --mount "type=tmpfs,target=/x,tmpfs-size=$SZ" docker.io/library/alpine:3.22 sh',
    'container run --rm -v /tmp/x:/x docker.io/library/alpine:3.22 sh',
    'container run --rm --name "test-$N" docker.io/library/alpine:3.22 sh',
    // 字の頭も終わりも読む（"$N"x は、字の分け方が引用の切れ目を持たないので $Nx の 1 つの変数に読み、止まる側に倒れる）。
    'container run --rm --name "${N}-test" docker.io/library/alpine:3.22 sh',
    'container run --rm -e "X=$Y" --name mytest docker.io/library/alpine:3.22 sh',
    // source の無い字の mount（tmpfs・名の無い volume。review-1 の指摘 3）。
    'container run --rm --mount type=tmpfs,target=/x docker.io/library/alpine:3.22 sh',
    // container の中で動かす命令の旗（review-1 の指摘 9）と、-- の後ろ。
    'container exec mytest tar -xzv castlist-data-v1.tgz',
    'container exec mytest tar -xzvf castlist-data-v1.tgz',
    'container run --rm docker.io/library/alpine:3.22 -- tar -xzv castlist-data-v1.tgz',
    // 置き換えで名を出しても、字で書いた所が合わなければ通す。
    'container run --rm --name "test-$(date +%s)" docker.io/library/alpine:3.22 sh',
    'container volume inspect castlist-data-v1',
    'container logs castlist.box',
    'container inspect castlist.box',
    'container ls -a',
    'grep -- "--name=castlist" docs',
    'rg -- "--volume=castlist-data" .',
    'git commit -m "--mount source=castlist-data-v1 を読む"',
    'roster ask devops --what "container run --volume=castlist-data-v1:/data" --why "x"',
    'grep -v "$X" file',
  ];

  describe.skipIf(!hasSibling('castlist'))('castlist の repo の宣言（PM だけ。隣の repo の本体の checkout が無い時は飛ぶ）', () => {
    const judgeCastlist = allowIn(readRolesConfig(sibling('castlist')).infra);
    test.each(castlistStops)('%s は、どの担当も止める（DevOps Engineer 担当・TPM 担当も）', (command) => {
      expect(judgeCastlist(command, 'software-engineer')).toBe(false);
      expect(judgeCastlist(command, 'devops-engineer')).toBe(false);
      expect(judgeCastlist(command, undefined)).toBe(false);
    });
    test.each(castlistPasses)('%s は、どの担当も通す', (command) => {
      expect(judgeCastlist(command, 'software-engineer')).toBe(true);
    });
  });

  describe.skipIf(!hasSibling('pagetray'))('pagetray の repo の宣言（TPM に相談。隣の repo の本体の checkout が無い時は飛ぶ）', () => {
    const judgePagetray = allowIn(readRolesConfig(sibling('pagetray')).infra);
    const toPagetray = (command: string): string => command.replaceAll('castlist-data-v1', 'pagetray-data-v1').replaceAll('castlist.box', 'pagetray.box').replaceAll('castlist.{', 'pagetray.{').replaceAll('castlist$(', 'pagetray$(')
      .replaceAll('castlist-$S', 'pagetray-$S').replaceAll('cast"$X"', 'page"$X"').replaceAll('ghcr.io/uraitakahito/castlist:v2.0.0', 'ghcr.io/uraitakahito/pagetray:v1.2.0');
    test.each(castlistStops.map(toPagetray))('%s は、ほかの担当を止め、DevOps Engineer 担当は通す', (command) => {
      expect(judgePagetray(command, 'software-engineer')).toBe(false);
      expect(judgePagetray(command, 'devops-engineer')).toBe(true);
    });
    test.each(castlistPasses.map(c => c.replaceAll('castlist', 'pagetray')))('%s は、どの担当も通す', (command) => {
      expect(judgePagetray(command, 'software-engineer')).toBe(true);
    });
  });

  describe.skipIf(!hasSibling('callboard'))('callboard の repo の宣言（TPM に相談。隣の repo の本体の checkout が無い時は飛ぶ）', () => {
    const judgeCallboard = allowIn(readRolesConfig(sibling('callboard')).infra);
    test.each([
      'container run -d --name "$N" ghcr.io/uraitakahito/callboard:v1.0.0',
      'container run -d --name="$(cat name)" ghcr.io/uraitakahito/callboard:v1.0.0',
    ])('%s は、ほかの担当を止め、DevOps Engineer 担当は通す', (command) => {
      expect(judgeCallboard(command, 'software-engineer')).toBe(false);
      expect(judgeCallboard(command, 'devops-engineer')).toBe(true);
    });
    test.each([
      'container run -d --name "test-$N" ghcr.io/uraitakahito/callboard:v1.0.0',
      'grep -- "--name=callboard" docs',
      'container logs callboard',
    ])('%s は、どの担当も通す', (command) => {
      expect(judgeCallboard(command, 'software-engineer')).toBe(true);
    });
  });
});
