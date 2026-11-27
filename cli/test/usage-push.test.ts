// トークンの使用量の取り込み（session の記録から数えて castlist へ送る）。偽の castlist（fake-castlist.ts）と、一時の folder に作った写しを使う。
// 本物の castlist と、本物の Claude Code の置き場（~/.claude・$CLAUDE_CONFIG_DIR）には触らない（置き場は、試験ごとの一時の folder に向ける）。
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { sessionEnd, sessionStart, readSession } from '../src/commands/castlist.ts';
import { guard } from '../src/commands/infra.ts';
import { hello } from '../src/commands/role-side.ts';
import { assign, close } from '../src/commands/tpm-side.ts';
import { pushUsage, readUsageState, sweepOrder, sweepUsage, tidyUsage, usageCheck, USAGE_CHECK_EVERY_MS, USAGE_RETRY_MS } from '../src/commands/usage.ts';
import { startTpm } from '../src/command.ts';
import type { Context } from '../src/context.ts';
import { requireRole } from '../src/roster.ts';
import { roleEnv } from '../src/run-role.ts';
import { startCastlist, type CastlistSeen, type FakeCastlist } from './fake-castlist.ts';
import { BRIEF, world, type World } from './helpers.ts';

const SE = { role: 'software-engineer', title: '計画と実装', brief: BRIEF, wait: 0 } as const;
const tpmSid = 'aaaaaaaa-0000-4000-8000-000000000000';
const SID = 'bbbbbbbb-0000-4000-8000-000000000001';
const SID2 = 'bbbbbbbb-0000-4000-8000-000000000002';
const NOW = '2026-11-20T12:00:00.000Z';

let fake: FakeCastlist;
const temps: string[] = [];

beforeAll(async () => {
  fake = await startCastlist(NOW);
});

afterAll(async () => {
  await fake.stop();
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  fake.intercept = undefined;
});

/** この後に偽の castlist が受けた、数の行を書く要求。 */
function mark(): () => CastlistSeen[] {
  const since = fake.requests().length;
  return () => fake.requests().slice(since).filter(r => r.method === 'PUT' && r.path.startsWith('/api/usage/'));
}

/** 写しの assistant の行（見本）。 */
function line(id: string, at: string, usage: Record<string, unknown> = {}, model = 'claude-opus-5-5'): string {
  return `${JSON.stringify({
    type: 'assistant',
    timestamp: at,
    message: { id, model, usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, speed: 'standard', service_tier: 'standard', ...usage } },
  })}\n`;
}

const other = (at: string): string => `${JSON.stringify({ type: 'user', timestamp: at, message: { content: '字は読まない' } })}\n`;

/** Claude Code の置き場に見立てた一時の folder（projects/<席を起こした folder>/）。 */
function home(): { config: string, project: string } {
  const config = mkdtempSync(join(tmpdir(), 'roster-usage-'));
  temps.push(config);
  const project = join(config, 'projects', '-w');
  mkdirSync(project, { recursive: true });
  return { config, project };
}

const startInput = (source: string, sid: string, transcript: string): string =>
  JSON.stringify({ hook_event_name: 'SessionStart', session_id: sid, source, transcript_path: transcript, cwd: '/w' });
const endInput = (sid: string, transcript: string): string => JSON.stringify({ hook_event_name: 'SessionEnd', session_id: sid, reason: 'other', transcript_path: transcript });

const withEnv = (ctx: Context, extra: NodeJS.ProcessEnv): Context => ({ ...ctx, env: { ...ctx.env, ...extra } });

