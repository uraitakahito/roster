// 席（Claude Code の session）の「トークンの使用量」の取り込み: session の記録（写し）から数だけを読み、castlist の数の表（PutUsage）へ送る。
// 数える中身は usage.ts（純な関数）。ここは、写しの file を読む・どこまで読んだかを控える・castlist へ送る、をする。
//
// 掛け所は 3 つ: 席が閉じる時の hook（roster castlist session-end）・席を閉じる命令（roster close）・TPM 担当の側の、1 時間に 1 度の片付け（名乗る時と、送る命令の時）。
// どれも、誤りでも呼んだ命令を止めない（castlist の行は消せないので、数え違いを送るより、送らない方へ倒す）。
//
// 控え（状態の folder の usage/<session の id>.jsonc）:
// - files: 写しの file ごとの、読んだ所（バイト。行の終わりまで）。
// - ids: 数えた応答の id（みな）。読みを分けた時に同じ応答を 2 度数えないためと、同じ起こしのほかの session（resume・fork で写しを持つ file）で
//   数えた応答を 2 度数えないため。
// - n: 送った行の数（行の id の番号）。
// - pending: 送る前に書く、送る行（id・送り手の時刻・本文）と、送れた後の files・ids。送りの途中で落ちても、次の回に同じ id で同じ本文を送り直せる
//   （castlist は、同じ id で同じ本文なら 200、違う本文なら 409。本文の写しには送り手の時刻も入るので、時刻も控える）。
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Context } from '../context.ts';
import { castlistUrl, issuerOf, listUsage, putUsage, sessionRef, type Reply, type UsageInput } from '../castlist.ts';
import { envOf } from '../env.ts';
import type { RoleRecord } from '../roster.ts';
import { readTurns, sumRows, toRows, unpricedModels, type Turn, type UsageRow } from '../usage.ts';

/** 席の控え（`sessions/<session の id>.jsonc`）のうち、取り込みが読む欄。 */
export interface SeatRecord {
  session: string
  id: string
  name: string
  launch?: string
  transcript?: string
}

/** 送る行 1 つ（id と、送り手の時刻と、本文）。 */
export interface PendingRow {
  id: string
  sentAt: string
  row: UsageRow
}

/** 取り込みの控え（`usage/<session の id>.jsonc`）。 */
export interface UsageState {
  session: string
  files: Record<string, number>
  ids: string[]
  n: number
  pending?: { rows: PendingRow[], files: Record<string, number>, ids: string[] }
}

/** 取り込み 1 回の結果。sent は送った行の数。old は、castlist がまだ数の口を持たない版。 */
export type Pushed = { kind: 'ok', sent: number } | { kind: 'none' } | { kind: 'down' } | { kind: 'busy' } | { kind: 'old' };

/** 片付けが判じた時刻の控え。 */
const CHECK_FILE = 'usage/checked.jsonc';
/** 片付けの間（ミリ秒）。 */
export const USAGE_CHECK_EVERY_MS = 60 * 60 * 1000;
/** castlist が答えない・混んでいる時に、片付けが聞き直すまで待つ長さ（ミリ秒）。 */
export const USAGE_RETRY_MS = 5 * 60 * 1000;
/** 片付けの控え: 判じた時刻・次に聞いてよい時刻（無ければ at の 1 時間後）・次に回る席。 */
interface UsageCheck {
  at: string
  retryAt?: string
  next?: string
}
/** 片付け 1 回に掛けてよい時間（ミリ秒）。過ぎたら、残りは次の回に回す。 */
export const USAGE_BUDGET_MS = 3000;
/** castlist が断った行の記録。 */
const REFUSED_FILE = 'usage-refused.jsonl';

const safe = (id: string): string => id.replaceAll(/[^A-Za-z0-9._-]/g, '_');
const stateFile = (sid: string): string => `usage/${safe(sid)}.jsonc`;

/** 取り込みの控え。無ければ空の控え。 */
export function readUsageState(ctx: Pick<Context, 'state'>, sid: string): UsageState {
  return ctx.state.read<UsageState>(stateFile(sid)) ?? { session: sid, files: {}, ids: [], n: 0 };
}

