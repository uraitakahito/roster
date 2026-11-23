// roster castlist find・show・lineage・events・settings: castlist の監査の検索（castlist の docs/src/api.md の「監査の検索」）を読むだけの命令。
// 送るのは GET だけで、castlist にも状態の folder にも書かない（Auditor の席から打つ物）。旗は castlist の引数の名にそのまま写し、値は確かめない（断るのは castlist）。
// 答えは 1 件 1 行の字にし、アクターにはプロフィールの画面の URL（<castlist>/actors/<id>）を添える。--json は castlist の答えの字をそのまま出す。
// castlist が断った（400・404）ら訳をそのまま、止まっていれば「castlist に聞けない」の 1 行で止まる。
// castlist には名で引く道が無いので、名（t-23zs-swe.1 など）は、この project の roster が登録して控えた物（状態の folder の sessions/）から id にする。
import { castlistUrl, request } from '../castlist.ts';
import type { Context } from '../context.ts';
import { TpmError } from '../skill-sets.ts';
import type { SessionRecord } from './castlist.ts';

/** 出す形。json なら castlist の答えをそのまま出す。 */
export interface JsonOption {
  json?: boolean
}

/** `roster castlist find` の旗（GET /v1/actors の引数）。 */
export interface FindOptions extends JsonOption {
  label?: string[]
  binding?: string
  at?: string
  activeFrom?: string
  activeTo?: string
  active?: string
  model?: string
  effort?: string
  launchedBy?: string
  skewed?: boolean
  kind?: string
  sort?: string
  order?: string
  limit?: string
  after?: string
}

/** `roster castlist lineage` の旗。 */
export interface LineageOptions extends JsonOption {
  direction?: string
  depth?: string
  type?: string
}

/** `roster castlist events` の旗（GET /v1/events の引数）。 */
export interface EventsOptions extends JsonOption {
  type?: string[]
  actor?: string
  from?: string
  to?: string
  reason?: string
  source?: string
  skewed?: boolean
  limit?: string
  after?: string
}

/** `roster castlist settings` の旗。actor があれば GET /v1/actors/<id>/settings、無ければ GET /v1/settings の引数。 */
export interface SettingsOptions extends JsonOption {
  actor?: string
  at?: string
  model?: string
  effort?: string
  source?: string
  from?: string
  to?: string
  mismatch?: boolean
  skewed?: boolean
  limit?: string
  after?: string
}

/** アクターの一覧の 1 行（GET /v1/actors の actors[] と、線の nodes[]。読む欄だけ）。 */
export interface ActorItem {
  id: string
  name: string
  kind: string
  labels?: Record<string, string>
  first_entered_at: string | null
  last_exited_at: string | null
  last_exit_type: string | null
  present: boolean
  model: string | null
  effort: string | null
}

/** 線 1 本。from と to はアクターの id。 */
interface Edge {
  type: string
  from: string
  to: string
  received_at: string
}

/** 出来事の行（GET /v1/events）。 */
interface EventRow {
  actor_id: string
  actor_name: string
  type: string
  detail: unknown
  received_at: string
}

/** model と effort の行（GET /v1/settings と /v1/actors/<id>/settings）。 */
interface SettingRow {
  actor_id: string
  actor_name: string
  model: string
  effort: string
  source: string
  received_at: string
}

/** 1 つのアクター（GET /v1/actors/<id>。読む欄だけ）。 */
interface ActorDetail {
  id: string
  name: string
  kind: string
  issuer: string
  labels: Record<string, string>
  current_bindings: { type: string, value: string, is_key: boolean }[]
  current_settings: { model: string, effort: string, source: string, received_at: string } | null
  state: { presence: string | null, present: boolean, entered_at: string | null, exited_at: string | null }
}

/** 引数（名と値。同じ名を何度でも並べてよい。値が undefined の物は送らない）。 */
type Params = [string, string | undefined][];

