// castlist（アクターの台帳。127.0.0.1 の別のサーバー）への組み込み。試験は偽の castlist（fake-castlist.ts。新しい API の決まりで答え、状態を持つ）と、何も待っていない port を使う。
// 本物の castlist（8802）と container には触らない。担当は file の連携で、本当には起こさない。
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { castlistIssuer, CASTLIST_VERSION, CASTLIST_VOLUME, emphasize, seatPrefix } from '../src/castlist.ts';
import { auditStart } from '../src/commands/audit.ts';
import { reviewList } from '../src/commands/review.ts';
import { readSession, sessionEnd, sessionStart } from '../src/commands/castlist.ts';
import { guard } from '../src/commands/infra.ts';
import { hello } from '../src/commands/role-side.ts';
import { askReview } from '../src/commands/staff.ts';
import { assign, close, roles } from '../src/commands/tpm-side.ts';
import { buildCommand, startTpm } from '../src/command.ts';
import { composeRolesConfig } from '../src/config.ts';
import type { Context } from '../src/context.ts';
import { guardSettings } from '../src/guard.ts';
import type { RoleName } from '../src/protocol.ts';
import { requireRole, readRole, type RoleRecord } from '../src/roster.ts';
import { roleEnv } from '../src/run-role.ts';
import { readReviews } from '../src/reviews.ts';
import { resolveSettings } from '../src/settings.ts';
import { startCastlist, type CastlistSeen, type FakeCastlist } from './fake-castlist.ts';
import { deadUrl } from './next-fake.ts';
import { BRIEF, staffRoot, world, type World } from './helpers.ts';

const SE = { role: 'software-engineer', title: '計画と実装', brief: BRIEF, wait: 0 } as const;
const tpmSid = 'aaaaaaaa-0000-4000-8000-000000000000';
const SID = 'bbbbbbbb-0000-4000-8000-000000000001';
const SID2 = 'bbbbbbbb-0000-4000-8000-000000000002';
const SID3 = 'bbbbbbbb-0000-4000-8000-000000000003';
/** world の時計の時刻（偽の castlist の既定の now と同じ）。 */
const NOW = '2026-11-20T12:00:00.000Z';
/** 送り手の時刻（sentAt）は world の時計の時刻（UTC の字。ミリ秒は付けても付けなくてもよい）。 */
const SENT_AT = expect.stringMatching(/^2026-11-20T12:00:00(?:\.000)?Z$/) as unknown;
const RUN_LINE = /^container run -d --name castlist\.box -p 127\.0\.0\.1:(\d+):8080 -v (\S+):\/data -m 200M -c 1 ghcr\.io\/uraitakahito\/castlist:(\S+)$/;

let fake: FakeCastlist;
let dead: string;

beforeAll(async () => {
  fake = await startCastlist(NOW);
  dead = await deadUrl();
});

afterAll(async () => {
  await fake.stop();
});

afterEach(() => {
  fake.intercept = undefined;
});

/** この後に偽の castlist が受けた要求を返す関数。 */
function mark(): () => CastlistSeen[] {
  const since = fake.requests().length;
  return () => fake.requests().slice(since);
}

/** 書く要求だけ（/healthz と読む要求を除く）。 */
const writes = (requests: CastlistSeen[]): CastlistSeen[] => requests.filter(r => r.method !== 'GET');

/** 道の初めの 2 段（/api/events など）。 */
const kindOf = (r: CastlistSeen): string => r.path.split('/').slice(0, 3).join('/');

/** 設定の file を読み直した周り（試験の中で file を消した後）。 */
const withConfig = (ctx: Context): Context => ({ ...ctx, config: composeRolesConfig(ctx.project) });

/** 周りの環境変数を足した周り。 */
const withEnv = (ctx: Context, extra: NodeJS.ProcessEnv): Context => ({ ...ctx, env: { ...ctx.env, ...extra } });

const startInput = (source: string, sid: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ hook_event_name: 'SessionStart', session_id: sid, source, transcript_path: '/nonexistent/transcript.jsonl', cwd: '/w', ...extra });
const endInput = (reason: string, sid: string): string => JSON.stringify({ hook_event_name: 'SessionEnd', session_id: sid, reason, transcript_path: '/nonexistent/transcript.jsonl' });
const bashInput = (sid: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, session_id: sid, transcript_path: '/nonexistent/transcript.jsonl', ...extra });

/** 外の命令のうち、castlist に触りうる物（container と、置き場でない URL への curl）。 */
const castlistCalls = (w: World) => w.calls.filter(c => c.cmd === 'container' || (c.cmd === 'curl' && !/127\.0\.0\.1:880[01]/.test(c.args.at(-1) ?? '')));

/** TPM 担当の周り: roster start の 1 行が付ける環境変数を持つ。 */
const tpmSeat = (w: World): Context => withEnv(w.tpm, {
  CLAUDE_CODE_SESSION_ID: tpmSid,
  ROSTER_LAUNCH: 'launch-tpm',
  ROSTER_LAUNCHED_BY: 'tpm.person:product-manager',
  ROSTER_LAUNCH_MODEL: 'claude-opus-5-5',
  ROSTER_LAUNCH_EFFORT: 'medium',
  ROSTER_LAUNCH_FRESH: '1',
});

/** 担当の周り: roster run-role が付ける環境変数（roleEnv）と、Claude Code の session。 */
function seat(w: World, key: string, sid: string, extra: NodeJS.ProcessEnv = {}): Context {
  const base = w.role(key, 'file:1');
  const record = requireRole(w.tpm, key);
  const env = roleEnv(record, w.project, w.tpm.state.dir, w.tpm.root, base.env);
  return { ...base, env: { ...env, CLAUDE_CODE_SESSION_ID: sid, ...extra } };
}

/** castlist を設定した世界で、roster start（PM の登録）・TPM 担当の登場・担当 1 人の assign までを済ませる。 */
async function launched(config: Record<string, unknown> = {}): Promise<{ w: World, tpm: Context, record: RoleRecord }> {
  const w = world({ castlist: fake.url, ...config });
  await startTpm(w.tpm);
  const tpm = tpmSeat(w);
  await sessionStart(tpm, startInput('startup', tpmSid));
  await hello(tpm);
  await assign(tpm, 't-x7k2', SE);
  return { w, tpm, record: requireRole(w.tpm, 't-x7k2') };
}

describe('castlist を設定していない時', () => {
  test('roster start・assign・hello・guard・close・session の hook は、castlist に触らない', async () => {
    const before = fake.requests().length;
    const w = world();
    let made = 0;
    const count = (ctx: Context): Context => ({ ...ctx, clients: { ...ctx.clients, castlist: (url) => {
      made += 1;
      return ctx.clients.castlist(url);
    } } });
    const tpm = count(tpmSeat(w));
    const { line } = await startTpm(count(w.tpm));
    expect(line).not.toContain('ROSTER_LAUNCH');
    await hello(tpm);
    await sessionStart(tpm, startInput('startup', tpmSid));
    await assign(tpm, 't-x7k2', SE);
    expect(readRole(w.tpm, 't-x7k2')).not.toHaveProperty('launch');
    expect(readRole(w.tpm, 't-x7k2')).not.toHaveProperty('launchedBy');
    const se = count(seat(w, 't-x7k2', SID));
    expect(se.env.ROSTER_LAUNCH).toBeUndefined();
    await sessionStart(se, startInput('startup', SID));
    expect(await guard(se, bashInput(SID, { effort: { level: 'high' } }))).toEqual({ allow: true });
    expect((await hello(se)).some(l => l.startsWith('アクター'))).toBe(false);
    await sessionEnd(se, endInput('other', SID));
    await close(tpm, 't-x7k2');
    expect(castlistCalls(w)).toEqual([]);
    expect(made).toBe(0);
    expect(w.tpm.state.list('sessions')).toEqual([]);
    expect(fake.requests().length).toBe(before);
  });
});

