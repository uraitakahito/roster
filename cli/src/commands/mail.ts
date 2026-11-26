// roster mail …: メッセージを NATS JetStream で渡す hook の命令（設定の messages が nats の席に、guard.ts の guardSettings が付ける）。
// どれも hook の入力（stdin の JSON）を読み、Claude Code の作業を誤りで止めない（program.ts が、どの誤りでも exit 0 にする）。
// 担当が中で起こした手伝い（subagent。入力に agent_id がある）の中では、何もしない。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Context } from '../context.ts';
import { sendsMessage, type Verdict } from '../guard.ts';
import { allClaims, claimNamed, claudePid, deliveredKey, deliveredLines, effective, ENDED_FILE, endedLines, recipientName, removeClaim as dropClaim, type EndedHow, type EndedLine, guardedKeys, markGuarded, gateFile, lineCount, ownName, readClaim, recordDelivered, removeClaim, stopWaiter, usesNats, waiterFile, writeClaim, type DeliveredWhen, type GateMark, type WaiterMark } from '../mail.ts';
import { MAILROOM_LIMITS, type Beacon, type Mailroom, type Recipient, type Stored, type TakeLimit, type Taken } from '../mailroom/types.ts';
import { allRoles, requireTpmSide, type RoleRecord } from '../roster.ts';
import { envOf } from '../env.ts';
import { selfParty } from '../party.ts';
import { copyMessageRecord } from './message-record.ts';
import type { Sent } from './messages.ts';

/** hook の入力（stdin の JSON）のうち、読む欄。 */
export interface HookInput {
  session_id?: string
  /** 会話の記録（JSONL）の path。 */
  transcript_path?: string
  /** 手伝い（subagent）の中で動いた hook にだけ在る。 */
  agent_id?: string
  /** hook の event の名（`PostToolUse`・`PostToolUseFailure` など）。 */
  hook_event_name?: string
  /** 道具の hook にだけ在る: 道具の呼び出しの id（`toolu_…`）。 */
  tool_use_id?: string
}

/** hook の入力を読む。JSON として読めなければ、欄の無い入力として扱う（hook は止めない）。 */
export function hookInput(stdin: string): HookInput {
  try {
    const input = JSON.parse(stdin) as unknown;
    return typeof input === 'object' && input !== null ? input : {};
  }
  catch {
    return {};
  }
}

/**
 * 名乗る（SessionStart の hook）: この session が「渡す hook を持つ」と、状態の folder に書く。送り手は、これが効いている受け手にだけ NATS で送る。
 * Claude Code の pid（mail.ts の claudePid）か、その始まった時刻が分からなければ、名乗らない（前の名乗りも消す。今のとおり cmux で届く）。
 * 設定が nats でなければ、何もしない。
 */
export function mailClaim(ctx: Context, stdin: string): void {
  const input = hookInput(stdin);
  if (input.agent_id !== undefined || !usesNats(ctx)) return;
  const name = ownName(ctx);
  if (name === undefined) return;
  const found = claudePid(ctx.env, ctx.procs);
  const started = found === undefined ? undefined : ctx.procs.startedAt(found.pid);
  if (found === undefined || started === undefined) {
    removeClaim(ctx, name);
    return;
  }
  writeClaim(ctx, { name, party: selfParty(ctx.env), ...(input.session_id === undefined ? {} : { session: input.session_id }), pid: found.pid, started, from: found.from, at: ctx.now().toISOString() });
}

/**
 * 名乗りを外す（SessionEnd の hook）。待つ命令も止める。
 * 消すのは、終わる session が書いた名乗りだけ（/clear では、次の session の名乗りが先に書かれていても消さない）。
 */
export function mailRelease(ctx: Context, stdin: string): void {
  const input = hookInput(stdin);
  if (input.agent_id !== undefined) return;
  const name = ownName(ctx);
  if (name === undefined) return;
  const claim = readClaim(ctx, name);
  if (claim !== undefined && input.session_id !== undefined && claim.session !== undefined && claim.session !== input.session_id) return;
  removeClaim(ctx, name);
  if (stopWaiter(ctx, name)) ctx.state.remove(waiterFile(name));
}

// ---- 渡す ----

/** hook が 1 度に取り置く量（20 通・本文を合わせて 9,000 字まで）。 */
const TAKE: TakeLimit = { max: 20, chars: 9000 };
/** 頭の 1 通だけを取り置く量（渡し直しの物かを見てから、後ろを取る）。 */
const TOP: TakeLimit = { max: 1, chars: TAKE.chars };

/**
 * hook が 1 度に渡す字の上限。Claude Code は、hook の additionalContext が 1 万字を超えると頭の 2KB だけにするので、
 * 見出しの行を合わせても超えないように、束の後ろを返して収める（頭の 1 通は、超えていても渡す）。
 */
const CONTEXT_MAX = 9800;