/** 聞いた答え。failed の reason は、そのまま出す 1 行（castlist の訳か「castlist に聞けない」）。 */
export type Answer<T> = { kind: 'ok', body: T, text: string } | { kind: 'failed', reason: string, down: boolean };

/** castlist の URL。設定が無ければ止める。 */
function requireUrl(ctx: Context): string {
  const url = castlistUrl(ctx);
  if (url === undefined) throw new TpmError('castlist を設定していない（project の folder の .claude/roles/config.jsonc の castlist か $ROSTER_CASTLIST_URL に URL を書く）');
  return url;
}

/** castlist に GET で聞く。 */
async function ask<T>(ctx: Pick<Context, 'exec'>, url: string, path: string, params: Params = []): Promise<Answer<T>> {
  const query = new URLSearchParams(params.filter((p): p is [string, string] => p[1] !== undefined)).toString();
  const r = await request(ctx, url, 'GET', query === '' ? path : `${path}?${query}`);
  if (r.kind === 'ok') return { kind: 'ok', body: r.body as T, text: r.text };
  if (r.kind === 'down') return { kind: 'failed', reason: `castlist に聞けない（${url} が応えない）`, down: true };
  if (r.kind === 'busy') return { kind: 'failed', reason: `castlist に聞けない（${url} が混んでいる。503）。少し待ってから打ち直す`, down: true };
  return { kind: 'failed', reason: r.error, down: false };
}

/** 聞いて、答えられなければ止める。 */
function must<T>(answer: Answer<T>): { body: T, text: string } {
  if (answer.kind === 'failed') throw new TpmError(answer.reason);
  return answer;
}

/** プロフィールの画面の URL。 */
export const profileUrl = (url: string, id: string): string => `${url}/actors/${encodeURIComponent(id)}`;

const flag = (on: boolean | undefined): string | undefined => on === true ? 'true' : undefined;
const many = (name: string, values: string[] | undefined): Params => (values ?? []).map(v => [name, v]);
const or = (value: string | null | undefined): string => value ?? '-';

/** 名（この project の roster が控えた物）なら id にし、ほかはそのまま id とみなす。 */
function actorId(ctx: Context, nameOrId: string): string {
  for (const file of ctx.state.list('sessions')) {
    const record = ctx.state.read<SessionRecord>(`sessions/${file}.jsonc`);
    if (record?.name === nameOrId) return record.id;
  }
  return nameOrId;
}

/** 頁の続き（next があれば、--after に渡す 1 行）。 */
const more = (next: unknown): string[] => typeof next === 'string' && next !== '' ? [`続きがある: --after ${next} を足して打ち直す`] : [];

/** 一覧の頭の 1 行。 */
const head = (what: string, n: number, asOf: unknown): string => n === 0 ? `当たる${what}は無い（castlist の時刻 ${String(asOf)}）` : `${what} ${n}（castlist の時刻 ${String(asOf)}）`;

/** アクター 1 行: 名・種類・状態（稼働中・停止。castlist の画面と同じ字）・登場と退場・最新の model と effort・ラベル・プロフィールの URL。 */
function actorLine(url: string, a: ActorItem): string {
  const exited = a.last_exited_at === null ? '-' : `${a.last_exited_at}（${or(a.last_exit_type)}）`;
  const labels = Object.entries(a.labels ?? {}).map(([k, v]) => `${k}=${v}`).join('・') || '-';
  return [a.name, a.kind, a.present ? '稼働中' : '停止', `登場 ${or(a.first_entered_at)}`, `退場 ${exited}`, `${or(a.model)}・${or(a.effort)}`, labels, profileUrl(url, a.id)].join('  ');
}

/** 線 1 本の行（名は点から引く）。 */
function edgeLine(names: Map<string, string>, e: Edge): string {
  return `- ${names.get(e.from) ?? e.from} → ${names.get(e.to) ?? e.to}（${e.type}・受けた ${e.received_at}）`;
}

const settingLine = (url: string, s: SettingRow): string => [s.received_at, s.actor_name, `${s.model}・${s.effort}（${s.source}）`, profileUrl(url, s.actor_id)].join('  ');

