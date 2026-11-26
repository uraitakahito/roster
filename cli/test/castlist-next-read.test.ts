// castlist を読む物（/healthz・1 つのアクター・監査の検索）を、生成した client で新しい API に送る道（AI-36。設定の api に依らない）。
// Context の client を作る関数に、偽の HTTP の handler（next-fake.ts）を持つ client を差し込み、送った道と引数を見て、決まりの形（restJson1）で答える。
// 出す物（表・--json）は、前の API と同じ形（欄の名は snake_case、無い値は null、頁の印は next）になることを見る。本物の castlist には触らない。
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { beforeAll, describe, expect, test } from 'vitest';
import { castlistClient, requireUp } from '../src/castlist.ts';
import { castlistEvents, castlistFind, castlistLineage, castlistSettings, castlistShow, seatActorsAt } from '../src/commands/castlist-read.ts';
import { castlistHello } from '../src/commands/castlist.ts';
import type { Context } from '../src/context.ts';
import { deadUrl, nextHandler, type NextAnswer, type NextSeen } from './next-fake.ts';
import { world, type World } from './helpers.ts';

const A1 = '019abcde-0000-7000-8000-000000000001';
const A2 = '019abcde-0000-7000-8000-000000000002';
const AS_OF = '2026-11-20T12:00:00.000Z';

let url: string;
beforeAll(async () => {
  url = await deadUrl();
});

/** 担当のアクターの一覧の行（欄が揃った物）。 */
const FULL = {
  id: A1,
  name: 't-1-swe.1',
  kind: 'ai',
  issuer: 'tpm.x',
  sentAt: '2026-11-20T11:00:00Z',
  receivedAt: '2026-11-20T11:00:00.001Z',
  clockSkew: false,
  labels: { 'tpm.key': 't-1' },
  firstEnteredAt: '2026-11-20T11:00:00.001Z',
  lastExitedAt: '2026-11-20T11:30:00.000Z',
  lastExitType: 'exited',
  present: false,
  inferred: false,
  model: 'claude-opus-5-5',
  effort: 'high',
  url: `/actors/${A1}`,
};
/** 人のアクターの一覧の行（無い値は欄ごと無い）。 */
const BARE = { id: A2, name: 'pm.1', kind: 'human', issuer: 'tpm.x', sentAt: '2026-11-20T10:00:00Z', receivedAt: '2026-11-20T10:00:00.000Z', clockSkew: false, labels: {}, present: true, inferred: false, url: `/actors/${A2}` };
/** BARE を今の道の形にした物。 */
const BARE_NOW = {
  id: A2,
  name: 'pm.1',
  kind: 'human',
  issuer: 'tpm.x',
  sent_at: '2026-11-20T10:00:00.000Z',
  received_at: '2026-11-20T10:00:00.000Z',
  clock_skew: false,
  labels: {},
  first_entered_at: null,
  last_exited_at: null,
  last_exit_type: null,
  present: true,
  inferred: false,
  model: null,
  effort: null,
  url: `/actors/${A2}`,
};
const SETTING = { actorId: A1, model: 'claude-opus-5-5', effort: 'high', source: 'observed', sentAt: '2026-11-20T11:00:00Z', receivedAt: '2026-11-20T11:00:00.004Z', clockSkew: false };
const EDGE = { id: 'l-1', type: 'launched', from: A2, to: A1, sentAt: '2026-11-20T11:00:00Z', receivedAt: '2026-11-20T11:00:00.002Z', clockSkew: false };
const BINDING = { issuer: 'tpm.x', sentAt: '2026-11-20T11:00:00Z', receivedAt: '2026-11-20T11:00:00.001Z' };
/** GetActor の答え。 */
const ACTOR = {
  ...FULL,
  bindings: [],
  currentBindings: [{ ...BINDING, type: 'claude.session', value: 's-1', isKey: true }, { ...BINDING, type: 'cmux.workspace.ref', value: 'workspace:3', isKey: false }],
  events: [],
  settings: [SETTING],
  currentSettings: SETTING,
  linksIn: [EDGE],
  linksOut: [],
  state: { presence: 'entered', present: true, inferred: false, enteredAt: '2026-11-20T11:00:00.001Z' },
  asOf: AS_OF,
};