describe('castlist を設定していない時の警告', () => {
  const RULE = /^━+$/;
  const HEAD = '⚠ 警告: castlist（アクターの台帳）を設定していません';

  test('roster start は、起こす 1 行を今までどおり出し、枠で囲んだ警告を alert に返す（warnings には入れない）', async () => {
    const w = world();
    const { line, warnings, alert } = await startTpm(w.tpm);
    expect(line).toBe(buildCommand(w.tpm.project, w.tpm.root, w.tpm.skillSets, w.tpm.env));
    expect(warnings).toEqual([]);
    expect(alert[0]).toMatch(RULE);
    expect(alert.at(-1)).toMatch(RULE);
    expect(alert).toContain(HEAD);
    expect(alert.join('\n')).toContain(join(w.project, '.claude', 'roles', 'config.jsonc'));
    expect(alert).toContain('  足す 1 行: "castlist": "http://127.0.0.1:8802"');
    expect(alert).toContain('  （足すかは Product Manager が決める。担当は何もしなくてよい。TPM 担当が伝える）');
  });

  test('設定の file が無い project では、作って書くよう言い分ける', async () => {
    const w = world();
    const file = join(w.project, '.claude', 'roles', 'config.jsonc');
    rmSync(file);
    const { alert } = await startTpm(withConfig(w.tpm));
    expect(alert).toContain(`  ${file} が無いので、この project の席は castlist に何も送りません（タイムラインに出ません）。`);
    expect(alert).toContain('  作って書く 1 行: { "castlist": "http://127.0.0.1:8802" }');
  });

  test('roster hello は、TPM 担当にも担当にも、出力の頭に同じ枠を出す', async () => {
    const w = world();
    const tpm = tpmSeat(w);
    const lines = await hello(tpm);
    expect(lines[0]).toMatch(RULE);
    expect(lines[1]).toBe(HEAD);
    await assign(tpm, 't-x7k2', SE);
    const se = await hello(seat(w, 't-x7k2', SID));
    expect(se[0]).toMatch(RULE);
    expect(se[1]).toBe(HEAD);
  });

  test('設定か $ROSTER_CASTLIST_URL に castlist があれば、警告を出さない', async () => {
    const configured = await launched();
    expect((await hello(configured.tpm)).some(l => l === HEAD)).toBe(false);
    expect((await startTpm(configured.w.tpm)).alert).toEqual([]);
    const byEnv = world({}, { ROSTER_CASTLIST_URL: fake.url });
    expect((await startTpm(byEnv.tpm)).alert).toEqual([]);
  });

  test('直下の folder の設定にだけ castlist があれば、読まないことを名指す（無ければその行は出ない）', async () => {
    const w = world({}, {}, { castlist: { castlist: fake.url }, other: { tracker: 'none' } });
    const { alert } = await startTpm(w.tpm);
    expect(alert).toContain('  （直下の folder の設定に castlist がありますが、読みません: castlist）');
    expect((await startTpm(world().tpm)).alert.some(l => l.includes('直下の folder'))).toBe(false);
  });

  test('強める（色を付ける）のは terminal で NO_COLOR が無い時だけ', () => {
    const lines = ['━━', '⚠ 警告'];
    expect(emphasize(lines, { isTTY: true, env: {} })).toEqual(['\u001b[1;31m━━\u001b[0m', '\u001b[1;31m⚠ 警告\u001b[0m']);
    expect(emphasize(lines, { isTTY: false, env: {} })).toEqual(lines);
    expect(emphasize(lines, { isTTY: true, env: { NO_COLOR: '1' } })).toEqual(lines);
  });
});

