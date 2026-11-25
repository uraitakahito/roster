// castlist（別の repo。127.0.0.1 で待つ、アクターの台帳のサーバー）への組み込み。API は castlist の docs/src/api.md。
// アクターは Claude Code の session 1 つ（担当・TPM 担当・Auditor）と、人の Product Manager。roster は、登録・出来事・線・model と effort を送る。
// 設定（config.jsonc の castlist か $ROSTER_CASTLIST_URL）が無ければ、どれも何もしない。
// 送るのは curl（置き場の pagetray と同じ。spawnSync で打つ。命令の形は非同期で、request が Promise を返す）。castlist を起こすのは Product Manager だけで、止まっていれば打つ 1 行を出す。
// 設定の api.castlist が next なら、書く物（登録・出来事・線・model と effort）は生成した client で新しい API に送る（registerActor・putRecord。AI-36 の段 6c）。
// 答えは、どちらの道でも同じ Reply の形にする（呼ぶ側は替えない）。読む物（/healthz・アクター・線・監査の検索）も、next なら生成した client で聞く（castlist-query.ts の query）。
import type { HttpHandler } from '@smithy/core/protocols';
import type { DocumentType } from '@smithy/types';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs';
import { basename } from 'node:path';
import type * as Castlist from '../gen/castlist-client/dist-types/index.js';
import { castlistApi, clientConfig, nextApi, sendOnce, withoutAwsMiddleware } from './clients.ts';
import type { Context } from './context.ts';
import { atLeast } from './commands/store.ts';
import { ROLE_NAMES, type RoleName } from './protocol.ts';
import { readRole } from './roster.ts';
import { TpmError } from './skill-sets.ts';
import { envOf } from './env.ts';

/**
 * castlist が止まっている時に Product Manager へ出す `container run` の image の版。
 * castlist の release を出したら、ここと試験の版を上げる（決まりは docs の開発の「castlist を上げる時」と、castlist の docs の「release を出す」）。
 */
export const CASTLIST_VERSION = 'v0.4.0';
/**
 * 設定の api.castlist が next の時に、castlist が止まっていれば Product Manager へ出す `container run` の image の版（新しい API の castlist。gen/gen.sh の DEFS の castlist の tag と揃える）。
 * 切り替え（AI-36 の段 8）の後は、CASTLIST_VERSION を上げて、これを消す。
 */
export const CASTLIST_NEXT_VERSION = 'v1.0.0-rc.1';
/** 新しい API を持つ castlist の版（/healthz の version がこれより前なら、api.castlist の next では送らない）。 */
export const NEXT_API_SINCE = '1.0.0';
/** 新しい API の castlist の volume（今の volume の castlist-data では起こさない。castlist の docs の release.html の「rc を動かす時と切り替え」）。 */
const NEXT_VOLUME = 'castlist-data-v1';
/** castlist の docs（動かし方）。 */
export const CASTLIST_DOCS = 'https://uraitakahito.github.io/castlist/';

/** Product Manager のアクターの鍵の付随する id。 */
export const PM_REF = 'tpm.person:product-manager';

/** 送り手の時計と castlist の時計の差の上限（ミリ秒）。超えたら、台帳に挙げるよう 1 行出す。 */
const MAX_SKEW_MS = 2000;
/** /healthz を待つ秒（起こす前に見るので、長くは待たない）。 */
const HEALTH_TIMEOUT = '1';
/** 書く要求と、監査の検索を読む要求を待つ秒（castlist は 1 つの問い合わせを 5 秒で切る）。 */
const REQUEST_TIMEOUT = '6';
/** 名の接頭辞の長さの上限（castlist の決まり）。 */
const PREFIX_LIMIT = 32;
/** issuer の長さの上限（castlist の決まり）。 */
const ISSUER_LIMIT = 64;

