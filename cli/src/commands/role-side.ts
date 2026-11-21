// 担当（TPM 担当に起こされた Claude Code）が打つ命令。hello と inbox は TPM 担当も打つ。
import type { Context } from '../context.ts';
import { modelStatus, ROLES, WAIT } from '../protocol.ts';
import { requireSelf, requireTpm, writeRole } from '../roster.ts';
import { TpmError } from '../skill-sets.ts';
import { issueTracker } from './issue.ts';
import { issueCopyLine, markShown } from './messages.ts';
import { recordingTo, tpmHello } from './tpm-side.ts';

/**
 * 名乗る。$TPM_KEY が無ければ TPM 担当の名乗り（tpmHello）。
 * 担当なら、状態を出し、名簿に自分の宛先と時刻を書き、受け持ちを返す。担当の model と effort は tpm assign が決めたので、旗は受けない。
 */
export function hello(ctx: Context, options: { model?: string, effort?: string } = {}): string[] {
  if (!ctx.env.TPM_KEY) return tpmHello(ctx, options);
  if (options.model !== undefined || options.effort !== undefined) {
    throw new TpmError('--model・--effort は TPM 担当が名乗るときだけ使う（担当の model と effort は tpm assign が決める）');
  }
  const record = requireSelf(ctx);
  const tpm = requireTpm(ctx);
  record.address = ctx.transport.whoami();
  record.helloAt = ctx.now().toISOString();
  ctx.transport.setStatus('model', modelStatus(record.model, record.effort));
  ctx.transport.setStatus('wait', WAIT.work('依頼書を読む'));
  writeRole(ctx, record);
  // 課題の Key が Jira か GitHub の Issue の形なら、課題管理の設定によらず中身を読める。
  const issueKey = record.issue ?? record.key;
  return [
    `役割: ${ROLES[record.role].label}`,
    `課題の Key: ${record.key}`,
    `依頼書: ${record.brief ?? '無し（【brief】を待つ）'}`,
    `課題管理の課題: ${record.issue === undefined ? '無し（記録しない）' : `${record.issue}（道具: ${recordingTo(ctx, record.issue)}）`}`,
    ...[issueCopyLine(record)].filter(v => v !== undefined),
    ...(issueTracker(ctx, issueKey) === undefined ? [] : [`課題の中身: tpm issue view ${issueKey}`]),
    `TPM 担当の宛先: ${tpm.address}`,
    `自分の宛先: ${record.address}`,
  ];
}

/** 自分宛てで、まだ届いていないメッセージを出す。届くのは手が空いた時なので、段の区切り（PR を出す前・merge を頼む前）に見る。 */
export function inbox(ctx: Context): string[] {
  const pending = ctx.transport.pending();
  if (pending.length === 0) return ['まだ届いていないメッセージは無い'];
  // ここで見せた物では、送る前の検査（assertRead）は止まらない。
  markShown(ctx, pending);
  return pending.flatMap(m => [`--- ${m.from}（id ${m.id}）`, m.text]);
}
