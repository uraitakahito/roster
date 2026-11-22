// 偽の castlist: 127.0.0.1 の空いた port で待つ node の http サーバー。tpm が curl で送る要求を記録し、本物（castlist の docs/src/api.md）の決まりの要る所だけで答える。
// tpm の命令は同期（spawnSync で curl を待つ）なので、同じ thread のサーバーは答えられない。サーバーは worker の thread で動かす。
// 記録は worker が file に 1 行ずつ足し、試験はそれを読む。castlist の時刻（/healthz の now と、書いた物の received_at）は、試験が書く file を worker が要求ごとに読む。
// 書く 4 つの道は、送り手の時刻を 0.2.0 の名 sent_at で受け、前の名 at は断る（本物は移る間 at も受ける）。
// 監査の検索（GET /v1/actors など）も、引数の名・1 つだけの引数の重なり・読めない時刻・limit の範囲を本物と同じ字で断る。頁の印（next）は本物と違う字（中は読まない決まりなので）。
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
const bindings = [];
const events = [];
const links = [];
const settings = [];
let seq = 0;
const ENTER = ['entered', 'reentered', 'forked'];
const EXIT = ['cleared', 'exited', 'closed'];
const EVENT_TYPES = ['entered', 'reentered', 'forked', 'compacted', 'cleared', 'exited', 'closed', 'reported_in', 'model_unreadable', 'retracted'];
const ACTOR_PARAMS = ['label', 'binding', 'at', 'active_from', 'active_to', 'kind', 'model', 'effort', 'active', 'launched_by', 'skewed', 'sort', 'order', 'limit', 'after'];
// 送り手の時刻は sent_at（castlist 0.2.0）。本物は移る間 0.1.x の名 at も受けるが、偽物は断る（tpm が前の名に戻ったら試験で分かるように）。
const OLD_AT = 'at は 0.1.x の名。送り手の時刻は sent_at で送る（偽の castlist は前の名を受けない）';
const refOk = (issuer, ref) => typeof ref === 'string' && keys.has(issuer + ' ' + ref);
const bad = (error) => { throw { status: 400, error }; };
const without = (row, ...names) => Object.fromEntries(Object.entries(row).filter(([k]) => !names.includes(k)));

/** 問い合わせの引数（本物の search.rs の Params と同じ断り方）。 */
function params(url, known, repeatable) {
  const pairs = [...url.searchParams.entries()];
  pairs.forEach(([n], i) => {
    if (!known.includes(n)) bad('知らない引数: ' + n + '（使えるのは ' + known.join('・') + '）');
    if (!repeatable.includes(n) && pairs.slice(0, i).some(([m]) => m === n)) bad(n + ' は 1 つだけ付ける');
  });
  const one = (n) => url.searchParams.get(n) ?? undefined;
  const p = {
    one,
    all: (n) => url.searchParams.getAll(n),
    time: (n) => {
      const v = one(n);
      if (v === undefined) return undefined;
      const t = Date.parse(v);
      if (Number.isNaN(t)) bad(n + ' は RFC 3339 の時刻（例 2026-11-22T13:00:00+09:00）');
      return t;
    },
    choice: (n, choices) => {
      const v = one(n);
      if (v !== undefined && !choices.includes(v)) bad(n + ' は ' + choices.join('・') + ' のどれか');
      return v;
    },
    onlyTrue: (n) => {
      const v = one(n);
      if (v !== undefined && v !== 'true') bad(n + ' は true だけ（絞らないなら付けない）');
      return v === 'true';
    },
    page: (rows, what) => {
      const v = one('limit');
      const limit = v === undefined ? 100 : Number(v);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) bad('limit は 1 から 1000 までの数');
      const a = one('after');
      const parts = a === undefined ? [what, '0'] : a.split('.');
      if (parts.length !== 2 || parts[0] !== what || !/^[0-9]+$/.test(parts[1])) bad('after が読めない（前の答えの next を、そのまま渡す）');
      const from = Number(parts[1]);
      return { rows: rows.slice(from, from + limit), next: from + limit < rows.length ? what + '.' + (from + limit) : null };
    },
  };
  return p;
}