/** 役割の、名の接頭辞に使う略。 */
const ROLE_ABBREV = {
  'software-engineer': 'swe',
  'devops-engineer': 'devops',
  'sustaining-engineer': 'sus',
  'staff-engineer': 'staff',
  'auditor': 'audit',
} as const satisfies Record<RoleName, string>;

/** castlist の URL が受ける形（roster を動かす機械の中だけ）。 */
const URL_FORM = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/?$/;

/** castlist の URL（末尾の / は落とす）。$ROSTER_CASTLIST_URL、無ければ project の folder の設定の castlist。どちらも無ければ undefined（castlist に何も送らない）。 */
export function castlistUrl(ctx: Pick<Context, 'env' | 'config'>): string | undefined {
  const url = envOf(ctx.env, 'CASTLIST_URL') || ctx.config.castlist;
  if (url === undefined) return undefined;
  if (!URL_FORM.test(url)) throw new TpmError(`$ROSTER_CASTLIST_URL は http://127.0.0.1:<port> か http://localhost:<port> の形にしてください: ${url}`);
  return url.replace(/\/+$/, '');
}

/** 警告に書く、足す 1 行の URL（castlist の docs の「動かす」の既定の port）。 */
const SUGGESTED_URL = 'http://127.0.0.1:8802';
/** 警告の枠の線。 */
const RULE = '━'.repeat(40);

/**
 * castlist を設定していない時に、roster start と roster hello が出す警告の枠（設定していれば空）。
 * 決め方は castlistUrl と同じ（送らない時にだけ出す）。設定の file が無ければ、作って書くよう言い分ける。
 * 足すのは Product Manager が決めることなので、どの席の名乗りにも、誰が足すかを添える。直下の folder の設定にだけ castlist があれば、読まないことを名指す（project の folder の設定だけが効くため）。
 */
export function missingCastlistWarning(ctx: Pick<Context, 'env' | 'config'>): string[] {
  if (castlistUrl(ctx) !== undefined) return [];
  const [own, ...folders] = ctx.config.sources;
  const unread = folders.filter(s => s.config.castlist !== undefined).map(s => s.name);
  return [
    RULE,
    '⚠ 警告: castlist（アクターの台帳）を設定していません',
    own?.exists === true
      ? `  ${own.file} に castlist の行が無いので、この project の席は castlist に何も送りません（タイムラインに出ません）。`
      : `  ${own?.file ?? '.claude/roles/config.jsonc'} が無いので、この project の席は castlist に何も送りません（タイムラインに出ません）。`,
    own?.exists === true ? `  足す 1 行: "castlist": "${SUGGESTED_URL}"` : `  作って書く 1 行: { "castlist": "${SUGGESTED_URL}" }`,
    ...(unread.length === 0 ? [] : [`  （直下の folder の設定に castlist がありますが、読みません: ${unread.join('・')}）`]),
    '  （足すかは Product Manager が決める。担当は何もしなくてよい。TPM 担当が伝える）',
    RULE,
  ];
}

/** 行を強める（赤の太字）。出す先が terminal で、NO_COLOR が無い時だけ（file や pipe に色の符号を混ぜない）。 */
export function emphasize(lines: string[], out: { isTTY: boolean, env: NodeJS.ProcessEnv }): string[] {
  if (!out.isTTY || (out.env.NO_COLOR ?? '') !== '') return lines;
  return lines.map(line => `\u001b[1;31m${line}\u001b[0m`);
}

/** 英小文字・数字・- だけにする（castlist の名の接頭辞の字）。 */
const slug = (text: string): string => text.toLowerCase().replaceAll(/[^a-z0-9-]+/g, '-').replaceAll(/-+/g, '-').replace(/^-|-$/g, '');

/** 頭の字を残し、後ろに suffix を付けて limit 字に収める。 */
const fit = (head: string, suffix: string, limit: number): string => `${head.slice(0, limit - suffix.length).replace(/-$/, '')}${suffix}`;

/**
 * issuer（アクターの名の番号を数える単位）。`tpm.` と状態の folder の名（project の path から作る。英小文字にし、castlist の受ける字に替える）。
 * castlist の上限（64 字）を超える名は、頭を残して元の名の hash を足す（別の project と重ならないように）。
 */
