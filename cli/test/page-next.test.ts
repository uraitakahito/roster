// 設定の api.pagetray が next の時に、置き場の道（ページ・file・返事の状態・レビューの印・版）を、生成した pagetray の client で新しい API に送る道（AI-36 の段 6c）。
// Context の clients.pagetray に、偽の HTTP の handler（next-fake.ts）を持つ client を差し込み、送った道と引数を見て、決まりの形（restJson1）で答える。
// 出す物（URL・表・--json）は今と同じ形になることを見る。ページの本文と file の中身（GET /<project>/<Key>/…）は新しい API でも同じ URL の手の道なので、今の curl のまま（偽の置き場が答える）。
// next の時に curl で置き場の API（/api/…）を呼ばないことも見る。本物の置き場には触らない。
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { castlistIssuer } from '../src/castlist.ts';
import { fileDelete, fileList, filePath, filePut } from '../src/commands/file.ts';
import { pageDelete, pageImport, pageList, pagePath, pagePut, pageReply } from '../src/commands/page.ts';
import { waitingUrls } from '../src/commands/reply.ts';
import { markVerdict } from '../src/commands/review-marks.ts';
import { pagetrayClient, storeAtLeast } from '../src/commands/store.ts';
import type { Context } from '../src/context.ts';
import { writeRole } from '../src/roster.ts';
import { nextHandler, type NextAnswer, type NextSeen } from './next-fake.ts';
import { world, type World } from './helpers.ts';

const BASE = 'http://127.0.0.1:8801';
const HTML = '<title>試し</title><p>日本語</p>';
const SID = 'bbbbbbbb-0000-4000-8000-000000000001';

/** 置き場のページの記録（新しい API の形）。 */
function page(project: string, key: string, kind: string, n: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { project, key, kind, n, title: `${kind} の題`, role: 'software-engineer', workspace: 'file:1', createdAt: `2026-11-20T12:00:0${n}.000Z`, size: 10, path: `/${project}/${key}/${kind}-${n}.html`, ...extra };
}

/** 新しい API の版の /healthz の答え。 */
const HEALTHY: NextAnswer = { status: 200, body: { status: 'ok', version: '1.0.0-rc.1' } };

/**
 * api.pagetray が next の世界: 控えを一時の folder にし、t-x7k2 の Software Engineer 担当（居場所 file:1）と TPM 担当の周り。
 * 生成した client を作る関数は、偽の handler を持つ client を作る。made は作った数。
 */
function setup(answer: (seen: NextSeen) => NextAnswer | undefined = () => undefined, config: Record<string, unknown> = { api: { pagetray: 'next' } }, health: NextAnswer = HEALTHY) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'roster-pages-next-')));
  const w: World = world(config);
  // /healthz（版を見る GetHealth）は health で答え、seen に入れずに数える（next の道は、1 つの命令で 1 度だけ版を見てから頼む）。
  let healths = 0;
  const { handler, seen } = nextHandler((s) => {
    if (s.path !== '/healthz') return answer(s);
    healths += 1;
    return health;
  }, s => s.path !== '/healthz');
  let made = 0;
  const wire = (ctx: Context, env: NodeJS.ProcessEnv = {}): Context => ({
    ...ctx,
    env: { ...ctx.env, ROSTER_PAGES_DIR: dir, ...env },
    clients: {
      ...ctx.clients,
      pagetray: (url: string) => {
        made += 1;
        return pagetrayClient(url, handler);
      },
    },
  });
  const role = wire(w.role('t-x7k2', 'file:1'), { ROSTER_ROLE: 'software-engineer' });
  const tpm = wire(w.tpm);
  writeRole(tpm, { key: 't-x7k2', role: 'software-engineer', title: 'SWE t-x7k2', cwd: w.project, addDirs: [], model: 'm', effort: 'e', permissionMode: 'p', address: 'file:1' });
  tpm.state.write('tpm.jsonc', { address: 'file:tpm' });
  const project = basename(w.tpm.state.dir);
  const html = join(dir, '..', `${basename(dir)}-src.html`);
  writeFileSync(html, HTML);
  /** 偽の置き場（今の道）への curl の引数。 */
  const curls = (): string[][] => w.calls.filter(c => c.cmd === 'curl').map(c => c.args);
  return { dir, w, role, tpm, project, html, seen, made: () => made, healths: () => healths, curls, wire };
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