/** 鍵:値・種類:値 を初めの : で分ける。 */
function pair(name, v, shape) {
  const i = v.indexOf(':');
  if (i <= 0 || i === v.length - 1) bad(name + ' は「' + shape + '」の形（' + v + '）');
  return [v.slice(0, i), v.slice(i + 1)];
}

/** 居る・居ないの出来事から、初めの登場・最後の退場・今居るか。 */
function presence(id) {
  const evs = events.filter(e => e.actor_id === id && (ENTER.includes(e.type) || EXIT.includes(e.type)));
  const first = evs.find(e => ENTER.includes(e.type));
  const exit = evs.filter(e => EXIT.includes(e.type)).at(-1);
  const latest = evs.at(-1);
  // 推しの幕引き: 今の状態を決めた出来事が closed で、detail.inferred が true（castlist 0.4.0）。
  const inferred = latest?.type === 'closed' && latest.detail?.inferred === true;
  return { first, exit, latest, present: latest !== undefined && ENTER.includes(latest.type), inferred };
}

const current = (id) => settings.filter(s => s.actor_id === id).at(-1);
const settingRow = (s) => ({ ...without(s, 'seq'), actor_name: actors.get(s.actor_id).name });
const eventRow = (e) => ({ ...without(e, 'seq'), actor_name: actors.get(e.actor_id).name });

/** アクターの一覧の 1 行。 */
function item(a) {
  const pr = presence(a.id);
  const cur = current(a.id);
  return {
    ...without(a, 'seq', 'labels'), labels: a.labels,
    first_entered_at: pr.first?.received_at ?? null,
    last_exited_at: pr.exit?.received_at ?? null, last_exit_type: pr.exit?.type ?? null,
    present: pr.present, inferred: pr.inferred,
    model: cur?.model ?? null, effort: cur?.effort ?? null,
    url: '/actors/' + a.id,
  };
}

/** 1 つのアクターの全部。 */
function detail(a, asOf) {
  const pr = presence(a.id);
  const bs = bindings.filter(b => b.actor_id === a.id);
  const types = [...new Set(bs.map(b => b.type))].sort();
  const cur = current(a.id);
  return {
    ...without(a, 'seq', 'labels'), labels: a.labels,
    bindings: bs.map(b => without(b, 'seq', 'actor_id')),
    current_bindings: types.map(t => without(bs.filter(b => b.type === t).at(-1), 'seq', 'actor_id')),
    events: events.filter(e => e.actor_id === a.id).map(e => without(e, 'seq')),
    settings: settings.filter(s => s.actor_id === a.id).map(s => without(s, 'seq')),
    current_settings: cur === undefined ? null : { model: cur.model, effort: cur.effort, source: cur.source, sent_at: cur.sent_at, received_at: cur.received_at },
    links_in: links.filter(l => l.to === a.id).map(l => without(l, 'seq')),
    links_out: links.filter(l => l.from === a.id).map(l => without(l, 'seq')),
    state: { presence: pr.latest?.type ?? null, present: pr.present, inferred: pr.inferred, entered_at: pr.first?.received_at ?? null, exited_at: pr.exit?.received_at ?? null },
    as_of: asOf,
  };
}