describe('castlist が止まっている時', () => {
  test('roster start は 1 行を出さず、Product Manager が打つ container start を出す（container が在る時）', async () => {
    const w = world({ castlist: dead });
    w.answers.set('container inspect castlist.box', { status: 0, stdout: '[{}]', stderr: '' });
    await expect(startTpm(w.tpm)).rejects.toThrow(/castlist/);
    try {
      await startTpm(w.tpm);
    }
    catch (e) {
      const lines = (e as Error).message.split('\n');
      expect(lines).toContain('container start castlist.box');
      expect(lines.join('\n')).not.toContain('claude --model');
    }
  });

  test('新しい名の container が無く、0.1.0 の docs の名（castlist）の container が在れば、前の名で起こし、名を替える docs を添える', async () => {
    const w = world({ castlist: dead });
    w.answers.set('container inspect castlist.box', { status: 1, stdout: '', stderr: 'not found' });
    w.answers.set('container inspect castlist', { status: 0, stdout: '[{}]', stderr: '' });
    let message = '';
    try {
      await startTpm(w.tpm);
    }
    catch (e) {
      message = (e as Error).message;
    }
    expect(message.split('\n')).toContain('container start castlist');
    expect(message).toContain('castlist.box');
    expect(message).toContain('https://uraitakahito.github.io/castlist/run.html');
  });

  test('container が無ければ、container run の 1 行だけ（名は castlist.box、port は設定の URL の port、今の版と volume。docs の URL つき。移す案内は無い）', async () => {
    const w = world({ castlist: dead });
    w.answers.set('container inspect castlist.box', { status: 1, stdout: '', stderr: 'not found' });
    w.answers.set('container inspect castlist', { status: 1, stdout: '', stderr: 'not found' });
    let message = '';
    try {
      await startTpm(w.tpm);
    }
    catch (e) {
      message = (e as Error).message;
    }
    const lines = message.split('\n');
    const at = lines.findIndex(l => RUN_LINE.test(l));
    const [, port, volume, version] = RUN_LINE.exec(lines[at] ?? '') ?? [];
    expect(port).toBe(new URL(dead).port);
    expect(volume).toBe(CASTLIST_VOLUME);
    expect(version).toBe(CASTLIST_VERSION);
    expect(CASTLIST_VERSION).toBe('v2.1.1');
    expect(CASTLIST_VOLUME).toBe('castlist-data-v1');
    expect(lines[0]).toContain('https://uraitakahito.github.io/castlist/');
    // 前の volume（castlist-data）から移す案内は、もう出さない。
    expect(message).not.toContain('release.html');
    expect(message).not.toMatch(/castlist-data[^-]/);
  });

  test('roster assign は担当を起こさず、1 行と roster wait pm "castlist を起こす" --hand を出す', async () => {
    const w = world({ castlist: dead });
    await hello(w.tpm);
    await expect(assign(w.tpm, 't-x7k2', SE)).rejects.toThrow(/roster wait pm "castlist を起こす" --hand/);
    await expect(assign(w.tpm, 't-x7k2', SE)).rejects.toThrow(/^container start castlist\.box$/m);
    expect(w.wire.seats()).toEqual([]);
    expect(readRole(w.tpm, 't-x7k2')).toBeUndefined();
  });

  test('roster audit start は席を起こさない', async () => {
    const w = world({ castlist: dead });
    w.answers.set('container inspect castlist.box', { status: 1, stdout: '', stderr: '' });
    w.answers.set('container inspect castlist', { status: 1, stdout: '', stderr: '' });
    await expect(auditStart(w.tpm, { wait: 0 })).rejects.toThrow(/^container run -d --name castlist\.box /m);
    expect(w.wire.seats()).toEqual([]);
    expect(readRole(w.tpm, 'audit')).toBeUndefined();
  });

  test('roster hello は名乗らずに止まる', async () => {
    const w = world({ castlist: dead });
    await expect(hello(tpmSeat(w))).rejects.toThrow(/^container start castlist\.box$/m);
    expect(w.tpm.state.read('tpm.jsonc')).toBeUndefined();
  });

  test('guard は、まだ登録していない session の Bash を、1 行を添えて止める（Bash でない道具は通す）', async () => {
    const w = world({ castlist: dead });
    const verdict = await guard(tpmSeat(w), bashInput(tpmSid));
    expect(verdict.allow).toBe(false);
    expect(verdict.allow ? '' : verdict.reason).toContain('container start castlist');
    expect(await guard(tpmSeat(w), JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/x' }, session_id: tpmSid }))).toEqual({ allow: true });
  });

  test('session-start は誤りにせず、何も書かずに終わる', async () => {
    const w = world({ castlist: dead });
    await expect(sessionStart(tpmSeat(w), startInput('startup', tpmSid))).resolves.toBeUndefined();
    await expect(sessionEnd(tpmSeat(w), endInput('other', tpmSid))).resolves.toBeUndefined();
    expect(w.tpm.state.list('sessions')).toEqual([]);
  });
});

describe('時計', () => {
  test('castlist の時刻と 2 秒より離れていれば、roster report incident を勧める 1 行を出す（止めない）', async () => {
    const w = world({ castlist: fake.url });
    try {
      fake.setNow('2026-11-20T12:00:05.000Z');
      const { warnings, line } = await startTpm(w.tpm);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/5 秒.*roster report incident/);
      expect(line).toContain('claude --model');
      fake.setNow('2026-11-20T11:59:58.500Z');
      expect((await startTpm(w.tpm)).warnings).toEqual([]);
    }
    finally {
      fake.setNow(NOW);
    }
  });
});

describe('roster start', () => {
  test('/healthz を見て、Product Manager を人のアクターとして登録する（2 度目も同じアクター）。1 行に起こした印の環境変数を付ける', async () => {
    const w = world({ castlist: fake.url });
    const got = mark();
    const { line } = await startTpm(w.tpm);
    await startTpm(w.tpm);
    const requests = got();
    expect(requests[0]).toMatchObject({ method: 'GET', path: '/healthz' });
    expect(requests[0]?.headers.host).toBe(new URL(fake.url).host);
    expect(requests[0]?.headers).not.toHaveProperty('origin');
    const posts = requests.filter(r => r.path === '/api/actors');
    expect(posts).toHaveLength(2);
    expect(posts[0]?.body).toMatchObject({ kind: 'human', namePrefix: 'product-manager', bindings: [{ type: 'tpm.person', value: 'product-manager' }], sentAt: SENT_AT });
    expect(posts[0]?.body?.issuer).toBe(castlistIssuer(w.tpm.state.dir));
    expect(posts.map(p => p.status)).toEqual([201, 200]);
    for (const part of ['ROSTER_LAUNCH="$(uuidgen)"', 'ROSTER_LAUNCHED_BY=tpm.person:product-manager', 'ROSTER_LAUNCH_MODEL=claude-opus-5-5', 'ROSTER_LAUNCH_EFFORT=medium', 'ROSTER_LAUNCH_FRESH=1']) expect(line).toContain(` ${part} `);
    expect(line).toMatch(/ claude --model claude-opus-5-5 --effort medium /);
  });

  test('$ROSTER_CASTLIST_URL は設定の castlist に勝つ', async () => {
    const w = world({ castlist: dead }, { ROSTER_CASTLIST_URL: fake.url });
    const got = mark();
    await expect(startTpm(w.tpm)).resolves.toBeDefined();
    expect(got().some(r => r.path === '/api/actors')).toBe(true);
  });

  test('castlist の欄は 127.0.0.1 か localhost の http の URL', () => {
    expect(() => world({ castlist: 'http://example.com:8802' })).toThrow(/castlist/);
    expect(() => world({ castlist: 8802 })).toThrow(/castlist/);
  });
});

describe('名の決まり', () => {
  test('issuer は tpm. と状態の folder の名（英小文字にし、castlist の受ける形に収める）', () => {
    expect(castlistIssuer('/Users/me/.local/state/tpm/-Users-me-projects-ai')).toBe('tpm.-users-me-projects-ai');
    const long = castlistIssuer(`/s/-${'a'.repeat(100)}`);
    expect(long).toMatch(/^tpm\.[a-z0-9.-]+$/);
    expect(long.length).toBeLessThanOrEqual(64);
    expect(castlistIssuer(`/s/-${'a'.repeat(100)}b`)).not.toBe(long);
  });

  test.each<[string, RoleName, string]>([
    ['t-23zs', 'software-engineer', 't-23zs-swe'],
    ['t-23zs', 'devops-engineer', 't-23zs-devops'],
    ['roster#12', 'sustaining-engineer', 'roster-12-sus'],
    ['AI-12', 'software-engineer', 'ai-12-swe'],
    ['audit', 'auditor', 'audit-audit'],
    ['AI-12', 'staff-engineer', 'ai-12-staff'],
    ['AI-36', 'tech-lead', 'ai-36-lead'],
  ])('担当の名の接頭辞: %s・%s → %s', (key, role, prefix) => {
    expect(seatPrefix(key, role)).toBe(prefix);
  });

  test('接頭辞は 32 字まで', () => {
    expect(seatPrefix('a-very-long-key-name-for-the-issue-1', 'software-engineer').length).toBeLessThanOrEqual(32);
  });
});

describe('課題の担当が roster ask review で起こした Staff Engineer 担当の席', () => {
  test('起こした者（launchedBy）は、課題の担当の session（TPM 担当ではない）', async () => {
    const { w } = await launched();
    const se = { ...seat(w, 't-x7k2', SID), root: staffRoot() };
    await sessionStart(se, startInput('startup', SID));
    await hello(se);
    await askReview(se, { url: 'https://github.com/o/r/pull/7', wait: 0 });
    const staff = requireRole(w.tpm, 't-x7k2.staff');
    expect(staff.launch).toMatch(/^[0-9a-f-]{36}$/);
    expect(staff.launchedBy).toBe(`claude.session:${SID}`);
  });

  test('頼みは、渡した席の起こしの id を持つ。席が落ちて起こし直すと、返っていない頼みは新しい回の id になり「席が見ている」（t-9tac。review-1 の指摘 4）', async () => {
    const { w } = await launched();
    const se = { ...seat(w, 't-x7k2', SID), root: staffRoot() };
    await sessionStart(se, startInput('startup', SID));
    await hello(se);
    await askReview(se, { url: 'https://github.com/o/r/pull/7', wait: 0 });
    const first = requireRole(w.tpm, 't-x7k2.staff');
    expect(readReviews(w.tpm).map(r => r.launch)).toEqual([first.launch]);
    w.wire.close(first.address ?? '');
    await askReview(se, { url: 'https://github.com/o/r/pull/8', wait: 0 });
    const second = requireRole(w.tpm, 't-x7k2.staff');
    expect(second.launch).not.toBe(first.launch);
    expect(readReviews(w.tpm).map(r => r.launch)).toEqual([second.launch, second.launch]);
    expect(reviewList(w.tpm, { key: 't-x7k2' }).slice(0, 2).map(l => l.split('  ')[2])).toEqual(['まだ（席が見ている）', 'まだ（席が見ている）']);
  });
});

describe('session-start', () => {
  test('起こされた担当の startup: 鍵の session を先頭に登録し、頼んだ model と effort・登場・起こした線を送り、控えを書く', async () => {
    const got = mark();
    const { w, record } = await launched();
    expect(record.launch).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.launchedBy).toBe(`claude.session:${tpmSid}`);
    const tpmPost = got().find(r => r.path === '/api/actors' && r.body?.kind === 'ai');
    expect(tpmPost?.body).toMatchObject({ namePrefix: 'project-tpm', labels: { 'tpm.project': w.project, 'tpm.launch': 'launch-tpm', 'tpm.role': 'tpm' }, bindings: [{ type: 'claude.session', value: tpmSid }], settings: { model: 'claude-opus-5-5', effort: 'medium' } });
    expect(got().find(r => r.path.startsWith('/api/links/'))?.body).toMatchObject({ type: 'launched', from: 'tpm.person:product-manager', to: `claude.session:${tpmSid}` });

    const se = seat(w, 't-x7k2', SID, { CMUX_WORKSPACE_ID: 'FF00-UUID' });
    const cmux = { ...se, config: { ...se.config, transport: 'cmux' as const } };
    w.answers.set('cmux --json identify', { status: 0, stdout: JSON.stringify({ caller: { workspace_ref: 'workspace:7' } }), stderr: '' });
    const after = mark();
    await sessionStart(cmux, startInput('startup', SID));
    const requests = writes(after());
    expect(requests.map(r => [r.method, kindOf(r), r.status])).toEqual([
      ['POST', '/api/actors', 201],
      ['PUT', '/api/events', 201],
      ['PUT', '/api/links', 201],
    ]);
    expect(requests[0]?.body).toEqual({
      issuer: castlistIssuer(w.tpm.state.dir),
      kind: 'ai',
      namePrefix: 't-x7k2-swe',
      labels: { 'tpm.project': w.project, 'tpm.launch': record.launch, 'tpm.key': 't-x7k2', 'tpm.role': 'software-engineer' },
      bindings: [{ type: 'claude.session', value: SID }, { type: 'cmux.workspace.ref', value: 'workspace:7' }, { type: 'cmux.workspace.uuid', value: 'FF00-UUID' }],
      sentAt: SENT_AT,
      settings: { model: record.model, effort: record.effort },
    });
    expect(requests[1]?.body).toMatchObject({ by: `claude.session:${SID}`, type: 'entered', detail: {} });
    expect(requests[2]?.body).toMatchObject({ type: 'launched', from: `claude.session:${tpmSid}`, to: `claude.session:${SID}` });
    expect(w.tpm.state.read(`sessions/${SID}.jsonc`)).toMatchObject({ name: 't-x7k2-swe.1', launch: record.launch });
  });

  test('同じ hook が 2 度来ても、同じ id で送る（castlist は足さない）', async () => {
    const { w } = await launched();
    const se = seat(w, 't-x7k2', SID);
    const first = mark();
    await sessionStart(se, startInput('startup', SID));
    const a = writes(first());
    const second = mark();
    await sessionStart(se, startInput('startup', SID));
    const b = writes(second());
    expect(b.map(r => r.path)).toEqual(a.map(r => r.path));
    expect(b.map(r => r.status)).toEqual([200, 200, 200]);
  });

  test('起こされたばかりの resume は頼んだ物を送り、再登場。2 度目の resume は頼んだ物を送らない', async () => {
    const { w } = await launched();
    const se = seat(w, 't-x7k2', SID);
    const first = mark();
    await sessionStart(se, startInput('resume', SID));
    const a = writes(first());
    expect(a[0]?.body).toHaveProperty('settings');
    expect(a.find(r => r.path.startsWith('/api/events/'))?.body).toMatchObject({ type: 'reentered' });
    const second = mark();
    await sessionStart(se, startInput('resume', SID));
    const b = writes(second());
    expect(b[0]?.body).not.toHaveProperty('settings');
    const ids = [...a, ...b].filter(r => r.body?.type === 'reentered').map(r => r.path);
    expect(new Set(ids).size).toBe(2);
  });

  test('/clear: 前の session は交代、新しい session は頼んだ物なしで登録し、登場（source clear）と、同じ起こしの前の session からの継ぐ線', async () => {
    const { w } = await launched();
    const se = seat(w, 't-x7k2', SID);
    await sessionStart(se, startInput('startup', SID));
    const got = mark();
    await sessionEnd(se, endInput('clear', SID));
    const se2 = seat(w, 't-x7k2', SID2);
    await sessionStart(se2, startInput('clear', SID2));
    const requests = writes(got());
    expect(requests[0]?.body).toMatchObject({ by: `claude.session:${SID}`, type: 'cleared' });
    const post = requests.find(r => r.path === '/api/actors');
    expect(post?.body).not.toHaveProperty('settings');
    expect(post?.body?.bindings).toEqual([{ type: 'claude.session', value: SID2 }]);
    expect(requests.find(r => r.path.startsWith('/api/events/') && r.body?.by === `claude.session:${SID2}`)?.body).toMatchObject({ type: 'entered', detail: { source: 'clear' } });
    expect(requests.find(r => r.path.startsWith('/api/links/'))?.body).toMatchObject({ type: 'continued', from: `claude.session:${SID}`, to: `claude.session:${SID2}` });
    expect(requests.every(r => r.status === 201)).toBe(true);
    expect(w.tpm.state.read(`sessions/${SID2}.jsonc`)).toMatchObject({ name: 't-x7k2-swe.2' });
  });

  test('fork: 分身と、同じ起こしの前の session からの継ぐ線', async () => {
    const { w } = await launched();
    await sessionStart(seat(w, 't-x7k2', SID), startInput('startup', SID));
    const got = mark();
    await sessionStart(seat(w, 't-x7k2', SID3), startInput('fork', SID3));
    const requests = writes(got());
    expect(requests.find(r => r.path.startsWith('/api/events/'))?.body).toMatchObject({ by: `claude.session:${SID3}`, type: 'forked' });
    expect(requests.find(r => r.path.startsWith('/api/links/'))?.body).toMatchObject({ type: 'continued', from: `claude.session:${SID}`, to: `claude.session:${SID3}` });
  });

  test('compact: 要約。2 度の compact は別の id', async () => {
    const { w } = await launched();
    const se = seat(w, 't-x7k2', SID);
    await sessionStart(se, startInput('startup', SID));
    const got = mark();
    await sessionStart(se, startInput('compact', SID));
    await sessionStart(se, startInput('compact', SID));
    const events = writes(got()).filter(r => r.path.startsWith('/api/events/'));
    expect(events.map(r => r.body?.type)).toEqual(['compacted', 'compacted']);
    expect(new Set(events.map(r => r.path)).size).toBe(2);
    expect(writes(got()).filter(r => r.path === '/api/actors').every(r => !('settings' in (r.body ?? {})))).toBe(true);
  });
});

