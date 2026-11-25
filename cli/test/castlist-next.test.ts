// 設定の api.castlist が next の時に、castlist へ書く物を生成した client（cli/gen/castlist-client/）で送る道（AI-36 の段 6c）。
// client を作る所（castlistClient）は、127.0.0.1 の空いた port の node の http サーバーで、送り直さないことと Host の形を見る。
// 書く道は、Context の client を作る関数に、偽の HTTP の handler を持つ client を差し込み、受けた要求を見て、決まりの形（restJson1）で答える。
// 本物の castlist（8802）には触らない。
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import type * as Castlist from '../gen/castlist-client/dist-types/index.js';
import { castlistClient, castlistIssuer, projectPrefix, registerPm } from '../src/castlist.ts';
import { withoutAwsMiddleware } from '../src/clients.ts';
import { castlistGuard, readSession, sessionStart } from '../src/commands/castlist.ts';
import type { Context } from '../src/context.ts';
import { withoutRosterEnv } from '../src/env.ts';
import { deadUrl } from './castlist-fake.ts';
import { nextHandler, type NextAnswer as Answer, type NextSeen as Seen } from './castlist-next-fake.ts';
import { world } from './helpers.ts';

const SID = 'bbbbbbbb-0000-4000-8000-000000000001';
const ACTOR = '019abcde-0000-7000-8000-000000000001';
/** world の時計の時刻。 */
const NOW = Date.parse('2026-11-20T12:00:00.000Z');

/** 偽の HTTP の handler（castlist-next-fake.ts）。answer が要求ごとの答えを決める（undefined なら、決まりの形の成功）。 */
const fakeHandler = (answer: (seen: Seen) => Answer | undefined = () => undefined) => nextHandler(s => answer(s) ?? success(s));

/** 決まりの形の成功（登録は 201 でアクターを返し、足す 3 つは 201 で足した行を返す）。 */
function success(seen: Seen): Answer {
  const at = { sentAt: '2026-11-20T12:00:00Z', receivedAt: '2026-11-20T12:00:00.001Z', clockSkew: false };
  if (seen.method === 'POST' && seen.path === '/api/actors') return { status: 201, body: { actor: { id: ACTOR, name: `${String(seen.body?.namePrefix)}.1`, kind: seen.body?.kind }, created: true } };
  const id = decodeURIComponent(seen.path.split('/').at(-1) ?? '');
  if (seen.path.startsWith('/api/events/')) return { status: 201, body: { id, actorId: ACTOR, type: seen.body?.type, detail: seen.body?.detail ?? {}, ...at } };
  if (seen.path.startsWith('/api/links/')) return { status: 201, body: { id, type: seen.body?.type, from: ACTOR, to: ACTOR, ...at } };
  if (seen.path.startsWith('/api/settings/')) return { status: 201, body: { id, actorId: ACTOR, model: seen.body?.model, effort: seen.body?.effort, source: seen.body?.source, ...at } };
  return { status: 404, type: 'UnknownOperationException', body: '知らない道' };
}

/** 送り手の時刻（sentAt）は world の時計の時刻（UTC）。 */
const sentAtOk = (body: Record<string, unknown> | undefined): boolean => typeof body?.sentAt === 'string' && body.sentAt.endsWith('Z') && Date.parse(body.sentAt) === NOW;

let dead: string;
beforeAll(async () => {
  dead = await deadUrl();
});

/** castlist の URL（何も待っていない port）と api.castlist: next を設定した TPM 担当の周り。client を作る関数は、偽の handler を持つ client を作る。 */
function nextSeat(answer?: (seen: Seen) => Answer | undefined, env: NodeJS.ProcessEnv = {}): { ctx: Context, seen: Seen[] } {
  const w = world({ castlist: dead, api: { castlist: 'next' } });
  const { handler, seen } = fakeHandler(answer);
  const ctx: Context = { ...w.tpm, env: { ...w.tpm.env, CLAUDE_CODE_SESSION_ID: SID, ...env }, clients: { ...w.tpm.clients, castlist: (url: string) => castlistClient(url, handler) } };
  return { ctx, seen };
}

/** 起こしの印（roster start の 1 行が付ける環境変数）。 */
const LAUNCH = {
  ROSTER_LAUNCH: 'launch-tpm',
  ROSTER_LAUNCHED_BY: 'tpm.person:product-manager',
  ROSTER_LAUNCH_MODEL: 'claude-opus-5-5',
  ROSTER_LAUNCH_EFFORT: 'medium',
  ROSTER_LAUNCH_FRESH: '1',
};