function searchActors(url, now) {
  const p = params(url, ACTOR_PARAMS, ['label']);
  const labels = p.all('label').map(v => pair('label', v, '鍵:値'));
  const binding = p.one('binding') === undefined ? undefined : pair('binding', p.one('binding'), '種類:値');
  const at = p.time('at');
  if (at !== undefined && binding === undefined) bad('at は binding と一緒に付ける（居た間で探すなら active_from・active_to）');
  const from = p.time('active_from');
  const to = p.time('active_to');
  const kind = p.choice('kind', ['ai', 'human']);
  const active = p.one('active');
  if (active !== undefined && active !== 'true' && active !== 'false') bad('active は true か false');
  const model = p.one('model');
  const effort = p.one('effort');
  const launchedBy = p.one('launched_by');
  const skewed = p.onlyTrue('skewed');
  const sort = p.choice('sort', ['entered', 'exited']) ?? 'entered';
  const order = p.choice('order', ['asc', 'desc']) ?? 'asc';
  if (!(labels.length > 0 || binding || from !== undefined || to !== undefined || active === 'true' || model || effort || launchedBy || skewed)) {
    bad('絞る条件を 1 つ以上付ける（label・binding・active_from・active_to・active=true・model・effort・launched_by・skewed のどれか）');
  }
  let rows = [...actors.values()];
  if (binding !== undefined) {
    const t = at ?? Date.parse(now);
    const hit = bindings.filter(b => b.type === binding[0] && b.value === binding[1] && Date.parse(b.received_at) <= t).at(-1);
    rows = rows.filter(a => a.id === hit?.actor_id);
  }
  rows = rows.filter(a => labels.every(([k, v]) => a.labels[k] === v));
  if (from !== undefined || to !== undefined) {
    rows = rows.filter((a) => {
      const pr = presence(a.id);
      if (pr.first === undefined) return false;
      const start = Date.parse(pr.first.received_at);
      const end = pr.present ? Infinity : Date.parse(pr.exit.received_at);
      return (to === undefined || start <= to) && (from === undefined || end >= from);
    });
  }
  if (kind !== undefined) rows = rows.filter(a => a.kind === kind);
  if (active !== undefined) rows = rows.filter(a => presence(a.id).present === (active === 'true'));
  if (model !== undefined) rows = rows.filter(a => settings.some(s => s.actor_id === a.id && s.model === model));
  if (effort !== undefined) rows = rows.filter(a => settings.some(s => s.actor_id === a.id && s.effort === effort));
  if (launchedBy !== undefined) rows = rows.filter(a => links.some(l => l.type === 'launched' && l.from === launchedBy && l.to === a.id));
  if (skewed) rows = [];
  const items = rows.map(item);
  const field = sort === 'entered' ? 'first_entered_at' : 'last_exited_at';
  const sign = order === 'asc' ? 1 : -1;
  items.sort((a, b) => (a[field] === b[field] ? 0 : a[field] === null ? -1 : b[field] === null ? 1 : a[field] < b[field] ? -1 : 1) * sign);
  const page = p.page(items, 'actors');
  return { as_of: now, actors: page.rows, next: page.next };
}

function lineage(id, url, now) {
  const p = params(url, ['direction', 'depth', 'type'], []);
  const direction = p.choice('direction', ['up', 'down', 'both']) ?? 'both';
  const d = p.one('depth');
  const depth = d === undefined ? undefined : Number(d);
  if (depth !== undefined && (!Number.isInteger(depth) || depth < 1 || depth > 20)) bad('depth は 1 から 20 までの数');
  const type = p.choice('type', ['launched', 'continued']);
  const up = direction === 'down' ? 0 : depth ?? 20;
  const down = direction === 'up' ? 0 : depth ?? 1;
  const seen = new Set([id]);
  const order = [id];
  const edges = new Map();
  for (const [steps, upward] of [[up, true], [down, false]]) {
    let frontier = [id];
    for (let i = 0; i < steps && frontier.length > 0; i++) {
      const next = [];
      for (const node of frontier) {
        if (upward && actors.get(node).kind === 'human') continue;
        for (const l of links.filter(l => (upward ? l.to : l.from) === node && (type === undefined || l.type === type))) {
          const end = upward ? l.from : l.to;
          if (!seen.has(end)) {
            seen.add(end);
            order.push(end);
            next.push(end);
          }
          edges.set(l.seq, l);
        }
      }
      frontier = next;
    }
  }
  return { as_of: now, actor_id: id, nodes: order.map(n => item(actors.get(n))), edges: [...edges.values()].sort((a, b) => a.seq - b.seq).map(l => without(l, 'seq')) };
}

function actorSettings(id, url, now) {
  const p = params(url, ['at'], []);
  const at = p.time('at');
  const rows = settings.filter(s => s.actor_id === id);
  if (at === undefined) return { as_of: now, actor_id: id, settings: rows.map(settingRow) };
  const hit = rows.filter(s => Date.parse(s.received_at) <= at).at(-1);
  return { as_of: now, actor_id: id, at: new Date(at).toISOString(), setting: hit === undefined ? null : settingRow(hit) };
}