/** 道ごとの、決まりの形の答え（試験が替えない時）。 */
function answer(seen: NextSeen): NextAnswer | undefined {
  const ok = (body: unknown): NextAnswer => ({ status: 200, body });
  switch (seen.path) {
    case '/healthz': return ok({ status: 'ok', version: '1.0.0-rc.1', now: AS_OF });
    case '/api/actors': return ok({ asOf: AS_OF, actors: [FULL, BARE], nextToken: 'tok-2' });
    case `/api/actors/${A1}`: return ok(ACTOR);
    case `/api/actors/${A1}/lineage`: return ok({ asOf: AS_OF, actorId: A1, nodes: [BARE, FULL], edges: [EDGE] });
    case `/api/actors/${A1}/settings`: return ok({ asOf: AS_OF, actorId: A1, settings: [SETTING] });
    case `/api/actors/${A1}/settings/at`: return ok({ asOf: AS_OF, actorId: A1, at: '2026-11-20T11:10:00.000Z', ...(seen.query.time === '2026-11-20T10:00:00Z' ? {} : { setting: SETTING }) });
    case '/api/events': return ok({ asOf: AS_OF, events: [{ id: 'e-1', actorId: A1, actorName: 't-1-swe.1', type: 'closed', detail: { inferred: true, reason: 'workspace_gone', byHand: false }, sentAt: '2026-11-20T11:00:00Z', receivedAt: '2026-11-20T11:00:00.003Z', clockSkew: false }] });
    case '/api/settings': return ok({ asOf: AS_OF, settings: [{ ...SETTING, id: 't-1', actorName: 't-1-swe.1' }], nextToken: 'tok-s' });
    default: return undefined;
  }
}

/** castlist を設定した世界と、偽の handler を持つ client を作る周り。over は道ごとに答えを替える（undefined なら answer）。 */
function nextWorld(over: (seen: NextSeen) => NextAnswer | undefined = () => undefined): { w: World, ctx: Context, seen: NextSeen[] } {
  const w = world({ castlist: url });
  const { handler, seen } = nextHandler(s => over(s) ?? answer(s));
  return { w, ctx: { ...w.tpm, clients: { ...w.tpm.clients, castlist: (u: string) => castlistClient(u, handler) } }, seen };
}

/** 投げた誤りの字（投げなければ空）。 */
async function thrown(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  }
  catch (e) {
    return (e as Error).message;
  }
  return '';
}

const profile = (id: string): string => `${url}/actors/${id}`;
const fullLine = (): string => ['t-1-swe.1', 'ai', '停止', '登場 2026-11-20T11:00:00.001Z', '退場 2026-11-20T11:30:00.000Z（exited）', 'claude-opus-5-5・high', 'tpm.key=t-1', profile(A1)].join('  ');
const bareLine = (): string => ['pm.1', 'human', '稼働中', '登場 -', '退場 -', '-・-', '-', profile(A2)].join('  ');

