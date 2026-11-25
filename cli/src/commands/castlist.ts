// roster castlist …（hook が呼ぶ）と、ほかの命令（guard・hello・close）が castlist に送る物。送る物の形は castlist の docs/src/api.md（設定の api.castlist が next なら docs/src/next.md。どちらで送るかは castlist.ts の registerActor・putRecord が決める）。
// session 1 つが castlist のアクター 1 つ。登録の答え（id と名）は状態の folder の sessions/<session の id>.jsonc に控え、
// 起こし 1 回（$ROSTER_LAUNCH）ごとの session の並びを launches/<起こしの id>.jsonc に控える（/clear と fork の継ぐ線を、前の session から引くため）。
// 出来事・線・model と effort の id は、issuer・session・種類（と、何度も起きる物は番号）で決める。送り直しても同じ id なので、castlist は 2 度足さない
// （castlist の id は issuer をまたいで 1 つなので、issuer の hash を頭に付ける）。
// 番号は、送れた時だけ進める（届かなかった物は、次に同じ id で送り直す）。
// 落ちて終わりを送れなかった session は、hello・roles・assign が cmux の居場所の一覧と突き合わせ、推しの幕引き（detail.inferred）を送る（sweep）。
import { createHash } from 'node:crypto';
import type { Context } from '../context.ts';
import { busyMessage, castlistUrl, downMessage, issuerOf, missingCastlistWarning, modelOf, putRecord, registerActor, requireUp, seatOf, sessionRef, type RecordInput, type Reply } from '../castlist.ts';
import { query } from '../castlist-query.ts';
import type { Verdict } from '../guard.ts';
import type { RoleRecord } from '../roster.ts';
import { TpmError } from '../skill-sets.ts';
import { envOf } from '../env.ts';

/** 控えた session 1 つ（`sessions/<session の id>.jsonc`）。 */
export interface SessionRecord {
  session: string
  /** castlist の本当の id と名。 */
  id: string
  name: string
  launch?: string
  /** castlist で今居ることになっているか（登場の類を送ったら true、退場の類を送ったら false）。 */
  present: boolean
  /** 何度も起きる出来事の、送れた数（id の番号）。 */
  seq: Record<string, number>
  /** 最後に送った、見た model と effort。 */
  observed?: { model: string, effort: string }
  /** model を読めなかったことを送ったか（session に 1 度だけ送る）。 */
  modelUnreadable?: boolean
  /** 登録した時の cmux の居場所（ref は起こし直しで替わり、uuid は復元で残る）。 */
  workspace?: { ref?: string, uuid?: string }
  /** 推しの幕引き（roster が、落ちたと推して送った幕引き）で居ないにした。guard が、その session の Bash で再登場を送る印。 */
  endedBy?: 'inferred'
}

/** 起こし 1 回の控え（`launches/<起こしの id>.jsonc`）。 */
interface LaunchRecord {
  /** この起こしの session（現れた順）。 */
  sessions: string[]
  /** 頼んだ model と effort を、もう送ったか（起こしたばかりの印は、初めの 1 度だけ使う）。 */
  requested?: boolean
}

/** 登録のきっかけ。startup・resume・clear・compact・fork は SessionStart の source。guard と hello は、控えが無い session（か、推しの幕引きで居ないにした session）を、その命令が登録した時。 */
type Source = 'startup' | 'resume' | 'clear' | 'compact' | 'fork' | 'guard' | 'hello';
const SOURCES: Source[] = ['startup', 'resume', 'clear', 'compact', 'fork'];

/** 送った結果。 */
type Sent = 'ok' | 'down' | 'busy';

/** 状態の folder の file の名にしてよい字にする。 */
const safe = (id: string): string => id.replaceAll(/[^A-Za-z0-9._-]/g, '_');
const sessionFile = (sid: string): string => `sessions/${safe(sid)}.jsonc`;
const launchFile = (launch: string): string => `launches/${safe(launch)}.jsonc`;

/** 控えた session。無ければ undefined。 */
export const readSession = (ctx: Context, sid: string): SessionRecord | undefined => ctx.state.read<SessionRecord>(sessionFile(sid));

/** hook の標準入力（JSON の物）。読めなければ空。 */
function hookInput(stdin: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(stdin) as unknown;
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
  }
  catch {
    return {};
  }
}