const startInput = (source: string): string => JSON.stringify({ hook_event_name: 'SessionStart', session_id: SID, source, transcript_path: '/nonexistent/transcript.jsonl', cwd: '/w' });
const bashInput = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, session_id: SID, transcript_path: '/nonexistent/transcript.jsonl', ...extra });

/** model の行を持つ写し（Claude Code の transcript の JSONL）。 */
function transcript(model: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'roster-next-')), 'transcript.jsonl');
  writeFileSync(file, `${JSON.stringify({ type: 'assistant', message: { model } })}\n`);
  return file;
}

describe('castlist の client を作る所（castlistClient）', () => {
  /** 受けた要求を数える http サーバー（いつも 503 の Unavailable で答える）。 */
  const seen: IncomingMessage[] = [];
  let url: string;
  const server = createServer((req, res) => {
    seen.push(req);
    req.resume();
    req.on('end', () => {
      res.writeHead(503, { 'content-type': 'application/json', 'x-amzn-errortype': 'Unavailable' });
      res.end(JSON.stringify({ message: '混んでいる' }));
    });
  });
  beforeAll(async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise(resolve => server.close(resolve)));
  afterEach(() => {
    vi.unstubAllEnvs();
    seen.length = 0;
  });

  /** 生成した client の module（試験は Command の class を使う）。 */
  const { GetHealthCommand, Unavailable } = createRequire(import.meta.url)('../gen/castlist-client/dist-cjs/index.js') as typeof Castlist;

  test('503（Unavailable は @retryable）でも 1 度しか送らない。Host は URL の 127.0.0.1:<port> のまま（curl と同じ）で、Origin は付けない', async () => {
    const client = castlistClient(url);
    const error: unknown = await client.send(new GetHealthCommand({})).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Unavailable);
    expect(seen.length).toBe(1);
    expect(seen[0]?.headers.host).toBe(new URL(url).host);
    expect(seen[0]?.headers.origin).toBeUndefined();
  });

  test('AWS_MAX_ATTEMPTS=5・AWS_RETRY_MODE・~/.aws/config の max_attempts を置いても、1 度しか送らない', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'roster-aws-'));
    writeFileSync(join(dir, 'config'), '[default]\nmax_attempts = 5\nretry_mode = adaptive\n');
    vi.stubEnv('AWS_MAX_ATTEMPTS', '5');
    vi.stubEnv('AWS_RETRY_MODE', 'adaptive');
    vi.stubEnv('AWS_CONFIG_FILE', join(dir, 'config'));
    vi.stubEnv('HOME', dir);
    const error: unknown = await castlistClient(url).send(new GetHealthCommand({})).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(seen.length).toBe(1);
  });

  test('castlist が止まっていれば（つながらない）、登録の答えは down', async () => {
    const w = world({ castlist: dead, api: { castlist: 'next' } });
    expect(await registerPm(w.tpm, dead)).toEqual({ kind: 'down' });
  });

  test('生成した client は使う時だけ読む（castlist の命令の module を読んだだけでは読まない）', () => {
    const script = [
      'import \'./src/commands/castlist.ts\';',
      'import \'./src/context.ts\';',
      'import { createRequire } from \'node:module\';',
      'const cache = Object.keys(createRequire(import.meta.url).cache);',
      'console.log(JSON.stringify(cache.filter(k => k.includes(\'castlist-client\'))));',
    ].join('\n');
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: join(import.meta.dirname, '..'), encoding: 'utf8', env: withoutRosterEnv(process.env) });
    expect(r.stderr).toBe('');
    expect(JSON.parse(r.stdout)).toEqual([]);
  });
});

