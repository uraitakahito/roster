import { describe, expect, test } from 'vitest';
import { NONE_GRACE_MS, WATCH_EXIT, WATCH_LOG, watchGithub, watchMain, watchPr, type WatchRecord } from '../src/commands/watch.ts';
import type { Context } from '../src/context.ts';
import type { ExecResult } from '../src/exec.ts';
import { TpmError } from '../src/skill-sets.ts';
import { lookChecks, lookMain, parsePr, RUN_GRACE_MS, span } from '../src/watch.ts';
import { world } from './helpers.ts';

const PR = 'https://github.com/o/r/pull/7';
const T0 = Date.parse('2026-11-27T12:00:00Z');

const ok = (value: unknown): ExecResult => ({ status: 0, stdout: JSON.stringify(value), stderr: '' });
/** gh pr checks は、まだの物があると 8、落ちた物があると 1 で終わるが、JSON は出す。 */
const checks = (status: number, ...buckets: string[]): ExecResult => ({ status, stdout: JSON.stringify(buckets.map((bucket, i) => ({ name: `c${i + 1}`, bucket, link: `https://x/${i + 1}` }))), stderr: '' });
const NO_CHECKS: ExecResult = { status: 1, stdout: '', stderr: 'no checks reported on the \'b\' branch' };
const DOWN: ExecResult = { status: 1, stdout: '', stderr: 'Get "https://api.github.com/x": dial tcp: connect: connection refused' };
const HTTP_502: ExecResult = { status: 1, stdout: '', stderr: 'gh: HTTP 502: Bad Gateway' };

/**
 * 偽の gh と偽の時計の席。answers は、gh の頭の 2 語（`pr checks` など）ごとの答えの並びで、聞かれるたびに 1 つ進む（最後の答えは、くり返す）。
 * sleep は、待たずに時計だけ進める。
 */
function seat(answers: Record<string, ExecResult[]>) {
  const w = world();
  const asked: string[] = [];
  let now = T0;
  const slept: number[] = [];
  const ctx: Context = {
    ...w.role('AI-41', 'file:swe'),
    exec: (cmd, args) => {
      const head = `${args[0] ?? ''} ${args[1] ?? ''}`;
      asked.push(`${cmd} ${args.join(' ')}`);
      const list = answers[head] ?? answers[args[0] ?? ''];
      if (list === undefined) throw new Error(`思わぬ命令: ${cmd} ${args.join(' ')}`);
      return (list.length > 1 ? list.shift() : list[0]) as ExecResult;
    },
    now: () => new Date(now),
    sleep: (ms) => {
      slept.push(ms);
      now += ms;
      return Promise.resolve();
    },
  };
  return { ctx, asked, slept, pass: (ms: number) => void (now += ms), records: () => ctx.state.lines<WatchRecord>(WATCH_LOG) };
}

/** PR の head（pr view）と branch の先（gh api …/commits/heads/…）の答え。既定は、どちらも new（追いついている）。 */
const head = (oid: string, state = 'OPEN', headRefName = 't-x/b'): ExecResult => ok({ state, headRefOid: oid, headRefName, headRepository: { name: 'r' }, headRepositoryOwner: { login: 'o' } });
const tip = (sha: string): ExecResult => ({ status: 0, stdout: `${sha}\n`, stderr: '' });
/** watch pr の席: PR の head は、既定で branch の先に追いついている。 */
const prSeat = (answers: Record<string, ExecResult[]>) => seat({ 'pr view': [head('new')], 'api': [tip('new')], ...answers });