/** 置く要求（CreatePage）に、置いた記録で答える。 */
const created = (s: NextSeen): NextAnswer | undefined => {
  const m = /^\/api\/projects\/([^/]+)\/keys\/([^/]+)\/kinds\/([^/]+)\/pages$/.exec(s.path);
  if (s.method !== 'POST' || m === null) return undefined;
  const [, project = '', key = '', kind = ''] = m.map(decodeURIComponent);
  const n = typeof s.query.n === 'string' ? s.query.n : '1';
  return { status: 201, body: { ...page(project, key, kind, n, { role: s.query.role, workspace: s.query.workspace ?? '' }), url: `${BASE}/${project}/${key}/${kind}-${n}.html` }, headers: { location: `${BASE}/${project}/${key}/${kind}-${n}.html` } };
};

describe('pagetray の client を作る所（pagetrayClient）', () => {
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

  test('503（Unavailable は @retryable）でも、AWS_MAX_ATTEMPTS=5 を置いても 1 度しか送らない。Host は URL の 127.0.0.1:<port>、Origin は付けない', async () => {
    vi.stubEnv('AWS_MAX_ATTEMPTS', '5');
    const s = setup(undefined, { api: { pagetray: 'next' } });
    const ctx: Context = { ...s.role, env: { ...s.role.env, ROSTER_PAGES_URL: url }, clients: { ...s.role.clients, pagetray: (u: string) => pagetrayClient(u) } };
    expect(await thrown(() => pagePut(ctx, s.html, { kind: 'brief' }))).toMatch(/^置き場がページを受け取りませんでした（503）: 混んでいる$/);
    // 版を見る /healthz（503 なので応えない扱いで、止めずに頼む）と、置く要求。どちらも 1 度だけ。
    expect(seen.map(r => (r.url ?? '').split('?')[0])).toEqual(['/healthz', `/api/projects/${s.project}/keys/t-x7k2/kinds/brief/pages`]);
    expect(seen[0]?.headers.host).toBe(new URL(url).host);
    expect(seen[0]?.headers.origin).toBeUndefined();
  });
});