describe('roster castlist find（ListActors）', () => {
  test('旗を新しい引数の名に写す（時刻は UTC・--limit は maxResults・--after は nextToken）。表は今と同じ形で、続きは nextToken を --after に渡す 1 行', async () => {
    const { ctx, seen } = nextWorld();
    const out = await castlistFind(ctx, {
      label: ['tpm.key:t-1', 'tpm.role:software-engineer'],
      binding: 'cmux.workspace.ref:workspace:3',
      at: '2026-11-20T20:30:00+09:00',
      activeFrom: '2026-11-20T20:00:00+09:00',
      activeTo: '2026-11-20T12:00:00Z',
      active: 'false',
      model: 'claude-opus-5-5',
      effort: 'high',
      launchedBy: A2,
      skewed: true,
      kind: 'ai',
      sort: 'exited',
      order: 'desc',
      limit: '2',
      after: 'tok-1',
    });
    expect(seen.map(s => `${s.method} ${s.path}`)).toEqual(['GET /api/actors']);
    expect(seen[0]?.query).toEqual({
      label: ['tpm.key:t-1', 'tpm.role:software-engineer'],
      binding: 'cmux.workspace.ref:workspace:3',
      at: '2026-11-20T11:30:00Z',
      activeFrom: '2026-11-20T11:00:00Z',
      activeTo: '2026-11-20T12:00:00Z',
      active: 'false',
      model: 'claude-opus-5-5',
      effort: 'high',
      launchedBy: A2,
      skewed: 'true',
      kind: 'ai',
      sort: 'exited',
      order: 'desc',
      maxResults: '2',
      nextToken: 'tok-1',
    });
    expect(out).toEqual([`アクター 2（castlist の時刻 ${AS_OF}）`, fullLine(), bareLine(), '続きがある: --after tok-2 を足して打ち直す']);
  });

  test('--json は今の道の形（欄は snake_case・無い値は null・頁の印は next）', async () => {
    const { ctx } = nextWorld(s => s.path === '/api/actors' ? { status: 200, body: { asOf: AS_OF, actors: [BARE] } } : undefined);
    const [text = ''] = await castlistFind(ctx, { label: ['tpm.key:t-1'], json: true });
    expect(JSON.parse(text)).toEqual({ as_of: AS_OF, actors: [BARE_NOW], next: null });
  });

  test('読めない時刻・true か false でない --active・数でない --limit は、送らずに今の道と同じ訳で止める', async () => {
    const { ctx, seen } = nextWorld();
    expect(await thrown(() => castlistFind(ctx, { label: ['a:b'], activeFrom: '昨日' }))).toBe('active_from は RFC 3339 の時刻（例 2026-11-22T13:00:00+09:00）');
    expect(await thrown(() => castlistFind(ctx, { label: ['a:b'], active: 'yes' }))).toBe('active は true か false');
    expect(await thrown(() => castlistFind(ctx, { label: ['a:b'], limit: 'ten' }))).toBe('limit は 1 から 1000 までの数');
    expect(seen).toEqual([]);
  });

  test('castlist が断った（400 の ValidationException）ら訳を、止まっていれば「castlist に聞けない」の 1 行を出して止まる', async () => {
    const refused = nextWorld(() => ({ status: 400, type: 'ValidationException', body: '索引で引ける条件が無い' }));
    expect(await thrown(() => castlistFind(refused.ctx, { kind: 'ai' }))).toBe('索引で引ける条件が無い');
    const down = nextWorld(() => ({ throws: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) }));
    expect(await thrown(() => castlistFind(down.ctx, { label: ['a:b'] }))).toBe(`castlist に聞けない（${url} が応えない）`);
    const busy = nextWorld(() => ({ status: 503, type: 'Unavailable', body: '混んでいる' }));
    expect(await thrown(() => castlistFind(busy.ctx, { label: ['a:b'] }))).toBe(`castlist に聞けない（${url} が混んでいる。503）。少し待ってから打ち直す`);
  });
});