/** Claude Code の置き場（`$CLAUDE_CONFIG_DIR`。無ければ `~/.claude`）。 */
function configDir(env: NodeJS.ProcessEnv): string {
  return env.CLAUDE_CONFIG_DIR !== undefined && env.CLAUDE_CONFIG_DIR !== '' ? env.CLAUDE_CONFIG_DIR : join(env.HOME ?? homedir(), '.claude');
}

/**
 * 席の写しの path。席の控えに在ればそれ（その席の hook が書く）、無ければ Claude Code の置き場の `projects/<席を起こした folder>/<session の id>.jsonl` を探す
 * （前の版で起こした席・控えに path の無い席。写しは、席を起こした folder ごとに別の folder に入る）。見つからなければ undefined。
 */
export function transcriptOf(ctx: Pick<Context, 'env'>, seat: Pick<SeatRecord, 'session' | 'transcript'>): string | undefined {
  if (seat.transcript !== undefined && existsSync(seat.transcript)) return seat.transcript;
  const projects = join(configDir(ctx.env), 'projects');
  let folders: string[];
  try {
    folders = readdirSync(projects);
  }
  catch {
    return undefined;
  }
  return folders.map(f => join(projects, f, `${seat.session}.jsonl`)).find(p => existsSync(p));
}

/** 手伝い（subagent）の写しと、その種類。写しの隣の `<session の id>/subagents/*.jsonl`。種類は `*.meta.json` の agentType（無ければ agent）。 */
function agentFiles(transcript: string, sid: string): { path: string, agent: string }[] {
  const folder = join(dirname(transcript), sid, 'subagents');
  let names: string[];
  try {
    names = readdirSync(folder);
  }
  catch {
    return [];
  }
  return names.filter(n => n.endsWith('.jsonl')).sort().map((name) => {
    let agent = 'agent';
    try {
      const meta = JSON.parse(readFileSync(join(folder, name.replace(/\.jsonl$/, '.meta.json')), 'utf8')) as { agentType?: unknown, name?: unknown };
      if (typeof meta.agentType === 'string' && meta.agentType !== '') agent = meta.agentType;
      else if (typeof meta.name === 'string' && meta.name !== '') agent = meta.name;
    }
    catch {
      // 種類の file が無い・読めない手伝いは agent。
    }
    return { path: join(folder, name), agent: agent.slice(0, 256) };
  });
}

/** file の from バイト目から、最後の行の終わりまでを読む。行の途中で終わる分（書いている途中の行）は、次の回に回す。 */
function readFrom(path: string, from: number): { lines: string[], to: number } {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    // 写しが短くなった（作り直された）時は、頭から読み直す（数えた応答は ids で除く）。
    const start = from > size ? 0 : from;
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    const end = buffer.lastIndexOf(0x0a);
    if (end < 0) return { lines: [], to: start };
    return { lines: buffer.subarray(0, end).toString('utf8').split('\n'), to: start + end + 1 };
  }
  finally {
    closeSync(fd);
  }
}

/** 行の id: `u-<issuer の hash>-<session>-<番号>`（出来事などの id と同じ作り）。 */
function idOf(ctx: Pick<Context, 'state'>, sid: string, n: number): string {
  return `u-${createHash('sha256').update(issuerOf(ctx)).digest('hex').slice(0, 8)}-${sid}-${n}`;
}

/** その控えが数えた応答の id（送り終えた物と、控えて送る途中の物）。 */
const countedIds = (state: UsageState): string[] => [...state.ids, ...state.pending?.ids ?? []];

/** 同じ起こしの session（起こしの控えの並び。古い順）。起こしが無ければ、その session だけ。 */
function launchSessions(ctx: Pick<Context, 'state'>, seat: Pick<SeatRecord, 'session' | 'launch'>): string[] {
  if (seat.launch === undefined) return [seat.session];
  return ctx.state.read<{ sessions?: string[] }>(`launches/${safe(seat.launch)}.jsonc`)?.sessions ?? [seat.session];
}