export function castlistIssuer(stateDir: string): string {
  const key = basename(stateDir);
  const issuer = `tpm.${key.toLowerCase().replaceAll(/[^a-z0-9.-]/g, '-')}`;
  if (issuer.length <= ISSUER_LIMIT) return issuer;
  return fit(issuer, `-${createHash('sha256').update(key).digest('hex').slice(0, 8)}`, ISSUER_LIMIT);
}

/** Key を持つ担当の名の接頭辞（`<Key>-<役割の略>`。castlist の接頭辞は `.` を受けないので `-` でつなぐ）。 */
export function seatPrefix(key: string, role: RoleName): string {
  return fit(slug(key) || 'seat', `-${ROLE_ABBREV[role]}`, PREFIX_LIMIT);
}

/** project に 1 つの席（TPM 担当・Auditor）の名の接頭辞（`<project の folder の名>-tpm` など）。 */
export function projectPrefix(project: string, seat: 'tpm' | 'audit'): string {
  return fit(slug(basename(project)) || 'project', `-${seat}`, PREFIX_LIMIT);
}

/** castlist の答え。ok の text は答えの本文の字のまま（--json で出す）。down は、つながらない・時間内に答えない。busy は 503（混んでいる）。 */
export type Reply = { kind: 'ok', code: number, body: unknown, text: string } | { kind: 'down' } | { kind: 'busy' } | { kind: 'refused', code: number, error: string };

/**
 * castlist に頼む。body があれば JSON で送る。Origin は付けない（castlist は Origin の付いた書く要求を断る）。
 * 今は curl を spawnSync で打つので、待つ物は無い。形だけ非同期にしておき、後で Promise を返す HTTP の client に替える（AI-36）。
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function request(ctx: Pick<Context, 'exec'>, url: string, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, timeout = REQUEST_TIMEOUT): Promise<Reply> {
  const input = body === undefined ? undefined : JSON.stringify(body);
  const args = ['-sS', '--max-time', timeout, '-X', method, '-w', '\n%{http_code}', ...(input === undefined ? [] : ['-H', 'Content-Type: application/json', '--data-binary', '@-']), `${url}${path}`];
  const r = ctx.exec('curl', args, input === undefined ? undefined : { input });
  const cut = r.stdout.lastIndexOf('\n');
  const code = Number(r.stdout.slice(cut + 1).trim());
  if (r.status !== 0 || !Number.isInteger(code) || code === 0) return { kind: 'down' };
  if (code === 503) return { kind: 'busy' };
  const text = r.stdout.slice(0, Math.max(cut, 0));
  let parsed: unknown;
  try {
    parsed = text === '' ? undefined : JSON.parse(text);
  }
  catch {
    parsed = text;
  }
  if (code >= 200 && code < 300) return { kind: 'ok', code, body: parsed, text };
  const error = typeof parsed === 'object' && parsed !== null && typeof (parsed as { error?: unknown }).error === 'string' ? (parsed as { error: string }).error : text.trim();
  return { kind: 'refused', code, error };
}

/**
 * 生成した castlist の client を作る（castlist の client を作る所は、ここだけ）。送り直さず、時間切れは書く要求の curl と同じ（REQUEST_TIMEOUT）。
 * Host は URL の名と port（curl と同じ字。castlist は 127.0.0.1・localhost でない Host を断る）で、Origin は付けない。requestHandler は試験が偽の HTTP を差し込む所。
 */
export function castlistClient(url: string, requestHandler?: HttpHandler): Castlist.CastlistClient {
  const { CastlistClient } = castlistApi();
  return withoutAwsMiddleware(new CastlistClient(clientConfig(url, Number(REQUEST_TIMEOUT) * 1000, requestHandler)));
}