describe('roster castlist show（GetActor と GetLineage）', () => {
  test('今と同じ行を出す（付随する id の鍵・今の状態・最新の model と effort・線）', async () => {
    const { ctx, seen } = nextWorld();
    expect(await castlistShow(ctx, A1, {})).toEqual([
      `t-1-swe.1（ai・issuer tpm.x）  ${profile(A1)}`,
      `id: ${A1}`,
      '今: 稼働中（entered・登場 2026-11-20T11:00:00.001Z）',
      'model と effort: claude-opus-5-5・high（observed・受けた 2026-11-20T11:00:00.004Z）',
      'ラベル: tpm.key=t-1',
      '付随する id: claude.session:s-1（鍵）・cmux.workspace.ref:workspace:3',
      '線（起こした・継いだ。上は人まで、下は 1 段）:',
      '- pm.1 → t-1-swe.1（launched・受けた 2026-11-20T11:00:00.002Z）',
    ]);
    expect(seen.map(s => `${s.method} ${s.path}`)).toEqual([`GET /api/actors/${A1}`, `GET /api/actors/${A1}/lineage`]);
  });

  test('--json は今の道の形（current_bindings の is_key・state の無い時刻は null・current_settings）', async () => {
    const { ctx } = nextWorld();
    const body = JSON.parse((await castlistShow(ctx, A1, { json: true }))[0] ?? '') as Record<string, unknown>;
    expect(body).toMatchObject({ id: A1, as_of: AS_OF, clock_skew: false, labels: { 'tpm.key': 't-1' }, links_in: [{ id: 'l-1', from: A2, to: A1, received_at: '2026-11-20T11:00:00.002Z' }] });
    expect(body.current_bindings).toEqual([
      { issuer: 'tpm.x', type: 'claude.session', value: 's-1', is_key: true, sent_at: '2026-11-20T11:00:00.000Z', received_at: '2026-11-20T11:00:00.001Z' },
      { issuer: 'tpm.x', type: 'cmux.workspace.ref', value: 'workspace:3', is_key: false, sent_at: '2026-11-20T11:00:00.000Z', received_at: '2026-11-20T11:00:00.001Z' },
    ]);
    expect(body.state).toEqual({ presence: 'entered', present: true, inferred: false, entered_at: '2026-11-20T11:00:00.001Z', exited_at: null });
    expect(body.current_settings).toMatchObject({ actor_id: A1, model: 'claude-opus-5-5', source: 'observed' });
  });

  test('無いアクター（404 の NotFound）は、訳に find を勧める文を足して止まる', async () => {
    const { ctx } = nextWorld(s => s.path.startsWith('/api/actors/') ? { status: 404, type: 'NotFound', body: 'そのアクターは無い' } : undefined);
    const missing = await thrown(() => castlistShow(ctx, 'nobody.1', {}));
    expect(missing).toMatch(/^そのアクターは無い（nobody\.1）/);
    expect(missing).toContain('roster castlist find');
  });
});

describe('roster castlist lineage（GetLineage）', () => {
  test('--direction・--depth・--type を写し、点と線を今と同じ形で出す', async () => {
    const { ctx, seen } = nextWorld();
    expect(await castlistLineage(ctx, A1, { direction: 'up', depth: '5', type: 'launched' })).toEqual([
      `t-1-swe.1 の線（castlist の時刻 ${AS_OF}）`,
      '点:',
      `- pm.1（human）  ${profile(A2)}`,
      `- t-1-swe.1（ai）  ${profile(A1)}`,
      '線:',
      '- pm.1 → t-1-swe.1（launched・受けた 2026-11-20T11:00:00.002Z）',
    ]);
    expect(seen[0]?.query).toEqual({ direction: 'up', depth: '5', type: 'launched' });
    const [text = ''] = await castlistLineage(ctx, A1, { json: true });
    expect(JSON.parse(text)).toMatchObject({ as_of: AS_OF, actor_id: A1, nodes: [BARE_NOW, { id: A1, first_entered_at: '2026-11-20T11:00:00.001Z' }], edges: [{ type: 'launched', from: A2, to: A1 }] });
  });
});

