// 偽の castlist: 127.0.0.1 の空いた port で待つ node の http サーバー（この試験の process の中）。roster が生成した client で送る要求を記録し、
// 本物（castlist 1.0.0 の新しい API。cli/gen/model/castlist/castlist.smithy）の決まりの要る所だけで、restJson1 の形で答える（欄の名は camelCase・誤りは x-amzn-errortype）。
// 状態を持つ（登録した鍵・名の番号・足した出来事・線・model と effort）ので、hook の流れ（登録し直し・同じ id の送り直し・推しの幕引き）と監査の検索を通しで見られる。
// 生成した client は Promise で待つので、同じ thread のサーバーが答えられる（命令を spawnSync で動かす試験は、待つ間に答えられないので spawn で待つ）。
// 答えを替える試験は intercept に関数を置く（要求ごとに先に呼ぶ。答えを返せばそれで答え、drop なら socket を切る（つながらない）。undefined なら決まりどおり答える）。
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NextAnswer, NextSeen } from './next-fake.ts';

/** 偽の castlist が受けた要求 1 件（答えた status つき）。/healthz も入る。 */
export interface CastlistSeen extends NextSeen {
  status: number
}

/** 偽の castlist。 */
export interface FakeCastlist {
  url: string
  /** 受けた要求（受けた順）。intercept が答えた物は入らない。 */
  requests: () => CastlistSeen[]
  /** /healthz が返す castlist の時刻。書いた物の受けた時刻（receivedAt）にもなる。 */
  setNow: (iso: string) => void
  /** 試験が castlist に直に書く（下ごしらえ）。答えの本文を返す。記録には入れない。 */
  send: (method: 'POST' | 'PUT', path: string, body: unknown) => Promise<Record<string, unknown>>
  /** 要求ごとに先に呼ぶ関数（試験が置き、終われば undefined に戻す）。 */
  intercept: ((seen: NextSeen) => NextAnswer | 'drop' | undefined) | undefined
  stop: () => Promise<void>
}

type Row = Record<string, unknown> & { seq: number };
type Actor = Row & { id: string, name: string, kind: string, issuer: string, labels: Record<string, string> };
type Binding = Row & { actorId: string, type: string, value: string };
type Event = Row & { id: string, actorId: string, type: string, detail: Record<string, unknown>, receivedAt: string };
type Link = Row & { id: string, type: string, from: string, to: string };
type Setting = Row & { actorId: string, model: string, effort: string, source: string, receivedAt: string };

const ENTER = ['entered', 'reentered', 'forked'];
const EXIT = ['cleared', 'exited', 'closed'];
const EVENT_TYPES = ['entered', 'reentered', 'forked', 'compacted', 'cleared', 'exited', 'closed', 'reported_in', 'model_unreadable', 'retracted'];

/** 決まりの誤り（restJson1。message は本文、型は x-amzn-errortype）。 */
class Refusal extends Error {
  readonly status: number;
  readonly type: string;

  constructor(status: number, type: string, message: string) {
    super(message);
    this.status = status;
    this.type = type;
  }
}
const bad = (message: string): never => {
  throw new Refusal(400, 'ValidationException', message);
};

/** 字の欄（字でなければ空）。 */
const textOf = (v: unknown): string => typeof v === 'string' ? v : '';

const without = (row: Record<string, unknown>, ...names: string[]): Record<string, unknown> => Object.fromEntries(Object.entries(row).filter(([k, v]) => !names.includes(k) && v !== undefined));

/** 状態を持つ castlist の決まり（HTTP の外の所）。 */
class Ledger {
  now: string;
  private seq = 0;
  private actors = new Map<string, Actor>();
  private keys = new Map<string, string>();
  private counts = new Map<string, number>();
  private puts = new Map<string, string | undefined>();
  private bindings: Binding[] = [];
  private events: Event[] = [];
  private links: Link[] = [];
  private settings: Setting[] = [];
  private usage: Record<string, unknown>[] = [];

  constructor(now: string) {
    this.now = now;
  }

  /** 要求 1 つに答える。 */
  answer(seen: NextSeen): NextAnswer {
    try {
      return this.route(seen);
    }
    catch (e) {
      if (e instanceof Refusal) return { status: e.status, type: e.type, body: e.message };
      throw e;
    }
  }