/** 誤りの型の無い 404 の訳: 新しい API の道を持たない castlist（今の 0.x の版）が答えた物（設定の api.castlist と castlist の版が合わない）。 */
const OUTDATED = 'castlist が新しい API を持たない（設定の api.castlist は next だが、castlist の版が 1.0.0 より前に見える。castlist の版か、設定の api を見る）';

/** castlist に書く要求の周り（設定・状態の folder の issuer・時計・curl・生成した client）。 */
export type Sender = Pick<Context, 'config' | 'state' | 'now' | 'exec' | 'clients'>;

/**
 * 生成した client で 1 つ送り（clients.ts の sendOnce）、答えを今の形にする。本文は shape で今の道の本文に合わせ、text はその JSON。
 * code は、答えの status（書く物）か、HTTP の状態の数（読む物）。wait は送る 1 回の全部の上限の秒（今の curl の --max-time と同じ。/healthz は HEALTH_TIMEOUT）。
 * 答えの無い物と読めない 2xx は down、503（Unavailable）は busy、ほかの誤りは refused（訳は本文の message。型の無い 404 は版が合わないと言う）。
 */
export async function viaNext<O extends { $metadata: { httpStatusCode?: number } }>(ctx: Pick<Context, 'clients'>, url: string, send: (client: Castlist.CastlistClient, api: typeof Castlist, options: { abortSignal: AbortSignal }) => Promise<O>, shape: (out: O) => unknown, wait: string = REQUEST_TIMEOUT): Promise<Reply> {
  const sent = await sendOnce(() => ctx.clients.castlist(url), (client, options) => send(client, castlistApi(), options), { server: 'castlist', wait: Number(wait) * 1000, outdated: OUTDATED });
  if (sent.kind === 'down') return { kind: 'down' };
  if (sent.kind === 'failed') return sent.code === 503 ? { kind: 'busy' } : { kind: 'refused', code: sent.code, error: sent.message };
  const body = shape(sent.out);
  const status = (sent.out as { status?: unknown }).status;
  return { kind: 'ok', code: typeof status === 'number' ? status : sent.out.$metadata.httpStatusCode ?? 200, body, text: JSON.stringify(body) };
}

/** 登録するアクター（欄の名は新しい API の名。issuer と送り手の時刻は registerActor が足す）。 */
export interface ActorInput {
  kind: 'ai' | 'human'
  namePrefix: string
  labels: Record<string, string>
  /** 付随する id（初めの物が鍵）。 */
  bindings: { type: string, value: string }[]
  /** 頼んだ model と effort。 */
  settings?: { model: string, effort: string }
}

/**
 * アクターを登録する。今の道は POST /v1/actors、next は RegisterActor（POST /api/actors）。
 * ok の本文は、どちらも今の道の形（id・name・kind・created）。
 */
export async function registerActor(ctx: Sender, url: string, actor: ActorInput): Promise<Reply> {
  const issuer = issuerOf(ctx);
  const sentAt = ctx.now();
  if (nextApi(ctx, 'castlist')) {
    return viaNext(ctx, url, (client, api, options) => client.send(new api.RegisterActorCommand({ issuer, ...actor, sentAt }), options), out => ({ ...out.actor, created: out.created }));
  }
  const { kind, namePrefix, labels, bindings, settings } = actor;
  return request(ctx, url, 'POST', '/v1/actors', { issuer, kind, name_prefix: namePrefix, labels, bindings, sent_at: sentAt.toISOString(), ...(settings === undefined ? {} : { settings }) });
}

/** 送り手が id を決めて足す物の本文（issuer と送り手の時刻は putRecord が足す）。欄の名は、今の道と新しい API で同じ。 */
export interface RecordInput {
  /** 出来事。 */
  events: { by: string, type: string, detail: Record<string, unknown> }
  /** 線。 */
  links: { type: string, from: string, to: string }
  /** model と effort。 */
  settings: { by: string, model: string, effort: string, source: string }
}