/** `roster castlist find`: アクターを探す（GET /v1/actors）。 */
export async function castlistFind(ctx: Context, options: FindOptions): Promise<string[]> {
  const url = requireUrl(ctx);
  const { body, text } = must(await ask<{ as_of: string, actors: ActorItem[], next: unknown }>(ctx, url, '/v1/actors', [
    ...many('label', options.label),
    ['binding', options.binding],
    ['at', options.at],
    ['active_from', options.activeFrom],
    ['active_to', options.activeTo],
    ['active', options.active],
    ['model', options.model],
    ['effort', options.effort],
    ['launched_by', options.launchedBy === undefined ? undefined : actorId(ctx, options.launchedBy)],
    ['skewed', flag(options.skewed)],
    ['kind', options.kind],
    ['sort', options.sort],
    ['order', options.order],
    ['limit', options.limit],
    ['after', options.after],
  ]));
  if (options.json === true) return [text];
  return [head('アクター', body.actors.length, body.as_of), ...body.actors.map(a => actorLine(url, a)), ...more(body.next)];
}

/** `roster castlist show`: 1 つのアクター（GET /v1/actors/<id>）と、線の要約（GET /v1/actors/<id>/lineage。上は人まで・下は 1 段）。 */
export async function castlistShow(ctx: Context, target: string, options: JsonOption): Promise<string[]> {
  const url = requireUrl(ctx);
  const id = actorId(ctx, target);
  const path = `/v1/actors/${encodeURIComponent(id)}`;
  const answer = await ask<ActorDetail>(ctx, url, path);
  if (answer.kind === 'failed' && !answer.down) {
    throw new TpmError(`${answer.reason}（${target}）。名で引けるのは、この project の roster が登録して控えたアクター（状態の folder の sessions/）だけ（castlist には名で引く道が無い）。id は roster castlist find で探す`);
  }
  const { body: a, text } = must(answer);
  if (options.json === true) return [text];
  const { body: lineage } = must(await ask<{ nodes: ActorItem[], edges: Edge[] }>(ctx, url, `${path}/lineage`));
  const names = new Map(lineage.nodes.map(n => [n.id, n.name]));
  const s = a.state;
  const now = s.present
    ? `稼働中（${or(s.presence)}・登場 ${or(s.entered_at)}）`
    : `停止（${s.presence ?? 'まだ登場が無い'}・登場 ${or(s.entered_at)}・最後の退場 ${or(s.exited_at)}）`;
  const c = a.current_settings;
  return [
    `${a.name}（${a.kind}・issuer ${a.issuer}）  ${profileUrl(url, a.id)}`,
    `id: ${a.id}`,
    `今: ${now}`,
    `model と effort: ${c === null ? 'まだ無い' : `${c.model}・${c.effort}（${c.source}・受けた ${c.received_at}）`}`,
    `ラベル: ${Object.entries(a.labels).map(([k, v]) => `${k}=${v}`).join('・') || '-'}`,
    `付随する id: ${a.current_bindings.map(b => `${b.type}:${b.value}${b.is_key ? '（鍵）' : ''}`).join('・') || '-'}`,
    lineage.edges.length === 0 ? '線: 無い' : '線（起こした・継いだ。上は人まで、下は 1 段）:',
    ...lineage.edges.map(e => edgeLine(names, e)),
  ];
}

/** `roster castlist lineage`: 誰が起こしたか・誰を起こしたか（GET /v1/actors/<id>/lineage）。 */
export async function castlistLineage(ctx: Context, target: string, options: LineageOptions): Promise<string[]> {
  const url = requireUrl(ctx);
  const id = actorId(ctx, target);
  const { body, text } = must(await ask<{ as_of: string, nodes: ActorItem[], edges: Edge[] }>(ctx, url, `/v1/actors/${encodeURIComponent(id)}/lineage`, [
    ['direction', options.direction],
    ['depth', options.depth],
    ['type', options.type],
  ]));
  if (options.json === true) return [text];
  const names = new Map(body.nodes.map(n => [n.id, n.name]));
  return [
    `${names.get(id) ?? id} の線（castlist の時刻 ${body.as_of}）`,
    '点:',
    ...body.nodes.map(n => `- ${n.name}（${n.kind}）  ${profileUrl(url, n.id)}`),
    body.edges.length === 0 ? '線: 無い' : '線:',
    ...body.edges.map(e => edgeLine(names, e)),
  ];
}

