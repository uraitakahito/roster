import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { guard } from '../src/commands/infra.ts';
import { commandOf, guardSettings } from '../src/guard.ts';
import { ROLE_NAMES } from '../src/protocol.ts';
import { checkReviewCommand } from '../src/review-guard.ts';
import { world } from './helpers.ts';

describe('レビューの席の通す側の表（t-n4j9 の段 1a）', () => {
  test.each([
    'roster page path http://127.0.0.1:8801/p/t-x/brief-1.html',
    'roster watch pr https://github.com/o/r/pull/1 --timeout 0',
    'gh pr view 141 --json files',
    'gh pr diff 141 -R o/r',
    'gh pr checks 141',
    'gh run view 45 --log-failed',
    'gh issue view 12',
    'gh api repos/o/r/contents/x?ref=abc',
    'gh api -X GET repos/o/r/pulls',
    'cat a.txt | head -40 | tail -5',
    'grep -n "x" cli/src/guard.ts | cut -d: -f1 | sort -u | uniq -c',
    'rg -n guard cli/src',
    'ls -la; pwd; date -u',
    'sed -n 93,111p cli/src/guard.ts',
    'sed -n \'/^## /p\' x.md',
    'sed \'s/<[^>]*>//g\' page.html',
    'find . -name "*.ts" -not -path "./node_modules/*"',
    'jq -r .title x.json',
    'for f in a b; do cat $f; done',
    'if test -f x; then echo y; else echo n; fi',
    'wc -l x 2>/dev/null',
    'cat $(ls *.md)',
    'sort -t: -k2 -n x',
    'sort --numeric-sort --reverse x',
    'tree -L 2 --dirsfirst',
    '( cat x; echo y )',
  ])('通す: %s', (command) => {
    expect(checkReviewCommand(command)).toEqual({ outside: [], writes: [] });
  });

  test.each([
    // #242・#247 の形。
    ['npx vitest run', 'npx'],
    ['cargo test --locked', 'cargo'],
    ['cargo clippy --all-targets', 'cargo'],
    ['pnpm test', 'pnpm'],
    ['cd ../roster-worktrees/ai-45-review && npx vitest run', 'npx'],
    // 表に無い名・script に包んだ試験。
    ['tsx x.ts', 'tsx'],
    ['bun test', 'bun'],
    ['./gradlew test', 'path で書いた命令'],
    ['./ci/check.sh', 'path で書いた命令'],
    ['node_modules/.bin/tree', 'path で書いた命令'],
    ['sh -c "cargo test"', 'sh'],
    ['bash x.sh', 'bash'],
    ['make test', 'make'],
    // 前置きの語と頭の代入（review-3 の指摘 3）。
    ['env cargo test', 'env'],
    ['xargs npm test', 'xargs'],
    ['time cargo test', 'time'],
    ['GIT_EXTERNAL_DIFF=x git diff', '頭の代入'],
    ['RIPGREP_CONFIG_PATH=x rg y', '頭の代入'],
    // 字を動かす道具・旗。
    ['awk \'{print $1}\' x', 'awk'],
    ['python3 -c "print(1)"', 'python3'],
    ['node -e "1"', 'node'],
    ['less x', 'less'],
    ['rg --pre ./x y', 'rg --pre'],
    ['sort -o out x', 'sort -o'],
    ['sort --compress-program=sh x', 'sort --compress-program'],
    // 略した長い旗・まとめた短い旗・BSD の sed -I（review-6 の指摘 1・2）。
    ['sort --compress=sh x', 'sort --compress'],
    ['sort --out=f x', 'sort --out'],
    ['sort -uo out x', 'sort -uo'],
    ['tree -ao out', 'tree -ao'],
    ['sed -I \'\' s/a/b/ x', 'sed'],
    ['sed -nI.bak s/a/b/p x', 'sed'],
    ['tree -o out', 'tree -o'],
    ['uniq a b', 'uniq の書き出し'],
    ['find . -exec cargo test \\;', 'find -exec'],
    ['find . -delete', 'find -delete'],
    ['find . -fprint out', 'find -fprint'],
    ['sed -i s/a/b/ x', 'sed'],
    ['sed -n \'1e cargo test\' x', 'sed'],
    ['sed -n \'s/a/b/w out\' x', 'sed'],
    ['sed -f script.sed x', 'sed'],
    // 素の git・変える gh（review-5 の指摘 1・食い違い）。
    ['git status', 'git'],
    ['git show HEAD:x', 'git'],
    ['git -C ../roster-worktrees/ai-45-review log', 'git'],
    ['gh pr checkout 141', 'gh pr checkout'],
    ['gh repo clone o/r', 'gh repo clone'],
    ['gh run download 45', 'gh run download'],
    ['gh api -X POST repos/o/r/issues', 'gh api'],
    ['gh api repos/o/r/issues -f title=x', 'gh api'],
    ['container run --rm alpine true', 'container'],
    ['roster infra run castlist -- x', 'roster infra run'],
    // 中の命令（review-4 の指摘 3）。
    ['cat <(cargo test)', 'process の置き換え'],
    ['diff <(npm test) x', 'process の置き換え'],
    ['( cargo test )', 'cargo'],
    ['echo $(cargo test)', 'cargo'],
    ['cat <<EOF\n$(cargo test)\nEOF', 'here-document'],
  ])('当たる: %s', (command, reason) => {
    const check = checkReviewCommand(command);
    expect(check.outside.join(' | ')).toContain(reason.split(' ')[0]);
    if (reason.includes(' ')) expect(check.outside.join(' | ')).toContain(reason.split(' ')[1]);
  });

  test('redirect の書く先を拾う（段 1a は記録だけ）', () => {
    expect(checkReviewCommand('echo x > out.txt 2>/dev/null').writes).toEqual(['out.txt']);
    expect(checkReviewCommand('cat x 2>/dev/null').writes).toEqual([]);
  });
});

