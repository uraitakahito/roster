// メッセージを NATS JetStream で配る道（設定の messages が nats の時）の、手元の物:
// 受け手の名・「渡す hook を持つ」の名乗り・process の見方・送る前の検査の印・渡した記録・届かずに終わった記録。
// どれも状態の folder の file で、配りの口（mailroom/）には聞かない（聞く物は commands/mail.ts と commands/messages.ts）。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Context } from './context.ts';
import type { Recipient } from './mailroom/types.ts';
import { selfParty, TPM_PARTY, type Party } from './party.ts';
import { TpmError } from './skill-sets.ts';

/** 設定で、メッセージを NATS で配る道を入れているか。 */
export const usesNats = (ctx: Pick<Context, 'config'>): boolean => ctx.config.messages === 'nats';

// ---- 受け手の名 ----

/** 受け手の名の長さの上限（配りの口の決まり）。 */
const NAME_MAX = 64;

/** 名の 1 節を作る: 英数字と `-` はそのまま、ほかの字（`_` も）は UTF-8 の byte ごとに `_` と 16 進 2 桁。 */
const encode = (part: string): string =>
  [...Buffer.from(part, 'utf8')].map(b => /[A-Za-z0-9-]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : `_${b.toString(16).padStart(2, '0')}`).join('');

/**
 * 担当の組（Key と起こした回）から、配りの受け手の名を作る。違う組は、同じ名にならない
 * （節の中の `_` の後ろは必ず 16 進 2 桁なので、`__` は Key と起こした回の境にしか出ない）。64 字を超える組は誤り。
 * TPM 担当だけは、起こした回を付けず、Key だけから作る: TPM 担当の席は project に 1 つで、起こし直した TPM 担当が、
 * 前の TPM 担当宛てで届いていなかった物を受け取る（cmux で運ぶ時と同じ）。前の session と今の session は、名乗りの pid と始まった時刻で見分ける。
 */
export function recipientName(party: Party): Recipient {
  const name = party.launch === undefined || party.key === TPM_PARTY ? encode(party.key) : `${encode(party.key)}__${encode(party.launch)}`;
  if (name === '' || name.length > NAME_MAX) throw new TpmError(`受け手の名が作れません（${NAME_MAX} 字まで。Key と起こしの id が長い）: ${party.key}`);
  return name;
}

// ---- process ----

/** process 1 つの、親の pid と命令（argv の頭）。 */
export interface ProcInfo {
  ppid: number
  command: string
}

/** process を見る・止める口（試験で替える）。 */
export interface Procs {
  /** この roster の process の pid。 */
  self: number
  /** その pid の process が始まった時刻の字（比べるだけに使う）。居なければ undefined。 */
  startedAt(pid: number): string | undefined
  /** その pid の process の親と命令。居なければ undefined。 */
  info(pid: number): ProcInfo | undefined
  /** 終わるよう合図（SIGTERM）を送る。もう居なくても誤りにしない。 */
  stop(pid: number): void
}