  private route(seen: NextSeen): NextAnswer {
    const { method, path } = seen;
    const parts = path.split('/').map(decodeURIComponent);
    const q = new Query(seen.query);
    const ok = (body: unknown, status = 200): NextAnswer => ({ status, body });
    if (method === 'GET') {
      if (path === '/healthz') return ok({ status: 'ok', version: '2.1.0', now: this.now });
      if (path === '/api/actors') return ok(this.searchActors(q));
      if (path === '/api/settings') return ok(this.searchSettings(q));
      if (path === '/api/events') return ok(this.searchEvents(q));
      if (path === '/api/usage') return ok(this.searchUsage(q));
      if (parts[1] === 'api' && parts[2] === 'actors' && parts.length >= 4) {
        const a = this.actors.get(parts[3] ?? '');
        if (a === undefined) throw new Refusal(404, 'NotFound', 'そのアクターは無い');
        if (parts.length === 4) return ok(this.detail(a));
        if (parts[4] === 'lineage' && parts.length === 5) return ok(this.lineage(a.id, q));
        if (parts[4] === 'settings' && parts.length === 5) return ok({ asOf: this.now, actorId: a.id, settings: this.settings.filter(s => s.actorId === a.id).map(s => without(s, 'seq')) });
        if (parts[4] === 'settings' && parts[5] === 'at') return ok(this.settingAt(a.id, q));
      }
    }
    const body = seen.body ?? {};
    if (method === 'POST' && path === '/api/actors') return this.register(body);
    const usage = /^\/api\/usage\/(.+)$/.exec(path);
    if (method === 'PUT' && usage !== null) return this.putUsage(decodeURIComponent(usage[1] ?? ''), body, seen.text);
    const put = /^\/api\/(events|links|settings)\/(.+)$/.exec(path);
    if (method === 'PUT' && put !== null) return this.put(put[1] as 'events' | 'links' | 'settings', decodeURIComponent(put[2] ?? ''), body, seen.text);
    return { status: 404, type: 'UnknownOperationException', body: '知らない道' };
  }

  private register(b: Record<string, unknown>): NextAnswer {
    const issuer = textOf(b.issuer);
    const prefix = textOf(b.namePrefix);
    const bindings = b.bindings as { type: string, value: string }[] | undefined;
    if (!/^[a-z0-9.-]{1,64}$/.test(issuer) || !/^[a-z0-9-]{1,32}$/.test(prefix) || !['ai', 'human'].includes(String(b.kind)) || !Array.isArray(bindings) || bindings.length === 0) bad('形が違う');
    const [key] = bindings as [{ type: string, value: string }];
    const sentAt = String(b.sentAt);
    const wanted = b.settings as { model: string, effort: string } | undefined;
    const had = this.keys.get(`${issuer} ${key.type}:${key.value}`);
    if (had !== undefined) {
      this.bind(had, issuer, bindings ?? [], sentAt, false);
      this.ask(had, wanted, sentAt);
      const a = this.actors.get(had) as Actor;
      return { status: 200, body: { actor: { id: a.id, name: a.name, kind: a.kind }, created: false } };
    }
    const n = (this.counts.get(`${issuer} ${prefix}`) ?? 0) + 1;
    this.counts.set(`${issuer} ${prefix}`, n);
    const id = `019abcde-0000-7000-8000-${String(this.actors.size + 1).padStart(12, '0')}`;
    const actor: Actor = { seq: this.seq += 1, id, name: `${prefix}.${n}`, kind: String(b.kind), issuer, sentAt, receivedAt: this.now, clockSkew: false, labels: (b.labels ?? {}) as Record<string, string> };
    this.actors.set(id, actor);
    this.keys.set(`${issuer} ${key.type}:${key.value}`, id);
    this.bind(id, issuer, bindings ?? [], sentAt, true);
    this.ask(id, wanted, sentAt);
    return { status: 201, body: { actor: { id, name: actor.name, kind: actor.kind }, created: true } };
  }