/** `roster castlist events`: 出来事を、アクターをまたいで（GET /v1/events）。 */
export async function castlistEvents(ctx: Context, options: EventsOptions): Promise<string[]> {
  const url = requireUrl(ctx);
  const { body, text } = must(await ask<{ as_of: string, events: EventRow[], next: unknown }>(ctx, url, '/v1/events', [
    ...many('type', options.type),
    ['actor', options.actor === undefined ? undefined : actorId(ctx, options.actor)],
    ['from', options.from],
    ['to', options.to],
    ['reason', options.reason],
    ['source', options.source],
    ['skewed', flag(options.skewed)],
    ['limit', options.limit],
    ['after', options.after],
  ]));
  if (options.json === true) return [text];
  return [
    head('出来事', body.events.length, body.as_of),
    ...body.events.map(e => [e.received_at, e.actor_name, e.type, JSON.stringify(e.detail), profileUrl(url, e.actor_id)].join('  ')),
    ...more(body.next),
  ];
}

/**
 * `roster castlist settings`: model と effort の行。--actor があれば、そのアクターの行（GET /v1/actors/<id>/settings。--at でその時に効いていた 1 行）、
 * 無ければアクターをまたいで（GET /v1/settings）。どちらにも、ほかの旗をそのまま送る（受けない引数は castlist が断る）。
 */
export async function castlistSettings(ctx: Context, options: SettingsOptions): Promise<string[]> {
  const url = requireUrl(ctx);
  const params: Params = [
    ['at', options.at],
    ['model', options.model],
    ['effort', options.effort],
    ['source', options.source],
    ['from', options.from],
    ['to', options.to],
    ['mismatch', flag(options.mismatch)],
    ['skewed', flag(options.skewed)],
    ['limit', options.limit],
    ['after', options.after],
  ];
  if (options.actor !== undefined) {
    const id = actorId(ctx, options.actor);
    const { body, text } = must(await ask<{ as_of: string, setting?: SettingRow | null, settings?: SettingRow[] }>(ctx, url, `/v1/actors/${encodeURIComponent(id)}/settings`, params));
    if (options.json === true) return [text];
    if (body.settings !== undefined) return [head('model と effort の行', body.settings.length, body.as_of), ...body.settings.map(s => settingLine(url, s))];
    return body.setting === null || body.setting === undefined ? [`その時（${options.at ?? ''}）の model と effort は、まだ無い（castlist の時刻 ${body.as_of}）`] : [settingLine(url, body.setting)];
  }
  const { body, text } = must(await ask<{ as_of: string, settings: SettingRow[], next: unknown }>(ctx, url, '/v1/settings', params));
  if (options.json === true) return [text];
  return [head('model と effort の行', body.settings.length, body.as_of), ...body.settings.map(s => settingLine(url, s)), ...more(body.next)];
}

/**
 * 時刻 at に、席 seat（担当は課題の Key、TPM 担当は tpm）に居たアクター（roster incident timeline のアクターの欄）。
 * この project のラベル（tpm.project と、tpm.key か tpm.role=tpm）で、居た間がその時刻に掛かる者を聞く。
 */
export async function seatActorsAt(ctx: Context, url: string, seat: string, at: string): Promise<Answer<{ actors: ActorItem[] }>> {
  return await ask(ctx, url, '/v1/actors', [
    ['label', `tpm.project:${ctx.project}`],
    ['label', seat === 'tpm' ? 'tpm.role:tpm' : `tpm.key:${seat}`],
    ['active_from', at],
    ['active_to', at],
  ]);
}