/** castlist を設定した世界で、TPM 担当の登場と、担当 1 人の assign までを済ませる。置き場は一時の folder。 */
async function launched(): Promise<{ w: World, tpm: Context, se: Context, config: string, project: string, transcript: string }> {
  const { config, project } = home();
  const w = world({ castlist: fake.url });
  await startTpm(w.tpm);
  const tpm = withEnv(w.tpm, { CLAUDE_CODE_SESSION_ID: tpmSid, ROSTER_LAUNCH: 'launch-tpm', ROSTER_LAUNCHED_BY: 'tpm.person:product-manager', CLAUDE_CONFIG_DIR: config });
  await sessionStart(tpm, startInput('startup', tpmSid, join(project, `${tpmSid}.jsonl`)));
  await hello(tpm);
  await assign(tpm, 't-x7k2', SE);
  const base = w.role('t-x7k2', 'file:1');
  const env = roleEnv(requireRole(w.tpm, 't-x7k2'), w.project, w.tpm.state.dir, w.tpm.root, base.env);
  const se: Context = { ...base, env: { ...env, CLAUDE_CODE_SESSION_ID: SID, CLAUDE_CONFIG_DIR: config } };
  const transcript = join(project, `${SID}.jsonl`);
  return { w, tpm, se, config, project, transcript };
}

describe('席が閉じる時の hook（roster castlist session-end）', () => {
  test('写しの回を、時計の 1 時間と種類ごとの行にして castlist へ送り、どこまで読んだかを控える', async () => {
    const { se, transcript } = await launched();
    writeFileSync(transcript, line('m1', '2026-11-20T10:05:00.000Z') + other('2026-11-20T10:05:01.000Z') + line('m1', '2026-11-20T10:05:02.000Z')
    + line('m2', '2026-11-20T10:50:00.000Z', { cache_creation_input_tokens: 30, cache_creation: { ephemeral_1h_input_tokens: 30 } }) + line('m3', '2026-11-20T11:01:00.000Z'));
    await sessionStart(se, startInput('startup', SID, transcript));
    expect(readSession(se, SID)?.transcript).toBe(transcript);
    const puts = mark();
    await sessionEnd(se, endInput(SID, transcript));
    const sent = puts();
    expect(sent.map(r => r.status)).toEqual([201, 201]);
    expect(sent.map(r => r.path)).toEqual([1, 2].map(n => expect.stringMatching(new RegExp(`^/api/usage/u-[0-9a-f]{8}-${SID}-${n}$`)) as unknown));
    expect(sent[0]?.body).toMatchObject({
      by: `claude.session:${SID}`,
      model: 'claude-opus-5-5',
      speed: 'standard',
      serviceTier: 'standard',
      turns: 2,
      inputTokens: 200,
      outputTokens: 20,
      cacheReadTokens: 2000,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 30,
      webSearchRequests: 0,
      webFetchRequests: 0,
      maxContext: 1130,
      buckets: [{ bucket: 0, turns: 2, costMicroUsd: (sent[0]?.body as { costMicroUsd: number }).costMicroUsd }],
    });
    expect(sent[0]?.body).not.toHaveProperty('agent');
    expect(sent[1]?.body).toMatchObject({ turns: 1 });
    const state = readUsageState(se, SID);
    expect(state.n).toBe(2);
    expect(state.ids).toEqual(['m1', 'm2', 'm3']);
    expect(state.pending).toBeUndefined();
    expect(Object.keys(state.files)).toEqual([transcript]);
  });

  test('2 度目は、増えた分だけを送る。読みの切れ目をまたいだ応答と、書いている途中の行は、2 度数えない', async () => {
    const { se, transcript } = await launched();
    await sessionStart(se, startInput('startup', SID, transcript));
    const url = fake.url;
    writeFileSync(transcript, line('m1', '2026-11-20T10:05:00.000Z') + line('m2', '2026-11-20T10:06:00.000Z'));
    // 書いている途中の行（改行で終わっていない）。
    appendFileSync(transcript, line('m3', '2026-11-20T10:07:00.000Z').slice(0, 40));
    expect(await pushUsage(se, url, SID)).toEqual({ kind: 'ok', sent: 1 });
    writeFileSync(transcript, line('m1', '2026-11-20T10:05:00.000Z') + line('m2', '2026-11-20T10:06:00.000Z') + line('m3', '2026-11-20T10:07:00.000Z')
    + line('m2', '2026-11-20T10:07:01.000Z') + line('m4', '2026-11-20T10:08:00.000Z'));
    const puts = mark();
    expect(await pushUsage(se, url, SID)).toEqual({ kind: 'ok', sent: 1 });
    // 同じ 1 時間の、増えた分の行（読む側が足す）。
    expect(puts().map(r => (r.body as { turns: number }).turns)).toEqual([2]);
    expect(readUsageState(se, SID).ids).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(await pushUsage(se, url, SID)).toEqual({ kind: 'none' });
  });

  test('手伝いの写しは、種類を付けた別の行で、親の席のアクターに付ける', async () => {
    const { se, project, transcript } = await launched();
    await sessionStart(se, startInput('startup', SID, transcript));
    writeFileSync(transcript, line('m1', '2026-11-20T10:05:00.000Z'));
    const sub = join(project, SID, 'subagents');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, 'agent-a1.jsonl'), line('a1', '2026-11-20T10:06:00.000Z', {}, 'claude-haiku-5-5'));
    writeFileSync(join(sub, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'Explore' }));
    const puts = mark();
    await pushUsage(se, fake.url, SID);
    expect(puts().map(r => [(r.body as { model: string }).model, (r.body as { agent?: string }).agent, (r.body as { by: string }).by])).toEqual([
      ['claude-haiku-5-5', 'Explore', `claude.session:${SID}`],
      ['claude-opus-5-5', undefined, `claude.session:${SID}`],
    ]);
  });
});

