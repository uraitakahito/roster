// 生成した client（cli/gen/castlist-client/・cli/gen/pagetray-client/。cli/gen/gen.sh が作る）が、ESM の roster から読めて、答えを読めるか（AI-36）。
// roster はまだ使わない（使う所は段 6c）。build した JS（dist-cjs/）を createRequire で読み、型は dist-types/ から取る（pnpm run typecheck が見る）。
// 試験の server は 127.0.0.1 の空いた port の node の http サーバーで、決まりの形（restJson1）で答える。本物の castlist・pagetray には触らない。
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, test } from 'vitest';
import type * as Castlist from '../gen/castlist-client/dist-types/index.js';
import type * as Pagetray from '../gen/pagetray-client/dist-types/index.js';

const load = createRequire(import.meta.url);

/** 受けた要求 1 件。 */
interface Seen {
  line: string
  contentType: string | undefined
  body: string
}

/** 試験の server を起こし、URL と受けた要求の記録を返す。止めるのは afterAll。 */
async function serve(answer: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ url: string, seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      seen.push({ line: `${req.method} ${req.url}`, contentType: req.headers['content-type'], body: Buffer.concat(chunks).toString() });
      answer(req, res);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  afterAll(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, seen };
}

/** JSON で答える。 */
function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

describe('castlist の client', async () => {
  const { CastlistClient, GetActorCommand, GetHealthCommand, NotFound } = load('../gen/castlist-client/dist-cjs/index.js') as typeof Castlist;
  const ACTOR = '019ab000-0000-7000-8000-000000000001';
  const { url, seen } = await serve((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') return json(res, 200, { status: 'ok', version: '1.0.0', now: '2026-11-24T00:00:00Z' });
    json(res, 404, { message: 'そのアクターは無い' }, { 'x-amzn-errortype': 'NotFound' });
  });
  const client = new CastlistClient({ endpoint: url, maxAttempts: 1 });
  afterAll(() => client.destroy());

  test('GetHealth の答えを読み、時刻は Date になる', async () => {
    const out = await client.send(new GetHealthCommand({}));
    expect(out.status).toBe('ok');
    expect(out.version).toBe('1.0.0');
    expect(out.now).toEqual(new Date('2026-11-24T00:00:00Z'));
    expect(seen.at(-1)?.line).toBe('GET /healthz');
  });

  test('決まりの誤り（404 の NotFound）は、生成した誤りの型で届く', async () => {
    const error: unknown = await client.send(new GetActorCommand({ actorId: ACTOR })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFound);
    expect((error as Castlist.NotFound).message).toBe('そのアクターは無い');
    expect(seen.at(-1)?.line).toBe(`GET /api/actors/${ACTOR}`);
  });
});

describe('pagetray の client', async () => {
  const { Conflict, CreatePageCommand, GetHealthCommand, PagetrayClient } = load('../gen/pagetray-client/dist-cjs/index.js') as typeof Pagetray;
  const { url, seen } = await serve((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') return json(res, 200, { status: 'ok', version: '1.0.0' });
    json(res, 409, { message: 'その番号はもう置いてある' }, { 'x-amzn-errortype': 'Conflict' });
  });
  const client = new PagetrayClient({ endpoint: url, maxAttempts: 1 });
  afterAll(() => client.destroy());

  test('GetHealth の答えを読む', async () => {
    const out = await client.send(new GetHealthCommand({}));
    expect(out.status).toBe('ok');
    expect(out.version).toBe('1.0.0');
    expect(seen.at(-1)?.line).toBe('GET /healthz');
  });

  test('CreatePage は道・引数・HTML の本文で送り、決まりの誤り（409 の Conflict）は生成した誤りの型で届く', async () => {
    const body = new TextEncoder().encode('<title>計画</title><p>本文</p>');
    const error: unknown = await client.send(new CreatePageCommand({ project: 'ai', key: 'AI-36', kind: 'plan', role: 'tpm', n: '1', body })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Conflict);
    expect((error as Pagetray.Conflict).message).toBe('その番号はもう置いてある');
    expect(seen.at(-1)).toEqual({ line: 'POST /api/projects/ai/keys/AI-36/kinds/plan/pages?role=tpm&n=1', contentType: 'text/html', body: '<title>計画</title><p>本文</p>' });
  });
});