/** 答えの $metadata と status を除いた、足した行。 */
const rowOf = (out: object): Record<string, unknown> => Object.fromEntries(Object.entries(out).filter(([k]) => k !== '$metadata' && k !== 'status'));

/**
 * 出来事・線・model と effort を、決めた id で足す。今の道は PUT /v1/<kind>/<id>、next は PutEvent・PutLink・PutSetting（PUT /api/<kind>/<id>）。
 * 同じ id で本文が違えば、どちらも 409（refused）。
 */
export async function putRecord<K extends keyof RecordInput>(ctx: Sender, url: string, kind: K, id: string, body: RecordInput[K]): Promise<Reply> {
  const issuer = issuerOf(ctx);
  const sentAt = ctx.now();
  if (!nextApi(ctx, 'castlist')) return request(ctx, url, 'PUT', `/v1/${kind}/${encodeURIComponent(id)}`, { issuer, ...body, sent_at: sentAt.toISOString() });
  return viaNext<Castlist.PutEventCommandOutput | Castlist.PutLinkCommandOutput | Castlist.PutSettingCommandOutput>(ctx, url, (client, api, options) => {
    switch (kind) {
      case 'events': {
        const { detail, ...rest } = body as RecordInput['events'];
        return client.send(new api.PutEventCommand({ eventId: id, issuer, ...rest, detail: detail as DocumentType, sentAt }), options);
      }
      case 'links': return client.send(new api.PutLinkCommand({ linkId: id, issuer, ...body as RecordInput['links'], sentAt }), options);
      default: return client.send(new api.PutSettingCommand({ settingId: id, issuer, ...body as RecordInput['settings'], sentAt }), options);
    }
  }, rowOf);
}

/** URL の port（書いていなければ http の 80）。 */
const portOf = (url: string): string => new URL(url).port || '80';

/** castlist の container の名（0.1.1 から。同じ network の container が DNS の domain box で名で引く）。 */
export const CASTLIST_CONTAINER = 'castlist.box';
/** 0.1.0 の docs の container の名。この名で動かしている間は、この名で起こし直す。 */
const LEGACY_CONTAINER = 'castlist';

/** container が在るか（`container inspect <名>` が通る。読むだけの命令）。 */
const exists = (ctx: Pick<Context, 'exec'>, name: string): boolean => ctx.exec('container', ['inspect', name]).status === 0;

/**
 * castlist が止まっている時に、Product Manager が自分の terminal で打つ 1 行（と、要れば添える行）。
 * 新しい名の container が在れば起こし直し、0.1.0 の名の container だけが在ればその名で起こし直して名を替える docs を添え、どちらも無ければ作って起こす。
 * 作って起こす時、設定の api.castlist が next なら、新しい API の版の image を新しい volume で起こし、今の volume の記録を先に移す docs を添える。
 */
export function pmStartLines(ctx: Pick<Context, 'exec' | 'config'>, url: string): string[] {
  if (exists(ctx, CASTLIST_CONTAINER)) return [`container start ${CASTLIST_CONTAINER}`];
  if (exists(ctx, LEGACY_CONTAINER)) {
    return [
      `container start ${LEGACY_CONTAINER}`,
      `（前の名 ${LEGACY_CONTAINER} で動いています。次に版を上げる時に、名を ${CASTLIST_CONTAINER} にして起こし直します: ${CASTLIST_DOCS}run.html の「版を上げる」）`,
    ];
  }
  const run = (volume: string, version: string): string => `container run -d --name ${CASTLIST_CONTAINER} -p 127.0.0.1:${portOf(url)}:8080 -v ${volume}:/data -m 200M -c 1 ghcr.io/uraitakahito/castlist:${version}`;
  if (!nextApi(ctx, 'castlist')) return [run('castlist-data', CASTLIST_VERSION)];
  return [
    run(NEXT_VOLUME, CASTLIST_NEXT_VERSION),
    `（新しい API の castlist は、新しい volume（${NEXT_VOLUME}）で起こす。今の volume（castlist-data）の記録は、先に移す: ${CASTLIST_DOCS}release.html の「rc を動かす時と切り替え」）`,
  ];
}