describe('roster watch pr', () => {
  test('まだの check が、みな通るまで聞き続け、0 で終わる', async () => {
    const s = prSeat({ 'pr checks': [checks(8, 'pass', 'pending'), checks(8, 'pass', 'pending'), checks(0, 'pass', 'pass', 'skipping')] });
    const r = await watchPr(s.ctx, PR);
    expect(r).toEqual({ code: WATCH_EXIT.passed, lines: ['通った: check 3 つ（1 分 35 秒）'] });
    // 聞く間は、初めは短く、だんだん空ける。みな終わったのを見た後、間を空けてもう 1 度見てから終える。
    expect(s.slept).toEqual([20_000, 30_000, 45_000]);
    expect(s.asked.slice(0, 3)).toEqual([
      `gh pr view ${PR} --json state,headRefOid,headRefName,headRepository,headRepositoryOwner`,
      'gh api repos/o/r/commits/heads/t-x/b -q .sha',
      `gh pr checks ${PR} --json name,bucket,link`,
    ]);
    expect(s.records()).toEqual([{ at: '2026-11-27T12:00:00.000Z', kind: 'pr', target: PR, result: 'passed', code: 0, polls: 4, seconds: 95, key: 'AI-41' }]);
  });

  test('落ちた check が 1 つ分かれば、ほかがまだでも、そこで 10 で終わり、名と URL を出す', async () => {
    const s = prSeat({ 'pr checks': [checks(8, 'pending', 'pending'), checks(1, 'pass', 'fail', 'pending', 'cancel')] });
    const r = await watchPr(s.ctx, PR);
    expect(r.code).toBe(WATCH_EXIT.failed);
    expect(r.lines).toEqual(['落ちた: c2（https://x/2）・c4（https://x/4）', 'ほかの check: 通った 1・まだ 1（20 秒）']);
    expect(s.records()[0]?.result).toBe('failed');
  });

  test('check が付かない時は、5 分待ってから 30 で終わる（通ったの 0 にしない）', async () => {
    const s = prSeat({ 'pr checks': [NO_CHECKS] });
    const r = await watchPr(s.ctx, PR);
    expect(r.code).toBe(WATCH_EXIT.none);
    expect(r.code).not.toBe(WATCH_EXIT.passed);
    expect(r.lines[0]).toContain('check が付いていない');
    expect(r.lines[0]).toContain('通ったのではない');
    expect(s.slept.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(NONE_GRACE_MS);
    expect(s.records()[0]).toMatchObject({ result: 'none', code: 30 });
  });

  test('check が遅れて付いた時（3 分後）は、付いた check で判じる', async () => {
    const none = Array.from({ length: 5 }, () => NO_CHECKS);
    const s = prSeat({ 'pr checks': [...none, { status: 0, stdout: '[]', stderr: '' }, checks(8, 'pending'), checks(0, 'pass')] });
    const r = await watchPr(s.ctx, PR);
    expect(r.code).toBe(WATCH_EXIT.passed);
    expect(r.lines[0]).toMatch(/^通った: check 1 つ/);
  });

  test('push し直して head の commit が替わると、新しい commit の check（まだ）を見て待ち続ける', async () => {
    // gh pr checks は、いつも今の head の commit の check を返す。前の commit で通っていても、替わった後の「まだ」で待つ。
    const s = prSeat({ 'pr checks': [checks(8, 'pass', 'pending'), checks(8, 'pending', 'pending', 'pending'), checks(0, 'pass', 'pass', 'pass')] });
    expect((await watchPr(s.ctx, PR)).lines).toEqual(['通った: check 3 つ（1 分 35 秒）']);
  });

  test('GitHub が応えない回（繋がらない・502）を挟んでも、止まらずに聞き直す', async () => {
    const s = prSeat({ 'pr checks': [checks(8, 'pending'), DOWN, HTTP_502, checks(0, 'pass')] });
    const r = await watchPr(s.ctx, PR);
    expect(r.code).toBe(WATCH_EXIT.passed);
    expect(s.records()[0]?.polls).toBe(5);
  });

  test('上限（rate limit）の 403 は「応えない」に数えて聞き直す。権限の無い 403 は、聞き直さずに 1', async () => {
    const limited: ExecResult = { status: 1, stdout: '', stderr: 'gh: API rate limit exceeded for user ID 1. (HTTP 403)' };
    const secondary: ExecResult = { status: 1, stdout: '', stderr: 'gh: You have exceeded a secondary rate limit. (HTTP 403)' };
    const s = prSeat({ 'pr checks': [limited, secondary, checks(0, 'pass')] });
    expect((await watchPr(s.ctx, PR)).code).toBe(WATCH_EXIT.passed);
    const denied = prSeat({ 'pr checks': [{ status: 1, stdout: '', stderr: 'gh: Resource not accessible by integration (HTTP 403)' }] });
    expect((await watchPr(denied.ctx, PR)).code).toBe(WATCH_EXIT.error);
    expect(denied.slept).toEqual([]);
  });

  test('1 度「みな終わった」を見ても、次に check が増えていれば（遅れて付く check）、待ち続ける', async () => {
    const s = prSeat({ 'pr checks': [checks(0, 'pass'), checks(8, 'pass', 'pending'), checks(0, 'pass', 'pass')] });
    const r = await watchPr(s.ctx, PR);
    expect(r.lines[0]).toMatch(/^通った: check 2 つ/);
    expect(s.records()[0]?.polls).toBe(4);
  });

  test('gh が 0 で終わったのに JSON を読めない時は、「check が無い」と言い切らずに聞き直す', async () => {
    const s = prSeat({ 'pr checks': [{ status: 0, stdout: 'x', stderr: '' }, checks(0, 'pass')] });
    expect((await watchPr(s.ctx, PR)).code).toBe(WATCH_EXIT.passed);
    expect(s.records()[0]?.polls).toBe(3);
  });

  test('長さを過ぎたら 20 で終わる（まだの数を出す）', async () => {
    const s = prSeat({ 'pr checks': [checks(8, 'pass', 'pending', 'pending')] });
    const r = await watchPr(s.ctx, PR, { timeout: 3 });
    expect(r.code).toBe(WATCH_EXIT.timeout);
    expect(r.lines[0]).toMatch(/^まだ: check 3 つのうち 2 つが終わっていない/);
    expect(r.lines[0]).toContain(`roster watch pr ${PR}`);
    // 長さより早く終えない: 残りが聞く間より短ければ、残りだけ眠って、長さの所で最後に 1 度見る。
    expect(s.slept.reduce((a, b) => a + b, 0)).toBe(3 * 60_000);
    expect(s.records()[0]).toMatchObject({ result: 'timeout', code: 20, seconds: 180 });
  });

  test('みな終わったのを 1 度見た所で長さを過ぎたら、20 で終わる（字は PR の check の物）', async () => {
    const s = prSeat({ 'pr checks': [checks(8, 'pending'), checks(8, 'pending'), checks(0, 'pass')] });
    const r = await watchPr(s.ctx, PR, { timeout: 0.75 });
    expect(r.code).toBe(WATCH_EXIT.timeout);
    expect(r.lines[0]).toMatch(/^まだ: check 1 つは終わっていたが、続けてもう 1 度は見ていない/);
    expect(r.lines[0]).not.toContain('GitHub');
  });

  test('GitHub が応えないまま長さを過ぎたら、20 で「応えない」と出す', async () => {
    const s = prSeat({ 'pr checks': [DOWN] });
    const r = await watchPr(s.ctx, PR, { timeout: 2 });
    expect(r.code).toBe(WATCH_EXIT.timeout);
    expect(r.lines[0]).toContain('GitHub が応えない');
    expect(r.lines[0]).toContain('connection refused');
  });

  test('--timeout 0 は、今の様子を 1 回見て、待たずに終わる', async () => {
    const pending = prSeat({ 'pr checks': [checks(8, 'pass', 'pending')] });
    expect((await watchPr(pending.ctx, PR, { timeout: 0 })).code).toBe(WATCH_EXIT.timeout);
    expect(pending.slept).toEqual([]);
    const passed = prSeat({ 'pr checks': [checks(0, 'pass')] });
    expect((await watchPr(passed.ctx, PR, { timeout: 0 })).code).toBe(WATCH_EXIT.passed);
    const none = prSeat({ 'pr checks': [NO_CHECKS] });
    expect((await watchPr(none.ctx, PR, { timeout: 0 })).code).toBe(WATCH_EXIT.none);
    expect(none.slept).toEqual([]);
  });

  test('PR が無い・認証が無い時は、聞き直さずに 1 で終わる', async () => {
    const s = prSeat({ 'pr checks': [{ status: 1, stdout: '', stderr: 'GraphQL: Could not resolve to a PullRequest with the number of 7.' }] });
    const r = await watchPr(s.ctx, PR);
    expect(r.code).toBe(WATCH_EXIT.error);
    expect(r.lines[0]).toMatch(/^見張れない: /);
    expect(s.slept).toEqual([]);
    const auth = prSeat({ 'pr checks': [{ status: 4, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login' }] });
    expect((await watchPr(auth.ctx, PR)).code).toBe(WATCH_EXIT.error);
  });

  test('push の直後で PR の head が branch の先に追いついていない間は、前の commit の落ちた check を見ずに待つ（台帳 #340）', async () => {
    // 1 回目: PR の head は前の commit（old）、branch の先は新しい commit（new）。gh pr checks は前の commit の落ちた check を返すはず。
    const s = seat({ 'pr view': [head('old'), head('new')], 'api': [tip('new')], 'pr checks': [checks(0, 'pass', 'pass')] });
    const r = await watchPr(s.ctx, PR);
    expect(r).toEqual({ code: WATCH_EXIT.passed, lines: ['通った: check 2 つ（50 秒）'] });
    // 追いついていない回は、gh pr checks を聞かない。
    expect(s.asked.filter(a => a.startsWith('gh pr checks'))).toHaveLength(2);
  });

  test('追いつかないまま長さを過ぎたら、20 で「追いついていない」と出す', async () => {
    const s = seat({ 'pr view': [head('old')], 'api': [tip('new')], 'pr checks': [checks(1, 'fail')] });
    const r = await watchPr(s.ctx, PR, { timeout: 0 });
    expect(r.code).toBe(WATCH_EXIT.timeout);
    expect(r.lines[0]).toMatch(/^まだ: PR の head が、branch の先（push した commit）に追いついていない/);
    expect(s.asked.some(a => a.startsWith('gh pr checks'))).toBe(false);
  });

  test('branch が無い（merge して消した: 422・404）・head の repo が無い時は、比べずに check で判じる', async () => {
    const gone: ExecResult = { status: 1, stdout: '', stderr: 'gh: No commit found for SHA: heads/t-x/b (HTTP 422)' };
    const s = seat({ 'pr view': [head('old')], 'api': [gone], 'pr checks': [checks(0, 'pass')] });
    expect((await watchPr(s.ctx, PR, { timeout: 0 })).code).toBe(WATCH_EXIT.passed);
    const missing = seat({ 'pr view': [head('old')], 'api': [{ status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' }], 'pr checks': [checks(1, 'fail')] });
    expect((await watchPr(missing.ctx, PR, { timeout: 0 })).code).toBe(WATCH_EXIT.failed);
    const fork = seat({ 'pr view': [ok({ state: 'OPEN', headRefOid: 'old', headRefName: 'b', headRepository: null, headRepositoryOwner: { login: 'f' } })], 'pr checks': [checks(0, 'pass')] });
    expect((await watchPr(fork.ctx, PR, { timeout: 0 })).code).toBe(WATCH_EXIT.passed);
    expect(fork.asked.some(a => a.startsWith('gh api'))).toBe(false);
  });

  test('merge・close した PR は、branch の先が進んでいても比べずに check で判じる（GitHub は head を止める）', async () => {
    for (const state of ['MERGED', 'CLOSED']) {
      const s = seat({ 'pr view': [head('old', state)], 'pr checks': [checks(0, 'pass')] });
      expect((await watchPr(s.ctx, PR, { timeout: 0 })).code).toBe(WATCH_EXIT.passed);
      expect(s.asked.some(a => a.startsWith('gh api'))).toBe(false);
    }
  });

  test('head の repo を読めない（上限でない 403）時は、見張れないにせず、比べずに check で判じる', async () => {
    const denied: ExecResult = { status: 1, stdout: '', stderr: 'gh: Resource protected by organization SAML enforcement. (HTTP 403)' };
    const s = seat({ 'pr view': [head('old')], 'api': [denied], 'pr checks': [checks(0, 'pass')] });
    expect((await watchPr(s.ctx, PR, { timeout: 0 })).code).toBe(WATCH_EXIT.passed);
  });

  test('branch の名の # ・ ? ・ % は、片ごとに encode して path に入れる（/ は残す）', async () => {
    const s = seat({ 'pr view': [head('new', 'OPEN', 'fix/a#12?b%c')], 'api': [tip('new')], 'pr checks': [checks(0, 'pass')] });
    await watchPr(s.ctx, PR, { timeout: 0 });
    expect(s.asked).toContain('gh api repos/o/r/commits/heads/fix/a%2312%3Fb%25c -q .sha');
  });

  test('比べの答え（pr view・branch の先）が 5xx・繋がらない・上限の時は、比べずに進まず、聞き直す', async () => {
    const limited: ExecResult = { status: 1, stdout: '', stderr: 'gh: API rate limit exceeded for user ID 1. (HTTP 403)' };
    const s = seat({ 'pr view': [HTTP_502, head('new')], 'api': [DOWN, limited, tip('new')], 'pr checks': [checks(0, 'pass')] });
    const r = await watchPr(s.ctx, PR);
    expect(r.code).toBe(WATCH_EXIT.passed);
    expect(s.records()[0]?.polls).toBe(5);
    // 前の commit の落ちた check が返る時でも、5xx の間に 10 にしない。
    const shaky = seat({ 'pr view': [head('old')], 'api': [HTTP_502], 'pr checks': [checks(1, 'fail')] });
    const t = await watchPr(shaky.ctx, PR, { timeout: 0 });
    expect(t.code).toBe(WATCH_EXIT.timeout);
    expect(t.lines[0]).toContain('GitHub が応えない');
  });

  test('pr view の答えを読めない時は、聞き直す', async () => {
    const s = seat({ 'pr view': [ok({}), head('new')], 'api': [tip('new')], 'pr checks': [checks(0, 'pass')] });
    expect((await watchPr(s.ctx, PR)).code).toBe(WATCH_EXIT.passed);
    // state だけ無い答えも、「開いていない」と見て比べを飛ばさずに聞き直す。
    const noState = seat({ 'pr view': [ok({ headRefOid: 'old', headRefName: 'b', headRepository: { name: 'r' }, headRepositoryOwner: { login: 'o' } })], 'pr checks': [checks(1, 'fail')] });
    expect((await watchPr(noState.ctx, PR, { timeout: 0 })).code).toBe(WATCH_EXIT.timeout);
  });

  test('PR の URL でない字は断る', () => {
    const s = seat({});
    expect(() => watchPr(s.ctx, '243')).toThrow(TpmError);
    expect(() => watchPr(s.ctx, 'https://github.com/o/r/issues/7')).toThrow(TpmError);
    expect(s.asked).toEqual([]);
  });

  test('負の長さ・数でない長さは断る', async () => {
    const s = prSeat({ 'pr checks': [checks(0, 'pass')] });
    await expect(watchPr(s.ctx, PR, { timeout: -1 })).rejects.toThrow(TpmError);
    await expect(watchPr(s.ctx, PR, { timeout: Number('x') })).rejects.toThrow(TpmError);
  });
});

/** merge は、既定では 1 時間前（回がまだ作られきっていない「merge の直後」ではない）。 */
const merged = (mergedAt = '2026-11-27T11:00:00Z'): ExecResult => ok({ state: 'MERGED', mergeCommit: { oid: 'abc123' }, mergedAt });
const run = (workflowName: string, status: string, conclusion: string, createdAt = '2026-11-27T12:00:00Z', event = 'push') => ({ workflowName, status, conclusion, event, createdAt, url: `https://x/runs/${workflowName}-${createdAt}` });

describe('roster watch main', () => {
  test('merge の commit の workflow が、みな終わるまで見張る', async () => {
    const s = seat({ 'pr view': [merged()], 'run list': [ok([run('test', 'in_progress', ''), run('docs', 'completed', 'success')]), ok([run('test', 'completed', 'success'), run('docs', 'completed', 'success')])] });
    const r = await watchMain(s.ctx, PR);
    expect(r).toEqual({ code: WATCH_EXIT.passed, lines: ['通った: main の workflow 2 つ（50 秒）'] });
    expect(s.asked).toContain('gh run list --repo o/r --commit abc123 --limit 100 --json workflowName,status,conclusion,event,createdAt,url');
  });

  test('merge の直後で回がまだ無い時は「まだ」と見て待ち、作られたら判じる', async () => {
    const s = seat({ 'pr view': [merged('2026-11-27T11:59:50Z')], 'run list': [ok([]), ok([]), ok([run('test', 'completed', 'success')])] });
    expect((await watchMain(s.ctx, PR)).code).toBe(WATCH_EXIT.passed);
    // merge から 2 分の間は、在る回がみな終わっていても「まだ」（回が、まだ作られきっていないことがある）。
    expect(s.slept.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(RUN_GRACE_MS - 10_000);
  });

  test('取り消された回（後の回に寄った docs）は「落ちた」にせず、通ったの行に数を出す', async () => {
    const s = seat({ 'pr view': [merged()], 'run list': [ok([run('test', 'completed', 'success'), run('docs', 'completed', 'cancelled')])] });
    const r = await watchMain(s.ctx, PR);
    expect(r.code).toBe(WATCH_EXIT.passed);
    expect(r.lines[0]).toMatch(/^通った: main の workflow 1 つ・取り消し 1 つ（後の回が済ませたかは見ていない）（/);
  });

  test('merge から 2 分を過ぎても回が無ければ、30（付いていない）で終わる', async () => {
    const s = seat({ 'pr view': [merged('2026-11-27T11:00:00Z')], 'run list': [ok([])] });
    const r = await watchMain(s.ctx, PR, { timeout: 0 });
    expect(r.code).toBe(WATCH_EXIT.none);
    expect(r.lines[0]).toContain('main の workflow が付いていない');
  });

  test('merge から 2 分の内に 1 回だけ見ると（--timeout 0）、終わっていても「まだ」で、字は「0 つが終わっていない」にしない', async () => {
    const s = seat({ 'pr view': [merged('2026-11-27T11:59:50Z')], 'run list': [ok([run('test', 'completed', 'success')])] });
    const r = await watchMain(s.ctx, PR, { timeout: 0 });
    expect(r.code).toBe(WATCH_EXIT.timeout);
    expect(r.lines[0]).toMatch(/^まだ: main の workflow 1 つは終わっているが、merge から 2 分の内/);
  });

  test('落ちた workflow が分かっても、ほかがまだ動いている間は待ち、みな終わってから 10 で終わる', async () => {
    const s = seat({ 'pr view': [merged()], 'run list': [ok([run('test', 'in_progress', ''), run('docs', 'completed', 'failure')]), ok([run('test', 'in_progress', ''), run('docs', 'completed', 'failure')]), ok([run('test', 'completed', 'success'), run('docs', 'completed', 'failure')])] });
    const r = await watchMain(s.ctx, PR);
    expect(r.code).toBe(WATCH_EXIT.failed);
    expect(r.lines[1]).toMatch(/^ほかの main の workflow: 通った 1・まだ 0/);
    expect(s.slept).toEqual([20_000, 30_000]);
  });

  test('落ちた workflow が分かっても、merge から 2 分の内は待つ。長さを過ぎたら、分かっている所で 10', async () => {
    const fresh = seat({ 'pr view': [merged('2026-11-27T11:59:50Z')], 'run list': [ok([run('docs', 'completed', 'failure')])] });
    expect((await watchMain(fresh.ctx, PR)).code).toBe(WATCH_EXIT.failed);
    expect(fresh.slept.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(RUN_GRACE_MS - 10_000);
    const long = seat({ 'pr view': [merged()], 'run list': [ok([run('test', 'in_progress', ''), run('docs', 'completed', 'failure')])] });
    const r = await watchMain(long.ctx, PR, { timeout: 2 });
    expect(r.code).toBe(WATCH_EXIT.failed);
    expect(r.lines[1]).toMatch(/まだ 1/);
  });

  test('落ちた workflow があれば 10 で終わる', async () => {
    const s = seat({ 'pr view': [merged()], 'run list': [ok([run('test', 'completed', 'success'), run('docs', 'completed', 'failure')])] });
    const r = await watchMain(s.ctx, PR);
    expect(r.code).toBe(WATCH_EXIT.failed);
    expect(r.lines[0]).toBe('落ちた: docs（https://x/runs/docs-2026-11-27T12:00:00Z）');
  });

  test('merge していない PR は、聞き直さずに 1 で終わる', async () => {
    const s = seat({ 'pr view': [ok({ state: 'OPEN', mergeCommit: null, mergedAt: null })] });
    const r = await watchMain(s.ctx, PR);
    expect(r.code).toBe(WATCH_EXIT.error);
    expect(r.lines[0]).toContain('まだ merge されていません');
  });
});

describe('lookMain（roster report merged も使う判じ方）', () => {
  const pr = parsePr(PR);
  if (pr === undefined) throw new Error('PR の URL を読めない');
  const look = (runs: unknown[], mergedAt: string, now: number) => lookMain((_, args) => (args[1] === 'view' ? merged(mergedAt) : ok(runs)), pr, new Date(now));

  test('同じ commit に docs が 2 回（落ちた後に、流し直して通った）なら、新しい回で判じて「通った」', () => {
    const runs = [run('docs', 'completed', 'failure', '2026-11-27T12:00:00Z'), run('docs', 'completed', 'success', '2026-11-27T12:05:00Z', 'workflow_dispatch'), run('test', 'completed', 'success')];
    expect(look(runs, '2026-11-27T11:59:50Z', T0 + 600_000)).toEqual({ state: 'passed', total: 2 });
  });

  test('流し直した回が動いている間は「まだ」', () => {
    const runs = [run('docs', 'completed', 'failure', '2026-11-27T12:00:00Z'), run('docs', 'in_progress', '', '2026-11-27T12:05:00Z', 'workflow_dispatch')];
    expect(look(runs, '2026-11-27T11:59:50Z', T0 + 600_000)).toEqual({ state: 'pending', done: 0, total: 1 });
  });

  test('PR の check の回（pull_request）は数えない', () => {
    const runs = [run('test', 'completed', 'failure', '2026-11-27T11:50:00Z', 'pull_request')];
    expect(look(runs, '2026-11-27T11:00:00Z', T0)).toEqual({ state: 'none' });
  });

  test('merge から 2 分の内は、在る回がみな終わっていても「まだ」。落ちた回は、その間でも返す', () => {
    const at = '2026-11-27T12:00:00Z';
    expect(look([run('test', 'completed', 'success')], at, T0 + 60_000)).toEqual({ state: 'pending', done: 1, total: 1 });
    expect(look([run('test', 'completed', 'failure')], at, T0 + 60_000)).toMatchObject({ state: 'failed' });
    expect(look([run('test', 'completed', 'success')], at, T0 + RUN_GRACE_MS)).toEqual({ state: 'passed', total: 1 });
  });

  test('gh pr view の答えを読めない時は、「merge していない」と言い切らない（応えない）', () => {
    expect(lookMain(() => ({ status: 0, stdout: 'x', stderr: '' }), pr, new Date(T0))).toEqual({ state: 'unreachable', message: 'gh pr view の答えを読めない' });
  });

  test('回が無い: merge から 1 分なら「まだ」、3 分なら「無い」。merge の時刻が読めなければ「まだ」', () => {
    const at = '2026-11-27T12:00:00Z';
    expect(look([], at, T0 + 60_000)).toEqual({ state: 'pending', done: 0, total: 0 });
    expect(look([], at, T0 + RUN_GRACE_MS + 60_000)).toEqual({ state: 'none' });
    expect(lookMain((_, args) => (args[1] === 'view' ? ok({ state: 'MERGED', mergeCommit: { oid: 'a' } }) : ok([])), pr, new Date(T0))).toEqual({ state: 'pending', done: 0, total: 0 });
  });

  test('gh run list が読めない時は「応えない」（通った・無い、とは言わない）', () => {
    expect(lookMain((_, args) => (args[1] === 'view' ? merged() : HTTP_502), pr, new Date(T0))).toEqual({ state: 'unreachable', message: 'gh: HTTP 502: Bad Gateway' });
  });
});

describe('lookChecks', () => {
  const pr = parsePr(PR);
  if (pr === undefined) throw new Error('PR の URL を読めない');
  test('数では判じない: check が 3 つでも 5 つでも、みな終わっていれば「通った」', () => {
    expect(lookChecks(() => checks(0, 'pass', 'pass', 'skipping'), pr)).toEqual({ state: 'passed', total: 3 });
    expect(lookChecks(() => checks(0, 'pass', 'pass', 'pass', 'pass', 'pass'), pr)).toEqual({ state: 'passed', total: 5 });
  });

  test('知らない bucket は「まだ」に倒す', () => {
    expect(lookChecks(() => checks(0, 'pass', 'new-bucket'), pr)).toEqual({ state: 'pending', done: 1, total: 2 });
  });
});

describe('roster watch github', () => {
  test('1 度応えただけでは「戻った」としない。続けて 2 度応えたら 0', async () => {
    const up: ExecResult = { status: 0, stdout: '5000\n', stderr: '' };
    const s = seat({ api: [DOWN, up, HTTP_502, up, up] });
    const r = await watchGithub(s.ctx);
    expect(r.code).toBe(WATCH_EXIT.passed);
    expect(r.lines[0]).toMatch(/^戻った: GitHub が応えた/);
    expect(s.records()[0]).toMatchObject({ kind: 'github', target: 'github', polls: 5 });
    expect(s.asked[0]).toBe('gh api rate_limit -q .rate.limit');
  });

  test('--repo があれば、その repo を読めるかで見る', async () => {
    const s = seat({ api: [{ status: 0, stdout: 'o/r\n', stderr: '' }] });
    expect((await watchGithub(s.ctx, { repo: 'o/r' })).code).toBe(WATCH_EXIT.passed);
    expect(s.asked[0]).toBe('gh api repos/o/r -q .full_name');
    expect(() => watchGithub(s.ctx, { repo: 'r' })).toThrow(TpmError);
  });

  test('上限（rate limit）に当たっても、止まらずに聞き直す', async () => {
    const s = seat({ api: [{ status: 1, stdout: '', stderr: 'gh: API rate limit exceeded (HTTP 403)' }, { status: 0, stdout: '1', stderr: '' }] });
    expect((await watchGithub(s.ctx)).code).toBe(WATCH_EXIT.passed);
  });

  test('応えないまま長さを過ぎたら 20', async () => {
    const s = seat({ api: [DOWN] });
    const r = await watchGithub(s.ctx, { timeout: 5 });
    expect(r.code).toBe(WATCH_EXIT.timeout);
    expect(r.lines[0]).toContain('roster watch github');
  });

  test('--timeout 0 は、1 回見て、応えれば 0・応えなければ 20', async () => {
    expect((await watchGithub(seat({ api: [{ status: 0, stdout: '1', stderr: '' }] }).ctx, { timeout: 0 })).code).toBe(WATCH_EXIT.passed);
    expect((await watchGithub(seat({ api: [DOWN] }).ctx, { timeout: 0 })).code).toBe(WATCH_EXIT.timeout);
  });
});

describe('見張りの字', () => {
  test('PR の URL を読む', () => {
    expect(parsePr('https://github.com/o/r/pull/7/files')).toEqual({ repo: 'o/r', number: 7, url: PR });
    expect(parsePr('o/r#7')).toBeUndefined();
  });

  test('秒を、分と秒にする', () => {
    expect(span(42)).toBe('42 秒');
    expect(span(252)).toBe('4 分 12 秒');
  });
});