/** この受け手に、hook がその id の本文を渡すのは何度目になるか（手元の渡した記録から数える。道具の数える回数ではない）。 */
const nthOf = (ctx: Context, name: Recipient, id: string): number => deliveredLines(ctx).filter(l => l.id === id && l.to === name && l.when !== 'output').length + 1;

/** 渡す字を作る: 頭の行と、メッセージごとに送り手・id・本文。前にも渡した物には「渡し直し n 度目」と付ける。 */
function compose(ctx: Context, name: Recipient, head: string[], batch: Taken[]): string {
  return [
    ...head,
    ...batch.flatMap((m) => {
      const nth = nthOf(ctx, name, m.id);
      const again = nth >= 2 ? `・渡し直し ${nth} 度目（前にも渡したかもしれない）` : '';
      return [`--- ${m.from}（id ${m.id}${m.replyTo === undefined ? '' : `・返事の先 ${m.replyTo}`}${again}）`, m.text];
    }),
    '--- ここまで',
  ].join('\n');
}

/**
 * 今回渡す束を決める。first は、先に取り置いた頭の 1 通（無ければ空）。
 * 頭が渡し直しの物（道具の数える回数が 2 以上）なら、その 1 通だけを渡す（1 通が渡せないせいで、束ごと渡し直しの上限に近づかないように）。
 * 後ろを取ってから返すと、返した回も道具が渡した 1 度に数えるので、頭を見てから後ろを取る。
 * 渡す字が CONTEXT_MAX を超える間は、後ろから 1 通ずつ返す（すぐ取り直せる）。
 */
async function batchOf(ctx: Context, room: Mailroom, name: Recipient, head: string[], first: Taken[]): Promise<Taken[]> {
  const [top] = first;
  if (top === undefined) return [];
  const left = TAKE.chars - top.text.length;
  const taken = top.deliveries >= 2 || left <= 0 ? [top] : [top, ...await room.take(name, { max: TAKE.max - 1, chars: left })];
  let batch = taken;
  while (batch.length > 1 && compose(ctx, name, head, batch).length > CONTEXT_MAX) batch = batch.slice(0, -1);
  const rest = taken.slice(batch.length);
  if (rest.length > 0) await room.giveBack(rest);
  return batch;
}

/** メッセージの本文の頭の見出し（`【brief】…` の brief）。無ければ空。 */
const headingOf = (text: string): string => /^【([^】]+)】/.exec(text)?.[1] ?? '';

/**
 * 配りの口の 1 通から、送った記録の行（置き場の記録に書き足す時の元）を作る。送り手の log.jsonl は読まず、受け取った物の本文と、
 * 送り手が持たせた欄（labels: Key・見出し・送り手と受け手の Key・送った時刻。messages.ts の deliver）から作る。
 * だから、送り手の写しと受け手の書き足しの、どちらが置き場に先に着いても、同じ値の記録になる（置き場は、初めに置いた値を保つ）。
 * 欄の無い物は、本文と宛名から作る（Key は空。置き場には Key 無しで写る）。
 */
export function sentFrom(m: Stored): Sent {
  const l = m.labels ?? {};
  return {
    at: l.at ?? m.at,
    key: l.key ?? '',
    heading: l.heading ?? headingOf(m.text),
    from: m.from,
    to: m.to,
    text: m.text,
    id: m.id,
    ...(m.replyTo === undefined ? {} : { replyTo: m.replyTo }),
    ...(l.from === undefined ? {} : { sender: { key: l.from } }),
    ...(l.to === undefined ? {} : { recipient: { key: l.to } }),
    carrier: 'nats',
    box: m.to,
  };
}

/**
 * 束を渡す字を作り、手元の渡した記録を書いてから、「渡せた」（done）を返す。作った字を返す（呼ぶ側が、hook の出力に出す）。
 * 渡した記録は、置き場の記録にも書き足す（状態 delivered・届いた時刻・道・回数）。
 * 記録を書いた後に done が誤りでも、字は返す（本文は出すので、記録は正しい。配りの口が後でもう 1 度渡し、その時は「渡し直し」と付く）。
 */
async function handOver(ctx: Context, room: Mailroom, name: Recipient, when: DeliveredWhen, head: string[], batch: Taken[], input: HookInput): Promise<string> {
  const text = compose(ctx, name, head, batch);
  const lines = lineCount(input.transcript_path);
  for (const m of batch) {
    const line = recordDelivered(ctx, m.id, name, when, lines, input.session_id);
    // 置き場の記録にも写す（待たない。写せなくても止めない）。
    copyMessageRecord(ctx, sentFrom(m), { state: 'delivered', deliveredAt: line.at, via: when, deliveries: line.nth });
  }
  await room.done(batch).catch(() => undefined);
  return text;
}

/** hook の出力（stdout の JSON）: 字を Claude Code の文脈に足す。 */
const contextOutput = (event: 'PostToolUse' | 'PostToolUseFailure' | 'UserPromptSubmit', text: string): string => JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });

/**
 * 検査が止めた後に渡す（Bash を使い終えた後の hook。成功の後の PostToolUse と、失敗の後の PostToolUseFailure の両方に付く）。
 * 両方に付ける訳: 結果を pipe で切る書き方（`roster ask … | tail -1`）では、検査が止めても、命令全体の結果は後ろの命令の 0 になり、
 * Claude Code は「成功」と見て PostToolUse を動かす。出力の JSON を返す（event の名は、入力の hook_event_name に合わせる）。出す物が無ければ undefined。
 * 送る前の検査が止めた印（mail.ts の GateMark）が無ければ、配りの口に聞かずに終わる（file を見るだけ。Bash のたびに動くので）。
 * 印があれば、自分宛てを取り置き、止まった訳（印の字）と本文を渡して、印を消す。取り置ける物が無ければ、印を残して何も出さない
 * （打ち直しの検査が、取り置き中かどうかで決める。T8）。
 */
export async function mailGate(ctx: Context, stdin: string): Promise<string | undefined> {
  const input = hookInput(stdin);
  if (input.agent_id !== undefined) return undefined;
  const name = ownName(ctx);
  const mark = name === undefined ? undefined : ctx.state.read<GateMark>(gateFile(name));
  if (name === undefined || mark === undefined) return undefined;
  const room = await ctx.mailroom();
  const head = [mark.reason, '次が、まだ渡っていなかったメッセージです。読んだうえで、止まった命令を打ち直してください（事情が変わっていたら、中身を変えて打つ）。'];
  const batch = await batchOf(ctx, room, name, head, await room.take(name, TOP));
  if (batch.length === 0) return undefined;
  const text = await handOver(ctx, room, name, 'gate', head, batch, input);
  ctx.state.remove(gateFile(name));
  return contextOutput(input.hook_event_name === 'PostToolUse' ? 'PostToolUse' : 'PostToolUseFailure', text);
}

/**
 * 人が入力した時に渡す（UserPromptSubmit の hook）。出力の JSON を返す。出す物が無ければ undefined。
 * 先に、待つ命令を止める（担当が作業を始めた後に、前の待つ命令が担当を起こさないように）。自分の名乗りが効いていて、自分宛てがあれば、取り置いて渡す。
 * この hook は、決して exit 2 で終わらせない（人の入力が消える。program.ts が、どの誤りでも exit 0 にする）。
 */
export async function mailPrompt(ctx: Context, stdin: string): Promise<string | undefined> {
  const input = hookInput(stdin);
  if (input.agent_id !== undefined) return undefined;
  const name = ownName(ctx);
  if (name === undefined) return undefined;
  stopWaiter(ctx, name);
  ctx.state.remove(waiterFile(name));
  if (claimNamed(ctx, name) === undefined) return undefined;
  const room = await ctx.mailroom();
  const head = ['roster: 人の入力の前に届いていたメッセージです（メッセージキューから渡した）。人の入力と合わせて扱ってください。'];
  const batch = await batchOf(ctx, room, name, head, await room.take(name, TOP));
  if (batch.length === 0) return undefined;
  return contextOutput('UserPromptSubmit', await handOver(ctx, room, name, 'prompt', head, batch, input));
}

// ---- 待つ ----

/** 待つ命令の終わり方。code が 2 の時だけ、stderr の字を持って Claude Code が session を起こす。 */
export interface WaitResult {
  code: 0 | 2
  stderr?: string
}

const QUIET: WaitResult = { code: 0 };

/** 配りの口の「来るまで待つ」1 回の長さ（ミリ秒。T5・T6）。 */
const WAIT_MS = 30_000;
/** 待つ間に、Claude Code が居るか・止められていないかを見る間（T7）。 */
const TICK_MS = 2000;
/** 何も来なかった回の後に空ける間。 */
const IDLE_MS = 200;
/** 配りの口が応えない間の、試し直しの間（1 秒から倍々、長くて 30 秒）。 */
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
/** 名乗り（同じ SessionStart の hook が書く）を待つ回数と間。 */
const CLAIM_TRIES = 10;
const CLAIM_PAUSE_MS = 500;

/** 手を止めている session を起こす時に、本文の頭に添える行。 */
const WAKE_HEAD = ['roster: 手を止めている間に届いたメッセージです（メッセージキューから渡した）。'];

/** ms 待つ。止める合図が来たら、待たずに返る。眠りが先に終わったら、合図の listener を外す（待つ命令は TICK_MS ごとに呼ぶので、残すと溜まる）。 */
export async function pause(ctx: Pick<Context, 'sleep'>, ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  let wake = (): void => undefined;
  const stopped = new Promise<void>((resolve) => {
    wake = resolve;
  });
  signal.addEventListener('abort', wake, { once: true });
  try {
    await Promise.race([ctx.sleep(ms), stopped]);
  }
  finally {
    signal.removeEventListener('abort', wake);
  }
}