/**
 * 同じ起こしの、ほかの session が数えた応答の id（resume・fork で写された行を、2 度数えないため）。
 * 送る途中の控え（pending）の id も入れる（castlist が止まっている間に控えた回を、ほかの session が先に送らないため）。
 */
function siblingIds(ctx: Pick<Context, 'state'>, seat: SeatRecord): string[] {
  return launchSessions(ctx, seat).filter(s => s !== seat.session).flatMap(s => countedIds(readUsageState(ctx, s)));
}

/** 送る行の控えを外した控え。 */
const withoutPending = (state: UsageState): UsageState => ({ session: state.session, files: state.files, ids: state.ids, n: state.n });

/** 行を castlist の本文にする。 */
function bodyOf(sid: string, row: UsageRow): UsageInput {
  const { fromAt, toAt, ...rest } = row;
  return { by: sessionRef(sid), ...rest, fromAt: new Date(fromAt), toAt: new Date(toAt) };
}

/** 控えた行を送る。みな送れたら ok。途中で止まったら、その訳（控えは残す）。断られた行は、記録して先へ進む。 */
async function sendPending(ctx: Context, url: string, state: UsageState, wait?: () => number): Promise<'ok' | 'down' | 'busy' | 'old'> {
  const rows = state.pending?.rows ?? [];
  for (const [index, pending] of rows.entries()) {
    const reply: Reply = await putUsage(ctx, url, pending.id, bodyOf(state.session, pending.row), new Date(pending.sentAt), wait?.());
    if (reply.kind === 'down' || reply.kind === 'busy') return reply.kind;
    if (reply.kind === 'refused') {
      // 数の口を持たない版の castlist（404）: 初めの行なら、何も足されていないので、控えを捨てて次の回に読み直す。
      if (reply.code === 404 && index === 0) return 'old';
      // 断られた行（形の誤り・同じ id で違う本文）は、送り直しても通らない。黙って済みにせず、記録に残して先へ進む（突き合わせの命令が違いを出す）。
      ctx.state.append(REFUSED_FILE, { at: ctx.now().toISOString(), id: pending.id, session: state.session, code: reply.code, error: reply.error });
    }
  }
  return 'ok';
}

/**
 * 席 1 つの取り込み。写しの、まだ読んでいない所から回を読み、行にまとめて castlist へ送る。
 * 送る前に、送る行を控えに書く（pending）。前の回の pending が残っていれば、先にそれを送る。
 */
export async function pushUsage(ctx: Context, url: string, sid: string, wait?: () => number): Promise<Pushed> {
  const seat = ctx.state.read<SeatRecord>(`sessions/${safe(sid)}.jsonc`);
  if (seat === undefined) return { kind: 'none' };
  // 席ごとの鍵（席の hook と TPM 担当の片付けが、同じ席を同時に読んで、同じ回を 2 度送らないため）。取れなければ、その席は飛ばす。
  if (!takeLock(ctx, sid)) return { kind: 'none' };
  try {
    return await pushLocked(ctx, url, seat, wait);
  }
  finally {
    ctx.state.remove(lockFile(sid));
  }
}

/** 鍵の file。 */
const lockFile = (sid: string): string => `usage/${safe(sid)}.lock`;
/** 鍵を、取った process が落ちて残した物とみなすまでの長さ（ミリ秒）。 */
const LOCK_STALE_MS = 10 * 60 * 1000;

/** 席の鍵を取る。残った鍵（LOCK_STALE_MS より古い）は、取り直す。 */
function takeLock(ctx: Pick<Context, 'state' | 'now'>, sid: string): boolean {
  const now = ctx.now();
  if (ctx.state.create(lockFile(sid), { at: now.toISOString(), pid: process.pid })) return true;
  const held = ctx.state.read<{ at?: string }>(lockFile(sid))?.at;
  if (held === undefined || now.getTime() - Date.parse(held) < LOCK_STALE_MS) return false;
  ctx.state.remove(lockFile(sid));
  return ctx.state.create(lockFile(sid), { at: now.toISOString(), pid: process.pid });
}