describe('session-end', () => {
  test.each([['clear', 'cleared', {}], ['logout', 'exited', { reason: 'logout' }], ['prompt_input_exit', 'exited', { reason: 'prompt_input_exit' }]])('%s → %s', async (reason, type, detail) => {
    const { w } = await launched();
    const se = seat(w, 't-x7k2', SID);
    await sessionStart(se, startInput('startup', SID));
    const got = mark();
    await sessionEnd(se, endInput(reason, SID));
    expect(writes(got()).map(r => r.body)).toEqual([expect.objectContaining({ by: `claude.session:${SID}`, type, detail: expect.objectContaining(detail) as unknown })]);
  });
});

/** 写しの JSONL を書く（Claude Code の transcript に見立てる）。 */
function transcript(lines: unknown[]): string {
  const file = join(mkdtempSync(join(tmpdir(), 'roster-transcript-')), 'session.jsonl');
  writeFileSync(file, lines.map(l => `${JSON.stringify(l)}\n`).join(''));
  return file;
}
const assistant = (model: string) => ({ type: 'assistant', message: { model, role: 'assistant', content: [{ type: 'text', text: 'x' }] } });
const user = { type: 'user', message: { role: 'user', content: 'x' } };

describe('guard と castlist', () => {
  test('登録した session: effort と、写しの最後の model（<synthetic> は飛ばす）を見た物として送る。変わらなければ送らない', async () => {
    const { w } = await launched();
    const se = seat(w, 't-x7k2', SID);
    await sessionStart(se, startInput('startup', SID));
    const path = transcript([user, assistant('claude-opus-5-5'), user, assistant('<synthetic>')]);
    const got = mark();
    expect(await guard(se, bashInput(SID, { transcript_path: path, effort: { level: 'high' } }))).toEqual({ allow: true });
    expect(await guard(se, bashInput(SID, { transcript_path: path, effort: { level: 'high' } }))).toEqual({ allow: true });
    let puts = writes(got());
    expect(puts.map(r => [r.method, kindOf(r)])).toEqual([['PUT', '/api/settings']]);
    expect(puts[0]?.body).toMatchObject({ by: `claude.session:${SID}`, model: 'claude-opus-5-5', effort: 'high', source: 'observed', sentAt: SENT_AT });
    // effort を替えた
    expect(await guard(se, bashInput(SID, { transcript_path: path, effort: { level: 'low' } }))).toEqual({ allow: true });
    // model を替えた
    appendFileSync(path, `${JSON.stringify(assistant('claude-fable-5-2'))}\n${JSON.stringify(assistant('<synthetic>'))}\n`);
    expect(await guard(se, bashInput(SID, { transcript_path: path, effort: { level: 'low' } }))).toEqual({ allow: true });
    puts = writes(got());
    expect(puts.map(r => [r.body?.model, r.body?.effort])).toEqual([['claude-opus-5-5', 'high'], ['claude-opus-5-5', 'low'], ['claude-fable-5-2', 'low']]);
    expect(new Set(puts.map(r => r.path)).size).toBe(3);
  });

  test('写しから model を読めなければ、session に 1 度だけ model 不明を送り、Bash は通す', async () => {
    const { w } = await launched();
    const se = seat(w, 't-x7k2', SID);
    await sessionStart(se, startInput('startup', SID));
    const path = transcript([user, { type: 'assistant', message: { role: 'assistant', content: [] } }, { type: 'assistant', msg: { model: 'claude-opus-5-5' } }]);
    const got = mark();
    expect(await guard(se, bashInput(SID, { transcript_path: path, effort: { level: 'high' } }))).toEqual({ allow: true });
    expect(await guard(se, bashInput(SID, { transcript_path: path, effort: { level: 'high' } }))).toEqual({ allow: true });
    const events = writes(got()).filter(r => r.path.startsWith('/api/events/'));
    expect(events.map(r => r.body?.type)).toEqual(['model_unreadable']);
  });

  test('まだ登録していない session は、guard が登録してから通す', async () => {
    const { w } = await launched();
    const se = seat(w, 't-x7k2', SID);
    const got = mark();
    expect(await guard(se, bashInput(SID))).toEqual({ allow: true });
    expect(writes(got()).find(r => r.path === '/api/actors')?.body?.bindings).toEqual([{ type: 'claude.session', value: SID }]);
    expect(w.tpm.state.read(`sessions/${SID}.jsonc`)).toMatchObject({ name: 't-x7k2-swe.1' });
  });

  test('送る物がある時に castlist が止まっていれば、1 行を添えて止める', async () => {
    const { w } = await launched();
    const se = seat(w, 't-x7k2', SID);
    await sessionStart(se, startInput('startup', SID));
    const path = transcript([user, assistant('claude-opus-5-5')]);
    expect(await guard(se, bashInput(SID, { transcript_path: path, effort: { level: 'high' } }))).toEqual({ allow: true });
    const down = withEnv(se, { ROSTER_CASTLIST_URL: dead });
    // 送る物が無ければ、castlist に聞かずに通す
    expect(await guard(down, bashInput(SID, { transcript_path: path, effort: { level: 'high' } }))).toEqual({ allow: true });
    const verdict = await guard(down, bashInput(SID, { transcript_path: path, effort: { level: 'max' } }));
    expect(verdict.allow).toBe(false);
    expect(verdict.allow ? '' : verdict.reason).toMatch(/^container start castlist\.box$/m);
  });
});

