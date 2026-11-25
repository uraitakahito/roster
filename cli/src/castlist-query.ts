// castlist を読む操作（1 つのアクター・線・監査の検索）。今の道（curl の GET /v1/…）と新しい API（生成した client）を、操作ごとに 1 つずつ合わせる（AI-36 の段 6c）。
// 引数は今の道の名で受け、next なら新しい名と型に直す（時刻は Date にして UTC で送る・limit は maxResults・after は nextToken）。
// 生成した client は形の決まりの一部しか見ないので、今の castlist が断る引数（知らない名・読めない時刻・範囲の外の数）は、送らずに今と同じ訳で断る（400）。
// 答えは、どちらの道でも今の道の形（欄の名は snake_case・無い値は null・頁の印は next）にする。呼ぶ側（castlist-read.ts など）は替えない。
import type * as Castlist from '../gen/castlist-client/dist-types/index.js';
import { request, viaNext, type Reply, type Sender } from './castlist.ts';
import { nextApi, toSnake } from './clients.ts';

/** 引数（今の道の名と値。同じ名を何度でも並べてよい。値が undefined の物は送らない）。 */
export type Params = [string, string | undefined][];

/** 読む操作（op は新しい API の操作の名）。ListActorSettings は、引数に at があれば GetActorSettingAt にする。 */
export type Query =
  | { op: 'GetActor', id: string }
  | { op: 'GetLineage' | 'ListActorSettings', id: string, params?: Params }
  | { op: 'ListActors' | 'ListEvents' | 'ListSettings', params?: Params };

/** 今の道の path（引数を除く）。 */
function pathOf(q: Query): string {
  switch (q.op) {
    case 'GetActor': return `/v1/actors/${encodeURIComponent(q.id)}`;
    case 'GetLineage': return `/v1/actors/${encodeURIComponent(q.id)}/lineage`;
    case 'ListActorSettings': return `/v1/actors/${encodeURIComponent(q.id)}/settings`;
    case 'ListActors': return '/v1/actors';
    case 'ListEvents': return '/v1/events';
    case 'ListSettings': return '/v1/settings';
  }
}

/** 引数 1 つの直し方: 新しい名と型。 */
type Field = { to: string, kind: 'text' | 'list' | 'time' | 'bool' } | { to: string, kind: 'int', min: number, max: number };

const text = (to: string): Field => ({ to, kind: 'text' });
const time = (to: string): Field => ({ to, kind: 'time' });
const bool = (to: string): Field => ({ to, kind: 'bool' });
/** 頁（今の limit・after）。 */
const PAGE = { limit: { to: 'maxResults', kind: 'int', min: 1, max: 1000 }, after: text('nextToken') } satisfies Record<string, Field>;

/** 操作ごとの、受ける引数（今の道の名 → 直し方）。並びは、知らない引数の訳に出す順。 */
const FIELDS: Record<Exclude<Query['op'], 'GetActor'>, Record<string, Field>> = {
  ListActors: {
    label: { to: 'label', kind: 'list' },
    binding: text('binding'),
    at: time('at'),
    active_from: time('activeFrom'),
    active_to: time('activeTo'),
    kind: text('kind'),
    model: text('model'),
    effort: text('effort'),
    active: bool('active'),
    launched_by: text('launchedBy'),
    skewed: bool('skewed'),
    sort: text('sort'),
    order: text('order'),
    ...PAGE,
  },
  GetLineage: { direction: text('direction'), depth: { to: 'depth', kind: 'int', min: 1, max: 20 }, type: text('type') },
  ListActorSettings: { at: time('time') },
  ListEvents: { type: { to: 'type', kind: 'list' }, actor: text('actor'), from: time('from'), to: time('to'), reason: text('reason'), source: text('source'), skewed: bool('skewed'), ...PAGE },
  ListSettings: { model: text('model'), effort: text('effort'), source: text('source'), from: time('from'), to: time('to'), mismatch: bool('mismatch'), skewed: bool('skewed'), ...PAGE },
};

/** RFC 3339 の時刻（時差は Z か ±hh:mm）。 */
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/i;