function searchSettings(url, now) {
  const p = params(url, ['model', 'effort', 'source', 'from', 'to', 'mismatch', 'skewed', 'limit', 'after'], []);
  const model = p.one('model');
  const effort = p.one('effort');
  const source = p.choice('source', ['requested', 'observed']);
  const from = p.time('from');
  const to = p.time('to');
  const mismatch = p.onlyTrue('mismatch');
  const skewed = p.onlyTrue('skewed');
  const rows = settings.filter((s) => {
    if (model !== undefined && s.model !== model) return false;
    if (effort !== undefined && s.effort !== effort) return false;
    if (source !== undefined && s.source !== source) return false;
    if (from !== undefined && Date.parse(s.received_at) < from) return false;
    if (to !== undefined && Date.parse(s.received_at) > to) return false;
    if (skewed) return false;
    if (mismatch) {
      if (s.source !== 'observed') return false;
      const asked = settings.filter(r => r.actor_id === s.actor_id && r.source === 'requested' && r.seq < s.seq).at(-1);
      return asked !== undefined && (asked.model !== s.model || asked.effort !== s.effort);
    }
    return true;
  });
  const page = p.page(rows.map(settingRow), 'settings');
  return { as_of: now, settings: page.rows, next: page.next };
}

function searchEvents(url, now) {
  const p = params(url, ['type', 'actor', 'from', 'to', 'reason', 'source', 'skewed', 'limit', 'after'], ['type']);
  const types = p.all('type');
  for (const t of types) if (!EVENT_TYPES.includes(t)) bad('type は ' + EVENT_TYPES.join('・') + ' のどれか（' + t + '）');
  const actor = p.one('actor');
  const from = p.time('from');
  const to = p.time('to');
  const reason = p.one('reason');
  const source = p.one('source');
  const skewed = p.onlyTrue('skewed');
  const rows = events.filter(e => (types.length === 0 || types.includes(e.type)) && (actor === undefined || e.actor_id === actor)
    && (from === undefined || Date.parse(e.received_at) >= from) && (to === undefined || Date.parse(e.received_at) <= to)
    && (reason === undefined || e.detail.reason === reason) && (source === undefined || e.detail.source === source) && !skewed);
  const page = p.page(rows.map(eventRow), 'events');
  return { as_of: now, events: page.rows, next: page.next };
}

/** 付随する id を足す（鍵でない物は、同じ種類の最新と違う時だけ）。 */
function bind(id, issuer, list, sentAt, now, fresh) {
  list.forEach((b, i) => {
    if (!fresh && i === 0) return;
    const latest = bindings.filter(x => x.actor_id === id && x.type === b.type).at(-1);
    if (!fresh && latest !== undefined && latest.value === b.value) return;
    bindings.push({ seq: ++seq, actor_id: id, issuer, type: b.type, value: b.value, is_key: fresh && i === 0, sent_at: sentAt, received_at: now });
  });
}