/** ps に 1 つ聞く。居ない・聞けない時は undefined。時刻の字が locale で替わらないように、LC_ALL=C で聞く。 */
function ps(format: string, pid: number): string | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  try {
    const out = execFileSync('ps', ['-o', format, '-p', String(pid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim();
    return out === '' ? undefined : out;
  }
  catch {
    return undefined;
  }
}

/** 本物の process を見る口。 */
export const realProcs: Procs = {
  self: process.pid,
  startedAt: pid => ps('lstart=', pid),
  info: (pid) => {
    const m = /^(\d+)\s+(.*)$/.exec(ps('ppid=,comm=', pid) ?? '');
    return m === null ? undefined : { ppid: Number(m[1]), command: m[2] ?? '' };
  },
  stop: (pid) => {
    try {
      process.kill(pid, 'SIGTERM');
    }
    catch {
      // もう居ない。
    }
  },
};

/** Claude Code の pid を渡す環境変数（cmux の wrapper が渡す物・Claude Code の環境に在る物）。この順に見る。 */
export const PID_ENV = ['CMUX_CLAUDE_PID', 'CLAUDE_PID'] as const;
/** 親をたどる段の上限。 */
const ANCESTORS_MAX = 12;
/** Claude Code の命令の名（argv の頭の、最後の節）。 */
const CLAUDE_COMMAND = 'claude';

/** pid をどこから知ったか。 */
export type PidSource = typeof PID_ENV[number] | 'parent';

/**
 * hook の命令から、自分を動かしている Claude Code の pid を知る（道は、この関数 1 つ）。分からなければ undefined（呼ぶ側は名乗らない）。
 * 自分の親をたどり、(1) 環境変数（PID_ENV）の pid が親の列に居れば、それ。(2) 無ければ、親の列で命令の名が claude の、いちばん近い物。
 * 環境変数だけを信じない訳: 外の Claude Code の Bash から起こされた session は、外の pid を受け継ぐ（親の列に居ない pid は使わない）。
 */
export function claudePid(env: NodeJS.ProcessEnv, procs: Procs): { pid: number, from: PidSource } | undefined {
  const ancestors: { pid: number, command: string }[] = [];
  let pid = procs.info(procs.self)?.ppid;
  while (pid !== undefined && pid > 1 && ancestors.length < ANCESTORS_MAX) {
    const info = procs.info(pid);
    if (info === undefined) break;
    ancestors.push({ pid, command: info.command });
    pid = info.ppid;
  }
  for (const name of PID_ENV) {
    const given = Number(env[name]);
    if (ancestors.some(a => a.pid === given)) return { pid: given, from: name };
  }
  const named = ancestors.find(a => basename(a.command.split(' ')[0] ?? '') === CLAUDE_COMMAND);
  return named === undefined ? undefined : { pid: named.pid, from: 'parent' };
}

// ---- 名乗り ----

/** 「渡す hook を持つ」の名乗り（`mail/claims/<受け手の名>.jsonc`）。session の始めの hook が書き、終わりの hook が消す。 */
export interface Claim {
  /** 受け手の名。 */
  name: Recipient
  party: Party
  /** Claude Code の session の id（hook の入力の session_id）。 */
  session?: string
  /** Claude Code の process の pid と、その process が始まった時刻の字。 */
  pid: number
  started: string
  /** pid をどこから知ったか。 */
  from: PidSource
  at: string
}

const CLAIMS = 'mail/claims';
const claimFile = (name: Recipient): string => `${CLAIMS}/${name}.jsonc`;

/** 名乗りが効いているか: pid の process が居て、始まった時刻が合う（番号の使い回しを見分ける）。 */
export const effective = (ctx: Pick<Context, 'procs'>, claim: Pick<Claim, 'pid' | 'started'>): boolean => ctx.procs.startedAt(claim.pid) === claim.started;

/** 名乗りを書く（あれば上書き）。 */
export const writeClaim = (ctx: Context, claim: Claim): void => ctx.state.write(claimFile(claim.name), claim);

/** 名乗りを消す。 */
export const removeClaim = (ctx: Context, name: Recipient): void => ctx.state.remove(claimFile(name));

/** 書いてある名乗り（効いていない物も）。 */
export const allClaims = (ctx: Context): Claim[] => ctx.state.list(CLAIMS).map(name => ctx.state.read<Claim>(claimFile(name))).filter(c => c !== undefined);

/** その名の、書いてある名乗り（効いているかは見ない）。 */
export const readClaim = (ctx: Context, name: Recipient): Claim | undefined => ctx.state.read<Claim>(claimFile(name));

/** その名の、効いている名乗り。無い・効いていなければ undefined。 */
export function claimNamed(ctx: Context, name: Recipient): Claim | undefined {
  const claim = readClaim(ctx, name);
  return claim !== undefined && effective(ctx, claim) ? claim : undefined;
}

/**
 * その担当の、効いている名乗り（送り手が、運ぶ道を決めるのに引く）。受け手の名（recipientName）の file を読む。
 * 起こした回の分からない担当（castlist を設定していない project の席）は、Key だけの名。TPM 担当は、起こした回に依らず 1 つの名。
 */
export function claimOf(ctx: Context, party: Party): Claim | undefined {
  try {
    return claimNamed(ctx, recipientName(party));
  }
  catch (e) {
    if (e instanceof TpmError) return undefined;
    throw e;
  }
}

/** 自分の受け手の名。作れない組（長い）なら undefined。 */
export function ownName(ctx: Pick<Context, 'env'>): Recipient | undefined {
  try {
    return recipientName(selfParty(ctx.env));
  }
  catch (e) {
    if (e instanceof TpmError) return undefined;
    throw e;
  }
}

/** 設定が nats で、自分（この session）の名乗りが効いていれば、その名乗り。そうでなければ undefined（今のとおり cmux で動く）。 */
export function ownClaim(ctx: Context): Claim | undefined {
  if (!usesNats(ctx)) return undefined;
  const name = ownName(ctx);
  return name === undefined ? undefined : claimNamed(ctx, name);
}

// ---- 送る前の検査の印 ----

/** 送る前の検査が止めた印（`mail/gate/<受け手の名>.jsonc`）。止めた後の hook が、これを見て本文を渡し、消す。 */
export interface GateMark {
  at: string
  /** 止めたメッセージの id。 */
  ids: string[]
  /** 止めた訳の字（hook が、本文の頭に添えて渡す）。 */
  reason: string
}

/** 検査が止めた印の file。 */
export const gateFile = (name: Recipient): string => `mail/gate/${name}.jsonc`;

/** 「検査では止めない」の印を付けた id を覚える数（受け手ごと）。 */
const PASSED_KEEP = 200;
const passedFile = (name: Recipient): string => `mail/passed/${name}.jsonc`;

/** 「検査では止めない」の印の付いた id（命令の結果に本文を出して通した物。次の送りでは止めない）。 */
export const passedIds = (ctx: Context, name: Recipient): Set<string> => new Set(ctx.state.read<string[]>(passedFile(name)) ?? []);

/** id に「検査では止めない」の印を付ける。 */
export function markPassed(ctx: Context, name: Recipient, ids: string[]): void {
  const had = ctx.state.read<string[]>(passedFile(name)) ?? [];
  ctx.state.write(passedFile(name), [...new Set([...had, ...ids])].slice(-PASSED_KEEP));
}

// ---- 待つ命令の印 ----

/** 待つ命令の印（`mail/waiters/<受け手の名>.jsonc`）。待つ者を、session につき 1 つに保つ。 */
export interface WaiterMark {
  pid: number
  started: string
}

/** 待つ命令の印の file。 */
export const waiterFile = (name: Recipient): string => `mail/waiters/${name}.jsonc`;

/** 動いている待つ命令（印の pid が居て、始まった時刻が合い、自分でない）を止める。止めたか。印は消さない（呼ぶ側が書き替えるか消す）。 */
export function stopWaiter(ctx: Context, name: Recipient): boolean {
  const mark = ctx.state.read<WaiterMark>(waiterFile(name));
  if (mark === undefined || mark.pid === ctx.procs.self || ctx.procs.startedAt(mark.pid) !== mark.started) return false;
  ctx.procs.stop(mark.pid);
  return true;
}

// ---- 渡した記録 ----

/** 手元の渡した記録の file。 */
export const DELIVERED_FILE = 'delivered.jsonl';

/** どの時に渡したか: gate は検査が止めた後、wake は手を止めている session を起こした、prompt は人の入力の時、output は命令の結果に出した（届いたには数えない）。 */
export type DeliveredWhen = 'gate' | 'wake' | 'prompt' | 'output';

/** 渡した記録の 1 行。 */
export interface DeliveredLine {
  at: string
  /** メッセージの id。 */
  id: string
  /** 受け手の名。 */
  to: Recipient
  when: DeliveredWhen
  /** hook が、この受け手に本文を渡した何度目か（output の行は 0）。 */
  nth: number
  /** その時の会話の記録（transcript）の行の数。分かる時だけ（guard が、送る命令を書いた返答より後に渡した物かを比べる）。 */
  lines?: number
  /** 渡した session の id（hook の入力の session_id。分かる時だけ。guard が、同じ会話の記録の行の数だけを比べる）。 */
  session?: string
}

/** 渡した記録を読む。 */
export const deliveredLines = (ctx: Context): DeliveredLine[] => ctx.state.lines<DeliveredLine>(DELIVERED_FILE);

/**
 * 渡した記録に 1 行足して返す。何度目か（nth）は、同じ受け手・同じ id の、hook が渡した行（output でない行）の数から出す（output の行は 0）。
 * lines は、その時の会話の記録の行の数、session は渡した session の id（どちらも、分かる時だけ）。
 */
export function recordDelivered(ctx: Context, id: string, to: Recipient, when: DeliveredWhen, lines?: number, session?: string): DeliveredLine {
  const nth = when === 'output' ? 0 : deliveredLines(ctx).filter(l => l.id === id && l.to === to && l.when !== 'output').length + 1;
  const line: DeliveredLine = { at: ctx.now().toISOString(), id, to, when, nth, ...(lines === undefined ? {} : { lines }), ...(session === undefined ? {} : { session }) };
  ctx.state.append(DELIVERED_FILE, line);
  return line;
}

/** guard が 1 度止めた、渡した記録の行を覚える数（受け手ごと）。 */
const GUARDED_KEEP = 200;
const guardedFile = (name: Recipient): string => `mail/guarded/${name}.jsonc`;

/** 渡した記録の行を、1 行ずつ見分ける字。 */
export const deliveredKey = (line: DeliveredLine): string => `${line.at} ${line.id} ${line.nth}`;

/** guard が「渡した物を読んでから打ち直す」と 1 度止めた、渡した記録の行（同じ行では、2 度止めない）。 */
export const guardedKeys = (ctx: Context, name: Recipient): Set<string> => new Set(ctx.state.read<string[]>(guardedFile(name)) ?? []);

/** 渡した記録の行を、guard が止めた物として覚える。 */
export function markGuarded(ctx: Context, name: Recipient, keys: string[]): void {
  ctx.state.write(guardedFile(name), [...guardedKeys(ctx, name), ...keys].slice(-GUARDED_KEEP));
}

/** file の行の数（空の行は数えない）。読めなければ undefined。 */
export function lineCount(path: string | undefined): number | undefined {
  if (path === undefined || path === '') return undefined;
  try {
    return readFileSync(path, 'utf8').split('\n').filter(l => l !== '').length;
  }
  catch {
    return undefined;
  }
}

// ---- 届かずに終わった記録 ----

/** 届かずに終わった記録の file（TPM 担当の命令が書く。1 通につき 1 行で、命令の結果に出すのも 1 度だけ）。 */
export const ENDED_FILE = 'mail-ended.jsonl';

/** 届かずに終わった訳: 渡し直しの上限を超えた・期限で消えた・席を閉じた（受け手の取り口を片付けた）。 */
export type EndedHow = 'undeliverable' | 'expired' | 'closed';

/** 届かずに終わった記録の 1 行。 */
export interface EndedLine {
  at: string
  id: string
  to: Recipient
  how: EndedHow
}

/** 届かずに終わった記録を読む。 */
export const endedLines = (ctx: Context): EndedLine[] => ctx.state.lines<EndedLine>(ENDED_FILE);
