// castlist（別の repo。127.0.0.1 で待つ、アクターの台帳のサーバー）への組み込み。API は castlist の docs/src/api.md。
// アクターは Claude Code の session 1 つ（担当・TPM 担当・Auditor）と、人の Product Manager。tpm は、登録・出来事・線・model と effort を送る。
// 設定（config.jsonc の castlist か $TPM_CASTLIST_URL）が無ければ、どれも何もしない。
// 送るのは curl（置き場の pagetray と同じ。命令が同期なので）。castlist を起こすのは Product Manager だけで、止まっていれば打つ 1 行を出す。
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs';
import { basename } from 'node:path';
import type { Context } from './context.ts';
import { ROLE_NAMES, type RoleName } from './protocol.ts';
import { readRole } from './roster.ts';
import { TpmError } from './skill-sets.ts';

/**
 * castlist が止まっている時に Product Manager へ出す `container run` の image の版。
 * castlist の release を出したら、ここと試験の版を上げる（決まりは docs の開発の「castlist を上げる時」と、castlist の docs の「release を出す」）。
 */
export const CASTLIST_VERSION = 'v0.4.0';
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

/** castlist の URL が受ける形（tpm を動かす機械の中だけ）。 */
const URL_FORM = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/?$/;

/** castlist の URL（末尾の / は落とす）。$TPM_CASTLIST_URL、無ければ project の folder の設定の castlist。どちらも無ければ undefined（castlist に何も送らない）。 */
export function castlistUrl(ctx: Pick<Context, 'env' | 'config'>): string | undefined {
  const url = ctx.env.TPM_CASTLIST_URL || ctx.config.castlist;
  if (url === undefined) return undefined;
  if (!URL_FORM.test(url)) throw new TpmError(`$TPM_CASTLIST_URL は http://127.0.0.1:<port> か http://localhost:<port> の形にしてください: ${url}`);
  return url.replace(/\/+$/, '');
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

/** castlist に頼む。body があれば JSON で送る。Origin は付けない（castlist は Origin の付いた書く要求を断る）。 */
export function request(ctx: Pick<Context, 'exec'>, url: string, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, timeout = REQUEST_TIMEOUT): Reply {
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
 */
export function pmStartLines(ctx: Pick<Context, 'exec'>, url: string): string[] {
  if (exists(ctx, CASTLIST_CONTAINER)) return [`container start ${CASTLIST_CONTAINER}`];
  if (exists(ctx, LEGACY_CONTAINER)) {
    return [
      `container start ${LEGACY_CONTAINER}`,
      `（前の名 ${LEGACY_CONTAINER} で動いています。次に版を上げる時に、名を ${CASTLIST_CONTAINER} にして起こし直します: ${CASTLIST_DOCS}run.html の「版を上げる」）`,
    ];
  }
  return [`container run -d --name ${CASTLIST_CONTAINER} -p 127.0.0.1:${portOf(url)}:8080 -v castlist-data:/data -m 200M -c 1 ghcr.io/uraitakahito/castlist:${CASTLIST_VERSION}`];
}

/** castlist が止まっている時の文。done はしなかった事、after は 1 行の後に続ける行。打つ 1 行は、それだけで 1 行に置く。 */
export function downMessage(ctx: Pick<Context, 'exec'>, url: string, done: string, after: string[] = []): string {
  return [
    `castlist（${url}）が応えません。${done}castlist を起こすのは Product Manager です。Product Manager が自分の terminal で次の 1 行を打ちます（docs: ${CASTLIST_DOCS}）:`,
    ...pmStartLines(ctx, url),
    ...after,
  ].join('\n');
}

/** castlist が混んでいる（503）時の文。 */
export const busyMessage = (url: string, done: string): string => `castlist（${url}）が混んでいます（503）。${done}少し待ってから打ち直してください`;

/**
 * 起こす前（tpm start・tpm assign・tpm audit start・tpm hello）に、castlist が起きているかを /healthz で見る。設定が無ければ何もしない。
 * 止まっていれば、done（しなかった事）と Product Manager が打つ 1 行を添えて止める。起きていれば、時計の差が 2 秒を超える時だけ 1 行を返す（止めない）。
 */
export function requireUp(ctx: Pick<Context, 'env' | 'config' | 'exec' | 'now'>, done: string, after: string[] = []): string[] {
  const url = castlistUrl(ctx);
  if (url === undefined) return [];
  const r = request(ctx, url, 'GET', '/healthz', undefined, HEALTH_TIMEOUT);
  if (r.kind === 'busy') throw new TpmError(busyMessage(url, done));
  if (r.kind !== 'ok') throw new TpmError(downMessage(ctx, url, done, after));
  const now = (r.body as { now?: unknown } | undefined)?.now;
  if (typeof now !== 'string' || Number.isNaN(Date.parse(now))) return [];
  const at = Date.parse(now);
  const skew = at - ctx.now().getTime();
  if (Math.abs(skew) <= MAX_SKEW_MS) return [];
  return [`castlist の時計と、tpm を動かす機械の時計が ${Number((Math.abs(skew) / 1000).toFixed(1))} 秒ずれています（castlist ${now}・tpm ${ctx.now().toISOString()}）。castlist の記録の時刻がずれるので、tpm report incident で台帳に挙げてください（止めてはいない）`];
}

/** この project の issuer。 */
export const issuerOf = (ctx: Pick<Context, 'state'>): string => castlistIssuer(ctx.state.dir);

/** Claude Code の session を指す鍵の付随する id（`claude.session:<session の id>`。session の登録の鍵）。 */
export const sessionRef = (sid: string): string => `claude.session:${sid}`;

/** 人の Product Manager を登録する（tpm start。鍵が同じなので何度打っても同じアクター）。 */
export function registerPm(ctx: Context, url: string): Reply {
  return request(ctx, url, 'POST', '/v1/actors', {
    issuer: issuerOf(ctx),
    kind: 'human',
    name_prefix: 'product-manager',
    labels: { 'tpm.project': ctx.project },
    bindings: [{ type: PM_REF.split(':')[0], value: PM_REF.split(':')[1] }],
    sent_at: ctx.now().toISOString(),
  });
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
 * 今の周りの席。$TPM_KEY があれば名簿の行（無ければ $TPM_ROLE）の役割の担当、Auditor は project に 1 つの席。
 * Staff Engineer 担当の席は、名の接頭辞を課題の Key から作り（`ai-33-staff`）、見ている課題の Key を subject に持つ。
 * $TPM_KEY が無ければ TPM 担当（castlist の hook と guard は、tpm が起こした session にしか付かない）。
 */
export function seatOf(ctx: Context): Seat {
  const key = ctx.env.TPM_KEY || undefined;
  const fromEnv = (ROLE_NAMES as string[]).includes(ctx.env.TPM_ROLE ?? '') ? ctx.env.TPM_ROLE as RoleName : undefined;
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