  /** 付随する id を足す（鍵でない物は、同じ種類の最新と違う時だけ）。 */
  private bind(id: string, issuer: string, list: { type: string, value: string }[], sentAt: string, fresh: boolean): void {
    list.forEach((b, i) => {
      if (!fresh && i === 0) return;
      const latest = this.bindings.filter(x => x.actorId === id && x.type === b.type).at(-1);
      if (!fresh && latest !== undefined && latest.value === b.value) return;
      this.bindings.push({ seq: this.seq += 1, actorId: id, issuer, type: b.type, value: b.value, isKey: fresh && i === 0, sentAt, receivedAt: this.now });
    });
  }

  /** 頼んだ model と effort（最新と違う時だけ足す。送り手の id は無い）。 */
  private ask(id: string, wanted: { model: string, effort: string } | undefined, sentAt: string): void {
    if (wanted === undefined) return;
    const cur = this.current(id);
    if (cur !== undefined && cur.model === wanted.model && cur.effort === wanted.effort) return;
    this.settings.push({ seq: this.seq += 1, actorId: id, model: wanted.model, effort: wanted.effort, source: 'requested', sentAt, receivedAt: this.now, clockSkew: false });
  }

  private put(kind: 'events' | 'links' | 'settings', id: string, b: Record<string, unknown>, text: string | undefined): NextAnswer {
    // 同じ id かは、指すアクターを引くより先に見る（同じ本文は前の行を 200・違えば 409）。
    const key = `${kind} ${id}`;
    if (this.puts.has(key)) {
      if (this.puts.get(key) !== text) throw new Refusal(409, 'Conflict', '同じ id で本文が違う');
      const rows: Row[] = kind === 'events' ? this.events : kind === 'links' ? this.links : this.settings;
      return { status: 200, body: without(rows.find(r => r.id === id) ?? {}, 'seq') };
    }
    const issuer = textOf(b.issuer);
    const actorOf = (ref: unknown): string => this.keys.get(`${issuer} ${String(ref)}`) ?? bad('指すアクターを知らない');
    const row = { seq: this.seq += 1, id, sentAt: String(b.sentAt), receivedAt: this.now, clockSkew: false };
    let added: Row;
    if (kind === 'events') {
      const actorId = actorOf(b.by);
      if (!EVENT_TYPES.includes(String(b.type))) bad('種類が決まりの外');
      added = { ...row, actorId, type: String(b.type), detail: (b.detail ?? {}) };
      this.events.push(added as Event);
    }
    else if (kind === 'links') {
      added = { ...row, type: String(b.type), from: actorOf(b.from), to: actorOf(b.to) };
      this.links.push(added as Link);
    }
    else {
      const actorId = actorOf(b.by);
      const cur = this.current(actorId);
      // 最新と同じ model と effort なら、足さずに最新の行を 200 で返す（id は残らない）。
      if (cur !== undefined && cur.model === b.model && cur.effort === b.effort) return { status: 200, body: without(cur, 'seq') };
      added = { ...row, actorId, model: String(b.model), effort: String(b.effort), source: String(b.source) };
      this.settings.push(added as Setting);
    }
    this.puts.set(key, text);
    return { status: 201, body: without(added, 'seq') };
  }

  /** トークンの数と費えの 1 行（PutUsage。2.1.0 から）。本物と同じ決まり: 同じ id で同じ本文は 200・違えば 409・同じ UTC の時の内・段の和が行と合う。 */
  private putUsage(id: string, b: Record<string, unknown>, text: string | undefined): NextAnswer {
    const key = `usage ${id}`;
    if (this.puts.has(key)) {
      if (this.puts.get(key) !== text) throw new Refusal(409, 'Conflict', '同じ id で本文が違う');
      return { status: 200, body: without(this.usage.find(r => r.id === id) ?? {}, 'seq') };
    }
    const actorId = this.keys.get(`${textOf(b.issuer)} ${String(b.by)}`) ?? bad('指すアクターを知らない');
    const iso = (v: unknown): string => typeof v === 'number' ? new Date(v * 1000).toISOString() : new Date(String(v)).toISOString();
    const fromAt = iso(b.fromAt);
    const toAt = iso(b.toAt);
    if (fromAt > toAt || fromAt.slice(0, 13) !== toAt.slice(0, 13)) bad('fromAt と toAt は、同じ UTC の時の内にする');
    const buckets = (b.buckets ?? []) as { bucket: number, turns: number, costMicroUsd: number }[];
    if (!/^[a-z0-9.-]{1,64}$/.test(String(b.model)) || Number(b.turns) < 1 || new Set(buckets.map(x => x.bucket)).size !== buckets.length
      || buckets.reduce((n, x) => n + x.turns, 0) !== b.turns || buckets.reduce((n, x) => n + x.costMicroUsd, 0) !== b.costMicroUsd) bad('形が違う');
    const rest = Object.fromEntries(Object.entries(b).filter(([k]) => k !== 'issuer' && k !== 'by'));
    const added = { seq: this.seq += 1, id, actorId, ...rest, fromAt, toAt, sentAt: iso(b.sentAt), receivedAt: this.now, clockSkew: false };
    this.usage.push(added);
    this.puts.set(key, text);
    return { status: 201, body: without(added, 'seq') };
  }