describe('送りの途中で落ちた時', () => {
  test('castlist が応えない時は、送る行を控えに残し、次の回に、同じ id・同じ本文で送り直す（その間に写しが伸びていても）', async () => {
    const { se, transcript } = await launched();
    await sessionStart(se, startInput('startup', SID, transcript));
    writeFileSync(transcript, line('m1', '2026-11-20T10:05:00.000Z'));
    fake.intercept = seen => seen.path.startsWith('/api/usage/') ? 'drop' : undefined;
    expect(await pushUsage(se, fake.url, SID)).toEqual({ kind: 'down' });
    const pending = readUsageState(se, SID).pending;
    expect(pending?.rows).toHaveLength(1);
    expect(readUsageState(se, SID).n).toBe(0);
    fake.intercept = undefined;
    appendFileSync(transcript, line('m2', '2026-11-20T10:06:00.000Z'));
    const later: Context = { ...se, now: () => new Date('2026-11-20T13:00:00.000Z') };
    const puts = mark();
    expect(await pushUsage(later, fake.url, SID)).toEqual({ kind: 'ok', sent: 2 });
    const sent = puts();
    expect(sent.map(r => r.path.split('-').at(-1))).toEqual(['1', '2']);
    // 送り直しの行は、控えた時刻と本文のまま（castlist は、本文の写しに送り手の時刻も入れる）。
    expect((sent[0]?.body as { turns: number, sentAt: string }).turns).toBe(1);
    expect(new Date((sent[0]?.body as { sentAt: string | number }).sentAt as string).toISOString()).toBe(pending?.rows[0]?.sentAt);
    expect(readUsageState(se, SID).pending).toBeUndefined();
    expect(readUsageState(se, SID).ids).toEqual(['m1', 'm2']);
  });

  test('1 行目が castlist に足された後に落ちても、送り直しは 200 で済み、2 重に足されない', async () => {
    const { se, tpm, transcript } = await launched();
    await sessionStart(se, startInput('startup', SID, transcript));
    writeFileSync(transcript, line('m1', '2026-11-20T10:05:00.000Z') + line('m2', '2026-11-20T11:05:00.000Z'));
    let n = 0;
    fake.intercept = seen => seen.path.startsWith('/api/usage/') && (n += 1) === 2 ? 'drop' : undefined;
    expect(await pushUsage(se, fake.url, SID)).toEqual({ kind: 'down' });
    fake.intercept = undefined;
    const puts = mark();
    expect(await pushUsage(se, fake.url, SID)).toEqual({ kind: 'ok', sent: 2 });
    expect(puts().map(r => r.status)).toEqual([200, 201]);
    expect(await usageCheck({ ...tpm, now: () => new Date('2026-11-20T13:00:00.000Z') }, {})).toContain('合った: どの席も、回の数と額が一致');
  });

  test('数の口を持たない版の castlist（404）には、控えを残さず、上がった後に初めから送る', async () => {
    const { se, transcript } = await launched();
    await sessionStart(se, startInput('startup', SID, transcript));
    writeFileSync(transcript, line('m1', '2026-11-20T10:05:00.000Z'));
    fake.intercept = seen => seen.path.startsWith('/api/usage/') ? { status: 404, type: 'UnknownOperationException', body: '知らない道' } : undefined;
    expect(await pushUsage(se, fake.url, SID)).toEqual({ kind: 'old' });
    expect(readUsageState(se, SID)).toEqual({ session: SID, files: {}, ids: [], n: 0 });
    fake.intercept = undefined;
    expect(await pushUsage(se, fake.url, SID)).toEqual({ kind: 'ok', sent: 1 });
  });

  test('castlist が断った行（形の誤り）は、記録に残して先へ進む（黙って済みにしない・止まり続けない）', async () => {
    const { se, tpm, transcript } = await launched();
    await sessionStart(se, startInput('startup', SID, transcript));
    writeFileSync(transcript, line('m1', '2026-11-20T10:05:00.000Z', {}, 'claude-Opus[1m]') + line('m2', '2026-11-20T10:06:00.000Z'));
    expect(await pushUsage(se, fake.url, SID)).toEqual({ kind: 'ok', sent: 2 });
    const refused = se.state.lines<{ id: string, code: number, session: string }>('usage-refused.jsonl');
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ code: 400, session: SID });
    const out = await usageCheck({ ...tpm, now: () => new Date('2026-11-20T13:00:00.000Z') }, {});
    expect(out.some(l => l.startsWith('違い: ') && l.includes('記録 2 回') && l.includes('castlist 1 回'))).toBe(true);
    expect(out).toContain('castlist が断った行: 1（状態の folder の usage-refused.jsonl）');
    expect(out.some(l => l.startsWith('値段の表に無い model（額を 0 で数えた）: claude-Opus[1m]'))).toBe(true);
  });
});

