// 担当（TPM 担当に起こされた Claude Code）が打つ命令。hello と inbox は TPM 担当も打つ。
import type { Context } from '../context.ts';
import { modelStatus, ROLES, WAIT } from '../protocol.ts';
import { isRepoSeat, readRole, requireSelf, requireTpm, subjectOf, writeRole } from '../roster.ts';
import { auditorHello } from './audit.ts';
import { castlistHello, sweep } from './castlist.ts';
import { TpmError } from '../skill-sets.ts';
import { issueTracker } from './issue.ts';
import { paint } from './launch.ts';
import { issueCopyLine, queueDown, seated, showUnread } from './messages.ts';
import { recordingTo, tpmHello } from './tpm-side.ts';
import { envOf } from '../env.ts';
import { claimNamed, ownName } from '../mail.ts';
import { peekInbox } from './mail.ts';

/**
 * 名乗る。$ROSTER_KEY が無ければ TPM 担当の名乗り（tpmHello）。
 * 担当なら、状態を出し、名簿に自分の宛先と時刻を書き、受け持ちを返す。担当の model と effort は roster assign が決めたので、旗は受けない。
 * castlist を設定していれば、名乗りを castlist に送り、`アクター: <名>` の行を頭に出す（castlist が止まっていれば、名乗らずに止まる）。設定していなければ、警告の枠を頭に出す。
 */
export async function hello(ctx: Context, options: { model?: string, effort?: string } = {}): Promise<string[]> {
  if (!envOf(ctx.env, 'KEY')) return await tpmHello(ctx, options);
  if (options.model !== undefined || options.effort !== undefined) {
    throw new TpmError('--model・--effort は TPM 担当が名乗るときだけ使う（担当の model と effort は roster assign が決める）');
  }
  const record = requireSelf(ctx);
  const tpm = record.role === 'auditor' ? undefined : requireTpm(ctx);
  const actor = await castlistHello(ctx);
  if (tpm === undefined) return [...actor, ...auditorHello(ctx, record)];
  record.address = ctx.seats.whoami();
  record.helloAt = ctx.now().toISOString();
  // 起こす時の塗り（launch）が落ちた席・前から居る席も、名乗れば役割の色になる。
  const painted = paint(ctx, record.address, ROLES[record.role].color);
  ctx.seats.setStatus('model', modelStatus(record.model, record.effort));
  ctx.seats.setStatus('wait', WAIT.work('依頼書を読む'));
  writeRole(ctx, record);
  // 課題の Key が Jira か GitHub の Issue の形なら、課題管理の設定によらず中身を読める。
  const subject = subjectOf(record);
  const issueKey = record.issue ?? subject;
  return [
    ...actor,
    `役割: ${ROLES[record.role].label}`,
    `課題の Key: ${subject}`,
    ...painted,
    // Staff Engineer 担当の席と repo の席は、課題の担当と並ぶ別の名簿の行（この Key で名指される）。
    ...(record.subject === undefined ? [] : [`名簿の Key: ${record.key}`]),
    ...(isRepoSeat(record) ? [`Tech Lead 担当の席: ${readRole(ctx, subject)?.title ?? `${subject}（名簿に居ない）`}（この席を起こし、依頼書を渡した担当）`] : []),
    `依頼書: ${record.brief ?? '無し（【brief】を待つ）'}`,
    `課題管理の課題: ${record.issue === undefined ? '無し（記録しない）' : `${record.issue}（道具: ${recordingTo(ctx, record.issue)}）`}`,
    ...[issueCopyLine(record)].filter(v => v !== undefined),
    ...(issueTracker(ctx, issueKey) === undefined ? [] : [`課題の中身: roster issue view ${issueKey}`]),
    `TPM 担当の宛先: ${tpm.address}`,
    `自分の宛先: ${record.address}`,
    // 落ちた session の推しの幕引き（castlist と cmux があれば。Auditor は打たない）。
    ...await sweep(ctx),
  ];
}

/**
 * roster inbox: 自分宛てで、まだ届いていない（配りの口に残っている）メッセージを出す。届くのは手が空いた時なので、段の区切り（PR を出す前・merge を頼む前）に見る。
 * 自分の受け手の名が作れなければ（長い組）、無いと答える。
 * - 自分（この session）の名乗りが効いている時: 取り置かずに出すだけ（届いたとは記録しない。hook が後で渡す。commands/mail.ts の peekInbox）。
 * - 名乗りが効いていない時（渡す hook を持たない session）: 出した物に「検査では止めない」の印を付け、渡した記録に output と残す
 *   （commands/messages.ts の showUnread。ここで見せた物では、送る前の検査（assertRead）は止まらない）。
 */
export async function inboxNow(ctx: Context): Promise<string[]> {
  const none = ['まだ届いていないメッセージは無い'];
  const name = ownName(ctx);
  if (name === undefined) return none;
  try {
    // 名乗っている session と、roster の席でない session（$ROSTER_KEY が無く、TPM 担当の居場所でもない）は、出すだけ（印を付けない）。
    if (claimNamed(ctx, name) !== undefined || !seated(ctx)) {
      const left = await peekInbox(ctx, name);
      return left.length === 0 ? none : left;
    }
    const unread = await showUnread(ctx, name);
    return unread.length === 0 ? none : [...unread, '--- ここまで'];
  }
  catch (e) {
    // 配りの口が応えない時は、決まりの字で止まる（席の状態と gate.jsonl にも出す）。
    throw queueDown(ctx, '見ていません', e);
  }
}