  /** トークンの数と費えの行を読む（ListUsage）: 窓は from <= toAt < to。actorId で絞る。 */
  private searchUsage(q: Query): Record<string, unknown> {
    const from = q.time('from') ?? bad('from と to が要る');
    const to = q.time('to') ?? bad('from と to が要る');
    if (to - from > 31 * 24 * 60 * 60 * 1000) bad('from から to までは 31 日まで');
    const actor = q.one('actorId');
    const rows = this.usage.filter(u => Date.parse(String(u.toAt)) >= from && Date.parse(String(u.toAt)) < to && (actor === undefined || u.actorId === actor));
    const page = this.page(q, rows.map(u => without(u, 'seq')), 'usage');
    const ids = [...new Set(page.rows.map(u => String(u.actorId)))];
    return { asOf: this.now, usage: page.rows, actors: ids.map(id => ({ id, name: this.nameOf(id), labels: {} })), ...(page.nextToken === undefined ? {} : { nextToken: page.nextToken }) };
  }

  private current(id: string): Setting | undefined {
    return this.settings.filter(s => s.actorId === id).at(-1);
  }

  /** 居る・居ないの出来事から、初めの登場・最後の退場・今居るか。 */
  private presence(id: string) {
    const evs = this.events.filter(e => e.actorId === id && (ENTER.includes(e.type) || EXIT.includes(e.type)));
    const first = evs.find(e => ENTER.includes(e.type));
    const exit = evs.filter(e => EXIT.includes(e.type)).at(-1);
    const latest = evs.at(-1);
    // 推しの幕引き: 今の状態を決めた出来事が closed で、detail.inferred が true。
    const inferred = latest?.type === 'closed' && latest.detail.inferred === true;
    return { first, exit, latest, present: latest !== undefined && ENTER.includes(latest.type), inferred };
  }

  private nameOf = (id: string): string => this.actors.get(id)?.name ?? '';

  /** アクターの一覧の 1 行（ActorRow。無い値は欄ごと無い）。 */
  private item(a: Actor): Record<string, unknown> {
    const pr = this.presence(a.id);
    const cur = this.current(a.id);
    return without({
      ...without(a, 'seq'),
      firstEnteredAt: pr.first?.receivedAt,
      lastExitedAt: pr.exit?.receivedAt,
      lastExitType: pr.exit?.type,
      present: pr.present,
      inferred: pr.inferred,
      model: cur?.model,
      effort: cur?.effort,
      url: `/actors/${a.id}`,
    });
  }

  /** 1 つのアクターの全部（GetActor）。 */
  private detail(a: Actor): Record<string, unknown> {
    const pr = this.presence(a.id);
    const bs = this.bindings.filter(b => b.actorId === a.id);
    const types = [...new Set(bs.map(b => b.type))].sort();
    const cur = this.current(a.id);
    return without({
      ...without(a, 'seq'),
      bindings: bs.map(b => without(b, 'seq', 'actorId')),
      currentBindings: types.map(t => without(bs.filter(b => b.type === t).at(-1) ?? {}, 'seq', 'actorId')),
      events: this.events.filter(e => e.actorId === a.id).map(e => without(e, 'seq')),
      settings: this.settings.filter(s => s.actorId === a.id).map(s => without(s, 'seq')),
      currentSettings: cur === undefined ? undefined : without(cur, 'seq'),
      linksIn: this.links.filter(l => l.to === a.id).map(l => without(l, 'seq')),
      linksOut: this.links.filter(l => l.from === a.id).map(l => without(l, 'seq')),
      state: without({ presence: pr.latest?.type, present: pr.present, inferred: pr.inferred, enteredAt: pr.first?.receivedAt, exitedAt: pr.exit?.receivedAt }),
      asOf: this.now,
    });
  }