const text = (value: unknown): string | undefined => typeof value === 'string' && value !== '' ? value : undefined;

/** 答えを、送った結果にする。断られた物（422 など）は、castlist は起きているので止めず、stderr に書いて進む。同じ id で違う本文（409）は、もう在るので済んだとみなす。 */
function settle(reply: Reply, what: string): Sent {
  if (reply.kind === 'down' || reply.kind === 'busy') return reply.kind;
  if (reply.kind === 'refused' && reply.code !== 409) process.stderr.write(`roster castlist: ${what} を castlist が断りました（${reply.code}: ${reply.error}）\n`);
  return 'ok';
}

/** 出来事（e）・線（l）・model と effort（t）の id: `<頭>-<issuer の hash>-<session>-<種類>[-<番号>]`。 */
function idOf(ctx: Context, head: 'e' | 'l' | 't', sid: string, rest: string): string {
  return `${head}-${createHash('sha256').update(issuerOf(ctx)).digest('hex').slice(0, 8)}-${sid}-${rest}`;
}

/** 出来事・線・model と effort を、決めた id で送る。 */
async function put<K extends keyof RecordInput>(ctx: Context, url: string, kind: K, id: string, body: RecordInput[K]): Promise<Sent> {
  return settle(await putRecord(ctx, url, kind, id, body), `${kind}/${id}`);
}

/** 出来事を送る。seq なら、送れた数の次の番号を id に付け、送れたら数を進める。 */
async function event(ctx: Context, url: string, record: SessionRecord, type: string, detail: Record<string, unknown>, seq = false): Promise<Sent> {
  const n = (record.seq[type] ?? 0) + 1;
  const sent = await put(ctx, url, 'events', idOf(ctx, 'e', record.session, `${type}${seq ? `-${n}` : ''}`), { by: sessionRef(record.session), type, detail });
  if (sent !== 'ok') return sent;
  if (seq) record.seq[type] = n;
  if (['entered', 'reentered', 'forked'].includes(type)) {
    record.present = true;
    delete record.endedBy;
  }
  if (['cleared', 'exited', 'closed'].includes(type)) {
    record.present = false;
    if (detail.inferred === true) record.endedBy = 'inferred';
    else delete record.endedBy;
  }
  ctx.state.write(sessionFile(record.session), record);
  return 'ok';
}

/** cmux の連携なら、自分の workspace の ref（`cmux --json identify`）。読めなければ undefined。 */
function workspaceRef(ctx: Context): string | undefined {
  if (ctx.config.transport !== 'cmux') return undefined;
  try {
    const r = ctx.exec('cmux', ['--json', 'identify']);
    return r.status === 0 ? text((JSON.parse(r.stdout) as { caller?: { workspace_ref?: unknown } }).caller?.workspace_ref) : undefined;
  }
  catch {
    return undefined;
  }
}

/**
 * session を登録し（鍵は session。何度登録しても同じアクター）、きっかけの出来事と線を送る。控えには、その時の居場所（cmux の ref と uuid）も書く。
 * revive なら、推しの幕引きで居ないにした session を、今の居場所で登録し直して、番号つきの再登場（source は guard）だけを送る（線は送らない）。
 * 頼んだ model と effort（$ROSTER_LAUNCH_MODEL・$ROSTER_LAUNCH_EFFORT）は、roster が起こしたばかりの process（$ROSTER_LAUNCH_FRESH）の初めの登録でだけ送る
 * （/clear の後の session は同じ環境変数を持つが、その後に /model で替えたかもしれないので送らない）。
 */
