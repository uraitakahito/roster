// 送った記録（log.jsonl の 1 行）を、置き場（pagetray 1.1.0 から）に写す（PutMessage）。
// Product Manager が、置き場の一覧の画面（/messages）で「誰が誰に何を送ったか」を見るための物。
// 写せなくても、送りは止めない: 誤りは投げず、画面にも出さない。写せなかった事だけを、状態の folder の message-records.jsonl に 1 行残す（写せた時は残さない）。
// 送る命令（messages.ts の deliver）は、写しを待たずに始め、命令の終わり（program.ts の runProgram）で済むのを待つ（送りを止めない・遅らせないため）。
import { basename } from 'node:path';
import type { Context } from '../context.ts';
import type { Sent } from './messages.ts';
import { pagesRequest, reason, sender, type Reply } from './store.ts';

/** 写しの記録の file（状態の folder の中）。 */
export const MESSAGE_RECORDS_FILE = 'message-records.jsonl';

/** 写しの記録の 1 行: 写せなかった回と、送り手を付けずに置いた回。 */
export interface MessageRecordNote {
  at: string
  /** 送った記録（log.jsonl）の id。 */
  id: string
  /** 訳の短い字。 */
  reason: string
  /** 送り手の付随する id を外して置き直し、置けた回だけ（記録は置き場に在る。送り手だけが空）。無ければ、写せなかった回。 */
  placed?: 'without-sender'
}

/**
 * 送った後の、メッセージの進み（NATS で運んだ物だけ。受け手の側・TPM 担当の片付けが、置き場の記録に書き足す）。
 * delivered は hook が本文を渡した、undeliverable は渡し直しの上限を超えた、expired は届かないまま期限で消えた・席を閉じた。
 */
export interface MessageProgress {
  state: 'delivered' | 'undeliverable' | 'expired'
  /** 届いた時刻（ISO）。delivered の時だけ。 */
  deliveredAt?: string
  /** どの時に渡したか（gate・wake・prompt）か、届かずに終わった訳。 */
  via?: string
  /** 受け手に本文を渡した回数（手元の渡した記録の回数）。 */
  deliveries?: number
}

/** 置き場が受けるメッセージの id の形（返事の先の id も同じ）。 */
const MESSAGE_ID = /^[A-Za-z0-9._-]{1,128}$/;
/** 置き場が受ける Key の形。 */
const MESSAGE_KEY = /^[A-Za-z0-9._-]{1,255}$/;
/** 置き場が受ける本文の長さ（字。どの長さも Unicode の符号位置で数える）。 */
const TEXT_MAX = 8000;
/** 置き場が受ける送り手・受け手の名の長さ。 */
const PARTY_MAX = 200;
/** 長い本文を切った時に、後ろに付ける字。 */
const CUT_MARK = '…（長いので切った）';
/** 訳の字の上限。 */
const REASON_MAX = 200;

/** 置き場の道の 1 段に置ける字か（`.`・`..` は置き場が断る）。 */
const fits = (form: RegExp, value: string): boolean => form.test(value) && value !== '.' && value !== '..';