describe('hello と castlist', () => {
  test('担当の hello: アクターの名の行を出し、名乗りを送る（登録が無ければ先に登録する）', async () => {
    const { w } = await launched();
    const se = seat(w, 't-x7k2', SID);
    const got = mark();
    const lines = await hello(se);
    expect(lines).toContain('アクター: t-x7k2-swe.1');
    const requests = writes(got());
    expect(requests[0]?.path).toBe('/api/actors');
    expect(requests.find(r => r.body?.type === 'reported_in')?.body).toMatchObject({ by: `claude.session:${SID}` });
  });

  test('TPM 担当の hello もアクターの名を出す', async () => {
    const { tpm } = await launched();
    expect(await hello(tpm)).toContain('アクター: project-tpm.1');
  });
});

describe('close と castlist', () => {
  test('その起こしのアクターのうち、まだ居る物にだけ幕引きを送る', async () => {
    const { w, tpm } = await launched();
    const se = seat(w, 't-x7k2', SID);
    await sessionStart(se, startInput('startup', SID));
    await sessionEnd(se, endInput('clear', SID));
    await sessionStart(seat(w, 't-x7k2', SID2), startInput('clear', SID2));
    const got = mark();
    await close(tpm, 't-x7k2');
    expect(writes(got()).map(r => r.body)).toEqual([expect.objectContaining({ type: 'closed', by: `claude.session:${SID2}` })]);
  });
});