async function enter(ctx: Context, url: string, sid: string, source: Source, revive = false): Promise<Sent> {
  const launch = text(envOf(ctx.env, 'LAUNCH'));
  const launched = launch === undefined ? { sessions: [] } : ctx.state.read<LaunchRecord>(launchFile(launch)) ?? { sessions: [] };
  const model = text(envOf(ctx.env, 'LAUNCH_MODEL'));
  const effort = text(envOf(ctx.env, 'LAUNCH_EFFORT'));
  const fresh = ['startup', 'resume', 'guard', 'hello'].includes(source) && envOf(ctx.env, 'LAUNCH_FRESH') === '1' && launched.requested !== true && model !== undefined && effort !== undefined;
  const seat = seatOf(ctx);
  const ref = workspaceRef(ctx);
  const uuid = text(ctx.env.CMUX_WORKSPACE_ID);
  const reply = await registerActor(ctx, url, {
    kind: 'ai',
    namePrefix: seat.prefix,
    labels: {
      'tpm.project': ctx.project,
      ...(launch === undefined ? {} : { 'tpm.launch': launch }),
      ...(seat.key === undefined ? {} : { 'tpm.key': seat.key }),
      // Staff Engineer 担当の席は、見ている課題の Key でも引けるようにする（tpm.key は席を 1 つに決める名簿の Key）。
      ...(seat.subject === undefined ? {} : { 'tpm.subject': seat.subject }),
      'tpm.role': seat.role,
    },
    bindings: [
      { type: 'claude.session', value: sid },
      ...(ref === undefined ? [] : [{ type: 'cmux.workspace.ref', value: ref }]),
      ...(uuid === undefined ? [] : [{ type: 'cmux.workspace.uuid', value: uuid }]),
    ],
    ...(fresh ? { settings: { model, effort } } : {}),
  });
  if (reply.kind === 'down' || reply.kind === 'busy') return reply.kind;
  if (reply.kind === 'refused') {
    settle(reply, `session ${sid} の登録`);
    return 'ok';
  }
  const actor = reply.body as { id?: unknown, name?: unknown };
  const had = readSession(ctx, sid);
  const workspace = ref === undefined && uuid === undefined ? had?.workspace : { ...(ref === undefined ? {} : { ref }), ...(uuid === undefined ? {} : { uuid }) };
  const record: SessionRecord = { ...had, session: sid, id: String(actor.id), name: String(actor.name), ...(launch === undefined ? {} : { launch }), present: had?.present ?? false, seq: had?.seq ?? {}, ...(workspace === undefined ? {} : { workspace }) };
  ctx.state.write(sessionFile(sid), record);
  if (revive) return await event(ctx, url, record, 'reentered', { source }, true);
  const previous = launched.sessions.filter(s => s !== sid).at(-1);
  if (launch !== undefined) {
    ctx.state.write(launchFile(launch), {
      sessions: launched.sessions.includes(sid) ? launched.sessions : [...launched.sessions, sid],
      ...(fresh || launched.requested === true ? { requested: true } : {}),
    } satisfies LaunchRecord);
  }
  const sent = await sourceEvent(ctx, url, record, source);
  if (sent !== 'ok') return sent;
  const by = text(envOf(ctx.env, 'LAUNCHED_BY'));
  if (['startup', 'resume', 'guard', 'hello'].includes(source) && previous === undefined && by !== undefined) {
    return await put(ctx, url, 'links', idOf(ctx, 'l', sid, 'launched'), { type: 'launched', from: by, to: sessionRef(sid) });
  }
  if ((source === 'clear' || source === 'fork') && previous !== undefined) {
    return await put(ctx, url, 'links', idOf(ctx, 'l', sid, 'continued'), { type: 'continued', from: sessionRef(previous), to: sessionRef(sid) });
  }
  return 'ok';
}

/** きっかけの出来事: 起こした・/clear・fork は 1 度きり（決まった id）、続きから開いた・要約したは何度も起きる（番号つき）。 */
async function sourceEvent(ctx: Context, url: string, record: SessionRecord, source: Source): Promise<Sent> {
  switch (source) {
    case 'startup': return event(ctx, url, record, 'entered', {});
    case 'clear': case 'guard': case 'hello': return event(ctx, url, record, 'entered', { source });
    case 'fork': return event(ctx, url, record, 'forked', {});
    case 'resume': return event(ctx, url, record, 'reentered', {}, true);
    case 'compact': return event(ctx, url, record, 'compacted', {}, true);
  }
}

/** hook の中の誤りは、Claude Code を止めないように stderr に書くだけにする。 */
async function quietly(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  }
  catch (e) {
    process.stderr.write(`roster castlist ${name}: ${(e as Error).message}\n`);
  }
}

/**
 * SessionStart の hook（`roster castlist session-start`）。session を登録し、source ごとの出来事と線を送る。
 * castlist が止まっていれば何もせずに終わる（hook で Claude Code を止めない。登録まで、guard が Bash を止める）。
 */