describe('roster castlist events（ListEvents）', () => {
  test('--type は重ね、時刻は UTC に、--limit・--after は maxResults・nextToken。detail の中の欄の名は替えない', async () => {
    const { ctx, seen } = nextWorld();
    const out = await castlistEvents(ctx, { type: ['exited', 'closed'], actor: A1, from: '2026-11-20T20:00:00+09:00', to: '2026-11-20T12:00:00Z', reason: 'workspace_gone', source: 'clear', skewed: true, limit: '10', after: 'tok-e' });
    expect(seen[0]?.path).toBe('/api/events');
    expect(seen[0]?.query).toEqual({ type: ['exited', 'closed'], actor: A1, from: '2026-11-20T11:00:00Z', to: '2026-11-20T12:00:00Z', reason: 'workspace_gone', source: 'clear', skewed: 'true', maxResults: '10', nextToken: 'tok-e' });
    expect(out).toEqual([
      `出来事 1（castlist の時刻 ${AS_OF}）`,
      ['2026-11-20T11:00:00.003Z', 't-1-swe.1', 'closed', '{"inferred":true,"reason":"workspace_gone","byHand":false}', profile(A1)].join('  '),
    ]);
    const [text = ''] = await castlistEvents(ctx, { json: true });
    expect(JSON.parse(text)).toEqual({ as_of: AS_OF, events: [{ id: 'e-1', actor_id: A1, actor_name: 't-1-swe.1', type: 'closed', detail: { inferred: true, reason: 'workspace_gone', byHand: false }, sent_at: '2026-11-20T11:00:00.000Z', received_at: '2026-11-20T11:00:00.003Z', clock_skew: false }], next: null });
  });
});

describe('roster castlist settings（ListSettings・ListActorSettings・GetActorSettingAt）', () => {
  test('--actor が無ければ ListSettings（--mismatch・--skewed は true だけ）', async () => {
    const { ctx, seen } = nextWorld();
    const out = await castlistSettings(ctx, { mismatch: true, source: 'observed', model: 'claude-opus-5-5', effort: 'high', from: '2026-11-20T11:00:00Z', to: '2026-11-20T21:00:00+09:00', skewed: true, limit: '5', after: 'tok-0' });
    expect(seen[0]?.path).toBe('/api/settings');
    expect(seen[0]?.query).toEqual({ mismatch: 'true', source: 'observed', model: 'claude-opus-5-5', effort: 'high', from: '2026-11-20T11:00:00Z', to: '2026-11-20T12:00:00Z', skewed: 'true', maxResults: '5', nextToken: 'tok-0' });
    expect(out).toEqual([
      `model と effort の行 1（castlist の時刻 ${AS_OF}）`,
      ['2026-11-20T11:00:00.004Z', 't-1-swe.1', 'claude-opus-5-5・high（observed）', profile(A1)].join('  '),
      '続きがある: --after tok-s を足して打ち直す',
    ]);
  });

  test('--actor だけなら ListActorSettings、--at も付ければ GetActorSettingAt（time は UTC）。アクターの名は GetActor から足す', async () => {
    const { ctx, seen } = nextWorld();
    const line = ['2026-11-20T11:00:00.004Z', 't-1-swe.1', 'claude-opus-5-5・high（observed）', profile(A1)].join('  ');
    expect(await castlistSettings(ctx, { actor: A1 })).toEqual([`model と effort の行 1（castlist の時刻 ${AS_OF}）`, line]);
    expect(seen.map(s => s.path)).toEqual([`/api/actors/${A1}`, `/api/actors/${A1}/settings`]);
    seen.length = 0;
    expect(await castlistSettings(ctx, { actor: A1, at: '2026-11-20T20:10:00+09:00' })).toEqual([line]);
    expect(seen.map(s => [s.path, s.query])).toEqual([[`/api/actors/${A1}`, {}], [`/api/actors/${A1}/settings/at`, { time: '2026-11-20T11:10:00Z' }]]);
    expect(await castlistSettings(ctx, { actor: A1, at: '2026-11-20T10:00:00Z' })).toEqual([`その時（2026-11-20T10:00:00Z）の model と effort は、まだ無い（castlist の時刻 ${AS_OF}）`]);
    const [text = ''] = await castlistSettings(ctx, { actor: A1, at: '2026-11-20T10:00:00Z', json: true });
    expect(JSON.parse(text)).toEqual({ as_of: AS_OF, actor_id: A1, at: '2026-11-20T11:10:00.000Z', setting: null });
  });

  test('--actor と一緒に、at のほかの旗は送らずに止める（今の道の castlist が断るのと同じ）', async () => {
    const { ctx, seen } = nextWorld();
    expect(await thrown(() => castlistSettings(ctx, { actor: A1, model: 'claude-opus-5-5' }))).toBe('知らない引数: model（使えるのは at）');
    expect(seen).toEqual([]);
  });
});