describe('model の別名を断る', () => {
  test('config.jsonc の担当の欄', async () => {
    const w = world({ 'software-engineer': { model: 'opus' } });
    await expect(assign(w.tpm, 't-x7k2', SE)).rejects.toThrow(/config\.jsonc.*software-engineer.*opus/);
  });

  test('--model の旗', async () => {
    const w = world();
    await expect(assign(w.tpm, 't-x7k2', { ...SE, model: 'sonnet' })).rejects.toThrow(/--model.*sonnet/);
    await expect(hello(w.tpm, { model: 'haiku' })).rejects.toThrow(/--model.*haiku/);
  });

  test('$ROSTER_MODEL', async () => {
    expect(() => resolveSettings('software-engineer', { env: { ROSTER_MODEL: 'opus[1m]' } })).toThrow(/\$ROSTER_MODEL.*opus\[1m\]/);
    const w = world({}, { ROSTER_MODEL: 'opus' });
    await expect(startTpm(w.tpm)).rejects.toThrow(/\$ROSTER_MODEL/);
  });

  test('claude- で始まる id は通す', () => {
    expect(resolveSettings('software-engineer', { flags: { model: 'claude-sonnet-5-5' }, env: {} }).model).toBe('claude-sonnet-5-5');
  });
});

describe('hook の settings', () => {
  const hooks = (role?: RoleName) => (JSON.parse(guardSettings('/r/cli/bin/roster', role)) as { hooks: Record<string, { matcher?: string, hooks: { command: string }[] }[]> }).hooks;

  test.each<[string, RoleName | undefined]>([['TPM 担当', undefined], ['担当', 'software-engineer'], ['Auditor', 'auditor']])('%s: session の始まりと終わりに roster castlist を呼ぶ', (_label, role) => {
    const h = hooks(role);
    expect(h.SessionStart?.flatMap(g => g.hooks.map(x => x.command))).toContain('/r/cli/bin/roster castlist session-start');
    expect(h.SessionEnd?.flatMap(g => g.hooks.map(x => x.command))).toContain('/r/cli/bin/roster castlist session-end');
    expect(h.PreToolUse?.[0]?.hooks.map(x => x.command)).toEqual(['/r/cli/bin/roster guard']);
  });

  test.each<[string, RoleName | undefined, string[]]>([
    ['TPM 担当', undefined, ['/r/cli/bin/roster mail wait', '/r/cli/bin/roster reply-language check || true']],
    ['Software Engineer 担当', 'software-engineer', ['/r/cli/bin/roster mail wait']],
    ['Staff Engineer 担当', 'staff-engineer', ['/r/cli/bin/roster mail wait']],
    ['Auditor', 'auditor', ['/r/cli/bin/roster mail wait']],
  ])('%s: 手を止める時の hook（返事の言葉を数えるのは TPM 担当の席だけ）', (_label, role, commands) => {
    expect(hooks(role).Stop?.flatMap(g => g.hooks.map(x => x.command))).toEqual(commands);
  });

  test('Auditor の席は、始まりに roster audit fresh も呼ぶ', () => {
    expect(hooks('auditor').SessionStart?.flatMap(g => g.hooks.map(x => x.command))).toEqual(['/r/cli/bin/roster audit fresh', '/r/cli/bin/roster castlist session-start', '/r/cli/bin/roster mail claim', '/r/cli/bin/roster mail wait']);
  });
});

describe('roster castlist の命令（hook が bin/roster を動かす）', () => {
  /** 試験を流す担当の居場所の ROSTER_* と cmux・Claude Code の変数を抜いた環境で、folder の中で roster を動かす。 */
  const run = (dir: string, args: string[], input: string) => {
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, XDG_STATE_HOME: join(dir, 'state') };
    return spawnSync(join(import.meta.dirname, '..', 'bin', 'roster'), args, { cwd: dir, env, input, encoding: 'utf8' });
  };
  const folder = (config: Record<string, unknown>): string => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'roster-castlist-cli-')));
    mkdirSync(join(dir, '.claude', 'roles'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'roles', 'config.jsonc'), JSON.stringify({ transport: 'file', ...config }));
    return dir;
  };

  test.each([['設定が無い', false], ['castlist が止まっている', true]] as const)('%s時も、session-start と session-end は何も出さずに 0 で終わる', (_label, configured) => {
    const dir = folder(configured ? { castlist: dead } : {});
    for (const [command, input] of [['session-start', startInput('startup', SID)], ['session-end', endInput('other', SID)]] as const) {
      const r = run(dir, ['castlist', command], input);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('');
    }
  });

  test('読めない標準入力でも 0 で終わる', () => {
    expect(run(folder({ castlist: dead }), ['castlist', 'session-start'], 'not json').status).toBe(0);
  });
});

describe('担当を起こす環境変数', () => {
  test('名簿に起こしの印があれば、起こしの id・起こした者・頼んだ model と effort・起こしたばかりの印を渡す', async () => {
    const { record } = await launched();
    const env = roleEnv(record, '/p', '/s', '/r', { PATH: '/usr/bin' });
    expect(env).toMatchObject({
      ROSTER_LAUNCH: record.launch,
      ROSTER_LAUNCHED_BY: `claude.session:${tpmSid}`,
      ROSTER_LAUNCH_MODEL: record.model,
      ROSTER_LAUNCH_EFFORT: record.effort,
      ROSTER_LAUNCH_FRESH: '1',
    });
  });

  test('印が無ければ、受け継いだ起こしの環境変数（TPM 担当の物）を渡さない', async () => {
    const w = world();
    await assign(w.tpm, 't-x7k2', SE);
    const names = ['LAUNCH', 'LAUNCHED_BY', 'LAUNCH_MODEL', 'LAUNCH_EFFORT', 'LAUNCH_FRESH'];
    const inherited = { PATH: '/usr/bin', ...Object.fromEntries(names.map(n => [`ROSTER_${n}`, 'x'])) };
    const env = roleEnv(requireRole(w.tpm, 't-x7k2'), '/p', '/s', '/r', inherited);
    for (const name of names) expect(env).not.toHaveProperty(`ROSTER_${name}`);
  });

  test('roster audit start の起こした者は Product Manager', async () => {
    const w = world({ castlist: fake.url });
    await startTpm(w.tpm);
    await auditStart(w.tpm, { wait: 0 });
    expect(requireRole(w.tpm, 'audit')).toMatchObject({ launchedBy: 'tpm.person:product-manager' });
  });
});