export async function sessionStart(ctx: Context, stdin: string): Promise<void> {
  await quietly('session-start', async () => {
    const url = castlistUrl(ctx);
    if (url === undefined) return;
    const input = hookInput(stdin);
    const sid = text(input.session_id);
    if (sid === undefined) return;
    const source = SOURCES.find(s => s === input.source) ?? 'startup';
    await enter(ctx, url, sid, source);
  });
}

/** SessionEnd の hook（`roster castlist session-end`）。/clear は交代、ほかは退場（訳は detail.reason）。 */
export async function sessionEnd(ctx: Context, stdin: string): Promise<void> {
  await quietly('session-end', async () => {
    const url = castlistUrl(ctx);
    if (url === undefined) return;
    const input = hookInput(stdin);
    const sid = text(input.session_id);
    const record = sid === undefined ? undefined : readSession(ctx, sid);
    if (record === undefined) return;
    const reason = text(input.reason) ?? 'other';
    await event(ctx, url, record, reason === 'clear' ? 'cleared' : 'exited', { reason }, true);
  });
}

/** guard が castlist のために止める時の文。 */
function stop(ctx: Context, url: string, sent: Exclude<Sent, 'ok'>): Verdict {
  const done = 'castlist に送れないので、Bash を止めました。';
  return { allow: false, reason: sent === 'busy' ? busyMessage(url, done) : downMessage(ctx, url, done, ['この 1 行を Product Manager に渡し、起きたら打ち直してください。']) };
}

/**
 * guard（PreToolUse の Bash）の castlist の分。控えが無い session は先に登録する。
 * 登録した session は、hook の入力の effort と、写しの最後の model を見て、前に送った物と違えば「見た」として送る。model を読めなければ session に 1 度だけ model 不明を送る（止めない）。
 * 送る物があるのに castlist が止まっていれば止める（送る物が無ければ、castlist に聞かない）。
 */
export async function castlistGuard(ctx: Context, stdin: string): Promise<Verdict> {
  const url = castlistUrl(ctx);
  if (url === undefined) return { allow: true };
  const input = hookInput(stdin);
  const sid = text(input.session_id);
  if (input.tool_name !== 'Bash' || sid === undefined) return { allow: true };
  const had = readSession(ctx, sid);
  // 控えが無ければ登録する。推しの幕引きで居ないにした session が Bash を打てば、生きていたので、今の居場所で登録し直して再登場を送る。
  if (had === undefined || (had.present === false && had.endedBy === 'inferred')) {
    const sent = await enter(ctx, url, sid, 'guard', had !== undefined);
    if (sent !== 'ok') return stop(ctx, url, sent);
  }
  const record = readSession(ctx, sid);
  if (record === undefined) return { allow: true };
  const seen = modelOf(input.transcript_path);
  if (seen.kind === 'unreadable' && record.modelUnreadable !== true) {
    const sent = await event(ctx, url, record, 'model_unreadable', { reason: seen.reason });
    if (sent !== 'ok') return stop(ctx, url, sent);
    record.modelUnreadable = true;
    ctx.state.write(sessionFile(sid), record);
  }
  const effort = text((input.effort as { level?: unknown } | undefined)?.level);
  if (seen.kind !== 'found' || effort === undefined) return { allow: true };
  if (record.observed?.model === seen.model && record.observed.effort === effort) return { allow: true };
  const n = (record.seq.observed ?? 0) + 1;
  const sent = await put(ctx, url, 'settings', idOf(ctx, 't', sid, `observed-${n}`), { by: sessionRef(sid), model: seen.model, effort, source: 'observed' });
  if (sent !== 'ok') return stop(ctx, url, sent);
  record.seq.observed = n;
  record.observed = { model: seen.model, effort };
  ctx.state.write(sessionFile(sid), record);
  return { allow: true };
}

/**
 * roster hello の castlist の分: 名乗り（reported_in）を送り、`アクター: <名>` の行を返す。控えが無い session は先に登録する。
 * castlist が止まっていれば、名乗らずに止まる。
 */