describe('castlist の client の守り（review-33）', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('castlist が答えの頭を返して本文を送らなければ、送る 1 回の全部で 6 秒の上限に切って down', async () => {
    const stall = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(201, { 'content-type': 'application/json' });
        res.write('{"actor":');
      });
    });
    await new Promise<void>(resolve => stall.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(stall.address() as AddressInfo).port}`;
    try {
      const w = world({ castlist: url, api: { castlist: 'next' } });
      const started = Date.now();
      expect(await registerPm(w.tpm, url)).toEqual({ kind: 'down' });
      expect(Date.now() - started).toBeLessThan(7500);
    }
    finally {
      stall.closeAllConnections();
      await new Promise(resolve => stall.close(resolve));
    }
  }, 15_000);

  test('2xx の答えの本文を読めなければ、断られた（refused）でなく、読めない答えとして down', async () => {
    const { ctx } = nextSeat(() => ({ status: 201, raw: 'not json' }));
    expect(await registerPm(ctx, dead)).toEqual({ kind: 'down' });
  });

  test('生成した client を読めなければ、pnpm install --frozen-lockfile を打つよう言う誤りで止まる（guard はこれを 2 で止める）', async () => {
    const { ctx } = nextSeat();
    const unreadable = (): never => {
      throw new Error('Cannot find module \'@smithy/core\'');
    };
    const seat: Context = { ...ctx, clients: { ...ctx.clients, castlist: unreadable } };
    await expect(registerPm(seat, dead)).rejects.toThrow(/生成した castlist の client を読めません.*pnpm install --frozen-lockfile/s);
  });

  test('送る物のある guard は、生成した client を読めなければ、素通りさせずに止める（install を言う訳で）', async () => {
    const { ctx } = nextSeat();
    const unreadable = (): never => {
      throw new Error('Cannot find module \'@smithy/core\'');
    };
    const seat: Context = { ...ctx, clients: { ...ctx.clients, castlist: unreadable } };
    const verdict = await castlistGuard(seat, bashInput({ transcript_path: transcript('claude-opus-5-5'), effort: { level: 'high' } })).catch((e: unknown) => ({ allow: false, reason: (e as Error).message }));
    expect(verdict.allow).toBe(false);
    expect('reason' in verdict ? verdict.reason : '').toMatch(/pnpm install --frozen-lockfile/);
  });

  test('AWS の Lambda の頭の middleware を外せなければ止まり、外せば _X_AMZN_TRACE_ID を置いても X-Amzn-Trace-Id を付けない', async () => {
    expect(() => withoutAwsMiddleware({ middlewareStack: { remove: () => false } })).toThrow(/recursionDetectionMiddleware/);
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'f');
    vi.stubEnv('_X_AMZN_TRACE_ID', 'Root=1-00000000-000000000000000000000000');
    const { ctx, seen } = nextSeat();
    expect((await registerPm(ctx, dead)).kind).toBe('ok');
    expect(seen.length).toBe(1);
    expect(Object.keys(seen[0]?.headers ?? {}).map(k => k.toLowerCase())).not.toContain('x-amzn-trace-id');
  });
});

describe('api.castlist が next の時の書く道', () => {
  test('SessionStart は RegisterActor（POST /api/actors）で登録し、PutEvent と PutLink で送る。欄は camelCase、時刻は UTC', async () => {
    const { ctx, seen } = nextSeat(undefined, LAUNCH);
    await sessionStart(ctx, startInput('startup'));
    expect(seen.map(s => `${s.method} ${s.path}`)).toEqual([
      'POST /api/actors',
      expect.stringMatching(new RegExp(`^PUT /api/events/e-[0-9a-f]{8}-${SID}-entered$`)),
      expect.stringMatching(new RegExp(`^PUT /api/links/l-[0-9a-f]{8}-${SID}-launched$`)),
    ]);
    const issuer = castlistIssuer(ctx.state.dir);
    const [register, entered, link] = seen;
    expect(register?.body).toMatchObject({
      issuer,
      kind: 'ai',
      namePrefix: projectPrefix(ctx.project, 'tpm'),
      labels: { 'tpm.project': ctx.project, 'tpm.launch': 'launch-tpm', 'tpm.role': 'tpm' },
      bindings: [{ type: 'claude.session', value: SID }],
      settings: { model: 'claude-opus-5-5', effort: 'medium' },
    });
    expect(register?.body).not.toHaveProperty('name_prefix');
    expect(register?.body).not.toHaveProperty('sent_at');
    expect(entered?.body).toMatchObject({ issuer, by: `claude.session:${SID}`, type: 'entered', detail: {} });
    expect(link?.body).toMatchObject({ issuer, type: 'launched', from: 'tpm.person:product-manager', to: `claude.session:${SID}` });
    for (const s of seen) {
      expect(sentAtOk(s.body)).toBe(true);
      expect(s.headers['content-type']).toBe('application/json');
      expect(s.headers.host).toBe(new URL(dead).host);
      expect(s.headers).not.toHaveProperty('origin');
    }
    // 控えには、登録の答えの id と名を書く（今の道と同じ）。
    expect(readSession(ctx, SID)).toMatchObject({ session: SID, id: ACTOR, name: `${projectPrefix(ctx.project, 'tpm')}.1`, present: true });
  });

  test('guard は、見た model と effort を PutSetting（PUT /api/settings/…）で送る', async () => {
    const { ctx, seen } = nextSeat();
    expect(await castlistGuard(ctx, bashInput({ transcript_path: transcript('claude-opus-5-5'), effort: { level: 'high' } }))).toEqual({ allow: true });
    const put = seen.find(s => s.path.startsWith('/api/settings/'));
    expect(put?.method).toBe('PUT');
    expect(put?.path).toMatch(new RegExp(`^/api/settings/t-[0-9a-f]{8}-${SID}-observed-1$`));
    expect(put?.body).toMatchObject({ issuer: castlistIssuer(ctx.state.dir), by: `claude.session:${SID}`, model: 'claude-opus-5-5', effort: 'high', source: 'observed' });
    expect(sentAtOk(put?.body)).toBe(true);
    expect(readSession(ctx, SID)?.observed).toEqual({ model: 'claude-opus-5-5', effort: 'high' });
  });

  test('Product Manager の登録（roster start）も RegisterActor で送り、答えは今の道と同じ形（id・名・種類・created）', async () => {
    const { ctx, seen } = nextSeat();
    expect(await registerPm(ctx, dead)).toEqual({
      kind: 'ok',
      code: 201,
      body: { id: ACTOR, name: 'product-manager.1', kind: 'human', created: true },
      text: JSON.stringify({ id: ACTOR, name: 'product-manager.1', kind: 'human', created: true }),
    });
    expect(seen[0]?.body).toMatchObject({ kind: 'human', namePrefix: 'product-manager', labels: { 'tpm.project': ctx.project }, bindings: [{ type: 'tpm.person', value: 'product-manager' }] });
  });

  test('503（Unavailable）は busy: guard は混んでいると言って止める（送り直さない）', async () => {
    const { ctx, seen } = nextSeat(() => ({ status: 503, type: 'Unavailable', body: '混んでいる' }));
    const verdict = await castlistGuard(ctx, bashInput());
    expect(verdict.allow).toBe(false);
    expect(verdict.allow === false && verdict.reason).toMatch(/混んでいます（503）/);
    expect(seen.length).toBe(1);
  });

  test('つながらない（handler の誤り）は down: guard は Product Manager が打つ 1 行を添えて止める', async () => {
    const { ctx } = nextSeat(() => ({ throws: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) }));
    const verdict = await castlistGuard(ctx, bashInput());
    expect(verdict.allow).toBe(false);
    expect(verdict.allow === false && verdict.reason).toMatch(/が応えません。castlist に送れないので、Bash を止めました。/);
  });

  test('409（Conflict）は、もう在るので済んだとみなす（stderr に書かない）。400（ValidationException）は断られた訳を stderr に書いて進む', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const conflict = nextSeat(s => s.path.startsWith('/api/events/') ? { status: 409, type: 'Conflict', body: '本文が違う' } : undefined);
      await sessionStart(conflict.ctx, startInput('startup'));
      expect(readSession(conflict.ctx, SID)?.present).toBe(true);
      expect(write).not.toHaveBeenCalled();
      const invalid = nextSeat(s => s.path.startsWith('/api/events/') ? { status: 400, type: 'ValidationException', body: 'by のアクターを引けない' } : undefined);
      await sessionStart(invalid.ctx, startInput('startup'));
      expect(write).toHaveBeenCalledWith(expect.stringMatching(/^roster castlist: events\/e-[0-9a-f]{8}-.+-entered を castlist が断りました（400: by のアクターを引けない）\n$/));
    }
    finally {
      write.mockRestore();
    }
  });

  test('api の欄が無ければ、生成した client を作らない（今の curl の道のまま。止まっている castlist には送れずに止める）', async () => {
    const w = world({ castlist: dead });
    let made = 0;
    const ctx: Context = { ...w.tpm, clients: { ...w.tpm.clients, castlist: (url: string) => {
      made += 1;
      return castlistClient(url);
    } } };
    const verdict = await castlistGuard(ctx, bashInput());
    expect(verdict.allow).toBe(false);
    expect(made).toBe(0);
  });
});
