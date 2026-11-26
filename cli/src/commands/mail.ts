// roster mail …: メッセージを NATS JetStream で渡す hook の命令（設定の messages が nats の席に、guard.ts の guardSettings が付ける）。
// どれも hook の入力（stdin の JSON）を読み、Claude Code の作業を誤りで止めない（program.ts が、どの誤りでも exit 0 にする）。
// 担当が中で起こした手伝い（subagent。入力に agent_id がある）の中では、何もしない。
import type { Context } from '../context.ts';
import { claudePid, ownName, readClaim, removeClaim, stopWaiter, usesNats, waiterFile, writeClaim } from '../mail.ts';
import { selfParty } from '../party.ts';

/** hook の入力（stdin の JSON）のうち、読む欄。 */
export interface HookInput {
  session_id?: string
  /** 会話の記録（JSONL）の path。 */
  transcript_path?: string
  /** 手伝い（subagent）の中で動いた hook にだけ在る。 */
  agent_id?: string
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