describe('roster guard: レビューの席の命令の記録（段 1a は止めない）', () => {
  const staff = (w: ReturnType<typeof world>) => ({ ...w.role('t-x7k2.staff', 'file:9'), env: { ROSTER_KEY: 't-x7k2.staff', ROSTER_ROLE: 'staff-engineer' } });
  const input = (tool: string, command: string, extra: Record<string, unknown> = {}) => JSON.stringify({ tool_name: tool, tool_input: { command }, ...extra });
  const hits = (w: ReturnType<typeof world>): { agent: string, tool: string, command: string, outside: string[] }[] => {
    const text = (() => {
      try {
        return readFileSync(join(w.tpm.state.dir, 'review-guard.jsonl'), 'utf8');
      }
      catch {
        return '';
      }
    })();
    return text.split('\n').filter(l => l !== '').map(l => JSON.parse(l) as { agent: string, tool: string, command: string, outside: string[] });
  };

  test('表に無い命令は、通して記録する。手伝いは agent_type で分ける', async () => {
    const w = world({});
    expect(await guard(staff(w), input('Bash', 'npx vitest run', { agent_id: 'a1', agent_type: 'general-purpose' }))).toEqual({ allow: true });
    expect(await guard(staff(w), input('Bash', 'gh pr diff 1'))).toEqual({ allow: true });
    expect(hits(w)).toEqual([expect.objectContaining({ agent: 'general-purpose', tool: 'Bash', command: 'npx vitest run', outside: ['表に無い命令（npx）'] })]);
  });

  test('Monitor の命令も、命令として読む', async () => {
    const w = world({});
    expect(commandOf(input('Monitor', 'cargo test'))).toBe('cargo test');
    expect(await guard(staff(w), input('Monitor', 'cargo test'))).toEqual({ allow: true });
    expect(hits(w)).toEqual([expect.objectContaining({ tool: 'Monitor', command: 'cargo test' })]);
  });

  test('今の読むだけの守り（git の変える命令）は今のまま止め、表の記録には入れない', async () => {
    const w = world({});
    expect((await guard(staff(w), input('Bash', 'git push origin x'))).allow).toBe(false);
    expect(hits(w)).toEqual([]);
  });

  test('記録が書けない時も、命令は通す（段 1a は止めない。review-6 の指摘 3）', async () => {
    const w = world({});
    mkdirSync(join(w.tpm.state.dir, 'review-guard.jsonl'), { recursive: true });
    expect(await guard(staff(w), input('Bash', 'npx vitest run'))).toEqual({ allow: true });
  });

  test('ほかの役割は記録しない', async () => {
    const w = world({});
    const se = { ...w.role('t-x7k2', 'file:2'), env: { ROSTER_KEY: 't-x7k2', ROSTER_ROLE: 'software-engineer' } };
    expect(await guard(se, input('Bash', 'npx vitest run'))).toEqual({ allow: true });
    expect(hits(w)).toEqual([]);
  });
});