/**
 * 手を止めている間に待つ（Stop と SessionStart の hook。背景で動く）。自分宛てが来たら、stderr に出す本文を持って code 2 で返る（Claude Code が起きる）。
 * code 2 で返るのは、取り置いた本文が 1 通以上ある時だけ（空で起こさない）。ほかは、みな code 0。
 * - 待つ者は、session につき 1 つ（T4）: 動き出す時に、前の待つ命令（印の pid）を止めてから、自分を印に書く。印が自分でなくなったら終わる。
 * - 止められたら（signal。SIGTERM）、取り置いていた物を返して終わる。
 * - 自分の名乗りが効かなくなったら（Claude Code が居ない。T7）終わる。TICK_MS ごとに見る。
 * - 配りの口が応えない間は、間を空けて試し続ける（起こさない）。
 */
export async function mailWait(ctx: Context, stdin: string, signal: AbortSignal): Promise<WaitResult> {
  const input = hookInput(stdin);
  if (input.agent_id !== undefined) return QUIET;
  const name = ownName(ctx);
  if (name === undefined) return QUIET;
  // session の始めは、名乗る hook と並んで動くので、名乗りが書かれるのを少し待つ。
  let claim = claimNamed(ctx, name);
  for (let i = 0; claim === undefined && i < CLAIM_TRIES && !signal.aborted; i++) {
    await pause(ctx, CLAIM_PAUSE_MS, signal);
    claim = claimNamed(ctx, name);
  }
  if (claim === undefined || signal.aborted) return QUIET;
  const own = claim;
  stopWaiter(ctx, name);
  const self: WaiterMark = { pid: ctx.procs.self, started: ctx.procs.startedAt(ctx.procs.self) ?? '' };
  ctx.state.write(waiterFile(name), self);
  const mine = (): boolean => ctx.state.read<WaiterMark>(waiterFile(name))?.pid === self.pid;
  const leaving = (): boolean => signal.aborted || !effective(ctx, own) || !mine();
  let backoff = BACKOFF_MIN_MS;
  try {
    for (;;) {
      if (leaving()) return QUIET;
      let room: Mailroom;
      let taken: Taken[] | undefined;
      try {
        room = await ctx.mailroom();
        taken = await pulled(ctx, room, room.wait(name, TOP, WAIT_MS), leaving, signal);
      }
      catch {
        // 配りの口が応えない: 繋ぎを閉じて（次の問いで繋ぎ直す）、間を空けて試し直す。
        await ctx.mailroom().then(r => r.close()).catch(() => undefined);
        await pause(ctx, backoff, signal);
        backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
        continue;
      }
      backoff = BACKOFF_MIN_MS;
      if (taken === undefined) return QUIET;
      if (taken.length === 0) {
        await pause(ctx, IDLE_MS, signal);
        continue;
      }
      // 取った所で止められていたら、渡さずに返す（T4。次の hook が取り直す）。
      if (leaving()) {
        await room.giveBack(taken).catch(() => undefined);
        return QUIET;
      }
      const batch = await batchOf(ctx, room, name, WAKE_HEAD, taken);
      return { code: 2, stderr: await handOver(ctx, room, name, 'wake', WAKE_HEAD, batch, input) };
    }
  }
  finally {
    if (mine()) ctx.state.remove(waiterFile(name));
  }
}

/**
 * 「来るまで待つ」1 回が済むのを待つ。待つ間、TICK_MS ごとに leaving を見て、終わるべき時は undefined を返す
 * （その後に来た物は、取り置かずに返す）。
 */
async function pulled(ctx: Context, room: Mailroom, pulling: Promise<Taken[]>, leaving: () => boolean, signal: AbortSignal): Promise<Taken[] | undefined> {
  const got: { taken?: Taken[], error?: unknown, settled: boolean } = { settled: false };
  const watched = pulling.then((taken) => {
    got.taken = taken;
    got.settled = true;
  }, (error: unknown) => {
    got.error = error;
    got.settled = true;
  });
  while (!got.settled) {
    await Promise.race([watched, pause(ctx, TICK_MS, signal)]);
    if (!got.settled && leaving()) {
      void pulling.then(taken => room.giveBack(taken)).catch(() => undefined);
      return undefined;
    }
  }
  if (got.taken === undefined) throw got.error;
  return got.taken;
}

// ---- 軽い待ち方（NATS の CLI で待つ） ----
// 待つ命令（mailWait）は、Node.js の process が居続ける（1 席につき memory が 127MB ほど）。機械に NATS の CLI（nats）があれば、
// 待つ所だけを CLI に任せる（29MB ほど）: cli/bin/roster-mail-wait（sh）が、下の 2 つの段を Node.js で短く動かし、その間を CLI の
// 「置かれた事を聞く」（nats sub。取り置かない）で待つ。hook の命令（roster mail wait）は変わらない。
// 決まり（待つ者は 1 つ・Claude Code が居る間だけ・空で起こさない）は mailWait と同じで、印の pid は sh の process になる。

