// 生成した castlist の client（cli/gen/castlist-client/。cli/gen/gen.sh が作る）が、ESM の roster から読めて、答えを読めるか（AI-36）。
// roster はまだ使わない（使う所は段 6c）。build した JS（dist-cjs/）を createRequire で読み、型は dist-types/ から取る（pnpm run typecheck が見る）。
// 試験の server は 127.0.0.1 の空いた port の node の http サーバーで、決まりの形（restJson1）で答える。本物の castlist には触らない。
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, test } from 'vitest';
import type * as Castlist from '../gen/castlist-client/dist-types/index.js';

const { CastlistClient, GetActorCommand, GetHealthCommand, NotFound } = createRequire(import.meta.url)('../gen/castlist-client/dist-cjs/index.js') as typeof Castlist;

const ACTOR = '019ab000-0000-7000-8000-000000000001';
let server: Server;
let client: Castlist.CastlistClient;
const seen: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '1.0.0', now: '2026-11-24T00:00:00Z' }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json', 'x-amzn-errortype': 'NotFound' });
    res.end(JSON.stringify({ message: 'そのアクターは無い' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  client = new CastlistClient({ endpoint: `http://127.0.0.1:${port}`, maxAttempts: 1 });
});

afterAll(async () => {
  client.destroy();
  await new Promise(resolve => server.close(resolve));
});

test('GetHealth の答えを読み、時刻は Date になる', async () => {
  const out = await client.send(new GetHealthCommand({}));
  expect(out.status).toBe('ok');
  expect(out.version).toBe('1.0.0');
  expect(out.now).toEqual(new Date('2026-11-24T00:00:00Z'));
  expect(seen.at(-1)).toBe('GET /healthz');
});

test('決まりの誤り（404 の NotFound）は、生成した誤りの型で届く', async () => {
  const error: unknown = await client.send(new GetActorCommand({ actorId: ACTOR })).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(NotFound);
  expect((error as Castlist.NotFound).message).toBe('そのアクターは無い');
  expect(seen.at(-1)).toBe(`GET /api/actors/${ACTOR}`);
});