async function pushLocked(ctx: Context, url: string, seat: SeatRecord, wait?: () => number): Promise<Pushed> {
  const sid = seat.session;
  let state = readUsageState(ctx, sid);
  let sent = 0;
  if (state.pending !== undefined) {
    const result = await sendPending(ctx, url, state, wait);
    if (result === 'old') {
      ctx.state.write(stateFile(sid), withoutPending(state));
      return { kind: 'old' };
    }
    if (result !== 'ok') return { kind: result };
    sent += state.pending.rows.length;
    state = { session: sid, files: state.pending.files, ids: [...state.ids, ...state.pending.ids], n: state.n + state.pending.rows.length };
    ctx.state.write(stateFile(sid), state);
  }
  const transcript = transcriptOf(ctx, seat);
  if (transcript === undefined) return sent > 0 ? { kind: 'ok', sent } : { kind: 'none' };
  const skip = new Set([...state.ids, ...siblingIds(ctx, seat)]);
  const files = { ...state.files };
  const turns: Turn[] = [];
  const ids: string[] = [];
  for (const file of [{ path: transcript, agent: undefined }, ...agentFiles(transcript, sid)]) {
    const read = readFrom(file.path, files[file.path] ?? 0);
    if (read.to === (files[file.path] ?? 0)) continue;
    const reading = readTurns(read.lines, { skip, ...(file.agent === undefined ? {} : { agent: file.agent }) });
    for (const id of reading.ids) skip.add(id);
    turns.push(...reading.turns);
    ids.push(...reading.ids);
    files[file.path] = read.to;
  }
  const rows = toRows(turns);
  if (rows.length === 0) {
    // 回の無い行（人の入力・道具の結果）だけを読んだ時も、読んだ所は進める。
    if (JSON.stringify(files) !== JSON.stringify(state.files)) ctx.state.write(stateFile(sid), { ...state, files });
    return sent > 0 ? { kind: 'ok', sent } : { kind: 'none' };
  }
  const at = ctx.now().toISOString();
  state = { ...state, pending: { rows: rows.map((row, i) => ({ id: idOf(ctx, sid, state.n + i + 1), sentAt: at, row })), files, ids } };
  ctx.state.write(stateFile(sid), state);
  const result = await sendPending(ctx, url, state, wait);
  if (result === 'old') {
    ctx.state.write(stateFile(sid), withoutPending(state));
    return { kind: 'old' };
  }
  if (result !== 'ok') return { kind: result };
  ctx.state.write(stateFile(sid), { session: sid, files, ids: [...state.ids, ...ids], n: state.n + rows.length } satisfies UsageState);
  return { kind: 'ok', sent: sent + rows.length };
}

/** 誤りを呑んで、取り込みを 1 つ流す（hook と、席を閉じる命令から。呼んだ命令を止めない）。 */
async function quietPush(ctx: Context, url: string, sid: string, wait?: () => number): Promise<Pushed> {
  try {
    return await pushUsage(ctx, url, sid, wait);
  }
  catch (e) {
    process.stderr.write(`roster: トークンの数の取り込み（${sid}）: ${(e as Error).message}\n`);
    return { kind: 'none' };
  }
}

/** 席が閉じる時の hook（roster castlist session-end）の、取り込みの分。castlist を設定していなければ何もしない。 */
export async function pushOnEnd(ctx: Context, sid: string): Promise<void> {
  const url = castlistUrl(ctx);
  if (url !== undefined) await quietPush(ctx, url, sid);
}

/** 席を閉じる命令（roster close）の、取り込みの分: その担当の起こしの session を、閉じる前に取り込む。 */
export async function pushLaunch(ctx: Context, role: RoleRecord): Promise<void> {
  const url = castlistUrl(ctx);
  if (url === undefined || role.launch === undefined) return;
  const launched = ctx.state.read<{ sessions?: string[] }>(`launches/${safe(role.launch)}.jsonc`);
  for (const sid of launched?.sessions ?? []) {
    const pushed = await quietPush(ctx, url, sid);
    if (pushed.kind === 'down' || pushed.kind === 'busy' || pushed.kind === 'old') return;
  }
}