describe('どの席の guard も Monitor の命令を見る（台帳 #416）', () => {
  const monitor = (command: string) => JSON.stringify({ tool_name: 'Monitor', tool_input: { command, description: 'x', timeout_ms: 1000 } });

  test.each([undefined, ...ROLE_NAMES])('%s の席の settings は Monitor の前にも roster guard を呼ぶ', (role) => {
    const settings = JSON.parse(guardSettings('/r/cli/bin/roster', role)) as { hooks: { PreToolUse: { matcher: string }[] } };
    expect(settings.hooks.PreToolUse[0]?.matcher.split('|')).toEqual(expect.arrayContaining(['Bash', 'Monitor']));
  });

  test.each([undefined, ...ROLE_NAMES])('%s の席で、Monitor の pkill を止める', async (role) => {
    const w = world({});
    const seat = role === undefined ? w.tpm : { ...w.role('t-x7k2', 'file:2'), env: { ROSTER_KEY: 't-x7k2', ROSTER_ROLE: role } };
    expect((await guard(seat, monitor('pkill -f vitest'))).allow).toBe(false);
    expect((await guard(seat, monitor('tail -f x.log'))).allow).toBe(true);
  });

  // castlist は Product Manager だけの環境（volume は消えると戻らない）。Monitor で打っても、Bash と同じに止める（t-xdmv）。guard の判じだけを見る（本物の命令は動かさない）。
  test.each([undefined, ...ROLE_NAMES])('%s の席で、Monitor の castlist の命令を Bash と同じに止める', async (role) => {
    const castlist = { guard: 'pm-only', match: ['--name castlist.box', 'container stop castlist.box', 'container volume delete castlist-data*', 'container volume rm castlist-data*', '-v castlist-data*'] };
    const w = world({ infra: { castlist } });
    const seat = role === undefined ? w.tpm : { ...w.role('t-x7k2', 'file:2'), env: { ROSTER_KEY: 't-x7k2', ROSTER_ROLE: role } };
    const bash = (command: string) => JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
    for (const command of ['container volume delete castlist-data-v1', 'container stop castlist.box', 'container logs -f castlist.box; container volume rm castlist-data-v1']) {
      const byMonitor = await guard(seat, monitor(command));
      expect(byMonitor.allow).toBe(false);
      expect(byMonitor).toEqual(await guard(seat, bash(command)));
    }
    expect((await guard(seat, monitor('container logs -f pagetray.box'))).allow).toBe(true);
  });

  test.each(['auditor', 'staff-engineer'])('%s の席で、Monitor の gh pr checkout を止める（読むだけの席。t-xdmv）', async (role) => {
    const w = world({});
    const seat = { ...w.role('t-x7k2', 'file:2'), env: { ROSTER_KEY: 't-x7k2', ROSTER_ROLE: role } };
    expect(await guard(seat, monitor('gh pr checkout 141'))).toEqual({ allow: false, reason: expect.stringContaining('repo を変えません（gh pr checkout）') as string });
    expect((await guard(seat, monitor('gh pr checks 141 --watch'))).allow).toBe(true);
  });
});