async function reportIn(ctx: Context, url: string, sid: string): Promise<string[]> {
  const done = '名乗っていません。';
  const fail = (sent: Exclude<Sent, 'ok'>): TpmError => new TpmError(sent === 'busy' ? busyMessage(url, done) : downMessage(ctx, url, done));
  const had = readSession(ctx, sid);
  // 控えが無ければ登録する。推しの幕引きで居ないにした session なら、名乗りの前に今の居場所で登録し直して再登場を送る（guard と同じ）。
  if (had === undefined || (had.present === false && had.endedBy === 'inferred')) {
    const sent = await enter(ctx, url, sid, 'hello', had !== undefined);
    if (sent !== 'ok') throw fail(sent);
  }
  const record = readSession(ctx, sid);
  if (record === undefined) return ['アクター: わからない（castlist が登録を断った。stderr を見る）'];
  const sent = await event(ctx, url, record, 'reported_in', {}, true);
  if (sent !== 'ok') throw fail(sent);
  return [`アクター: ${record.name}`];
}

/**
 * roster hello（TPM 担当・担当・Auditor）の castlist の分: 起きているかを見て（時計がずれていれば 1 行足す）、名乗りを送る。
 * 設定が無ければ、castlist には送らず、警告の枠（missingCastlistWarning）を返す（名乗りの頭に出る）。
 * Claude Code の session の id（$CLAUDE_CODE_SESSION_ID）が無ければ、どのアクターかわからないので、castlist に聞かずに 1 行だけ返す。
 */
export async function castlistHello(ctx: Context): Promise<string[]> {
  const url = castlistUrl(ctx);
  if (url === undefined) return missingCastlistWarning(ctx);
  const sid = text(ctx.env.CLAUDE_CODE_SESSION_ID);
  if (sid === undefined) return ['アクター: わからない（$CLAUDE_CODE_SESSION_ID が無い。castlist には送っていない）'];
  const skew = await requireUp(ctx, '名乗っていません。');
  return [...await reportIn(ctx, url, sid), ...skew];
}

/** roster close の castlist の分: その担当の起こしのアクターのうち、まだ居る物に幕引き（closed）を送る。送れなければ 1 行を返す（閉じるのは止めない）。 */
export async function closeLaunch(ctx: Context, role: RoleRecord): Promise<string[]> {
  const url = castlistUrl(ctx);
  if (url === undefined || role.launch === undefined) return [];
  const launched = ctx.state.read<LaunchRecord>(launchFile(role.launch));
  const present = (launched?.sessions ?? []).map(sid => readSession(ctx, sid)).filter(r => r?.present === true);
  const failed: (SessionRecord | undefined)[] = [];
  for (const record of present) {
    if (record !== undefined && await event(ctx, url, record, 'closed', {}) !== 'ok') failed.push(record);
  }
  return failed.length === 0 ? [] : [`castlist（${url}）に幕引きを送れませんでした（${failed.map(r => r?.name).join('・')}）。castlist が起きてから送る道は無いので、台帳に要るなら roster report incident で挙げる`];
}

/** 1 つの命令の中で、突き合わせを 1 度だけにする（roster hello は名簿も出すので、2 度呼ばれる）。 */
const swept = new WeakSet<Context>();

/** 居場所の組。 */
type Place = { ref: string, uuid: string };
const isPlace = (w: SessionRecord['workspace']): w is Place => w?.ref !== undefined && w.uuid !== undefined;

/**
 * 控えの居場所。無ければ castlist のアクターの付随する id（種類ごとに最新）から引き、読み直した控えに居場所だけを足して書く
 * （引く間に、その session の hook が控えを書いても消さない）。引けなければ undefined、castlist が止まっている・混んでいれば、その印。
 */
async function placeOf(ctx: Context, url: string, record: SessionRecord): Promise<Place | undefined | Exclude<Sent, 'ok'>> {
  if (isPlace(record.workspace)) return record.workspace;
  const reply = await query(ctx, url, { op: 'GetActor', id: record.id });
  if (reply.kind === 'down' || reply.kind === 'busy') return reply.kind;
  if (reply.kind !== 'ok') return undefined;
  const bindings = (reply.body as { current_bindings?: { type?: unknown, value?: unknown }[] }).current_bindings ?? [];
  const value = (type: string): string | undefined => text(bindings.find(b => b.type === type)?.value);
  const workspace = { ref: value('cmux.workspace.ref'), uuid: value('cmux.workspace.uuid') };
  if (!isPlace(workspace)) return undefined;
  const fresh = readSession(ctx, record.session);
  if (fresh !== undefined) ctx.state.write(sessionFile(record.session), { ...fresh, workspace });
  return workspace;
}