describe('同じ起こしの、ほかの session の写し（resume・fork）', () => {
  test('前の session で数えた応答が、次の session の写しに写されていても、2 度数えない', async () => {
    const { se, project, transcript } = await launched();
    await sessionStart(se, startInput('startup', SID, transcript));
    writeFileSync(transcript, line('m1', '2026-11-20T10:05:00.000Z') + line('m2', '2026-11-20T10:06:00.000Z'));
    await pushUsage(se, fake.url, SID);
    const forked: Context = { ...se, env: { ...se.env, CLAUDE_CODE_SESSION_ID: SID2 } };
    const copy = join(project, `${SID2}.jsonl`);
    writeFileSync(copy, line('m1', '2026-11-20T10:05:00.000Z') + line('m2', '2026-11-20T10:06:00.000Z') + line('m3', '2026-11-20T10:30:00.000Z'));
    await sessionStart(forked, startInput('fork', SID2, copy));
    const puts = mark();
    expect(await pushUsage(forked, fake.url, SID2)).toEqual({ kind: 'ok', sent: 1 });
    expect(puts().map(r => [(r.body as { by: string }).by, (r.body as { turns: number }).turns])).toEqual([[`claude.session:${SID2}`, 1]]);
  });

  test('前の session が、castlist の止まっている間に控えて送れていない回も、次の session は 2 度数えない（review-10 の #1）', async () => {
    const { se, project, transcript } = await launched();
    await sessionStart(se, startInput('startup', SID, transcript));
    writeFileSync(transcript, line('m1', '2026-11-20T10:05:00.000Z'));
    fake.intercept = seen => seen.path.startsWith('/api/usage/') ? 'drop' : undefined;
    expect(await pushUsage(se, fake.url, SID)).toEqual({ kind: 'down' });
    fake.intercept = undefined;
    const forked: Context = { ...se, env: { ...se.env, CLAUDE_CODE_SESSION_ID: SID2 } };
    const copy = join(project, `${SID2}.jsonl`);
    writeFileSync(copy, line('m1', '2026-11-20T10:05:00.000Z') + line('m3', '2026-11-20T10:30:00.000Z'));
    await sessionStart(forked, startInput('fork', SID2, copy));
    const puts = mark();
    // fork の席が先に取り込まれても、控えの残った m1 は数えない。
    expect(await pushUsage(forked, fake.url, SID2)).toEqual({ kind: 'ok', sent: 1 });
    expect(await pushUsage(se, fake.url, SID)).toEqual({ kind: 'ok', sent: 1 });
    expect(puts().map(r => [(r.body as { by: string }).by, (r.body as { turns: number }).turns])).toEqual([[`claude.session:${SID2}`, 1], [`claude.session:${SID}`, 1]]);
  });

  test('片付けは、起こしの古い順に回り、突き合わせも、取り込みが付けた席で数える（review-10 の #4）', async () => {
    const { tpm, se, project, transcript } = await launched();
    await sessionStart(se, startInput('startup', SID, transcript));
    writeFileSync(transcript, line('m1', '2026-11-20T10:05:00.000Z'));
    const forked: Context = { ...se, env: { ...se.env, CLAUDE_CODE_SESSION_ID: SID2 } };
    const copy = join(project, `${SID2}.jsonl`);
    writeFileSync(copy, line('m1', '2026-11-20T10:05:00.000Z') + line('m3', '2026-11-20T10:30:00.000Z'));
    await sessionStart(forked, startInput('fork', SID2, copy));
    const order = sweepOrder(tpm);
    expect(order.indexOf(SID)).toBeLessThan(order.indexOf(SID2));
    // fork の席が先に閉じて、m1 を持っていった時も、突き合わせは合う。
    await pushUsage(forked, fake.url, SID2);
    await pushUsage(se, fake.url, SID);
    expect((await usageCheck({ ...tpm, now: () => new Date('2026-11-20T13:00:00.000Z') }, {})).at(-1)).toBe('合った: どの席も、回の数と額が一致');
  });
});