/**
 * 軽い待ち方の段の終わり方（exit code）。quit は何もせずに終わる、woke は本文を stderr に出して session を起こす（mailWait の code 2 と同じ）、
 * armed は待ってよい（自分宛ては今は無い）、retry は配りの口が応えない（間を空けて試し直す）、heavy は軽い待ち方ができない（mailWait に任せる）。
 */
export const WAIT_STEP = { quit: 0, woke: 2, armed: 10, retry: 11, heavy: 12 } as const;

/** 軽い待ち方の段の結果。stdout は sh が読む 1 行、stderr は起こす時の本文。 */
export interface StepResult {
  code: typeof WAIT_STEP[keyof typeof WAIT_STEP]
  stdout?: string
  stderr?: string
}

/** 合図の後に、配る箱に写されるのを待つ長さ（ミリ秒。NATS の「来るまで待つ」1 回の短い方の限り）。 */
const CHECK_WAIT_MS = 1000;

/**
 * 軽い待ち方の 1 段目（構える）: 名乗りを待ち、前の待つ命令を止め、待つ者の印を sh の process（waiter）で書く（T4）。
 * stdout に、sh が要る物を tab 区切りの 1 行で返す: Claude Code の pid・印の file の path・NATS の URL・合図の宛名。
 * 手伝いの中・名乗れない時は quit。配りの口が合図の在り処を持たない時（試験用の口）は heavy。
 */
export async function mailArm(ctx: Context, stdin: string, waiter: number): Promise<StepResult> {
  const input = hookInput(stdin);
  if (input.agent_id !== undefined) return { code: WAIT_STEP.quit };
  const name = ownName(ctx);
  if (name === undefined) return { code: WAIT_STEP.quit };
  // session の始めは、名乗る hook と並んで動くので、名乗りが書かれるのを少し待つ（mailWait と同じ）。
  let claim = claimNamed(ctx, name);
  for (let i = 0; claim === undefined && i < CLAIM_TRIES; i++) {
    await ctx.sleep(CLAIM_PAUSE_MS);
    claim = claimNamed(ctx, name);
  }
  if (claim === undefined) return { code: WAIT_STEP.quit };
  const started = ctx.procs.startedAt(waiter);
  if (started === undefined) return { code: WAIT_STEP.quit };
  let beacon: Beacon | undefined;
  try {
    beacon = (await ctx.mailroom()).beacon?.(name);
  }
  catch {
    return { code: WAIT_STEP.heavy };
  }
  if (beacon === undefined) return { code: WAIT_STEP.heavy };
  stopWaiter(ctx, name);
  ctx.state.write(waiterFile(name), { pid: waiter, started } satisfies WaiterMark);
  return { code: WAIT_STEP.armed, stdout: [claim.pid, join(ctx.state.dir, waiterFile(name)), beacon.url, beacon.subject].join('\t') };
}

/**
 * 軽い待ち方の 2 段目（見る）: 自分宛てがあれば取り置いて渡す（woke。本文は stderr）。無ければ armed（sh が、合図を待つ）。
 * 合図のすぐ後は、配る箱にまだ写されていないことがあるので、CHECK_WAIT_MS だけ待って取る。
 * 名乗りが効かない・待つ者の印が waiter でない（止められた・次の待つ命令に替わった）時は、取った物を返して quit。配りの口が応えなければ retry。
 */
export async function mailCheck(ctx: Context, stdin: string, waiter: number): Promise<StepResult> {
  const input = hookInput(stdin);
  if (input.agent_id !== undefined) return { code: WAIT_STEP.quit };
  const name = ownName(ctx);
  if (name === undefined) return { code: WAIT_STEP.quit };
  const leaving = (): boolean => claimNamed(ctx, name) === undefined || ctx.state.read<WaiterMark>(waiterFile(name))?.pid !== waiter;
  if (leaving()) return { code: WAIT_STEP.quit };
  let room: Mailroom;
  let taken: Taken[];
  try {
    room = await ctx.mailroom();
    taken = await room.wait(name, TOP, CHECK_WAIT_MS);
  }
  catch {
    return { code: WAIT_STEP.retry };
  }
  if (taken.length === 0) return { code: WAIT_STEP.armed };
  // 取った所で止められていたら、渡さずに返す（T4。次の hook が取り直す）。
  if (leaving()) {
    await room.giveBack(taken).catch(() => undefined);
    return { code: WAIT_STEP.quit };
  }
  const batch = await batchOf(ctx, room, name, WAKE_HEAD, taken);
  return { code: WAIT_STEP.woke, stderr: await handOver(ctx, room, name, 'wake', WAKE_HEAD, batch, input) };
}

/**
 * 担当が道具（Bash）を使う時に、残っている待つ命令を止める（roster guard が呼ぶ）。作業を始めた後に、前の待つ命令が担当を起こさないように（T4）。
 * 人の入力の時の hook（mailPrompt）が止めるのと同じ事を、入力を経ずに作業が始まった時（席を起こす時に渡した最初の入力・session の始まりの
 * 待つ命令が、名乗りを待っている間に過ぎた入力）にもする。手伝い（subagent）の道具では止めない（担当は、手を止めて待っていることがある）。
 */