/**
 * 席を回る順: 起こしごとに、起こしの控えの並び（古い順）。同じ起こしの session が写しを分け合う時（fork）、分け合う回は、先に起こした session に付く。
 * from（前の回に、時間の上限で止めた所）が在れば、その席から回る。
 */
export function sweepOrder(ctx: Pick<Context, 'state'>, from?: string): string[] {
  const names = ctx.state.list('sessions');
  const known = new Set(names);
  const ordered: string[] = [];
  const placed = new Set<string>();
  for (const name of names) {
    if (placed.has(name)) continue;
    const seat = ctx.state.read<SeatRecord>(`sessions/${name}.jsonc`);
    for (const sid of seat === undefined ? [name] : launchSessions(ctx, seat)) {
      const s = safe(sid);
      if (known.has(s) && !placed.has(s)) {
        placed.add(s);
        ordered.push(s);
      }
    }
    if (!placed.has(name)) {
      placed.add(name);
      ordered.push(name);
    }
  }
  const at = from === undefined ? -1 : ordered.indexOf(from);
  return at <= 0 ? ordered : [...ordered.slice(at), ...ordered.slice(0, at)];
}

/**
 * まだ送っていない席を、みな取り込む。budgetMs を過ぎたら、残りは次の回（done は false・next は次に回る席）。castlist が応えない・古い版なら、そこでやめる。
 * 1 つの送りを待つのも、残りの時間まで（castlist が繋がりを受けたまま答えない時に、上限を越えて待たない）。
 */
export async function sweepUsage(ctx: Context, url: string, budgetMs: number, from?: string): Promise<{ sent: number, done: boolean, next?: string, stopped?: 'down' | 'busy' | 'old' }> {
  const started = Date.now();
  const left = (): number => Math.max(1, Math.ceil((budgetMs - (Date.now() - started)) / 1000));
  const wait = Number.isFinite(budgetMs) ? left : undefined;
  let sent = 0;
  for (const name of sweepOrder(ctx, from)) {
    if (Date.now() - started > budgetMs) return { sent, done: false, next: name };
    const pushed = await quietPush(ctx, url, name, wait);
    if (pushed.kind === 'ok') sent += pushed.sent;
    if (pushed.kind === 'down' || pushed.kind === 'busy' || pushed.kind === 'old') return { sent, done: false, next: name, stopped: pushed.kind };
  }
  return { sent, done: true };
}

/**
 * TPM 担当の側の片付け（TPM 担当が名乗る時と、送る命令を打つ時に呼ぶ）。1 時間に 1 度、まだ送っていない席をみな取り込む。
 * 長く続く TPM 担当の席・席が閉じる時の hook が届かなかった席・前の版で起こした席を、ここで拾う。
 * メッセージの片付け（tidyMail）とは別に判じる（写しの遅れの条件に依らない）。誤りでも、何も出さずに終わる（呼んだ命令を止めない）。
 * みな取り込めた時は 1 時間後まで聞かない。時間の上限で残った分は、次の命令で、止めた席から続ける。castlist が答えない・混んでいる時は、5 分待つ。
 */
export async function tidyUsage(ctx: Context, options: { force?: boolean } = {}): Promise<void> {
  if (envOf(ctx.env, 'KEY') !== undefined) return;
  try {
    const url = castlistUrl(ctx);
    if (url === undefined) return;
    const now = ctx.now().getTime();
    const checked = ctx.state.read<UsageCheck>(CHECK_FILE);
    if (options.force !== true && checked !== undefined) {
      if (checked.retryAt !== undefined ? now < Date.parse(checked.retryAt) : now - Date.parse(checked.at) < USAGE_CHECK_EVERY_MS) return;
    }
    const swept = await sweepUsage(ctx, url, USAGE_BUDGET_MS, checked?.next);
    const at = ctx.now().toISOString();
    // みな回った・古い版の castlist（上がるまで何度聞いても同じ）: 1 時間待つ。
    if (swept.done || swept.stopped === 'old') ctx.state.write(CHECK_FILE, { at } satisfies UsageCheck);
    // castlist が答えない・混んでいる: 続けて聞かず、少し待つ（TPM 担当の命令のたびに、送りの時間切れを待たないため）。
    else if (swept.stopped !== undefined) ctx.state.write(CHECK_FILE, { at: checked?.at ?? at, retryAt: new Date(ctx.now().getTime() + USAGE_RETRY_MS).toISOString(), ...(swept.next === undefined ? {} : { next: swept.next }) } satisfies UsageCheck);
    // 時間の上限で止めた: 次の命令で、止めた席から続ける。
    else ctx.state.write(CHECK_FILE, { at: checked?.at ?? at, retryAt: at, ...(swept.next === undefined ? {} : { next: swept.next }) } satisfies UsageCheck);
  }
  catch {
    // 呼んだ命令を止めない。
  }
}

