// 証拠: 後から「何が・いつ・誰の手で起きたか」を言えるように、roster が自分のした事を状態の folder に足していく記録。
// どれも 1 行 1 件の .jsonl（担当が同時に書いてもぶつからない）。書くだけで、命令の動きは変えない。
// 中身にはメッセージや命令の字が入るので、roster を動かす機械の外（課題のコメント・PR の本文）には写さない。
import type { Context } from './context.ts';
import type { MessageTrace } from './transport/types.ts';
import { envOf } from './env.ts';

/** 記録に書く「誰が」: 担当は課題の Key と役割、TPM 担当（と roster が起こしていない session）は tpm。 */
export const actor = (env: NodeJS.ProcessEnv): { by: string, role: string } => ({ by: envOf(env, 'KEY') || 'tpm', role: envOf(env, 'ROLE') || 'tpm' });

/** guard が止めた命令に残す字の長さ（here-document などの長い命令を丸ごと残さない）。 */
const COMMAND_LIMIT = 300;

/** guard が止めた命令 1 件（guard.jsonl）。 */
export interface GuardStop {
  at: string
  by: string
  role: string
  /** 命令の頭（COMMAND_LIMIT 字まで）。 */
  command: string
  reason: string
}

/** guard が命令を止めたことを guard.jsonl に残す。 */
export function recordGuardStop(ctx: Context, command: string, reason: string): void {
  ctx.state.append('guard.jsonl', { at: ctx.now().toISOString(), ...actor(ctx.env), command: command.slice(0, COMMAND_LIMIT), reason } satisfies GuardStop);
}

/**
 * 入口の検査の種類: 読んでいないメッセージ・merge していない PR・状態を読めない PR・同じメッセージの 2 度送り・TPM 担当が送って済んでいない物・
 * 前の監査の文脈が残ったまま始めようとした監査・担当の session から打った TPM 担当だけの命令・
 * メッセージキュー（NATS）が応えない・写しが遅れている（設定の messages が nats の時だけ）。
 */
export type GateKind = 'unread' | 'not-merged' | 'pr-unreadable' | 'repeat' | 'unsettled' | 'stale-context' | 'tpm-only' | 'queue';

/** 入口の検査が送るのを止めた 1 件（gate.jsonl）。 */
export interface GateStop {
  at: string
  by: string
  role: string
  gate: GateKind
  /** 読んでいなかったメッセージの id、PR の URL と state、先に送った同じメッセージの id、前の監査の報告の URL、断った命令の名。 */
  detail: string
}

/** 入口の検査が送るのを止めたことを gate.jsonl に残す（多すぎないかを、後から数で見るため）。 */
export function recordGateStop(ctx: Context, gate: GateKind, detail: string): void {
  ctx.state.append('gate.jsonl', { at: ctx.now().toISOString(), ...actor(ctx.env), gate, detail } satisfies GateStop);
}

/** 状態 wait の移り 1 件（waits.jsonl）。`waits/<宛先>.jsonc` は最後の 1 つだけなので、移り変わりはここに残す。 */
export interface WaitChange {
  at: string
  by: string
  role: string
  address: string
  text: string
}

/** 状態 wait を替えたことを waits.jsonl に残す。 */
export function recordWait(ctx: Context, address: string, text: string): void {
  ctx.state.append('waits.jsonl', { at: ctx.now().toISOString(), ...actor(ctx.env), address, text } satisfies WaitChange);
}

const same = (a: MessageTrace, b: MessageTrace): boolean => a.deliveredAt === b.deliveredAt && a.readAt === b.readAt;

/**
 * 連携の道具が覚えている「送った・届いた・読んだ時刻」を、deliveries.jsonl に写す。写した件数を返す。
 * 写すのは、この project が送ったメッセージ（log.jsonl に id がある物）だけ。前に写した時から変わっていない物は足さない。
 * 道具は古いメッセージを捨てる（cmux は新しい 1,000 件まで）ので、居場所を閉じる時と TPM 担当が名乗る時に呼ぶ。
 */
export function syncDeliveries(ctx: Context): number {
  const ours = new Set(ctx.state.lines<{ id: string }>('log.jsonl').map(l => l.id));
  const known = new Map(ctx.state.lines<MessageTrace>('deliveries.jsonl').map(t => [t.id, t]));
  let written = 0;
  for (const trace of ctx.messages.history()) {
    const before = known.get(trace.id);
    if (!ours.has(trace.id) || (before !== undefined && same(before, trace))) continue;
    ctx.state.append('deliveries.jsonl', trace);
    known.set(trace.id, trace);
    written += 1;
  }
  return written;
}