/** castlist が止まっている時の文。done はしなかった事、after は 1 行の後に続ける行。打つ 1 行は、それだけで 1 行に置く。 */
export function downMessage(ctx: Pick<Context, 'exec' | 'config'>, url: string, done: string, after: string[] = []): string {
  return [
    `castlist（${url}）が応えません。${done}castlist を起こすのは Product Manager です。Product Manager が自分の terminal で次の 1 行を打ちます（docs: ${CASTLIST_DOCS}）:`,
    ...pmStartLines(ctx, url),
    ...after,
  ].join('\n');
}

/** castlist が混んでいる（503）時の文。 */
export const busyMessage = (url: string, done: string): string => `castlist（${url}）が混んでいます（503）。${done}少し待ってから打ち直してください`;

/**
 * 起こす前（roster start・roster assign・roster audit start・roster hello）に、castlist が起きているかを /healthz で見る。設定が無ければ何もしない。
 * 止まっていれば、done（しなかった事）と Product Manager が打つ 1 行を添えて止める。起きていれば、時計の差が 2 秒を超える時だけ 1 行を返す（止めない）。
 * 設定の api.castlist が next なら GetHealth（同じ /healthz。待つのも同じ 1 秒）で聞き、答えの version が新しい API を持たない版（NEXT_API_SINCE より前）なら止める
 * （今の版の castlist に新しい API の道で書くと、どれも断られるため。今の API には版を聞く道が無いので、/healthz の version で見る）。
 */
export async function requireUp(ctx: Pick<Context, 'env' | 'config' | 'exec' | 'now' | 'clients'>, done: string, after: string[] = []): Promise<string[]> {
  const url = castlistUrl(ctx);
  if (url === undefined) return [];
  const next = nextApi(ctx, 'castlist');
  const r = next
    ? await viaNext(ctx, url, (client, api, options) => client.send(new api.GetHealthCommand({}), options), out => ({ status: out.status, version: out.version, now: out.now?.toISOString() }), HEALTH_TIMEOUT)
    : await request(ctx, url, 'GET', '/healthz', undefined, HEALTH_TIMEOUT);
  if (r.kind === 'busy') throw new TpmError(busyMessage(url, done));
  if (r.kind !== 'ok') throw new TpmError(downMessage(ctx, url, done, after));
  const answered = (r.body as { version?: unknown } | undefined)?.version;
  const version = typeof answered === 'string' ? answered : '';
  if (next && !atLeast(version, NEXT_API_SINCE)) {
    throw new TpmError(`castlist（${url}）の版は ${version || 'わからない'} で、新しい API（${NEXT_API_SINCE} から）を持ちません。${done}設定の api.castlist を外すか、castlist を新しい版に替えてください（Product Manager に伝える）`);
  }
  const now = (r.body as { now?: unknown } | undefined)?.now;
  if (typeof now !== 'string' || Number.isNaN(Date.parse(now))) return [];
  const at = Date.parse(now);
  const skew = at - ctx.now().getTime();
  if (Math.abs(skew) <= MAX_SKEW_MS) return [];
  return [`castlist の時計と、roster を動かす機械の時計が ${Number((Math.abs(skew) / 1000).toFixed(1))} 秒ずれています（castlist ${now}・roster ${ctx.now().toISOString()}）。castlist の記録の時刻がずれるので、roster report incident で台帳に挙げてください（止めてはいない）`];
}

/** この project の issuer。 */
export const issuerOf = (ctx: Pick<Context, 'state'>): string => castlistIssuer(ctx.state.dir);

/** Claude Code の session を指す鍵の付随する id（`claude.session:<session の id>`。session の登録の鍵）。 */
export const sessionRef = (sid: string): string => `claude.session:${sid}`;