/** 突き合わせの 1 行（席 1 つ）。 */
interface Compared {
  name: string
  direct: { turns: number, costMicroUsd: number }
  stored: { turns: number, costMicroUsd: number }
}

const dollars = (micro: number): string => (micro / 1_000_000).toFixed(2);

/** castlist の、その席の行を、窓の内でみな読む。 */
async function storedRows(ctx: Context, url: string, actorId: string, from: Date, to: Date): Promise<UsageRow[] | Exclude<Reply, { kind: 'ok' }>> {
  const rows: UsageRow[] = [];
  let nextToken: string | undefined;
  do {
    const reply = await listUsage(ctx, url, { from, to, actorId, ...(nextToken === undefined ? {} : { nextToken }) });
    if (reply.kind !== 'ok') return reply;
    const body = reply.body as { usage: UsageRow[], nextToken?: string };
    rows.push(...body.usage);
    nextToken = body.nextToken;
  } while (nextToken !== undefined);
  return rows;
}

/** その時刻の、時の初め（UTC）。 */
const hourOf = (at: Date): Date => new Date(Math.floor(at.getTime() / USAGE_CHECK_EVERY_MS) * USAGE_CHECK_EVERY_MS);

/** 突き合わせの窓の長さの上限（castlist の ListUsage の窓の上限と同じ）。 */
const WINDOW_DAYS = 31;

/**
 * 突き合わせ（roster castlist usage-check）: 窓の内の回を、session の記録から直に数えた値と、castlist の行の合計を、席ごとに並べる。
 * 数える関数は取り込みと同じなので、違いは、取り込み（どこまで読んだか・送り直し・時の境）の誤りか、まだ送っていない分を表す。
 * 既定の窓は、今から 31 日前〜1 時間前（直近の 1 時間は、まだ送っていない分が在りうる）。窓の端は、時の境（UTC）に切り下げる。違いが在れば、最後の行に数を出す。
 */