describe('席の鍵', () => {
  test('ほかの process が同じ席を取り込んでいる間（鍵が在る）は、その席を飛ばす。落ちて残った古い鍵は、取り直す（review-10 の #3）', async () => {
    const { se, transcript } = await launched();
    await sessionStart(se, startInput('startup', SID, transcript));
    writeFileSync(transcript, line('m1', '2026-11-20T10:05:00.000Z'));
    se.state.write(`usage/${SID}.lock`, { at: NOW, pid: 1 });
    expect(await pushUsage(se, fake.url, SID)).toEqual({ kind: 'none' });
    const later: Context = { ...se, now: () => new Date(Date.parse(NOW) + 11 * 60 * 1000) };
    expect(await pushUsage(later, fake.url, SID)).toEqual({ kind: 'ok', sent: 1 });
    expect(se.state.read(`usage/${SID}.lock`)).toBeUndefined();
  });
});

describe('席を閉じる命令（roster close）', () => {
  test('閉じる前に、その席の数を取り込む（hook が届かなくても）', async () => {
    const { tpm, se, transcript } = await launched();
    await sessionStart(se, startInput('startup', SID, transcript));
    writeFileSync(transcript, line('m1', '2026-11-20T10:05:00.000Z'));
    const since = fake.requests().length;
    await close(tpm, 't-x7k2');
    const after = fake.requests().slice(since).filter(r => r.method === 'PUT').map(r => r.path.split('/').slice(0, 3).join('/'));
    expect(after).toEqual(['/api/usage', '/api/events']);
  });
});