export function settleWaiter(ctx: Context, stdin: string): void {
  if (hookInput(stdin).agent_id !== undefined) return;
  const name = ownName(ctx);
  if (name === undefined || ctx.state.read<WaiterMark>(waiterFile(name)) === undefined) return;
  stopWaiter(ctx, name);
  ctx.state.remove(waiterFile(name));
}

// ---- 打つ前に止める守り（roster guard）への足し ----

/** guard が見送った回の記録の file（送る命令を書いた返答の行が、会話の記録に見つからなかった回）。 */
export const GUARD_SKIPS_FILE = 'mail-guard.jsonl';

/**
 * 会話の記録（JSONL）の中で、その道具の呼び出し（tool_use の id）を書いた返答の行が、何行目か（空の行は数えない。1 から）。
 * 見つからない・読めない時は undefined。
 */
export function toolUseLine(path: string | undefined, toolUseId: string): number | undefined {
  if (path === undefined || path === '') return undefined;
  let lines: string[];
  try {
    lines = readFileSync(path, 'utf8').split('\n').filter(l => l !== '');
  }
  catch {
    return undefined;
  }
  const found = lines.findIndex((l) => {
    if (!l.includes(toolUseId)) return false;
    try {
      const row = JSON.parse(l) as { type?: string, message?: { content?: unknown } };
      const content = row.message?.content;
      return row.type === 'assistant' && Array.isArray(content) && content.some((c: { type?: string, id?: string } | null) => c?.type === 'tool_use' && c.id === toolUseId);
    }
    catch {
      return false;
    }
  });
  return found === -1 ? undefined : found + 1;
}

/**
 * roster guard に足す守り（設定の messages が nats の席だけ。Bash の命令が、roster の送る命令・ページを置く命令の時）。
 * - 手伝い（subagent。入力に agent_id がある）の中からの送る命令は止める（送る前の検査も、止めた後に渡す hook も、担当の物）。
 * - 同じ返答の中で渡した物がある時は、1 度止める: この命令を書いた返答（会話の記録の中の、この道具の呼び出しの id を持つ行）より後に、
 *   hook が渡した記録（行の数で比べる。同じ session の物だけ）があれば、「渡した物を読んでから打ち直す」と止める。同じ渡した記録では、2 度止めない。
 *   会話の記録にその行が見つからない時は、止めずに、見送った事を GUARD_SKIPS_FILE に残す。
 *   Claude Code 2.1.332 では、PreToolUse の時に、その返答の行がまだ会話の記録に書かれていないので、この守りは働かない（いつも見送る）。
 *   並べた送りは、送る前の検査が時刻で止める（commands/messages.ts の assertNotFresh）。行が先に書かれる版になれば、ここも効く。
 */
export function mailGuard(ctx: Context, stdin: string, command: string): Verdict {
  if (!usesNats(ctx) || !sendsMessage(command)) return { allow: true };
  const input = hookInput(stdin);
  if (input.agent_id !== undefined) {
    return { allow: false, reason: '送る命令（roster ask・report・notify・answer・dismiss・assign・page put）は、手伝い（subagent）でなく担当が打ちます。手伝いは、送る中身を担当に返してください（担当が、届いたメッセージを読んだうえで打つ）。' };
  }
  const name = ownName(ctx);
  if (name === undefined || input.tool_use_id === undefined) return { allow: true };
  const hooked = deliveredLines(ctx).filter(l => l.to === name && l.when !== 'output' && l.lines !== undefined && (l.session === undefined || input.session_id === undefined || l.session === input.session_id));
  if (hooked.length === 0) return { allow: true };
  const written = toolUseLine(input.transcript_path, input.tool_use_id);
  if (written === undefined) {
    ctx.state.append(GUARD_SKIPS_FILE, { at: ctx.now().toISOString(), to: name, tool: input.tool_use_id, note: '会話の記録に、この道具の呼び出しの行が見つからない（止めていない）' });
    return { allow: true };
  }
  const guarded = guardedKeys(ctx, name);
  const after = hooked.filter(l => (l.lines ?? 0) >= written && !guarded.has(deliveredKey(l)));
  if (after.length === 0) return { allow: true };
  markGuarded(ctx, name, after.map(deliveredKey));
  return { allow: false, reason: `この命令を書いた後に、メッセージが ${after.length} 件渡されています（同じ返答の中）。渡された物を読んでから、同じ命令を打ち直してください（事情が変わっていたら、中身を変えて打つ）。` };
}

// ---- TPM 担当の側の片付け ----