describe('roster incident timeline のアクターの欄（seatActorsAt）', () => {
  test('ラベル 2 つと、稼働した期間の窓（その時刻。UTC）で ListActors を聞く', async () => {
    const { ctx, seen } = nextWorld();
    const answer = await seatActorsAt(ctx, url, 't-1', '2026-11-20T12:00:10.000Z');
    expect(answer.kind === 'ok' && answer.body.actors.map(a => a.name)).toEqual(['t-1-swe.1', 'pm.1']);
    expect(seen[0]?.query).toEqual({ label: [`tpm.project:${ctx.project}`, 'tpm.key:t-1'], activeFrom: '2026-11-20T12:00:10Z', activeTo: '2026-11-20T12:00:10Z' });
  });
});

describe('起きているか（GetHealth）と版', () => {
  test('/healthz を GetHealth で聞き、時計の差は今と同じに見る', async () => {
    const { ctx, seen } = nextWorld();
    expect(await requireUp(ctx, '何もしていません。')).toEqual([]);
    expect(seen.map(s => [s.method, s.path])).toEqual([['GET', '/healthz']]);
    const skewed = nextWorld(s => s.path === '/healthz' ? { status: 200, body: { status: 'ok', version: '1.0.0-rc.1', now: '2026-11-20T12:00:05.000Z' } } : undefined);
    expect((await requireUp(skewed.ctx, '何もしていません。'))[0]).toMatch(/^castlist の時計と、roster を動かす機械の時計が 5 秒ずれています/);
  });

  test('503 は混んでいる、つながらなければ止まっている（Product Manager が打つ 1 行は、1.0.0 の image と castlist-data-v1 の volume。移す案内は添えない）', async () => {
    const busy = nextWorld(() => ({ status: 503, type: 'Unavailable', body: '混んでいる' }));
    expect(await thrown(() => requireUp(busy.ctx, '名乗っていません。'))).toMatch(/混んでいます（503）。名乗っていません。/);
    const down = nextWorld(() => ({ throws: new Error('connect ECONNREFUSED') }));
    down.w.answers.set('container inspect castlist.box', { status: 1, stdout: '', stderr: '' });
    down.w.answers.set('container inspect castlist', { status: 1, stdout: '', stderr: '' });
    const message = await thrown(() => requireUp(down.ctx, '名乗っていません。'));
    expect(message.split('\n').slice(1)).toEqual([
      `container run -d --name castlist.box -p 127.0.0.1:${new URL(url).port}:8080 -v castlist-data-v1:/data -m 200M -c 1 ghcr.io/uraitakahito/castlist:v1.0.0`,
    ]);
  });

  test('roster hello も GetHealth で聞く（curl を打たない）', async () => {
    // castlist の URL は何も待っていない port なので、curl で聞けば止まる。
    const { ctx, seen } = nextWorld();
    await expect(castlistHello({ ...ctx, env: { ...ctx.env, CLAUDE_CODE_SESSION_ID: 'bbbbbbbb-0000-4000-8000-000000000009' } })).resolves.toBeDefined();
    expect(seen[0]?.path).toBe('/healthz');
  });
});

