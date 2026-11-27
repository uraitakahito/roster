// roster reply-language check: TPM 担当の席の Stop の hook（guard.ts の guardSettings が、TPM 担当の席にだけ付ける）。
// 最後の返事の字を数え、英語なら 1 回だけ日本語で書き直させる（監査 audit-2 の R13・t-jen6 の plan-2 の PR 2）。
// hook なので、どの誤りでも何も返さずに 0 で終わる（program.ts）。返事の字そのものは、どこにも書かない。
import type { Context } from '../context.ts';
import { countJapanese, isEnglish } from '../reply-language.ts';
import { hookInput, type HookInput } from './mail.ts';

/** Stop の hook の入力のうち、この命令が読む欄。 */
interface StopInput extends HookInput {
  /** 止まる前の最後の返事の字（Claude Code 2.1 から）。 */
  last_assistant_message?: string
  /** Stop の hook が止めて続けた回・背景の hook（mail wait）が起こした回で true。 */
  stop_hook_active?: boolean
}

/** 書き直させた印を置く folder（状態の folder の下。session ごとに 1 つ）。 */
export const MARK_FOLDER = 'reply-language';

/** 手を止めるたびに 1 行書く記録。 */
export const LOG_FILE = 'reply-language.jsonl';

/**
 * 書き直させた印が効く長さ。過ぎた印は、書き直しの前に人が割り込んだ・session が替わった物として消す。
 * 書き直しは新しい手を打たないので、すぐ済む。短くするのは、書き直しの途中で人が Esc で止めて印が残り、その後にメッセージで起こされた回（stop_hook_active が true）の英語を、書き直しの回と取り違えて通す間を狭めるため（review-6 の指摘 1。その間は残る）。
 */
export const MARK_MINUTES = 3;

/** 決めた道。ok・short は通した、block は書き直させた、rewritten は書き直しの回（数えて書くが止めない）。 */
export type Way = 'ok' | 'short' | 'block' | 'rewritten';

/** 記録の 1 行。continued は入力の stop_hook_active（false は人が書いた回、true はメッセージで起こされた回か書き直しの回）。 */
export interface LogLine {
  at: string
  session: string
  way: Way
  share: number | null
  letters: number
  continued: boolean
}

interface Mark {
  at: string
}

/** session の印の file（状態の folder の下）。session の id は、英数字と - と _ のほかを - にする（. を残すと .. で folder の外を指せるため）。 */
function markName(session: string): string {
  return markFile(session.replaceAll(/[^A-Za-z0-9_-]/g, '-'));
}

function markFile(id: string): string {
  return `${MARK_FOLDER}/${id}.jsonc`;
}

/** 書き直しを頼む文。 */
export function rewriteReason(share: number): string {
  return `直前の返事は英語でした（仮名と漢字が字の ${Math.floor(share * 100)}%）。TPM 担当の画面への返事は日本語で書く決まりです。同じ中身を日本語で書き直してください（新しい手は打たない）。命令・file の名・原文の写しは元のまま。`;
}

/**
 * 最後の返事を数え、英語なら書き直させる。書き直させる時は、Claude Code に返す JSON（decision: block）を返す。通す時は undefined。
 * 1 回に限る: 書き直させた時に印を書き、次の Stop が「印が MARK_MINUTES の内、かつ stop_hook_active」の時だけ、書き直しの回として通す。
 * stop_hook_active だけでは決めない（メッセージで起こされた回にも立つ。review-1 の指摘 2）。印だけでも決めない（書き直しの途中で人が割り込んだ回を見逃す。review-2 の指摘 1）。
 */
export function replyLanguageCheck(ctx: Context, stdin: string): string | undefined {
  const input = hookInput(stdin) as StopInput;
  if (input.agent_id !== undefined) return undefined;
  const text = input.last_assistant_message;
  if (typeof text !== 'string') return undefined;
  const now = ctx.now();
  sweepMarks(ctx, now);
  const session = input.session_id ?? 'unknown';
  const name = markName(session);
  const marked = ctx.state.read<Mark>(name) !== undefined;
  const continued = input.stop_hook_active === true;
  const counted = countJapanese(text);
  const log = (way: Way): void => ctx.state.append(LOG_FILE, { at: now.toISOString(), session, way, share: counted.share === undefined ? null : Math.round(counted.share * 1000) / 1000, letters: counted.letters, continued } satisfies LogLine);
  if (marked) ctx.state.remove(name);
  if (marked && continued) {
    log('rewritten');
    return undefined;
  }
  if (counted.share === undefined) {
    log('short');
    return undefined;
  }
  if (!isEnglish(counted)) {
    log('ok');
    return undefined;
  }
  ctx.state.write(name, { at: now.toISOString() } satisfies Mark);
  log('block');
  return JSON.stringify({ decision: 'block', reason: rewriteReason(counted.share) });
}

/** MARK_MINUTES を過ぎた印を消す（ほかの session の物も。/clear や起こし直しで session が替わった印を溜めない。review-2 の指摘 6）。読めない印も消す。 */
function sweepMarks(ctx: Context, now: Date): void {
  for (const id of ctx.state.list(MARK_FOLDER)) {
    const name = markFile(id);
    let at: number;
    try {
      at = Date.parse(ctx.state.read<Mark>(name)?.at ?? '');
    }
    catch {
      at = Number.NaN;
    }
    if (Number.isNaN(at) || now.getTime() - at > MARK_MINUTES * 60_000) ctx.state.remove(name);
  }
}