describe('pagetray の client の守り', () => {
  test('置き場が答えの頭を返して本文を送らなければ、送る 1 回の全部を 10 秒で切って 000（置き場が応えません）', async () => {
    const stall = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        // 版を見る /healthz には答え、置く要求には頭だけを返す。
        if (req.url === '/healthz') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', version: '1.0.0-rc.1' }));
          return;
        }
        res.writeHead(201, { 'content-type': 'application/json' });
        res.write('{"project":');
      });
    });
    await new Promise<void>(resolve => stall.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(stall.address() as AddressInfo).port}`;
    try {
      const s = setup();
      const ctx: Context = { ...s.role, env: { ...s.role.env, ROSTER_PAGES_URL: url }, clients: { ...s.role.clients, pagetray: (u: string) => pagetrayClient(u) } };
      const started = Date.now();
      expect(await thrown(() => pagePut(ctx, s.html, { kind: 'plan' }))).toMatch(new RegExp(`^置き場（${url}）が応えません。ページは置けていません`));
      const took = Date.now() - started;
      expect(took).toBeGreaterThanOrEqual(9500);
      expect(took).toBeLessThan(11_500);
    }
    finally {
      stall.closeAllConnections();
      await new Promise(resolve => stall.close(resolve));
    }
  }, 20_000);

  test('誤りの型の無い 404（新しい API の道を持たない置き場）は、版が合わないと言う', async () => {
    const s = setup(() => ({ status: 404, raw: '' }));
    expect(await thrown(() => pageList(s.tpm, {}))).toMatch(/^置き場が一覧を返しませんでした（404）: 置き場が新しい API を持たない/);
  });
});

describe('roster page put（CreatePage）', () => {
  test('道に project・Key・種類、引数に役割と居場所、本文は file のまま（text/html）。答えから控えと URL を今と同じに出す', async () => {
    const s = setup(created);
    const path = join(s.dir, s.project, 't-x7k2', 'proposal-1.html');
    expect(await pagePut(s.role, s.html, { kind: 'proposal' })).toEqual([`置いた: ${path}`, `URL: ${BASE}/${s.project}/t-x7k2/proposal-1.html`]);
    expect(readFileSync(path, 'utf8')).toBe(HTML);
    expect(s.seen.map(r => [r.method, r.path, r.query])).toEqual([['POST', `/api/projects/${s.project}/keys/t-x7k2/kinds/proposal/pages`, { role: 'software-engineer', workspace: 'file:1' }]]);
    expect(s.seen[0]?.headers['content-type']).toBe('text/html');
    expect(s.seen[0]?.text).toBe(HTML);
    expect(s.curls()).toEqual([]);
  });

  test('castlist を設定し session があれば、送り手を actorIssuer・actorRef で付ける', async () => {
    const s = setup(created, { api: { pagetray: 'next' }, castlist: 'http://127.0.0.1:1' });
    const ctx = { ...s.role, env: { ...s.role.env, CLAUDE_CODE_SESSION_ID: SID } };
    await pagePut(ctx, s.html, { kind: 'plan' });
    expect(s.seen[0]?.query).toEqual({ role: 'software-engineer', workspace: 'file:1', actorIssuer: castlistIssuer(s.w.tpm.state.dir), actorRef: `claude.session:${SID}` });
  });

  test('送り手が castlist に無い（400 の fieldList に /actorRef）・置き場が castlist に聞けない（503）は、今の 422・503 と同じ訳で止まる', async () => {
    const unknown = setup(() => ({ status: 400, type: 'ValidationException', body: 'castlist に登録の無い送り手', fieldList: [{ path: '/actorRef', message: 'castlist に登録の無い送り手' }] }), { api: { pagetray: 'next' }, castlist: 'http://127.0.0.1:1' });
    const at = (s: typeof unknown): Context => ({ ...s.role, env: { ...s.role.env, CLAUDE_CODE_SESSION_ID: SID } });
    expect(await thrown(() => pagePut(at(unknown), unknown.html, { kind: 'plan' }))).toBe(`この session（claude.session:${SID}）は castlist に登録が無いと、置き場が答えました（400）。ページは置けていません。session は guard が Bash の前に登録するので、打ち直してください。続く時は roster report incident で台帳に挙げてください`);
    const busy = setup(() => ({ status: 503, type: 'Unavailable', body: 'castlist に聞けない' }), { api: { pagetray: 'next' }, castlist: 'http://127.0.0.1:1' });
    expect(await thrown(() => pagePut(at(busy), busy.html, { kind: 'plan' }))).toMatch(/^置き場（http:\/\/127\.0\.0\.1:8801）が castlist に送り手を聞けませんでした（503）。ページは置けていません。/);
    // ほかの欄の 400 は、送り手の訳にしない。
    const other = setup(() => ({ status: 400, type: 'ValidationException', body: 'role の形が違う', fieldList: [{ path: '/role', message: '形が違う' }] }), { api: { pagetray: 'next' }, castlist: 'http://127.0.0.1:1' });
    expect(await thrown(() => pagePut(at(other), other.html, { kind: 'plan' }))).toBe('置き場がページを受け取りませんでした（400）: role の形が違う');
    // actorRef の形の誤り（/actorRef の 400 でも、訳が「castlist に登録の無い送り手」でない）は、打ち直しても通らないので、登録を待つ訳にしない。
    const shape = setup(() => ({ status: 400, type: 'ValidationException', body: 'actorRef の形が違う', fieldList: [{ path: '/actorRef', message: '形が違う' }] }), { api: { pagetray: 'next' }, castlist: 'http://127.0.0.1:1' });
    expect(await thrown(() => pagePut(at(shape), shape.html, { kind: 'plan' }))).toBe('置き場がページを受け取りませんでした（400）: actorRef の形が違う');
  });

  test('止まっている・答えが読めない（2xx の JSON でない本文）は「置き場が応えません」、client を読めなければ install を言う', async () => {
    const down = setup(() => ({ throws: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) }));
    expect(await thrown(() => pagePut(down.role, down.html, { kind: 'plan' }))).toMatch(/^置き場（http:\/\/127\.0\.0\.1:8801）が応えません。ページは置けていません/);
    const unreadable = setup(() => ({ status: 201, raw: 'not json' }));
    expect(await thrown(() => pagePut(unreadable.role, unreadable.html, { kind: 'plan' }))).toMatch(/^置き場（http:\/\/127\.0\.0\.1:8801）が応えません。/);
    const missing = setup();
    const unloadable = (): never => {
      throw new Error('Cannot find module \'@smithy/core\'');
    };
    const ctx: Context = { ...missing.role, clients: { ...missing.role.clients, pagetray: unloadable } };
    expect(await thrown(() => pagePut(ctx, missing.html, { kind: 'plan' }))).toMatch(/^生成した pagetray の client を読めません（.*）。cli\/ で pnpm install --frozen-lockfile を打ってください$/);
  });
});

describe('roster page list（ListPages）', () => {
  const pages = (project: string): Record<string, unknown>[] => [
    page(project, 't-x7k2', 'plan', '2', { askedAt: '2026-11-20T12:10:00.000Z', waitsOn: 'review', sender: { issuer: 'tpm.x', ref: `claude.session:${SID}`, actor: { id: '019abcde-0000-7000-8000-000000000001', name: 't-x7k2-swe.1', kind: 'ai' }, resolvedAt: '2026-11-20T12:00:02.000Z' } }),
    page(project, 't-x7k2', 'plan', '1', { workspace: '' }),
  ];

  test('旗を新しい引数に写し（--oldest は sort=createdAt・--limit は maxResults）、表は今と同じ形', async () => {
    const s = setup(r => r.path === '/api/pages' ? { status: 200, body: { pages: pages(s.project) } } : undefined);
    const out = await pageList(s.tpm, { key: 't-x7k2', kind: 'plan', role: 'software-engineer', workspace: 'file:1', q: '題', oldest: true, reply: 'waiting', on: 'review', limit: '5' });
    expect(s.seen.map(r => [r.method, r.path, r.query])).toEqual([['GET', '/api/pages', { maxResults: '5', project: s.project, key: 't-x7k2', role: 'software-engineer', workspace: 'file:1', kind: 'plan', q: '題', sort: 'createdAt', reply: 'waiting', on: 'review' }]]);
    expect(out).toEqual([['2026-11-20T12:00:02.000Z', 't-x7k2', 'plan-2', 'software-engineer', 'file:1', `${BASE}/${s.project}/t-x7k2/plan-2.html`, 'plan の題'].join('  ')]);
  });

  test('--json は今の記録の形（n は数・欄は snake_case・url を足す）', async () => {
    const s = setup(r => r.path === '/api/pages' ? { status: 200, body: { pages: pages(s.project) } } : undefined);
    const [text = ''] = await pageList(s.tpm, { json: true });
    expect(JSON.parse(text)).toEqual([
      { project: s.project, key: 't-x7k2', kind: 'plan', n: 2, title: 'plan の題', role: 'software-engineer', workspace: 'file:1', created_at: '2026-11-20T12:00:02.000Z', size: 10, path: `/${s.project}/t-x7k2/plan-2.html`, asked_at: '2026-11-20T12:10:00.000Z', waits_on: 'review', sender: { issuer: 'tpm.x', ref: `claude.session:${SID}`, actor: { id: '019abcde-0000-7000-8000-000000000001', name: 't-x7k2-swe.1', kind: 'ai' }, resolved_at: '2026-11-20T12:00:02.000Z' }, url: `${BASE}/${s.project}/t-x7k2/plan-2.html` },
      { project: s.project, key: 't-x7k2', kind: 'plan', n: 1, title: 'plan の題', role: 'software-engineer', workspace: '', created_at: '2026-11-20T12:00:01.000Z', size: 10, path: `/${s.project}/t-x7k2/plan-1.html`, url: `${BASE}/${s.project}/t-x7k2/plan-1.html` },
    ]);
    expect(s.seen[0]?.query).toEqual({ maxResults: '50', project: s.project });
  });

  test('--limit の数まで nextToken で辿る（1 頁は 1000 まで）', async () => {
    const s = setup((r) => {
      if (r.path !== '/api/pages') return undefined;
      return r.query.nextToken === undefined
        ? { status: 200, body: { pages: pages(s.project), nextToken: 'tok-1' } }
        : { status: 200, body: { pages: [page(s.project, 't-x7k2', 'brief', '1')], nextToken: 'tok-2' } };
    });
    const out = await pageList(s.tpm, { limit: '3' });
    expect(out).toHaveLength(3);
    expect(s.seen.map(r => [r.query.maxResults, r.query.nextToken])).toEqual([['3', undefined], ['1', 'tok-1']]);
  });

  test('置き場が止まっていれば、今と同じ 1 行で止まる', async () => {
    const s = setup(() => ({ throws: new Error('connect ECONNREFUSED') }));
    expect(await thrown(() => pageList(s.tpm, {}))).toBe('置き場（http://127.0.0.1:8801）が応えません。置き場を起こすよう roster ask devops で頼んでください');
  });
});

describe('roster page delete（ListPages と DeletePages）', () => {
  test('--key は ListPages（maxResults 1000）で消す物を見せ、--yes で DeletePages（project・key）。URL を名指せば kind と n（字）', async () => {
    const s = setup((r) => {
      if (r.method === 'GET' && r.path === '/api/pages') return { status: 200, body: { pages: [page(s.project, 't-x7k2', 'plan', '1')] } };
      if (r.method === 'DELETE' && r.path === '/api/pages') return { status: 200, body: { removed: [`/${s.project}/t-x7k2/plan-1.html`] } };
      if (r.method === 'GET' && r.path === '/api/files') return { status: 200, body: { files: [] } };
      return undefined;
    });
    // --key の時は、合う file も ListFiles で探す（無ければ消さない）。
    expect(await pageDelete(s.tpm, [], { key: 't-x7k2' })).toEqual(['消すページ（1 枚。戻せない）:', `${BASE}/${s.project}/t-x7k2/plan-1.html  plan の題`, '消すには、同じ命令に --yes を付けて打ってください']);
    expect(s.seen.map(r => [r.method, r.path, r.query])).toEqual([['GET', '/api/pages', { maxResults: '1000', project: s.project, key: 't-x7k2' }], ['GET', '/api/files', { maxResults: '1000', project: s.project, key: 't-x7k2' }]]);
    s.seen.length = 0;
    expect(await pageDelete(s.tpm, [`${BASE}/${s.project}/t-x7k2/plan-1.html`], { yes: true })).toEqual(['消した: 1 枚（控えも消した）', `- ${BASE}/${s.project}/t-x7k2/plan-1.html`]);
    expect(s.seen.map(r => [r.method, r.query])).toEqual([['GET', { maxResults: '1000', project: s.project, key: 't-x7k2' }], ['DELETE', { project: s.project, key: 't-x7k2', kind: 'plan', n: '1' }]]);
  });

  test('担当の居場所からは、置き場に聞かずに断る（今と同じ）', async () => {
    const s = setup();
    expect(await thrown(() => pageDelete(s.role, [], { key: 't-x7k2' }))).toMatch(/^ページを消せるのは TPM 担当だけです/);
    expect(s.seen).toEqual([]);
  });
});

describe('roster page import（CreatePage の n と createdAt）と roster page path（本文は今の URL）', () => {
  test('控えのページを、番号（字）と file の時刻（UTC）で置く。もうある番号（409）は本文を今の URL で取って比べる', async () => {
    const s = setup((r) => {
      if (r.query.n === '1') return { status: 409, type: 'Conflict', body: 'その番号はもう置いてある' };
      return created(r);
    });
    const folder = join(s.dir, s.project, 't-x7k2');
    const { mkdirSync, utimesSync } = await import('node:fs');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'plan-1.html'), HTML);
    writeFileSync(join(folder, 'plan-2.html'), HTML);
    utimesSync(join(folder, 'plan-2.html'), new Date('2026-11-20T21:00:00+09:00'), new Date('2026-11-20T21:00:00+09:00'));
    // plan-1 は今の置き場（偽の置き場）に同じ中身で置いてある（本文の URL は新しい API でも同じ）。
    s.w.store.pages.set(`/${s.project}/t-x7k2/plan-1.html`, { record: { ...page(s.project, 't-x7k2', 'plan', '1'), n: 1, created_at: '2026-11-20T12:00:01.000Z' } as never, body: Buffer.from(HTML) });
    const out = await pageImport(s.tpm);
    expect(out[0]).toMatch(/^入れた: 1 枚・もう入っていた: 1 枚・消したページ: 0 枚・ぶつかった: 0 枚/);
    const plan2 = s.seen.find(r => r.query.n === '2');
    expect(plan2?.query).toEqual({ role: 'unknown', workspace: '', n: '2', createdAt: '2026-11-20T12:00:00Z' });
  });

  test('roster page path は、控えに無ければ本文を今の URL（curl）で取る', async () => {
    const s = setup();
    s.w.store.pages.set(`/${s.project}/t-x7k2/plan-1.html`, { record: { n: 1 } as never, body: Buffer.from(HTML) });
    const [path = ''] = await pagePath(s.tpm, `${BASE}/${s.project}/t-x7k2/plan-1.html`);
    expect(readFileSync(path, 'utf8')).toBe(HTML);
    expect(s.seen).toEqual([]);
    expect(s.curls().at(-1)?.at(-1)).toBe(`${BASE}/${s.project}/t-x7k2/plan-1.html`);
  });
});

/** /healthz に新しい API の版で答える。 */
const health = (s: NextSeen): NextAnswer | undefined => s.path === '/healthz' ? { status: 200, body: { status: 'ok', version: '1.0.0-rc.1' } } : undefined;

/** 偽の置き場（今の道）への curl のうち、置き場の API（/api/…）を呼んだ物。next の時は無いはず（本文と file の中身の手の道だけが残る）。 */
const apiCurls = (s: { curls: () => string[][] }): string[] => s.curls().map(a => a.at(-1) ?? '').filter(u => u.includes('/api/'));

describe('置き場の版（storeAtLeast）', () => {
  test('api.pagetray が next なら /healthz（GetHealth）の version で見る。1 つの命令の中で 1 度だけ聞く', async () => {
    const s = setup();
    expect(await storeAtLeast(s.tpm, '0.8.0')).toBe('yes');
    expect(await storeAtLeast(s.tpm, '1.1.0')).toBe('old');
    expect(s.healths()).toBe(1);
    const down = setup(undefined, undefined, { throws: new Error('connect ECONNREFUSED') });
    expect(await storeAtLeast(down.tpm, '0.8.0')).toBe('down');
  });

  test('今の版の置き場の /healthz（字の ok で読めない 2xx）と version の無い答えは、応えないでなく古い（版を答えない置き場）', async () => {
    const text = setup(undefined, undefined, { status: 200, raw: 'ok' });
    expect(await storeAtLeast(text.tpm, '0.8.0')).toBe('old');
    const bare = setup(undefined, undefined, { status: 200, body: { status: 'ok' } });
    expect(await storeAtLeast(bare.tpm, '0.8.0')).toBe('old');
  });

  test('next の道は、1 つの命令で 1 度だけ版を見て、1.0.0 より前なら送らずに止める（api.pagetray を外すか置き場を替える）', async () => {
    const old = setup(created, undefined, { status: 200, body: { status: 'ok', version: '0.8.0' } });
    expect(await thrown(() => pagePut(old.role, old.html, { kind: 'plan' }))).toBe('置き場（http://127.0.0.1:8801）の版は 0.8.0 で、新しい API（1.0.0 から）を持ちません。設定の api.pagetray を外すか、置き場を新しい版に替えてください（置き場を替えるのは、roster ask devops で頼む）');
    expect(old.seen).toEqual([]);
    const text = setup(created, undefined, { status: 200, raw: 'ok' });
    expect(await thrown(() => pagePut(text.role, text.html, { kind: 'plan' }))).toMatch(/^置き場（http:\/\/127\.0\.0\.1:8801）の版は わからない で、新しい API（1\.0\.0 から）を持ちません。/);
    const fresh = setup(r => r.path === '/api/pages' ? { status: 200, body: { pages: [] } } : r.path === '/api/files' ? { status: 200, body: { files: [] } } : undefined);
    await pageDelete(fresh.tpm, [], { key: 't-x7k2' });
    expect(fresh.seen.length).toBe(2);
    expect(fresh.healths()).toBe(1);
  });

  test('設定が無ければ、今の道（/api/version）で聞く', async () => {
    const s = setup(undefined, {});
    expect(await storeAtLeast(s.tpm, '0.8.0')).toBe('yes');
    expect(apiCurls(s)).toEqual([`${BASE}/api/version`]);
    expect(s.made()).toBe(0);
  });
});

describe('返事の状態（SetReplyState）と返事待ちの一覧（ListPages）', () => {
  const url = (s: { project: string }): string => `${BASE}/${s.project}/t-x7k2/plan-1.html`;
  const replied = (s: NextSeen): NextAnswer | undefined => {
    if (s.method === 'PUT' && s.path.endsWith('/reply')) return { status: 200, body: page(String(/\/api\/projects\/([^/]+)\//.exec(s.path)?.[1]), 't-x7k2', 'plan', '1', { askedAt: '2026-11-20T12:10:00.000Z' }) };
    return health(s);
  };

  test('roster page reply --on review は、版を /healthz で見て、PUT …/pages/<番号>/reply に本文 {state, on} で送る。Product Manager の時は on を書かない', async () => {
    const s = setup(replied);
    expect(await pageReply(s.tpm, [url(s)], { waiting: true, on: 'review' })).toEqual([`レビュー待ちにした: ${url(s)}`]);
    expect(s.seen.map(r => [r.method, r.path, r.body])).toEqual([
      ['PUT', `/api/projects/${s.project}/keys/t-x7k2/kinds/plan/pages/1/reply`, { state: 'waiting', on: 'review' }],
    ]);
    s.seen.length = 0;
    expect(await pageReply(s.tpm, [url(s)], { answered: true })).toEqual([`答えたにした: ${url(s)}`]);
    expect(s.seen.map(r => r.body)).toEqual([{ state: 'answered' }]);
    expect(apiCurls(s)).toEqual([]);
  });

  test('ほかの相手を待っている（409 の Conflict）・無いページ（404 の NotFound）は、今と同じ訳', async () => {
    const conflict = setup(r => r.path.endsWith('/reply') ? { status: 409, type: 'Conflict', body: 'そのページは、on の相手の返事を待っていない' } : undefined);
    expect(await thrown(() => pageReply(conflict.tpm, [url(conflict)], { answered: true }))).toMatch(/^そのページは、--on pm の相手の返事を待っていません/);
    const missing = setup(r => r.path.endsWith('/reply') ? { status: 404, type: 'NotFound', body: 'そのページは無い' } : undefined);
    expect(await thrown(() => pageReply(missing.tpm, [url(missing)], { answered: true }))).toBe(`そのページは置き場にありません: ${url(missing)}`);
  });

  test('返事待ちの一覧は ListPages（reply=waiting・sort=createdAt・maxResults 1000）で聞く', async () => {
    const s = setup(r => r.path === '/api/pages' ? { status: 200, body: { pages: [page(s.project, 't-x7k2', 'confirm', '1', { askedAt: '2026-11-20T12:10:00.000Z' })] } } : undefined);
    expect(await waitingUrls(s.tpm, 't-x7k2')).toEqual([`${BASE}/${s.project}/t-x7k2/confirm-1.html`]);
    expect(s.seen[0]?.query).toEqual({ project: s.project, key: 't-x7k2', reply: 'waiting', sort: 'createdAt', maxResults: '1000' });
  });
});

describe('レビューの印（AddReviewMarks）', () => {
  const review = (s: { project: string }): string => `${BASE}/${s.project}/t-x7k2/review-1.html`;

  test('roster report review の判定は、POST …/pages/<番号>/review に本文 {verdict, targets} で書く', async () => {
    const s = setup(r => r.path.endsWith('/review') ? { status: 200, body: page(s.project, 't-x7k2', 'review', '1', { verdict: 'approve' }) } : health(r));
    expect(await markVerdict(s.tpm, review(s), 'approve', [])).toEqual([`置き場の印: 判定と見た物を書いた ${review(s)}`]);
    expect(s.seen.map(r => [r.method, r.path, r.body])).toEqual([
      ['POST', `/api/projects/${s.project}/keys/t-x7k2/kinds/review/pages/1/review`, { verdict: 'approve', targets: [] }],
    ]);
    expect(apiCurls(s)).toEqual([]);
  });

  test('置き場が断れば（400）、訳を 1 行にして止めない', async () => {
    const s = setup(r => r.path.endsWith('/review') ? { status: 400, type: 'ValidationException', body: '種類が review のページだけ' } : health(r));
    expect(await markVerdict(s.tpm, review(s), 'approve', [])).toEqual(['置き場の印: 判定と見た物を書いていない（置き場が断った: 400 種類が review のページだけ）']);
  });
});

describe('file（CreateFile・ListFiles・DeleteFiles）', () => {
  const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('png')]);
  /** file の記録（新しい API の形）。 */
  const fileRecord = (project: string, n = '1'): Record<string, unknown> => ({ project, key: 't-x7k2', name: 'shot', ext: 'png', n, type: 'image/png', size: PNG.length, sha256: 'ab'.repeat(32), role: 'software-engineer', workspace: 'file:1', createdAt: '2026-11-20T12:00:00.000Z', path: `/${project}/t-x7k2/files/shot-${n}.png` });
  const shot = (s: { dir: string }): string => {
    const file = join(s.dir, '..', `${basename(s.dir)}-shot.png`);
    writeFileSync(file, PNG);
    return file;
  };

  test('roster file put は、道に project と Key、引数に名・役割・居場所、Content-Type は拡張子の表のまま、本文は file の byte', async () => {
    const s = setup(r => r.method === 'POST' && r.path.endsWith('/files') ? { status: 201, body: { ...fileRecord(s.project), url: `${BASE}/${s.project}/t-x7k2/files/shot-1.png` } } : undefined);
    const path = join(s.dir, s.project, 't-x7k2', 'files', 'shot-1.png');
    expect(await filePut(s.role, shot(s), { reviewed: true, name: 'shot.png' })).toEqual([`置いた: ${path}`, `URL: ${BASE}/${s.project}/t-x7k2/files/shot-1.png`, 'ページからの参照: files/shot-1.png']);
    expect(s.seen.map(r => [r.method, r.path, r.query, r.headers['content-type']])).toEqual([['POST', `/api/projects/${s.project}/keys/t-x7k2/files`, { name: 'shot.png', role: 'software-engineer', workspace: 'file:1' }, 'image/png']]);
    expect(Buffer.from(s.seen[0]?.text ?? '', 'binary').length).toBeGreaterThan(0);
    expect(readFileSync(path).equals(PNG)).toBe(true);
    expect(apiCurls(s)).toEqual([]);
  });

  test('送り手が castlist に無い（400 の fieldList に /actorRef）は、今の 422 と同じ訳', async () => {
    const s = setup(() => ({ status: 400, type: 'ValidationException', body: 'castlist に登録の無い送り手', fieldList: [{ path: '/actorRef', message: '登録の無い送り手' }] }), { api: { pagetray: 'next' }, castlist: 'http://127.0.0.1:1' });
    const ctx: Context = { ...s.role, env: { ...s.role.env, CLAUDE_CODE_SESSION_ID: SID } };
    expect(await thrown(() => filePut(ctx, shot(s), { reviewed: true }))).toMatch(/castlist に登録が無いと、置き場が答えました（400）。file は上げていません/);
  });

  test('roster file list は ListFiles（--limit は maxResults）。表と --json は今と同じ形（n と size は数）', async () => {
    const s = setup(r => r.path === '/api/files' ? { status: 200, body: { files: [fileRecord(s.project)] } } : undefined);
    expect(await fileList(s.tpm, { key: 't-x7k2' })).toEqual([['2026-11-20T12:00:00.000Z', 't-x7k2', 'shot-1.png', 'software-engineer', 'file:1', `${BASE}/${s.project}/t-x7k2/files/shot-1.png`, `${PNG.length} byte`].join('  ')]);
    expect(s.seen[0]?.query).toEqual({ maxResults: '50', project: s.project, key: 't-x7k2' });
    const [text = ''] = await fileList(s.tpm, { json: true });
    expect(JSON.parse(text)).toEqual([{ project: s.project, key: 't-x7k2', name: 'shot', ext: 'png', n: 1, type: 'image/png', size: PNG.length, sha256: 'ab'.repeat(32), role: 'software-engineer', workspace: 'file:1', created_at: '2026-11-20T12:00:00.000Z', path: `/${s.project}/t-x7k2/files/shot-1.png`, url: `${BASE}/${s.project}/t-x7k2/files/shot-1.png` }]);
  });

  test('roster file delete は ListFiles で探し、参照するページを ListPages で見せ、--yes で DeleteFiles（name と n は字）', async () => {
    const s = setup((r) => {
      if (r.path === '/api/files' && r.method === 'GET') return { status: 200, body: { files: [fileRecord(s.project)] } };
      if (r.path === '/api/pages') return { status: 200, body: { pages: [] } };
      if (r.path === '/api/files' && r.method === 'DELETE') return { status: 200, body: { removed: [`/${s.project}/t-x7k2/files/shot-1.png`] } };
      return undefined;
    });
    const target = `${BASE}/${s.project}/t-x7k2/files/shot-1.png`;
    expect((await fileDelete(s.tpm, [target], {})).at(-2)).toBe('参照しているページは無い');
    expect(s.seen.map(r => [r.method, r.path, r.query])).toEqual([
      ['GET', '/api/files', { project: s.project, key: 't-x7k2', q: 'shot.png', maxResults: '1000' }],
      ['GET', '/api/pages', { project: s.project, maxResults: '1000' }],
    ]);
    s.seen.length = 0;
    expect(await fileDelete(s.tpm, [target], { yes: true })).toEqual(['消した: 1 個（控えも消した）', `- ${target}`]);
    expect(s.seen.at(-1)?.query).toEqual({ project: s.project, key: 't-x7k2', name: 'shot.png', n: '1' });
    expect(apiCurls(s)).toEqual([]);
  });

  test('roster file path は、中身を今の URL（curl。手の道）で取る。置き場に無ければ（404）、版の古さを ListFiles で見分ける', async () => {
    const s = setup(r => r.path === '/api/files' ? { status: 200, body: { files: [] } } : undefined);
    s.w.store.files.set(`/${s.project}/t-x7k2/files/shot-1.png`, { record: { n: 1 } as never, body: PNG });
    const [path = ''] = await filePath(s.tpm, `${BASE}/${s.project}/t-x7k2/files/shot-1.png`);
    expect(readFileSync(path).equals(PNG)).toBe(true);
    expect(s.seen).toEqual([]);
    expect(await thrown(() => filePath(s.tpm, `${BASE}/${s.project}/t-x7k2/files/gone-1.png`))).toMatch(/^置き場に file がありません（404）/);
    expect(s.seen.map(r => [r.path, r.query])).toEqual([['/api/files', { maxResults: '1' }]]);
    expect(apiCurls(s)).toEqual([]);
  });

  test('roster page import は、控えの file も CreateFile に番号（字）と file の時刻（UTC）で入れる', async () => {
    const s = setup(r => r.method === 'POST' && r.path.endsWith('/files') ? { status: 201, body: { ...fileRecord(s.project), url: '' } } : undefined);
    const files = join(s.dir, s.project, 't-x7k2', 'files');
    mkdirSync(files, { recursive: true });
    writeFileSync(join(files, 'shot-1.png'), PNG);
    const out = await pageImport(s.tpm);
    expect(out).toContain('file: 入れた: 1 個・もう入っていた: 0 個・消した file: 0 個・ぶつかった: 0 個');
    expect(s.seen[0]?.query).toMatchObject({ name: 'shot.png', role: 'unknown', workspace: '', n: '1' });
    expect(typeof s.seen[0]?.query.createdAt).toBe('string');
  });
});

describe('設定が無い時', () => {
  test('api の欄が無ければ、ページの道も今の道（curl）で、生成した client を作らない', async () => {
    const s = setup(undefined, {});
    await pagePut(s.role, s.html, { kind: 'plan' });
    await pageList(s.tpm, {});
    expect(s.made()).toBe(0);
    expect(s.curls().length).toBe(2);
  });
});