/**
 * 落ちた session の突き合わせ（roster hello・roles・assign が呼ぶ）。cmux の居場所の一覧（uuid → ref）と、控えで「居る」ままの session を突き合わせ、
 * 次のどちらかなら推しの幕引き（closed。detail は inferred: true と訳）を番号つきの id で送り、控えを居ないにする。送った session の名の行を返す。
 * - workspace_gone: 居場所の uuid が一覧に無い。
 * - superseded: uuid は残り ref が替わった（cmux が起こし直され、居場所を復元した）うえ、今の組（uuid と今の ref）に別の session が登録した
 *   （今の ref は起こし直しの後に振られたので、その session は後から来た）。ref が替わっただけでは送らない（cmux が session を続けることがある）。
 * 自分の session は見ない。自分の session の id が無い（roster の起こした session の外で打った）・一覧が引けない・自分の組が一覧に無い（一覧を信じられない）時は、
 * 何もしない。castlist が止まっている・混んでいれば、そこでやめる。送れなくても命令は止めず、送れなかった session を 1 行で出す。
 */
export async function sweep(ctx: Context): Promise<string[]> {
  const url = castlistUrl(ctx);
  if (url === undefined || ctx.config.transport !== 'cmux' || ctx.transport.seatsById === undefined || swept.has(ctx)) return [];
  swept.add(ctx);
  let seats: Map<string, { address: string }>;
  try {
    seats = ctx.transport.seatsById();
  }
  catch {
    return [];
  }
  const mine = text(ctx.env.CLAUDE_CODE_SESSION_ID);
  const ref = workspaceRef(ctx);
  const uuid = text(ctx.env.CMUX_WORKSPACE_ID);
  if (mine === undefined || ref === undefined || uuid === undefined || seats.get(uuid)?.address !== ref) return [];
  const records = ctx.state.list('sessions')
    .map(name => ctx.state.read<SessionRecord>(`sessions/${name}.jsonc`))
    .filter((r): r is SessionRecord => r !== undefined && r.session !== mine);
  const stopped = (): string[] => [`castlist（${url}）が応えないので、落ちた session の突き合わせをやめました（次の roster roles などで、また見ます）`];
  const places = new Map<string, Place | undefined>();
  for (const r of records.filter(r => r.present)) {
    const p = await placeOf(ctx, url, r);
    if (p === 'down' || p === 'busy') return stopped();
    places.set(r.session, p);
  }
  // 組ごとの、登録した session（自分も）。
  const at = (p: Place): string => `${p.uuid} ${p.ref}`;
  const seated = new Map<string, string[]>([[at({ ref, uuid }), [mine]]]);
  for (const r of records) {
    const p = places.get(r.session) ?? r.workspace;
    if (isPlace(p)) seated.set(at(p), [...seated.get(at(p)) ?? [], r.session]);
  }
  const closed: string[] = [];
  const failed: string[] = [];
  for (const r of records.filter(r => r.present)) {
    const p = places.get(r.session);
    if (p === undefined) continue;
    const now = seats.get(p.uuid)?.address;
    const reason = now === undefined
      ? 'workspace_gone'
      : now !== p.ref && (seated.get(at({ uuid: p.uuid, ref: now })) ?? []).some(s => s !== r.session) ? 'superseded' : undefined;
    if (reason === undefined) continue;
    // 送る直前に読み直す（その session の guard と書き合わないため）。
    const fresh = readSession(ctx, r.session);
    if (fresh?.present !== true) continue;
    const sent = await event(ctx, url, fresh, 'closed', { inferred: true, reason }, true);
    if (sent === 'ok') closed.push(`${fresh.name}（${reason === 'workspace_gone' ? '居場所が消えた' : '居場所に後から別の session が入った'}）`);
    else {
      failed.push(fresh.name);
      break;
    }
  }
  return [
    ...(closed.length === 0 ? [] : [`castlist: 落ちたと推して幕引きを送った: ${closed.join('・')}`]),
    ...(failed.length === 0 ? [] : [`castlist（${url}）に、落ちたと推した幕引きを送れませんでした（${failed.join('・')}）。castlist が応えないので、残りもやめました（次の roster roles などで、また見ます）`]),
  ];
}