/** 頼んだ model と effort（最新と違う時だけ足す）。 */
function ask(id, wanted, sentAt, now) {
  if (wanted === undefined) return;
  const cur = current(id);
  if (cur !== undefined && cur.model === wanted.model && cur.effort === wanted.effort) return;
  settings.push({ seq: ++seq, id: null, actor_id: id, model: wanted.model, effort: wanted.effort, source: 'requested', sent_at: sentAt, received_at: now, clock_skew: false });
}

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
    const parts = url.pathname.split('/').map(decodeURIComponent);
    try {
      if (req.method === 'GET' && url.pathname === '/healthz') return answer(200, { status: 'ok', version: '0.4.0', now });
      if (req.method === 'GET' && url.pathname === '/v1/actors') return answer(200, searchActors(url, now));
      if (req.method === 'GET' && url.pathname === '/v1/settings') return answer(200, searchSettings(url, now));
      if (req.method === 'GET' && url.pathname === '/v1/events') return answer(200, searchEvents(url, now));
      if (req.method === 'GET' && parts[1] === 'v1' && parts[2] === 'actors' && parts.length >= 4 && parts.length <= 5) {
        const a = actors.get(parts[3]);
        if (a === undefined) return answer(404, { error: 'そのアクターは無い' });
        if (parts.length === 4) {
          params(url, [], []);
          return answer(200, detail(a, now));
        }
        if (parts[4] === 'lineage') return answer(200, lineage(a.id, url, now));
        if (parts[4] === 'settings') return answer(200, actorSettings(a.id, url, now));
      }
    }
    catch (e) {
      if (e && e.status === 400) return answer(400, { error: e.error });
      throw e;
    }
    if (['POST', 'PUT'].includes(req.method) && (body ?? {}).at !== undefined) return answer(422, { error: OLD_AT });
    if (req.method === 'POST' && url.pathname === '/v1/actors') {
      const b = body ?? {};
      if (!/^[a-z0-9.-]{1,64}$/.test(b.issuer ?? '') || !/^[a-z0-9-]{1,32}$/.test(b.name_prefix ?? '') || !['ai', 'human'].includes(b.kind) || !Array.isArray(b.bindings) || b.bindings.length === 0) return answer(422, { error: '形が違う' });
      const key = b.issuer + ' ' + b.bindings[0].type + ':' + b.bindings[0].value;
      const had = keys.get(key);
      if (had !== undefined) {
        bind(had, b.issuer, b.bindings, b.sent_at, now, false);
        ask(had, b.settings, b.sent_at, now);
        const a = actors.get(had);
        return answer(200, { id: a.id, name: a.name, kind: a.kind, created: false });
      }
      const n = (counts.get(b.issuer + ' ' + b.name_prefix) ?? 0) + 1;
      counts.set(b.issuer + ' ' + b.name_prefix, n);
      const id = 'act-' + (actors.size + 1);
      actors.set(id, { seq: ++seq, id, name: b.name_prefix + '.' + n, kind: b.kind, issuer: b.issuer, sent_at: b.sent_at, received_at: now, clock_skew: false, labels: b.labels ?? {} });
      keys.set(key, id);
      bind(id, b.issuer, b.bindings, b.sent_at, now, true);
      ask(id, b.settings, b.sent_at, now);
      return answer(201, { id, name: b.name_prefix + '.' + n, kind: b.kind, created: true });
    }
    const put = /^\\/v1\\/(events|links|settings)\\/(.+)$/.exec(url.pathname);
    if (req.method === 'PUT' && put) {
      const b = body ?? {};
      const refs = put[1] === 'links' ? [b.from, b.to] : [b.by];
      if (!refs.every(r => refOk(b.issuer, r))) return answer(422, { error: '指すアクターを知らない' });
      if (put[1] === 'events' && !EVENT_TYPES.includes(b.type)) return answer(422, { error: '種類が決まりの外' });
      const id = put[1] + ' ' + put[2];
      const had = puts.get(id);
      if (had !== undefined) return answer(had === data ? 200 : 409, { id: put[2] });
      const actorOf = (ref) => keys.get(b.issuer + ' ' + ref);
      const row = { seq: ++seq, id: put[2], sent_at: b.sent_at, received_at: now, clock_skew: false };
      if (put[1] === 'events') events.push({ ...row, actor_id: actorOf(b.by), type: b.type, detail: b.detail ?? {} });
      if (put[1] === 'links') links.push({ ...row, type: b.type, from: actorOf(b.from), to: actorOf(b.to) });
      if (put[1] === 'settings') {
        const cur = current(actorOf(b.by));
        if (cur !== undefined && cur.model === b.model && cur.effort === b.effort) return answer(200, settingRow(cur));
        settings.push({ ...row, actor_id: actorOf(b.by), model: b.model, effort: b.effort, source: b.source });
      }
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
  /** /healthz が返す castlist の時刻。書いた物の受けた時刻（received_at）にもなる。 */
  setNow: (iso: string) => void
  /** 試験が castlist に直に書く（検索の試験の下ごしらえ）。答えの本文を返す。 */
  send: (method: 'POST' | 'PUT', path: string, body: unknown) => Promise<unknown>
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
  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    // JSON の記録は undefined の欄を落とすので、Origin の無い要求も origin の欄を持つように戻す。
    requests: () => readFileSync(log, 'utf8').split('\n').filter(l => l !== '').map(l => ({ origin: undefined, ...JSON.parse(l) as Omit<CastlistRequest, 'origin'> })),
    setNow: (iso) => {
      writeFileSync(control, JSON.stringify({ now: iso }));
    },
    send: async (method, path, body) => {
      const r = await fetch(`${url}${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return r.json() as Promise<unknown>;
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