describe('落ちた session の突き合わせ（推しの幕引き）', () => {
  /** cmux の中の周り: 自分の居場所（ref と uuid）と、cmux の居場所の一覧（uuid → ref）。一覧が誤りなら seats は throw する。 */
  function inCmux(ctx: Context, me: { ref: string, uuid: string }, seats: () => Record<string, string>): Context {
    const seatPort = Object.create(ctx.seats) as Context['seats'];
    seatPort.seatsById = () => new Map(Object.entries(seats()).map(([uuid, ref]) => [uuid, { address: ref, title: '' }]));
    const exec: Context['exec'] = (cmd, args, options) =>
      cmd === 'cmux' && args.join(' ') === '--json identify'
        ? { status: 0, stdout: JSON.stringify({ caller: { workspace_ref: me.ref } }), stderr: '' }
        : ctx.exec(cmd, args, options);
    return { ...ctx, exec, seats: seatPort, config: { ...ctx.config, transport: 'cmux' }, env: { ...ctx.env, CMUX_WORKSPACE_ID: me.uuid } };
  }

  const tpmAt = { ref: 'workspace:1', uuid: 'U-TPM' };
  const SE_AT = { ref: 'workspace:2', uuid: 'U-SE' };
  const inferredCloses = (requests: CastlistSeen[]) => writes(requests).filter(r => r.body?.type === 'closed' && (r.body.detail as { inferred?: unknown } | undefined)?.inferred === true);

  /** 担当 1 人（SID）が SE_AT で登場した世界。seats は TPM 担当が見る cmux の一覧（試験の中で替える）。 */
  async function world2(): Promise<{ w: World, se: Context, tpmIn: (seats: Record<string, string>, me?: { ref: string, uuid: string }) => Context }> {
    const { w, tpm } = await launched();
    const se = inCmux(seat(w, 't-x7k2', SID), SE_AT, () => ({ [tpmAt.uuid]: tpmAt.ref, [SE_AT.uuid]: SE_AT.ref }));
    await sessionStart(se, startInput('startup', SID));
    const tpmIn = (seats: Record<string, string>, me = tpmAt): Context => inCmux(tpm, me, () => seats);
    return { w, se, tpmIn };
  }

  test('登録で、控えに居場所（ref と uuid）を書く', async () => {
    const { w } = await world2();
    expect(readSession(w.tpm, SID)?.workspace).toEqual(SE_AT);
  });

  test('居場所の uuid が一覧に無い「居る」session に、推しの幕引き（workspace_gone）を番号つきの id で送り、控えを居ないにする', async () => {
    const { w, tpmIn } = await world2();
    const got = mark();
    const lines = await roles(tpmIn({ [tpmAt.uuid]: tpmAt.ref }));
    const closes = inferredCloses(got());
    expect(closes.map(r => r.body)).toEqual([expect.objectContaining({ by: `claude.session:${SID}`, type: 'closed', detail: { inferred: true, reason: 'workspace_gone' } })]);
    expect(closes[0]?.path).toMatch(new RegExp(`-${SID}-closed-1$`));
    expect(readSession(w.tpm, SID)).toMatchObject({ present: false, endedBy: 'inferred' });
    expect(lines.join('\n')).toContain('t-x7k2-swe.1');
    // 2 度目は何も送らない。
    const again = mark();
    await roles(tpmIn({ [tpmAt.uuid]: tpmAt.ref }));
    expect(inferredCloses(again())).toEqual([]);
  });

  test('uuid が残り ref が替わり、今の組に後から別の session が登録していれば、古い方に推しの幕引き（superseded）', async () => {
    const { w, tpmIn } = await world2();
    const restored = { ref: 'workspace:12', uuid: SE_AT.uuid };
    await sessionStart(inCmux(seat(w, 't-x7k2', SID2), restored, () => ({})), startInput('startup', SID2));
    const got = mark();
    await roles(tpmIn({ 'U-TPM2': 'workspace:11', [SE_AT.uuid]: restored.ref }, { ref: 'workspace:11', uuid: 'U-TPM2' }));
    expect(inferredCloses(got()).map(r => r.body)).toEqual([expect.objectContaining({ by: `claude.session:${SID}`, detail: { inferred: true, reason: 'superseded' } })]);
    expect(readSession(w.tpm, SID2)?.present).toBe(true);
  });

  test('自分（TPM 担当）が、復元された居場所に後から入ったのでも superseded', async () => {
    const { tpmIn } = await world2();
    const got = mark();
    await roles(tpmIn({ [SE_AT.uuid]: 'workspace:11' }, { ref: 'workspace:11', uuid: SE_AT.uuid }));
    expect(inferredCloses(got()).map(r => r.body)).toEqual([expect.objectContaining({ by: `claude.session:${SID}`, detail: { inferred: true, reason: 'superseded' } })]);
  });

  test('uuid が残り ref が替わっただけ（cmux が session を続けたかもしれない）なら、送らない', async () => {
    const { w, tpmIn } = await world2();
    const got = mark();
    await roles(tpmIn({ 'U-TPM2': 'workspace:11', [SE_AT.uuid]: 'workspace:12' }, { ref: 'workspace:11', uuid: 'U-TPM2' }));
    expect(inferredCloses(got())).toEqual([]);
    expect(readSession(w.tpm, SID)?.present).toBe(true);
  });

  test('同じ組（ref も同じ）に別の session が居ても、後先を決められないので送らない', async () => {
    const { w, tpmIn } = await world2();
    await sessionStart(inCmux(seat(w, 't-x7k2', SID2), SE_AT, () => ({})), startInput('startup', SID2));
    const got = mark();
    await roles(tpmIn({ [tpmAt.uuid]: tpmAt.ref, [SE_AT.uuid]: SE_AT.ref }));
    expect(inferredCloses(got())).toEqual([]);
  });

  test('組がそのまま一覧にある session と、自分の session には送らない', async () => {
    const { w, tpmIn } = await world2();
    const got = mark();
    await roles(tpmIn({ [tpmAt.uuid]: tpmAt.ref, [SE_AT.uuid]: SE_AT.ref }));
    expect(inferredCloses(got())).toEqual([]);
    // 自分の居場所が一覧に無くても、自分は閉じない（その時は突き合わせごと止める）。
    expect(readSession(w.tpm, tpmSid)?.present).toBe(true);
  });

  test('一覧に自分の組が無い・一覧が空・一覧が誤りなら、何も送らず、命令は続ける', async () => {
    const { tpmIn } = await world2();
    const got = mark();
    expect((await roles(tpmIn({}))).join('\n')).toContain('名簿');
    await roles(tpmIn({ [tpmAt.uuid]: 'workspace:99' }));
    const broken = inCmux(tpmIn({}), tpmAt, () => {
      throw new Error('cmux が答えない');
    });
    expect((await roles(broken)).join('\n')).toContain('名簿');
    expect(inferredCloses(got())).toEqual([]);
  });

  test('控えに居場所の無い session は、castlist の付随する id（種類ごとに最新）から引いて突き合わせる', async () => {
    const { w, tpmIn } = await world2();
    const record = readSession(w.tpm, SID);
    if (record === undefined) throw new Error('控えが無い');
    delete record.workspace;
    w.tpm.state.write(`sessions/${SID}.jsonc`, record);
    const got = mark();
    await roles(tpmIn({ [tpmAt.uuid]: tpmAt.ref }));
    expect(got().some(r => r.method === 'GET' && r.path === `/api/actors/${record.id}`)).toBe(true);
    expect(inferredCloses(got()).map(r => r.body)).toEqual([expect.objectContaining({ by: `claude.session:${SID}`, detail: { inferred: true, reason: 'workspace_gone' } })]);
    expect(readSession(w.tpm, SID)?.workspace).toEqual(SE_AT);
  });

  test('assign と担当の hello も突き合わせる', async () => {
    const { tpmIn } = await world2();
    const got = mark();
    await assign(tpmIn({ [tpmAt.uuid]: tpmAt.ref }), 't-q9zz', SE);
    expect(inferredCloses(got())).toHaveLength(1);
    const { w } = await world2();
    const other = inCmux(seat(w, 't-x7k2', SID3), { ref: 'workspace:3', uuid: 'U-3' }, () => ({ 'U-3': 'workspace:3' }));
    const got2 = mark();
    await hello(other);
    expect(inferredCloses(got2())).toHaveLength(1);
  });

  test('推しで閉じた session が Bash を打てば、今の居場所で登録し直し、番号つきの再登場を送り、もう閉じない', async () => {
    const { w, se, tpmIn } = await world2();
    await roles(tpmIn({ [tpmAt.uuid]: tpmAt.ref }));
    const moved = { ref: 'workspace:12', uuid: SE_AT.uuid };
    const back = inCmux(se, moved, () => ({}));
    const got = mark();
    expect((await guard(back, bashInput(SID))).allow).toBe(true);
    const sent = writes(got());
    expect(sent.find(r => r.path === '/api/actors')?.body?.bindings).toContainEqual({ type: 'cmux.workspace.ref', value: moved.ref });
    const re = sent.find(r => r.body?.type === 'reentered');
    expect(re?.body).toMatchObject({ by: `claude.session:${SID}`, detail: { source: 'guard' } });
    expect(re?.path).toMatch(new RegExp(`-${SID}-reentered-1$`));
    expect(readSession(w.tpm, SID)).toMatchObject({ present: true, workspace: moved });
    expect(readSession(w.tpm, SID)?.endedBy).toBeUndefined();
    const after = mark();
    await roles(tpmIn({ [tpmAt.uuid]: tpmAt.ref, [moved.uuid]: moved.ref }));
    expect(inferredCloses(after())).toEqual([]);
  });

  test('castlist から居場所を引く間に控えが替わっても、替わった所を消さず、居場所だけを足す', async () => {
    const { w, tpmIn } = await world2();
    const record = readSession(w.tpm, SID);
    if (record === undefined) throw new Error('控えが無い');
    delete record.workspace;
    w.tpm.state.write(`sessions/${SID}.jsonc`, record);
    // 引く間（GetActor を castlist が受けた時）に、その session の SessionEnd が退場を送った（控えは居ないになり、番号が進む）。
    fake.intercept = (seen) => {
      if (seen.method === 'GET' && seen.path.startsWith('/api/actors/')) {
        const now = readSession(w.tpm, SID);
        if (now !== undefined) w.tpm.state.write(`sessions/${SID}.jsonc`, { ...now, present: false, seq: { ...now.seq, exited: 1 } });
      }
      return undefined;
    };
    const got = mark();
    await roles(tpmIn({ [tpmAt.uuid]: tpmAt.ref, [SE_AT.uuid]: SE_AT.ref }));
    expect(readSession(w.tpm, SID)).toMatchObject({ present: false, seq: { exited: 1 }, workspace: SE_AT });
    expect(inferredCloses(got())).toEqual([]);
  });

  test('自分の session の id が無い所（roster の起こした session の外）で打っても、突き合わせない', async () => {
    const { tpmIn } = await world2();
    const outside = tpmIn({ [tpmAt.uuid]: tpmAt.ref });
    const got = mark();
    await roles({ ...outside, env: { ...outside.env, CLAUDE_CODE_SESSION_ID: undefined } });
    expect(inferredCloses(got())).toEqual([]);
  });

  test('castlist が応えなければ、そこでやめて 1 行出し、命令は続ける', async () => {
    const { w, tpmIn } = await world2();
    const record = readSession(w.tpm, SID);
    if (record === undefined) throw new Error('控えが無い');
    delete record.workspace;
    w.tpm.state.write(`sessions/${SID}.jsonc`, record);
    fake.intercept = seen => seen.path.startsWith('/api/actors/') ? 'drop' : undefined;
    const lines = await roles(tpmIn({ [tpmAt.uuid]: tpmAt.ref }));
    expect(lines.join('\n')).toContain('落ちた session の突き合わせをやめました');
    expect(lines.join('\n')).toContain('名簿');
  });

  test('幕引きを送れなければ、送れなかった session を 1 行で出す', async () => {
    const { tpmIn } = await world2();
    fake.intercept = seen => seen.method === 'PUT' && seen.path.startsWith('/api/events/') ? 'drop' : undefined;
    const lines = await roles(tpmIn({ [tpmAt.uuid]: tpmAt.ref }));
    expect(lines.join('\n')).toContain('落ちたと推した幕引きを送れませんでした（t-x7k2-swe.1）');
  });

  test('推しで閉じた session が roster hello を打てば、名乗りより前に再登場を送る', async () => {
    const { se, tpmIn } = await world2();
    await roles(tpmIn({ [tpmAt.uuid]: tpmAt.ref }));
    const got = mark();
    await hello(inCmux(se, { ref: 'workspace:12', uuid: SE_AT.uuid }, () => ({ [SE_AT.uuid]: 'workspace:12' })));
    const types = writes(got()).map(r => r.body?.type).filter(t => t === 'reentered' || t === 'reported_in');
    expect(types).toEqual(['reentered', 'reported_in']);
    expect(writes(got()).find(r => r.body?.type === 'reentered')?.body?.detail).toEqual({ source: 'hello' });
  });

  test('退場・交代・roster close の後の session が Bash を打っても、再登場を送らない', async () => {
    const { w, se } = await world2();
    await sessionEnd(se, endInput('other', SID));
    const got = mark();
    await guard(se, bashInput(SID));
    expect(writes(got()).filter(r => r.body?.type === 'reentered' || r.path === '/api/actors')).toEqual([]);
    expect(readSession(w.tpm, SID)?.present).toBe(false);
  });

  test('推しで閉じて戻った session も、roster close の幕引きは castlist に残る（推しの id と別）', async () => {
    const { se, tpmIn } = await world2();
    await roles(tpmIn({ [tpmAt.uuid]: tpmAt.ref }));
    await guard(inCmux(se, { ref: 'workspace:12', uuid: SE_AT.uuid }, () => ({})), bashInput(SID));
    const got = mark();
    await close(tpmIn({ [tpmAt.uuid]: tpmAt.ref, [SE_AT.uuid]: 'workspace:12' }), 't-x7k2');
    const closes = writes(got()).filter(r => r.body?.type === 'closed');
    expect(closes.map(r => r.body?.detail)).toEqual([{}]);
    expect(closes[0]?.path).toMatch(new RegExp(`-${SID}-closed$`));
  });
});