describe('読む道の client の守り（書く道と同じ。review-33）', () => {
  test('2xx の答えの本文を読めなければ、断られた訳でなく「castlist に聞けない」（down）で止まる', async () => {
    const { ctx } = nextWorld(() => ({ status: 200, raw: 'not json' }));
    expect(await thrown(() => castlistFind(ctx, { label: ['tpm.key:t-1'] }))).toBe(`castlist に聞けない（${url} が応えない）`);
    expect(await thrown(() => requireUp(ctx, '名乗っていません。'))).toMatch(/が応えません。名乗っていません。/);
  });

  test('生成した client を読めなければ、pnpm install --frozen-lockfile を打つよう言う誤りで止まる', async () => {
    const { ctx } = nextWorld();
    const unreadable = (): never => {
      throw new Error('Cannot find module \'@smithy/core\'');
    };
    const seat: Context = { ...ctx, clients: { ...ctx.clients, castlist: unreadable } };
    await expect(castlistFind(seat, { label: ['tpm.key:t-1'] })).rejects.toThrow(/生成した castlist の client を読めません.*pnpm install --frozen-lockfile/s);
    await expect(requireUp(seat, '名乗っていません。')).rejects.toThrow(/生成した castlist の client を読めません/);
  });

  test('castlist が答えの頭を返して本文を送らなければ、/healthz は今の curl と同じ 1 秒で切って止まっているとみなす', async () => {
    const stall = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{"status":');
      });
    });
    await new Promise<void>(resolve => stall.listen(0, '127.0.0.1', resolve));
    const stalled = `http://127.0.0.1:${(stall.address() as AddressInfo).port}`;
    try {
      const w = world({ castlist: stalled });
      const started = Date.now();
      expect(await thrown(() => requireUp(w.tpm, '名乗っていません。'))).toMatch(new RegExp(`^castlist（${stalled}）が応えません。名乗っていません。`));
      expect(Date.now() - started).toBeLessThan(2500);
    }
    finally {
      stall.closeAllConnections();
      await new Promise(resolve => stall.close(resolve));
    }
  }, 10_000);
});

describe('前の castlist と同じに断る・答える（review-35）', () => {
  test.each([['2 月 30 日', '2026-02-30T00:00:00Z'], ['11 月 31 日', '2026-11-31T10:00:00+09:00'], ['24 時', '2026-11-22T24:00:00Z'], ['時差の 24 時', '2026-11-22T10:00:00+24:00']])('在らない時刻（%s）は、次の日に回さず、送らずに今と同じ訳で止める', async (_, time) => {
    const { ctx, seen } = nextWorld();
    expect(await thrown(() => castlistEvents(ctx, { from: time }))).toBe('from は RFC 3339 の時刻（例 2026-11-22T13:00:00+09:00）');
    expect(seen).toEqual([]);
  });

  test('閏年の 2 月 29 日は通る', async () => {
    const { ctx, seen } = nextWorld();
    await castlistEvents(ctx, { from: '2028-02-29T00:00:00Z' });
    expect(seen[0]?.query.from).toBe('2028-02-29T00:00:00Z');
  });

  test('UUID の形でない id は、新しい API の 400 でなく、今と同じく「無い」で止まる（送らない）', async () => {
    const { ctx, seen } = nextWorld();
    const missing = await thrown(() => castlistShow(ctx, 'nobody.1', {}));
    expect(missing).toMatch(/^そのアクターは無い（nobody\.1）/);
    expect(seen).toEqual([]);
  });

  test('UUID の形でない --actor・--launched-by の絞りは、送らずに空の答え（今の castlist と同じ）', async () => {
    const { ctx, seen } = nextWorld();
    const [events = ''] = await castlistEvents(ctx, { actor: 'nobody.1', json: true });
    expect(JSON.parse(events)).toMatchObject({ events: [], next: null });
    const [actors = ''] = await castlistFind(ctx, { launchedBy: 'some-name', json: true });
    expect(JSON.parse(actors)).toMatchObject({ actors: [], next: null });
    expect(seen).toEqual([]);
  });

  test('設定の行の送り手の id が無ければ、--json でも今と同じく "id": null', async () => {
    const { ctx } = nextWorld();
    const [text = ''] = await castlistSettings(ctx, { actor: A1, json: true });
    expect((JSON.parse(text) as { settings: Record<string, unknown>[] }).settings[0]).toHaveProperty('id', null);
  });

  test('誤りの型の無い 404（この roster の呼ぶ道を持たない castlist）は、アクターが無いでなく、版が合わないと言う', async () => {
    const { ctx } = nextWorld(() => ({ status: 404, raw: '' }));
    expect(await thrown(() => castlistFind(ctx, { label: ['a:b'] }))).toMatch(/castlist が、この roster の呼ぶ操作を持たない/);
  });
});