/** 人の Product Manager を登録する（roster start。鍵が同じなので何度打っても同じアクター）。 */
export async function registerPm(ctx: Context, url: string): Promise<Reply> {
  const [type = '', value = ''] = PM_REF.split(':');
  return registerActor(ctx, url, { kind: 'human', namePrefix: 'product-manager', labels: { 'tpm.project': ctx.project }, bindings: [{ type, value }] });
}

/** この session の席: 名の接頭辞・役割・Key。 */
export interface Seat {
  prefix: string
  /** 役割（TPM 担当は tpm）。 */
  role: string
  /** 名簿の Key（席を 1 つに決める。Staff Engineer 担当の席は `<課題の Key>.staff`）。 */
  key?: string
  /** 見ている課題の Key（Staff Engineer 担当の席だけ）。 */
  subject?: string
}

/**
 * 今の周りの席。$ROSTER_KEY があれば名簿の行（無ければ $ROSTER_ROLE）の役割の担当、Auditor は project に 1 つの席。
 * Staff Engineer 担当の席は、名の接頭辞を課題の Key から作り（`ai-33-staff`）、見ている課題の Key を subject に持つ。
 * $ROSTER_KEY が無ければ TPM 担当（castlist の hook と guard は、roster が起こした session にしか付かない）。
 */
export function seatOf(ctx: Context): Seat {
  const key = envOf(ctx.env, 'KEY');
  const envRole = envOf(ctx.env, 'ROLE');
  const fromEnv = (ROLE_NAMES as string[]).includes(envRole ?? '') ? envRole as RoleName : undefined;
  const record = key === undefined ? undefined : readRole(ctx, key);
  const role = key === undefined ? undefined : record?.role ?? fromEnv;
  if (role === 'auditor') return { prefix: projectPrefix(ctx.project, 'audit'), role, ...(key === undefined ? {} : { key }) };
  if (key !== undefined && role !== undefined) {
    const subject = record?.subject;
    return { prefix: seatPrefix(subject ?? key, role), role, key, ...(subject === undefined ? {} : { subject }) };
  }
  return { prefix: projectPrefix(ctx.project, 'tpm'), role: 'tpm' };
}

/** 写しから読んだ model。none は、まだ答えの行が無い。 */
export type SeenModel = { kind: 'found', model: string } | { kind: 'none' } | { kind: 'unreadable', reason: string };

/** 写しの終わりから読む大きさ（バイト）。 */
const TAIL_BYTES = 1024 * 1024;

/**
 * Claude Code の写し（transcript_path の JSONL）の終わりから、model を読む: `type` が assistant で `message.model` が claude- で始まる、最後の行。
 * `<synthetic>`（Claude Code が自分で足す行）は飛ばす。写しが無い・JSONL でない・assistant の行に model の欄が無いなら、形が変わったとみなす（unreadable）。
 */
export function modelOf(path: unknown): SeenModel {
  if (typeof path !== 'string' || path === '' || !existsSync(path)) return { kind: 'unreadable', reason: 'no-transcript' };
  const fd = openSync(path, 'r');
  let text: string;
  let cut: boolean;
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    text = buffer.toString('utf8');
    cut = size > length;
  }
  finally {
    closeSync(fd);
  }
  const lines = text.split('\n').slice(cut ? 1 : 0).filter(l => l.trim() !== '');
  let parsed = 0;
  let strange = false;
  for (const line of lines.reverse()) {
    let entry: { type?: unknown, message?: { model?: unknown } };
    try {
      entry = JSON.parse(line) as typeof entry;
      parsed += 1;
    }
    catch {
      continue;
    }
    if (entry.type !== 'assistant') continue;
    const model = entry.message?.model;
    if (typeof model === 'string' && model.startsWith('claude-')) return { kind: 'found', model };
    if (model !== '<synthetic>') strange = true;
  }
  if (lines.length > 0 && parsed === 0) return { kind: 'unreadable', reason: 'not-jsonl' };
  return strange ? { kind: 'unreadable', reason: 'no-model' } : { kind: 'none' };
}