  /** 頁（nextToken は `<items>.<始めの番号>`。中は読まない決まりなので、本物と違う字）。 */
  private page<T>(q: Query, rows: T[], what: string): { rows: T[], nextToken?: string } {
    const limit = Number(q.one('maxResults') ?? 100);
    const token = q.one('nextToken');
    const [name, from = ''] = (token ?? `${what}.0`).split('.');
    if (name !== what || !/^\d+$/.test(from)) bad('nextToken が読めない（前の答えの nextToken を、そのまま渡す）');
    const start = Number(from);
    return { rows: rows.slice(start, start + limit), ...(start + limit < rows.length ? { nextToken: `${what}.${start + limit}` } : {}) };
  }

  private searchActors(q: Query): Record<string, unknown> {
    const labels = q.all('label').map(v => pair('label', v, '鍵:値'));
    const bindingText = q.one('binding');
    const binding = bindingText === undefined ? undefined : pair('binding', bindingText, '種類:値');
    const at = q.time('at');
    if (at !== undefined && binding === undefined) bad('at は binding と一緒に付ける（居た間で探すなら activeFrom・activeTo）');
    const from = q.time('activeFrom');
    const to = q.time('activeTo');
    const kind = q.choice('kind', ['ai', 'human']);
    const active = q.one('active');
    const model = q.one('model');
    const effort = q.one('effort');
    const launchedBy = q.one('launchedBy');
    const skewed = q.onlyTrue('skewed');
    const sort = q.choice('sort', ['entered', 'exited']) ?? 'entered';
    const order = q.choice('order', ['asc', 'desc']) ?? 'asc';
    if (!(labels.length > 0 || binding !== undefined || from !== undefined || to !== undefined || active === 'true' || model !== undefined || effort !== undefined || launchedBy !== undefined || skewed)) {
      bad('絞る条件を 1 つ以上付ける（label・binding・activeFrom・activeTo・active=true・model・effort・launchedBy・skewed のどれか）');
    }
    let rows = [...this.actors.values()];
    if (binding !== undefined) {
      const t = at ?? Date.parse(this.now);
      const hit = this.bindings.filter(b => b.type === binding[0] && b.value === binding[1] && Date.parse(String(b.receivedAt)) <= t).at(-1);
      rows = rows.filter(a => a.id === hit?.actorId);
    }
    rows = rows.filter(a => labels.every(([k, v]) => a.labels[k] === v));
    if (from !== undefined || to !== undefined) {
      rows = rows.filter((a) => {
        const pr = this.presence(a.id);
        if (pr.first === undefined) return false;
        const start = Date.parse(pr.first.receivedAt);
        const end = pr.present || pr.exit === undefined ? Infinity : Date.parse(pr.exit.receivedAt);
        return (to === undefined || start <= to) && (from === undefined || end >= from);
      });
    }
    if (kind !== undefined) rows = rows.filter(a => a.kind === kind);
    if (active !== undefined) rows = rows.filter(a => this.presence(a.id).present === (active === 'true'));
    if (model !== undefined) rows = rows.filter(a => this.settings.some(s => s.actorId === a.id && s.model === model));
    if (effort !== undefined) rows = rows.filter(a => this.settings.some(s => s.actorId === a.id && s.effort === effort));
    if (launchedBy !== undefined) rows = rows.filter(a => this.links.some(l => l.type === 'launched' && l.from === launchedBy && l.to === a.id));
    if (skewed) rows = [];
    const items = rows.map(a => this.item(a));
    const field = sort === 'entered' ? 'firstEnteredAt' : 'lastExitedAt';
    const sign = order === 'asc' ? 1 : -1;
    const value = (r: Record<string, unknown>): string | undefined => r[field] as string | undefined;
    items.sort((a, b) => (value(a) === value(b) ? 0 : value(a) === undefined ? -1 : value(b) === undefined ? 1 : String(value(a)) < String(value(b)) ? -1 : 1) * sign);
    const page = this.page(q, items, 'actors');
    return { asOf: this.now, actors: page.rows, ...(page.nextToken === undefined ? {} : { nextToken: page.nextToken }) };
  }