describe('TPM 担当の側の片付け', () => {
  test('担当の session では何もしない。TPM 担当の session で、hook を持たない席（控えに写しの path が無い席）も、置き場から探して取り込む', async () => {
    const { tpm, se, w, transcript } = await launched();
    // 写しの path を知らせない（前の版で起こした席）。
    await sessionStart(se, startInput('startup', SID, '/nonexistent/transcript.jsonl'));
    writeFileSync(transcript, line('m1', '2026-11-20T10:05:00.000Z'));
    w.tpm.state.remove('usage/checked.jsonc');
    const puts = mark();
    await tidyUsage(se);
    expect(puts()).toEqual([]);
    await tidyUsage(tpm);
    expect(puts().map(r => (r.body as { by: string }).by)).toEqual([`claude.session:${SID}`]);
  });

  test('1 時間に 1 度だけ判じる。みな取り込めた時だけ、判じた時刻を控える', async () => {
    const { tpm, se, transcript } = await launched();
    await sessionStart(se, startInput('startup', SID, transcript));
    // launched の中の名乗り（roster hello）で、もう 1 度判じている。
    expect(tpm.state.read<{ at: string }>('usage/checked.jsonc')?.at).toBe(NOW);
    writeFileSync(transcript, line('m1', '2026-11-20T10:05:00.000Z'));
    const puts = mark();
    await tidyUsage(tpm);
    expect(puts()).toEqual([]);
    const later: Context = { ...tpm, now: () => new Date(Date.parse(NOW) + USAGE_CHECK_EVERY_MS) };
    fake.intercept = seen => seen.path.startsWith('/api/usage/') ? 'drop' : undefined;
    await tidyUsage(later);
    expect(tpm.state.read<{ at: string }>('usage/checked.jsonc')?.at).toBe(NOW);
    fake.intercept = undefined;
    // 答えなかった後は、5 分待ってから聞き直す（下の試験）。
    const retry: Context = { ...tpm, now: () => new Date(Date.parse(NOW) + USAGE_CHECK_EVERY_MS + USAGE_RETRY_MS) };
    await tidyUsage(retry);
    expect(puts().filter(r => r.status === 201)).toHaveLength(1);
    expect(tpm.state.read<{ at: string, retryAt?: string }>('usage/checked.jsonc')).toEqual({ at: new Date(Date.parse(NOW) + USAGE_CHECK_EVERY_MS + USAGE_RETRY_MS).toISOString() });
  });

  test('時間の上限を過ぎたら、残りは次の回に回し、次は止めた席から続ける（review-10 の #5）', async () => {
    const { tpm, se, transcript } = await launched();
    await sessionStart(se, startInput('startup', SID, transcript));
    writeFileSync(transcript, line('m1', '2026-11-20T10:05:00.000Z'));
    const stopped = await sweepUsage(tpm, fake.url, -1);
    expect(stopped).toMatchObject({ sent: 0, done: false });
    expect(sweepOrder(tpm, stopped.next)[0]).toBe(stopped.next);
    expect(await sweepUsage(tpm, fake.url, 10_000, stopped.next)).toEqual({ sent: 1, done: true });
  });

  test('castlist が答えない時は、5 分の間、聞き直さない（TPM 担当の命令のたびに待たない。review-10 の #2）', async () => {
    const { tpm, se, transcript } = await launched();
    await sessionStart(se, startInput('startup', SID, transcript));
    writeFileSync(transcript, line('m1', '2026-11-20T10:05:00.000Z'));
    const t1: Context = { ...tpm, now: () => new Date(Date.parse(NOW) + USAGE_CHECK_EVERY_MS) };
    let asked = 0;
    fake.intercept = (seen) => {
      if (!seen.path.startsWith('/api/usage/')) return undefined;
      asked += 1;
      return 'drop';
    };
    await tidyUsage(t1);
    expect(asked).toBe(1);
    await tidyUsage(t1);
    await tidyUsage({ ...tpm, now: () => new Date(Date.parse(NOW) + USAGE_CHECK_EVERY_MS + USAGE_RETRY_MS - 1) });
    expect(asked).toBe(1);
    fake.intercept = undefined;
    const puts = mark();
    await tidyUsage({ ...tpm, now: () => new Date(Date.parse(NOW) + USAGE_CHECK_EVERY_MS + USAGE_RETRY_MS) });
    expect(puts().filter(r => r.status === 201)).toHaveLength(1);
  });
});