/**
 * RFC 3339 の時刻として在る字か。Date.parse は在らない日と時刻（2 月 30 日・11 月 31 日・24 時）を次の日に回して読むので、
 * 字の欄を 1 つずつ見る（今の castlist の RFC 3339 の読みと同じく、在らない物は断る）。
 */
export function isTime(value: string): boolean {
  const m = RFC3339.exec(value);
  if (m === null) return false;
  // 時差の欄は Z の時に無い（undefined）ので 0 にする。
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0, offsetHour = 0, offsetMinute = 0] = m.slice(1).map(v => Number(v ?? 0));
  if (month < 1 || month > 12 || day < 1) return false;
  // その月の日の数（次の月の 0 日は、その月の終わりの日）。
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return false;
  return hour <= 23 && minute <= 59 && second <= 59 && offsetHour <= 23 && offsetMinute <= 59;
}

/** castlist のアクターの id の形（ai.common#ActorId。小文字の UUID）。新しい API は、この形でない id を 400 で断る。 */
export const ACTOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 今の道の引数を、新しい API の入力にする。今の castlist が断る物は、その訳（今の castlist と同じ字）。 */
function inputOf(fields: Record<string, Field>, params: Params): { input: Record<string, unknown> } | { error: string } {
  const input: Record<string, unknown> = {};
  for (const [name, value] of params) {
    if (value === undefined) continue;
    const field = fields[name];
    if (field === undefined) return { error: `知らない引数: ${name}（使えるのは ${Object.keys(fields).join('・')}）` };
    if (field.kind === 'list') {
      input[field.to] = [...(input[field.to] as string[] | undefined) ?? [], value];
      continue;
    }
    if (input[field.to] !== undefined) return { error: `${name} は 1 つだけ付ける` };
    switch (field.kind) {
      case 'text':
        input[field.to] = value;
        break;
      case 'time':
        if (!isTime(value)) return { error: `${name} は RFC 3339 の時刻（例 2026-11-22T13:00:00+09:00）` };
        input[field.to] = new Date(value);
        break;
      case 'bool':
        if (value !== 'true' && value !== 'false') return { error: `${name} は true か false` };
        input[field.to] = value === 'true';
        break;
      case 'int': {
        const n = /^\d+$/.test(value) ? Number(value) : Number.NaN;
        if (!(n >= field.min && n <= field.max)) return { error: `${name} は ${field.min} から ${field.max} までの数` };
        input[field.to] = n;
        break;
      }
    }
  }
  return { input };
}

/** 答えを今の道の形にする（clients.ts の toSnake）。labels と detail の中は送られた物なので替えない。 */
const snake = (value: unknown): unknown => toSnake(value, ['labels', 'detail']);

/** 今の道で null の欄（新しい API は欄ごと無い）を null で埋める。 */
const withNulls = (row: unknown, names: string[]): Record<string, unknown> => ({ ...Object.fromEntries(names.map(n => [n, null])), ...row as Record<string, unknown> });

/** アクターの一覧の 1 行（ListActors の行と、線の点）。 */
const actorRow = (row: unknown): Record<string, unknown> => withNulls(snake(row), ['first_entered_at', 'last_exited_at', 'last_exit_type', 'model', 'effort']);

/** 設定の 1 行。送り手の id（登録の時に頼んだ物には無い）は、今の道と同じく null で埋める。 */
const settingRow = (row: unknown): Record<string, unknown> => withNulls(snake(row), ['id']);

/** 1 つのアクター（GetActor）。 */
function actorOf(out: Castlist.GetActorCommandOutput): Record<string, unknown> {
  const body = withNulls(snake(out), ['current_settings']);
  return { ...body, state: withNulls(body.state, ['presence', 'entered_at', 'exited_at']) };
}

/** 頁の答え（as_of・行・next）。 */
const pageOf = (items: string, rows: unknown[], asOf: Date | undefined, next: string | undefined): Record<string, unknown> => ({ as_of: snake(asOf), [items]: rows, next: next ?? null });

/**
 * castlist に読む操作を 1 つ頼む。今の道なら GET（引数は書いた順で付ける）、設定の api.castlist が next なら生成した client。
 * 断る引数は、送らずに refused（400。今の castlist と同じ訳）にする。
 */