/** 字を、頭の max 字（符号位置）までにする。切った時は mark を付ける（合わせて max 字）。 */
function cut(text: string, max: number, mark = ''): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - [...mark].length).join('')}${mark}`;
}

/** 置けなかった答えの訳。2xx なのに本文を読めない答えは、応えないと分ける（置き場には置けているかもしれない）。 */
function refusal(r: Reply): string {
  if (r.unreadable !== undefined) return `置き場が ${r.unreadable} を返したが、答えを読めない（置けたかは分からない）`;
  return r.code === '000' ? '置き場が応えない' : `${r.code} ${reason(r.body)}`;
}

/**
 * 送った記録 1 行を置き場に置く。残す物が無ければ（置けた）undefined、あれば写しの記録に残す欄を返す（投げない）。
 * 状態は、cmux が運んだ行は carried（「ほかの道具で運んだ」。届いたかは置き場に書かない）、NATS で運んだ行（carrier が nats）は waiting（届くのを待っている）。
 * 送り手・受け手の名は、担当の Key（TPM 担当は tpm）。置き場の記録の名は初めの値から替わらないので、替わる居場所の題でなく Key で書く。
 * 送り手の組の無い前の版の行は居場所の題、届く担当の分からない行は宛先の字に落とす。どちらも PARTY_MAX 字までに切り、空なら写さない。
 * id の形が置き場の決まりに合わない時は、字を替えずに、写さない。Key・返事の先は、形が合う時だけ付ける。
 * 送り手の付随する id は、ページを置く時と同じ（store.ts の sender）。それを置き場が castlist に聞けない（503）・castlist に登録が無いと断った（400 の /actorRef）時は、
 * 付随する id を外して 1 度だけ置き直す（送り手が空の記録になる）。
 * progress があれば、送った後の進みの書き足し（状態と、届いた時刻・道・回数を足す）。送った側の書き込みではないので、送り手の付随する id は付けない。
 */
async function put(ctx: Context, sent: Sent, progress?: MessageProgress): Promise<Pick<MessageRecordNote, 'reason' | 'placed'> | undefined> {
  if (!fits(MESSAGE_ID, sent.id)) return { reason: 'id の形が、置き場の決まりに合わない（写していない）' };
  const from = cut(sent.sender?.key ?? sent.from, PARTY_MAX);
  const to = cut(sent.recipient?.key ?? sent.to, PARTY_MAX);
  if (from === '' || to === '') return { reason: '送り手か受け手の名が空（写していない）' };
  try {
    const actor = progress === undefined ? sender(ctx) : {};
    const send = (ids: Record<string, string>): Promise<Reply> => pagesRequest(ctx, {
      op: 'PutMessage',
      query: new URLSearchParams({ project: basename(ctx.state.dir), id: sent.id, ...ids }),
      message: {
        ...(fits(MESSAGE_KEY, sent.key) ? { key: sent.key } : {}),
        heading: sent.heading,
        from,
        to,
        text: cut(sent.text, TEXT_MAX, CUT_MARK),
        sentAt: new Date(sent.at),
        state: progress?.state ?? (sent.carrier === 'nats' ? 'waiting' : 'carried'),
        ...(progress?.deliveredAt === undefined ? {} : { deliveredAt: new Date(progress.deliveredAt) }),
        ...(progress?.via === undefined ? {} : { via: progress.via }),
        ...(progress?.deliveries === undefined ? {} : { deliveries: progress.deliveries }),
        ...(sent.replyTo !== undefined && fits(MESSAGE_ID, sent.replyTo) ? { replyTo: sent.replyTo } : {}),
      },
    });
    const placed = (r: Reply): boolean => r.code === '201' || r.code === '200';
    const first = await send(actor);
    if (placed(first)) return undefined;
    if (actor.actor_ref === undefined || (first.code !== '503' && first.unknownSender !== true)) return { reason: refusal(first) };
    const second = await send({});
    return placed(second)
      ? { reason: `送り手を付けずに置いた（${refusal(first)}）`, placed: 'without-sender' }
      : { reason: `${refusal(first)}。送り手を外しても置けない（${refusal(second)}）` };
  }
  catch (e) {
    return { reason: e instanceof Error ? e.message : String(e) };
  }
}

/** 始めて、まだ済んでいない写し。 */
const pending = new Set<Promise<void>>();

/**
 * 送った記録 1 行を、置き場に写し始める（待たない。送りを止めない・遅らせない）。
 * 写せなかった時と、送り手を付けずに置いた時だけ、MESSAGE_RECORDS_FILE に 1 行残す（それも書けなければ、何もしない）。済むのを待つのは {@link messageRecordsSettled}。
 * progress は、送った後の進み（届いた・渡せない・期限切れ）を書き足す時に渡す。
 */
export function copyMessageRecord(ctx: Context, sent: Sent, progress?: MessageProgress): void {
  const copying = put(ctx, sent, progress)
    .then((note) => {
      if (note !== undefined) ctx.state.append(MESSAGE_RECORDS_FILE, { at: ctx.now().toISOString(), id: sent.id, ...note, reason: cut(note.reason, REASON_MAX) } satisfies MessageRecordNote);
    })
    .catch(() => undefined)
    .finally(() => pending.delete(copying));
  pending.add(copying);
}

/** 始めた写しがみな済む（置けた・写しの記録に残した）のを待つ。命令の終わりと、試験が呼ぶ。誤りは投げない。 */
export async function messageRecordsSettled(): Promise<void> {
  while (pending.size > 0) await Promise.all(pending);
}
