// 偽の castlist: 127.0.0.1 の空いた port で待つ node の http サーバー。tpm が curl で送る要求を記録し、本物（castlist の docs/src/api.md）の決まりの要る所だけで答える。
// tpm の命令は同期（spawnSync で curl を待つ）なので、同じ thread のサーバーは答えられない。サーバーは worker の thread で動かす。
// 記録は worker が file に 1 行ずつ足し、試験はそれを読む。castlist の時刻（/healthz の now）は、試験が書く file を worker が要求ごとに読む。
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

/** 偽の castlist が受けた要求 1 件。 */
export interface CastlistRequest {
  method: string
  path: string
  host: string
  origin: string | undefined
  body: Record<string, unknown> | undefined
  status: number
}

const SERVER = `
const { appendFileSync, readFileSync } = require('node:fs');
const { createServer } = require('node:http');
const { workerData, parentPort } = require('node:worker_threads');
const { log, control } = workerData;
const actors = new Map();
const keys = new Map();
const counts = new Map();
const puts = new Map();
const refOk = (issuer, ref) => typeof ref === 'string' && keys.has(issuer + ' ' + ref);
const server = createServer((req, res) => {
  let data = '';
  req.on('data', c => { data += c; });
  req.on('end', () => {
    const now = JSON.parse(readFileSync(control, 'utf8')).now;
    let body;
    try { body = data === '' ? undefined : JSON.parse(data); } catch { body = { unreadable: data }; }
    const answer = (status, value) => {
      appendFileSync(log, JSON.stringify({ method: req.method, path: req.url, host: req.headers.host, origin: req.headers.origin, body, status }) + '\\n');
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/healthz') return answer(200, { status: 'ok', version: '0.1.0', now });
    if (req.method === 'POST' && url.pathname === '/v1/actors') {
      const b = body ?? {};
      if (!/^[a-z0-9.-]{1,64}$/.test(b.issuer ?? '') || !/^[a-z0-9-]{1,32}$/.test(b.name_prefix ?? '') || !['ai', 'human'].includes(b.kind) || !Array.isArray(b.bindings) || b.bindings.length === 0) return answer(422, { error: '形が違う' });
      const key = b.issuer + ' ' + b.bindings[0].type + ':' + b.bindings[0].value;
      const had = keys.get(key);
      if (had !== undefined) return answer(200, { ...actors.get(had), created: false });
      const n = (counts.get(b.issuer + ' ' + b.name_prefix) ?? 0) + 1;
      counts.set(b.issuer + ' ' + b.name_prefix, n);
      const id = 'act-' + (actors.size + 1);
      actors.set(id, { id, name: b.name_prefix + '.' + n, kind: b.kind });
      keys.set(key, id);
      return answer(201, { id, name: b.name_prefix + '.' + n, kind: b.kind, created: true });
    }
    const put = /^\\/v1\\/(events|links|settings)\\/(.+)$/.exec(url.pathname);
    if (req.method === 'PUT' && put) {
      const b = body ?? {};
      const refs = put[1] === 'links' ? [b.from, b.to] : [b.by];
      if (!refs.every(r => refOk(b.issuer, r))) return answer(422, { error: '指すアクターを知らない' });
      const id = put[1] + ' ' + put[2];
      const had = puts.get(id);
      if (had !== undefined) return answer(had === data ? 200 : 409, { id: put[2] });
      puts.set(id, data);
      return answer(201, { id: put[2] });
    }
    return answer(404, { error: '無い' });
  });
});
server.listen(0, '127.0.0.1', () => parentPort.postMessage(server.address().port));
`;

/** 偽の castlist。 */
export interface FakeCastlist {
  url: string
  /** 受けた要求（受けた順）。/healthz も入る。 */
  requests: () => CastlistRequest[]
  /** /healthz が返す castlist の時刻。 */
  setNow: (iso: string) => void
  stop: () => Promise<number>
}

/** 偽の castlist を起こす。now は /healthz が返す時刻（既定は world の時計の時刻）。 */
export async function startFakeCastlist(now = '2026-11-20T12:00:00.000Z'): Promise<FakeCastlist> {
  const dir = mkdtempSync(join(tmpdir(), 'tpm-castlist-'));
  const log = join(dir, 'requests.jsonl');
  const control = join(dir, 'control.json');
  writeFileSync(log, '');
  writeFileSync(control, JSON.stringify({ now }));
  const worker = new Worker(SERVER, { eval: true, workerData: { log, control } });
  const port = await new Promise<number>((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
  });
  return {
    url: `http://127.0.0.1:${port}`,
    // JSON の記録は undefined の欄を落とすので、Origin の無い要求も origin の欄を持つように戻す。
    requests: () => readFileSync(log, 'utf8').split('\n').filter(l => l !== '').map(l => ({ origin: undefined, ...JSON.parse(l) as Omit<CastlistRequest, 'origin'> })),
    setNow: (iso) => {
      writeFileSync(control, JSON.stringify({ now: iso }));
    },
    stop: () => worker.terminate(),
  };
}

/** 何も待っていない 127.0.0.1 の URL（castlist が止まっている）。空いた port を 1 度取って閉じる。 */
export async function deadUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}