/** 届かずに終わった訳の、命令の結果に出す字と、置き場の記録に書く状態と道。 */
const ENDED: Record<EndedHow, { label: string, why: string, state: 'undeliverable' | 'expired', via: string }> = {
  undeliverable: { label: '渡せない', why: `渡し直しの上限（${MAILROOM_LIMITS.maxDeliveries} 度）を超えた`, state: 'undeliverable', via: 'max-deliveries' },
  expired: { label: '期限切れ', why: `届かないまま ${MAILROOM_LIMITS.undeliveredTtlMs / 3_600_000} 時間で消えた`, state: 'expired', via: 'ttl' },
  closed: { label: '期限切れ（席を閉じた）', why: '届かないまま、受け手の取り口を片付けた', state: 'expired', via: 'closed' },
};

/** 期限切れを判じた時刻を覚える file（送る命令のたびには、記録の箱を読み直さない）。 */
const EXPIRED_CHECK_FILE = 'mail/expired-check.jsonc';
/** 送る命令の時に、期限切れを判じ直すまでの間（ミリ秒）。名乗る時は、いつも判じる。 */
const EXPIRED_CHECK_EVERY_MS = 60 * 60 * 1000;

/**
 * 届かずに終わった 1 通を記録し（ENDED_FILE。1 通につき 1 行）、置き場の記録に写し、命令の結果に出す 1 行を返す。
 * もう記録してあれば、何もせず undefined（結果に出すのは、1 通につき 1 度だけ）。
 */
function ended(ctx: Context, known: Set<string>, how: EndedHow, m: Stored): string | undefined {
  if (known.has(m.id)) return undefined;
  known.add(m.id);
  ctx.state.append(ENDED_FILE, { at: ctx.now().toISOString(), id: m.id, to: m.to, how } satisfies EndedLine);
  const sent = sentFrom(m);
  const deliveries = deliveredLines(ctx).filter(l => l.id === m.id && l.when !== 'output').length;
  copyMessageRecord(ctx, sent, { state: ENDED[how].state, via: ENDED[how].via, ...(deliveries === 0 ? {} : { deliveries }) });
  return `${ENDED[how].label}: 【${sent.heading}】${sent.from} → ${sent.recipient?.key ?? m.to}（${sent.at} に送った。id ${m.id}。${ENDED[how].why}。要る中身なら、送り直す）`;
}

/** 名簿の行の、配りの受け手の名。作れない組（長い）なら undefined。 */
function nameOfRole(role: Pick<RoleRecord, 'key' | 'launch'>): Recipient | undefined {
  try {
    return recipientName({ key: role.key, ...(role.launch === undefined ? {} : { launch: role.launch }) });
  }
  catch {
    return undefined;
  }
}

/**
 * TPM 担当の側の片付け（設定の messages が nats の時だけ。TPM 担当が名乗る時と、送る命令を打つ時に呼ぶ）。命令の結果に出す行を返す。
 * - 渡し直しの上限を超えた物を引いて「渡せない」と記録し、置き場に写す（T2）。
 * - 届かないまま期限で消えた物（記録の箱にあって・配る箱に無く・渡した記録が無く・置いてから期限を過ぎた物）を「期限切れ」と記録し、写す（T3）。
 *   判じるのは、写しの遅れが 0 の時だけ。名乗る時（sweep）はいつも、送る命令の時は EXPIRED_CHECK_EVERY_MS に 1 度。
 * - sweep（名乗る時）: 名簿に無く、名乗りも効いていない受け手の取り口を掃き、残っていた物を「期限切れ（席を閉じた）」と記録する（N1）。
 * どの行も、1 通につき 1 度だけ出る。配りの口が誤りの時は、何も出さずに終わる（呼んだ命令を止めない）。
 */
export async function tidyMail(ctx: Context, options: { sweep: boolean }): Promise<string[]> {
  if (!usesNats(ctx) || envOf(ctx.env, 'KEY') !== undefined) return [];
  const out: string[] = [];
  try {
    const room = await ctx.mailroom();
    const known = new Set(endedLines(ctx).map(l => l.id));
    const keep = (how: EndedHow, m: Stored): void => {
      const line = ended(ctx, known, how, m);
      if (line !== undefined) out.push(line);
    };
    for (const u of await room.undeliverable()) {
      if (u.stored !== undefined) keep('undeliverable', u.stored);
      else out.push(`${ENDED.undeliverable.label}: ${u.to} 宛ての 1 通（中身は、もう期限で消えていた。${ENDED.undeliverable.why}）`);
    }
    const now = ctx.now().getTime();
    const checked = ctx.state.read<{ at: string }>(EXPIRED_CHECK_FILE)?.at;
    if ((options.sweep || checked === undefined || now - Date.parse(checked) >= EXPIRED_CHECK_EVERY_MS) && await room.lag() === 0) {
      // 前に判じた時より後に期限を過ぎた物だけを読む（初めは、記録の箱の残す長さの分）。
      const since = new Date(checked === undefined ? now - MAILROOM_LIMITS.recordTtlMs : Date.parse(checked) - MAILROOM_LIMITS.undeliveredTtlMs - EXPIRED_CHECK_EVERY_MS);
      const outstanding = await room.outstanding();
      const handed = new Set(deliveredLines(ctx).filter(l => l.when !== 'output').map(l => l.id));
      for (const m of await room.record(since)) {
        if (Date.parse(m.at) + MAILROOM_LIMITS.undeliveredTtlMs <= now && !outstanding.has(m.id) && !handed.has(m.id)) keep('expired', m);
      }
      ctx.state.write(EXPIRED_CHECK_FILE, { at: new Date(now).toISOString() });
    }
    if (options.sweep) {
      const listed = new Set([nameOfRole(selfParty(ctx.env)), ...allRoles(ctx).map(nameOfRole), ...allClaims(ctx).filter(c => effective(ctx, c)).map(c => c.name)]);
      for (const name of await room.recipients()) {
        if (listed.has(name)) continue;
        const left = await room.clear(name);
        for (const m of left) keep('closed', m);
        dropClaim(ctx, name);
        out.push(`名簿に無い受け手の取り口を片付けた: ${name}（残っていた物 ${left.length} 通）`);
      }
    }
  }
  catch {
    // 配りの口が応えない時は、片付けを見送る（次の回に見る）。
  }
  return out;
}

