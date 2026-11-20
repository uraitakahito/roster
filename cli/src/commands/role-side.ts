// 担当（TPM 担当に起こされた Claude Code）が打つ命令。
import type { Context } from '../context.ts';
import { modelStatus, ROLES, WAIT } from '../protocol.ts';
import { requireSelf, requireTpm, writeRole } from '../roster.ts';

/** 名乗る: 状態を出し、名簿に自分の宛先と時刻を書く（起きた合図）。受け持ちを返す。 */
export function hello(ctx: Context): string[] {
  const record = requireSelf(ctx);
  const tpm = requireTpm(ctx);
  record.address = ctx.transport.whoami();
  record.helloAt = ctx.now().toISOString();
  ctx.transport.setStatus('model', modelStatus(record.model, record.effort));
  ctx.transport.setStatus('wait', WAIT.work('依頼書を読む'));
  writeRole(ctx, record);
  return [
    `役割: ${ROLES[record.role].label}`,
    `課題の鍵: ${record.key}`,
    `依頼書: ${record.brief ?? '無し（【依頼】を待つ）'}`,
    `課題管理の課題: ${record.issue ?? '無し'}（道具: ${ctx.config.tracker}）`,
    `TPM 担当の宛先: ${tpm.address}`,
    `自分の宛先: ${record.address}`,
  ];
}