export async function query(ctx: Sender, url: string, q: Query): Promise<Reply> {
  const params = 'params' in q ? q.params ?? [] : [];
  if (!nextApi(ctx, 'castlist')) {
    const search = new URLSearchParams(params.filter((p): p is [string, string] => p[1] !== undefined)).toString();
    return request(ctx, url, 'GET', search === '' ? pathOf(q) : `${pathOf(q)}?${search}`);
  }
  // 新しい API は ActorId の形でない id を 400 で断る。今の castlist は、無い id として 404（道の id）か空の答え（絞り）を返すので、それに合わせて送らない。
  if ('id' in q && !ACTOR_ID.test(q.id)) return { kind: 'refused', code: 404, error: 'そのアクターは無い' };
  const filter = q.op === 'ListEvents' ? 'actor' : q.op === 'ListActors' ? 'launched_by' : undefined;
  if (filter !== undefined && params.some(([name, value]) => name === filter && value !== undefined && !ACTOR_ID.test(value))) {
    const items = q.op === 'ListEvents' ? 'events' : 'actors';
    const body = pageOf(items, [], new Date(), undefined);
    return { kind: 'ok', code: 200, body, text: JSON.stringify(body) };
  }
  if (q.op === 'GetActor') return viaNext(ctx, url, (client, api, options) => client.send(new api.GetActorCommand({ actorId: q.id }), options), actorOf);
  const made = inputOf(FIELDS[q.op], params);
  if ('error' in made) return { kind: 'refused', code: 400, error: made.error };
  const { input } = made;
  switch (q.op) {
    case 'GetLineage':
      return viaNext(ctx, url, (client, api, options) => client.send(new api.GetLineageCommand({ ...input, actorId: q.id }), options), out => ({ as_of: snake(out.asOf), actor_id: out.actorId, nodes: (out.nodes ?? []).map(actorRow), edges: snake(out.edges ?? []) }));
    case 'ListActors':
      return viaNext(ctx, url, (client, api, options) => client.send(new api.ListActorsCommand(input), options), out => pageOf('actors', (out.actors ?? []).map(actorRow), out.asOf, out.nextToken));
    case 'ListEvents':
      return viaNext(ctx, url, (client, api, options) => client.send(new api.ListEventsCommand(input), options), out => pageOf('events', snake(out.events ?? []) as unknown[], out.asOf, out.nextToken));
    case 'ListSettings':
      return viaNext(ctx, url, (client, api, options) => client.send(new api.ListSettingsCommand(input), options), out => pageOf('settings', (out.settings ?? []).map(settingRow), out.asOf, out.nextToken));
    case 'ListActorSettings':
      return actorSettings(ctx, url, q.id, input.time as Date | undefined);
  }
}

/**
 * 1 つのアクターの model と effort（今の道の GET /v1/actors/<id>/settings）。at が無ければ ListActorSettings で全部、あれば GetActorSettingAt でその時の 1 行。
 * 新しい API の行にはアクターの名が無い（今の道の行には actor_name がある）ので、先に GetActor で名を引いて足す（無いアクターの 404 も、ここで返る）。
 */
async function actorSettings(ctx: Sender, url: string, id: string, at: Date | undefined): Promise<Reply> {
  const actor = await viaNext(ctx, url, (client, api, options) => client.send(new api.GetActorCommand({ actorId: id }), options), out => out.name);
  if (actor.kind !== 'ok') return actor;
  const named = (row: unknown): Record<string, unknown> => ({ ...settingRow(row), actor_name: actor.body });
  if (at === undefined) {
    return viaNext(ctx, url, (client, api, options) => client.send(new api.ListActorSettingsCommand({ actorId: id }), options), out => ({ as_of: snake(out.asOf), actor_id: out.actorId, settings: (out.settings ?? []).map(named) }));
  }
  return viaNext(ctx, url, (client, api, options) => client.send(new api.GetActorSettingAtCommand({ actorId: id, time: at }), options), out => ({ as_of: snake(out.asOf), actor_id: out.actorId, at: snake(out.at), setting: out.setting === undefined ? null : named(out.setting) }));
}
