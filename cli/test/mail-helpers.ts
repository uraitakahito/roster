// メッセージを渡す hook の試験の足場: 名乗った担当の居る世界（置かれた物は、試験が hook の命令を呼ぶまで箱に残る）と、誤りを返す配りの口。
import type { Context } from '../src/context.ts';
import { hello } from '../src/commands/role-side.ts';
import { assign } from '../src/commands/tpm-side.ts';
import { ownName, recordDelivered, writeClaim } from '../src/mail.ts';
import type { Mailroom, Stored } from '../src/mailroom/types.ts';
import { selfParty } from '../src/party.ts';
import { TpmError } from '../src/skill-sets.ts';
import { BRIEF, world, type World } from './helpers.ts';

export const TPM = { model: 'claude-opus-5-5', effort: 'medium' };
/** 1 度に取る量（hook と同じ）。 */
export const ALL = { max: 20, chars: 9000 };
/** TPM 担当の題。 */
export const FROM_TPM = 'Technical Program Manager';
/** t-x7k2 の担当の題。 */
export const FROM_SE = 'SWE t-x7k2: 計画と実装';

/** その周りの session が「渡す hook を持つ」と名乗った事にする（pid の process を居る事にして、名乗りを書く）。 */
export function claim(w: World, ctx: Context, pid: number): void {
  w.procs.add(pid, 1, 'claude');
  writeClaim(ctx, { name: ownName(ctx) ?? '', party: selfParty(ctx.env), session: `s-${pid}`, pid, started: `started-${pid}`, from: 'CLAUDE_PID', at: ctx.now().toISOString() });
}

/**
 * TPM 担当が名乗り、t-x7k2 の Software Engineer 担当を起こして名乗らせた世界（どちらも、まだ「渡す hook を持つ」とは名乗っていない）。
 * 置かれた物を、席がすぐ受け取った事にはしない（world の handOver: false）。
 */
export async function natsWorld(config: Record<string, unknown> = { messages: 'nats' }): Promise<World & { se: Context }> {
  const w = world(config, {}, {}, { handOver: false });
  await hello(w.tpm, TPM);
  await assign(w.tpm, 't-x7k2', { role: 'software-engineer', title: '計画と実装', brief: BRIEF, wait: 0 });
  const se = w.role('t-x7k2', 'file:1');
  await hello(se);
  return { ...w, se };
}

/** 配りの口が応えない周り。 */
export const down = (ctx: Context): Context => ({ ...ctx, mailroom: () => Promise.reject(new TpmError('メッセージキュー（NATS。nats://127.0.0.1:4222）が応えません: timeout')) });

/** 配りの口の 1 つの問いだけを替えた周り。 */
export async function patched(ctx: Context, patch: Partial<Mailroom>): Promise<Context> {
  const room = Object.assign(Object.create(await ctx.mailroom()) as Mailroom, patch);
  return { ...ctx, mailroom: () => Promise.resolve(room) };
}

/** 配る箱に残っている物（受け手の名ごと）。 */
export const left = (w: World, box: string): Stored[] => w.office.work.filter(i => i.stored.to === box).map(i => i.stored);

/** その周りの session 宛てで残っている物を、hook が渡した事にする（渡した記録に wake と残し、箱から外す）。名乗りは要らない。 */
export async function handed(ctx: Context): Promise<void> {
  const name = ownName(ctx) ?? '';
  const room = await ctx.mailroom();
  const taken = await room.take(name, ALL);
  for (const m of taken) recordDelivered(ctx, m.id, name, 'wake');
  await room.done(taken);
}