export async function usageCheck(ctx: Context, options: { from?: string, to?: string }): Promise<string[]> {
  const url = castlistUrl(ctx);
  if (url === undefined) return ['castlist を設定していないので、突き合わせる物が無い'];
  const now = ctx.now().getTime();
  const given = { to: new Date(options.to ?? now - USAGE_CHECK_EVERY_MS), from: options.from === undefined ? undefined : new Date(options.from) };
  if (Number.isNaN(given.to.getTime()) || (given.from !== undefined && Number.isNaN(given.from.getTime()))) return ['--from・--to は、読める時刻（2026-11-27T00:00:00Z など）にしてください'];
  // 窓の端は、時の境（UTC）に揃える。castlist の行は UTC の時をまたがず（今は 10 分の枠ごと。前の版の行は 1 時間ごと）、窓に入るかは
  // 行の終わりの時刻で決まるので、時の途中で切ると、端の行（前の版の 1 時間の行）が、記録の側と castlist の側で食い違う。
  const to = hourOf(given.to);
  const from = hourOf(given.from ?? new Date(to.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000));
  if (to.getTime() - from.getTime() > WINDOW_DAYS * 24 * 60 * 60 * 1000) return [`窓（--from から --to）は ${WINDOW_DAYS} 日までにしてください`];
  const inWindow = (at: string): boolean => at >= from.toISOString() && at < to.toISOString();
  const compared: Compared[] = [];
  const missing: string[] = [];
  const unpriced = new Set<string>();
  // 同じ起こしの session は、写しを分け合うことが在る（resume・fork）。分け合う回は、取り込みが実際に付けた席（その席の控えの id）に数える。
  // まだ取り込んでいない回は、取り込みと同じ順（sweepOrder。起こしの古い順）で、先に読んだ席に数える。
  const owner = new Map<string, string>();
  const seats = sweepOrder(ctx)
    .map(name => ctx.state.read<SeatRecord>(`sessions/${name}.jsonc`))
    .filter((s): s is SeatRecord => s !== undefined);
  for (const seat of seats) {
    for (const id of countedIds(readUsageState(ctx, seat.session))) if (!owner.has(id)) owner.set(id, seat.session);
  }
  const seenByLaunch = new Map<string, Set<string>>();
  for (const seat of seats) {
    const transcript = transcriptOf(ctx, seat);
    let turns: Turn[] = [];
    if (transcript === undefined) missing.push(seat.name);
    else {
      const seen = seenByLaunch.get(seat.launch ?? seat.session) ?? new Set<string>();
      seenByLaunch.set(seat.launch ?? seat.session, seen);
      const mine = (id: string): boolean => (owner.get(id) ?? (seen.has(id) ? undefined : seat.session)) === seat.session;
      for (const file of [{ path: transcript, agent: undefined }, ...agentFiles(transcript, seat.session)]) {
        const reading = readTurns(readFrom(file.path, 0).lines, file.agent === undefined ? {} : { agent: file.agent });
        turns.push(...reading.turns.filter(t => mine(t.id)));
        for (const id of reading.ids) seen.add(id);
      }
      turns = turns.filter(t => inWindow(t.at));
    }
    for (const model of unpricedModels(turns)) unpriced.add(model);
    const stored = await storedRows(ctx, url, seat.id, from, to);
    if (!Array.isArray(stored)) {
      if (stored.kind === 'refused') return [`castlist（${url}）が断りました（${stored.code}: ${stored.error}）`];
      return [`castlist（${url}）が応えないので、突き合わせをやめました`];
    }
    const direct = sumRows(toRows(turns));
    const sum = sumRows(stored);
    if (direct === undefined && sum === undefined) continue;
    compared.push({
      name: seat.name,
      direct: { turns: direct?.turns ?? 0, costMicroUsd: direct?.costMicroUsd ?? 0 },
      stored: { turns: sum?.turns ?? 0, costMicroUsd: sum?.costMicroUsd ?? 0 },
    });
  }
  const differ = compared.filter(c => c.direct.turns !== c.stored.turns || c.direct.costMicroUsd !== c.stored.costMicroUsd);
  const total = (pick: (c: Compared) => { turns: number, costMicroUsd: number }): string => `${compared.reduce((n, c) => n + pick(c).turns, 0)} 回・${dollars(compared.reduce((n, c) => n + pick(c).costMicroUsd, 0))} ドル`;
  const refused = ctx.state.lines<{ id: string }>(REFUSED_FILE).length;
  return [
    `窓: ${from.toISOString()} 〜 ${to.toISOString()}（回の時刻。端は時の境）`,
    `席: ${compared.length}（記録から直に数えた: ${total(c => c.direct)}／castlist の行の合計: ${total(c => c.stored)}）`,
    ...differ.map(c => `違い: ${c.name} 記録 ${c.direct.turns} 回・${dollars(c.direct.costMicroUsd)} ドル／castlist ${c.stored.turns} 回・${dollars(c.stored.costMicroUsd)} ドル`),
    ...(missing.length === 0 ? [] : [`写しが見つからない席（30 日で消えた・ほかの機械で動いた）: ${missing.length}（castlist の行だけを数えた）`]),
    ...(unpriced.size === 0 ? [] : [`値段の表に無い model（額を 0 で数えた）: ${[...unpriced].join('・')}`]),
    ...(refused === 0 ? [] : [`castlist が断った行: ${refused}（状態の folder の ${REFUSED_FILE}）`]),
    differ.length === 0 ? '合った: どの席も、回の数と額が一致' : `合わない席: ${differ.length}（まだ送っていない分なら、roster castlist usage の後に、もう 1 度）`,
  ];
}