/**
 * 席を閉じる時の片付け（roster close。設定の messages が nats の時だけ）: その受け手の取り口と残りを消し、残っていた物を
 * 「期限切れ（席を閉じた）」と記録して写す。名乗りと印も消す。命令の結果に出す行を返す。
 * 担当の交代（dismiss --handover）の後の close では、消さない（同じ受け手の名を、次の担当が継ぐことがある）。
 */
export async function clearSeat(ctx: Context, role: RoleRecord): Promise<string[]> {
  if (!usesNats(ctx) || role.dismissed === 'handover') return [];
  const name = nameOfRole(role);
  if (name === undefined) return [];
  try {
    const left = await (await ctx.mailroom()).clear(name);
    const known = new Set(endedLines(ctx).map(l => l.id));
    const lines = left.map(m => ended(ctx, known, 'closed', m)).filter(l => l !== undefined);
    dropClaim(ctx, name);
    ctx.state.remove(gateFile(name));
    if (stopWaiter(ctx, name)) ctx.state.remove(waiterFile(name));
    return lines;
  }
  catch (e) {
    return [`メッセージキューが応えないので、${role.key} の取り口を片付けられなかった（${e instanceof Error ? e.message : String(e)}）。次に TPM 担当が名乗る時に掃く`];
  }
}

/** roster inbox の、NATS の分（設定の messages が nats で、名乗っている session）: 自分宛てで残っている物を、取り置かずに出すだけ（届いたとは記録しない）。無ければ空。 */
export async function peekInbox(ctx: Context, name: Recipient): Promise<string[]> {
  const letters = await (await ctx.mailroom()).peek(name);
  if (letters.length === 0) return [];
  return [...letters.flatMap(m => [`--- ${m.from}（id ${m.id}）`, m.text]), '--- ここまで（出しただけ。届いたとは記録していない。hook が、この後で渡す）'];
}

/**
 * roster mail left（TPM 担当だけ。設定の messages が cmux でも nats でも動く）: メッセージキュー（NATS）に残っている物（まだ渡っていない物）を、
 * 受け手ごとに、数と、1 通ごとの見出し・送り手・置いた時刻で出す。取り置かない（読むだけ）。
 * 設定を cmux に戻す前と後に、残りを見るための物（戻した後は、送り手が NATS に置かず、hook を持たない席は受け取らない）。
 * 見る受け手は、取り口のある受け手・名簿の担当・名乗りのある受け手・送った記録で NATS に置いた受け手・TPM 担当。応えなければ、そう出す。
 */
export async function mailLeft(ctx: Context): Promise<string[]> {
  requireTpmSide(ctx, 'roster mail left');
  try {
    const room = await ctx.mailroom();
    const names = new Set<string | undefined>([
      ...await room.recipients(),
      nameOfRole(selfParty(ctx.env)),
      ...allRoles(ctx).map(nameOfRole),
      ...allClaims(ctx).map(c => c.name),
      ...ctx.state.lines<Sent>('log.jsonl').map(l => l.box),
    ]);
    const out: string[] = [];
    for (const name of [...names].filter(n => n !== undefined).sort()) {
      const letters = await room.peek(name);
      if (letters.length === 0) continue;
      out.push(`${name}: ${letters.length} 通`, ...letters.map((m) => {
        const sent = sentFrom(m);
        return `- 【${sent.heading}】${m.from}（${m.at} に置いた。id ${m.id}）`;
      }));
    }
    return out.length === 0 ? ['メッセージキューに、残っている物は無い'] : [...out, '中身は、受け手の席の roster inbox か、送った記録（log.jsonl）の同じ id の行で読む'];
  }
  catch (e) {
    return [`メッセージキューが応えません（${e instanceof Error ? e.message : String(e)}）。残りは分かりません`];
  }
}