describe('写しの path と、圧縮の印', () => {
  test('guard は、写しの path を席の控えに書く（前の版で起こした席）', async () => {
    const { se, transcript } = await launched();
    await sessionStart(se, startInput('startup', SID, '/nonexistent/transcript.jsonl'));
    writeFileSync(transcript, line('m1', '2026-11-20T10:05:00.000Z'));
    await guard(se, JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, session_id: SID, transcript_path: transcript }));
    expect(readSession(se, SID)?.transcript).toBe(transcript);
  });

  test('要約（圧縮）の出来事に、写しの圧縮の印の欄をそのまま載せる。読めなければ空', async () => {
    const { se, transcript } = await launched();
    await sessionStart(se, startInput('startup', SID, transcript));
    writeFileSync(transcript, `${line('m1', '2026-11-20T10:05:00.000Z')}${JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: '2026-11-20T10:06:00.000Z', compactMetadata: { trigger: 'auto', preTokens: 300000, postTokens: 60000, durationMs: 5 } })}\n${other('2026-11-20T10:06:01.000Z')}`);
    const since = fake.requests().length;
    await sessionStart(se, startInput('compact', SID, transcript));
    await sessionStart(se, startInput('compact', SID, '/nonexistent/transcript.jsonl'));
    const events = fake.requests().slice(since).filter(r => r.method === 'PUT' && r.path.startsWith('/api/events/'));
    expect(events.map(r => [(r.body as { type: string }).type, (r.body as { detail: unknown }).detail])).toEqual([
      ['compacted', { trigger: 'auto', preTokens: 300000, postTokens: 60000 }],
      ['compacted', {}],
    ]);
  });
});

describe('突き合わせ（roster castlist usage-check）', () => {
  test('記録から直に数えた値と、castlist の行の合計が合えば「合った」。まだ送っていない分は違いに出る', async () => {
    const { tpm, se, transcript } = await launched();
    await sessionStart(se, startInput('startup', SID, transcript));
    writeFileSync(transcript, line('m1', '2026-11-20T10:05:00.000Z') + line('m2', '2026-11-20T11:05:00.000Z'));
    await pushUsage(se, fake.url, SID);
    const at13: Context = { ...tpm, now: () => new Date('2026-11-20T13:00:00.000Z') };
    const out = await usageCheck(at13, {});
    expect(out[1]).toMatch(/^席: 1（記録から直に数えた: 2 回・0\.00 ドル／castlist の行の合計: 2 回・0\.00 ドル）$/);
    expect(out.at(-1)).toBe('合った: どの席も、回の数と額が一致');
    appendFileSync(transcript, line('m3', '2026-11-20T11:30:00.000Z'));
    const again = await usageCheck(at13, {});
    expect(again.some(l => /^違い: t-x7k2-swe\.1 記録 3 回.*castlist 2 回/.test(l))).toBe(true);
    expect(again.at(-1)).toMatch(/^合わない席: 1/);
    // 窓の外の回は数えない。窓の端は、時の境に切り下げる（10:20〜11:10 は、10:00〜11:00）。
    const narrow = await usageCheck(at13, { from: '2026-11-20T10:20:00Z', to: '2026-11-20T11:10:00Z' });
    expect(narrow[0]).toBe('窓: 2026-11-20T10:00:00.000Z 〜 2026-11-20T11:00:00.000Z（回の時刻。端は時の境）');
    expect(narrow[1]).toMatch(/^席: 1（記録から直に数えた: 1 回・0\.00 ドル／castlist の行の合計: 1 回/);
    expect(narrow.at(-1)).toBe('合った: どの席も、回の数と額が一致');
  });

  test('窓が 31 日を越える・読めない時刻は、送らずに断る。castlist を設定していなければ、そう言う', async () => {
    const { tpm } = await launched();
    expect(await usageCheck(tpm, { from: '2026-01-01T00:00:00Z', to: '2026-11-20T00:00:00Z' })).toEqual(['窓（--from から --to）は 31 日までにしてください']);
    expect(await usageCheck(tpm, { from: 'きのう' })).toEqual(['--from・--to は、読める時刻（2026-11-27T00:00:00Z など）にしてください']);
    expect(await usageCheck(world().tpm, {})).toEqual(['castlist を設定していないので、突き合わせる物が無い']);
  });
});