  private lineage(id: string, q: Query): Record<string, unknown> {
    const direction = q.choice('direction', ['up', 'down', 'both']) ?? 'both';
    const d = q.one('depth');
    const depth = d === undefined ? undefined : Number(d);
    const type = q.choice('type', ['launched', 'continued']);
    const up = direction === 'down' ? 0 : depth ?? 20;
    const down = direction === 'up' ? 0 : depth ?? 1;
    const seen = new Set([id]);
    const order = [id];
    const edges = new Map<number, Link>();
    for (const [steps, upward] of [[up, true], [down, false]] as const) {
      let frontier = [id];
      for (let i = 0; i < steps && frontier.length > 0; i += 1) {
        const next: string[] = [];
        for (const node of frontier) {
          if (upward && this.actors.get(node)?.kind === 'human') continue;
          for (const l of this.links.filter(l => (upward ? l.to : l.from) === node && (type === undefined || l.type === type))) {
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
    return { asOf: this.now, actorId: id, nodes: order.map(n => this.item(this.actors.get(n) as Actor)), edges: [...edges.values()].sort((a, b) => a.seq - b.seq).map(l => without(l, 'seq')) };
  }

  private settingAt(id: string, q: Query): Record<string, unknown> {
    const at = q.time('time') ?? bad('time を付ける');
    const hit = this.settings.filter(s => s.actorId === id && Date.parse(s.receivedAt) <= at).at(-1);
    return without({ asOf: this.now, actorId: id, at: new Date(at).toISOString(), setting: hit === undefined ? undefined : without(hit, 'seq') });
  }

  private searchSettings(q: Query): Record<string, unknown> {
    const model = q.one('model');
    const effort = q.one('effort');
    const source = q.choice('source', ['requested', 'observed']);
    const from = q.time('from');
    const to = q.time('to');
    const mismatch = q.onlyTrue('mismatch');
    const skewed = q.onlyTrue('skewed');
    const rows = this.settings.filter((s) => {
      if (model !== undefined && s.model !== model) return false;
      if (effort !== undefined && s.effort !== effort) return false;
      if (source !== undefined && s.source !== source) return false;
      if (from !== undefined && Date.parse(s.receivedAt) < from) return false;
      if (to !== undefined && Date.parse(s.receivedAt) > to) return false;
      if (skewed) return false;
      if (mismatch) {
        if (s.source !== 'observed') return false;
        const asked = this.settings.filter(r => r.actorId === s.actorId && r.source === 'requested' && r.seq < s.seq).at(-1);
        return asked !== undefined && (asked.model !== s.model || asked.effort !== s.effort);
      }
      return true;
    });
    const page = this.page(q, rows.map(s => ({ ...without(s, 'seq'), actorName: this.nameOf(s.actorId) })), 'settings');
    return { asOf: this.now, settings: page.rows, ...(page.nextToken === undefined ? {} : { nextToken: page.nextToken }) };
  }

  private searchEvents(q: Query): Record<string, unknown> {
    const types = q.all('type');
    for (const t of types) if (!EVENT_TYPES.includes(t)) bad(`type は ${EVENT_TYPES.join('・')} のどれか（${t}）`);
    const actor = q.one('actor');
    const from = q.time('from');
    const to = q.time('to');
    const reason = q.one('reason');
    const source = q.one('source');
    const skewed = q.onlyTrue('skewed');
    const rows = this.events.filter(e => (types.length === 0 || types.includes(e.type)) && (actor === undefined || e.actorId === actor)
      && (from === undefined || Date.parse(e.receivedAt) >= from) && (to === undefined || Date.parse(e.receivedAt) <= to)
      && (reason === undefined || e.detail.reason === reason) && (source === undefined || e.detail.source === source) && !skewed);
    const page = this.page(q, rows.map(e => ({ ...without(e, 'seq'), actorName: this.nameOf(e.actorId) })), 'events');
    return { asOf: this.now, events: page.rows, ...(page.nextToken === undefined ? {} : { nextToken: page.nextToken }) };
  }
}

/** 問い合わせの引数（重ねた物は配列）。 */
class Query {
  private readonly query: Record<string, string | string[] | null>;

  constructor(query: Record<string, string | string[] | null>) {
    this.query = query;
  }

  all(name: string): string[] {
    const v = this.query[name];
    return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
  }

  one(name: string): string | undefined {
    return this.all(name)[0];
  }

  time(name: string): number | undefined {
    const v = this.one(name);
    if (v === undefined) return undefined;
    const t = Date.parse(v);
    return Number.isNaN(t) ? bad(`${name} は RFC 3339 の時刻`) : t;
  }

  choice(name: string, choices: string[]): string | undefined {
    const v = this.one(name);
    if (v !== undefined && !choices.includes(v)) bad(`${name} は ${choices.join('・')} のどれか`);
    return v;
  }

  onlyTrue(name: string): boolean {
    const v = this.one(name);
    if (v !== undefined && v !== 'true') bad(`${name} は true だけ（絞らないなら付けない）`);
    return v === 'true';
  }
}

/** 鍵:値・種類:値 を初めの : で分ける。 */
function pair(name: string, v: string, shape: string): [string, string] {
  const i = v.indexOf(':');
  if (i <= 0 || i === v.length - 1) bad(`${name} は「${shape}」の形（${v}）`);
  return [v.slice(0, i), v.slice(i + 1)];
}

/** 受けた HTTP の要求を、偽の handler（next-fake.ts）と同じ形に読む。 */
function seenOf(req: IncomingMessage, text: string): NextSeen {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const query: Record<string, string | string[]> = {};
  for (const [k, v] of url.searchParams) {
    const had = query[k];
    query[k] = had === undefined ? v : [...Array.isArray(had) ? had : [had], v];
  }
  const json = (req.headers['content-type'] ?? '').startsWith('application/json') && text !== '';
  const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v ?? '']));
  return { method: req.method ?? '', path: url.pathname, query, headers, text: text === '' ? undefined : text, body: json ? JSON.parse(text) as Record<string, unknown> : undefined };
}

/** 答えを restJson1 の形で書く。 */
function write(res: ServerResponse, got: NextAnswer): void {
  if ('throws' in got) throw got.throws;
  const type = 'type' in got ? got.type : undefined;
  res.writeHead(got.status, { 'content-type': 'application/json', ...(type === undefined ? {} : { 'x-amzn-errortype': type }) });
  res.end('raw' in got ? got.raw : JSON.stringify((type === undefined ? got.body : { message: got.body, ...(got.fieldList === undefined ? {} : { fieldList: got.fieldList }) }) ?? {}));
}

/** 偽の castlist を起こす。now は /healthz が返す時刻（既定は world の時計の時刻）。 */
export async function startCastlist(now = '2026-11-20T12:00:00.000Z'): Promise<FakeCastlist> {
  const ledger = new Ledger(now);
  const log: CastlistSeen[] = [];
  const fake: FakeCastlist = {
    url: '',
    requests: () => [...log],
    setNow: (iso) => {
      ledger.now = iso;
    },
    send: (method, path, body) => {
      const text = JSON.stringify(body);
      const got = ledger.answer({ method, path, query: {}, headers: {}, text, body: body as Record<string, unknown> });
      return Promise.resolve(('body' in got ? got.body : {}) as Record<string, unknown>);
    },
    intercept: undefined,
    stop: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
  const server = createServer((req, res) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => {
      text += c;
    });
    req.on('end', () => {
      const seen = seenOf(req, text);
      const over = fake.intercept?.(seen);
      if (over === 'drop') {
        req.socket.destroy();
        return;
      }
      if (over !== undefined) {
        write(res, over);
        return;
      }
      const got = ledger.answer(seen);
      log.push({ ...seen, status: 'status' in got ? got.status : 0 });
      write(res, got);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return fake;
}
