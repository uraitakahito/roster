// 届け違い（前の版の記録）: 返った物を読む命令（roster returned show）。
// 前の版では、待っているメッセージを連携の道具（cmux）が持ち、居場所の中の面で次に起きた Claude に配ったので、前の session 宛ての物が、
// 同じ面で起きた別の担当の session に届いた（台帳 #84）。session の始まりの hook（roster returned check）が、それを TPM 担当へ【returned】で返した。
// 今は、メッセージを配りの口（NATS）が運び、受け手の名に起こした回が入るので、前の session 宛ての物を別の session が受け取ることは無い。
// 検査は外した（roster returned check の命令は、前の版が起こした席の hook のために残してある。何もしない。program.ts）。
import type { Context } from '../context.ts';
import { requireTpmSide } from '../roster.ts';
import { TpmError } from '../skill-sets.ts';
import { TPM_PARTY, type Party, type Sent } from './messages.ts';

/** 担当の見せ方（t-8b6j の担当・TPM 担当）と起こし。 */
const who = (p: Party): string => `${p.key === TPM_PARTY ? 'TPM 担当' : `${p.key} の担当`}${p.launch === undefined ? '' : `（起こし ${p.launch.slice(0, 8)}…）`}`;

/** 返った物（届け違い）の全文を、送った記録から出す（TPM 担当が打つ。読むだけ）。 */
export function showReturned(ctx: Context, id: string): string[] {
  requireTpmSide(ctx, 'roster returned show');
  const s = ctx.state.lines<Sent>('log.jsonl').findLast(l => l.id === id || l.id.startsWith(id));
  if (s === undefined) throw new TpmError(`送った記録に ${id} がありません`);
  return [
    `id: ${s.id}`,
    `送った: ${s.at}（${s.from} から ${s.to} へ。課題の Key: ${s.key}）`,
    `宛先の担当: ${s.recipient === undefined ? '記録に無い' : who(s.recipient)}`,
    s.text,
  ];
}
