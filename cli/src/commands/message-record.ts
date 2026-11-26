// 送った記録（log.jsonl の 1 行）を、置き場（pagetray 1.1.0 から）に写す（PutMessage）。
// Product Manager が、置き場の一覧の画面（/messages）で「誰が誰に何を送ったか」を見るための物。
// 写せなくても、送りは止めない: 誤りは投げず、画面にも出さない。写せなかった事だけを、状態の folder の message-records.jsonl に 1 行残す（写せた時は残さない）。
// 送る命令（messages.ts の deliver）は同期なので、写しは待たずに始め、命令の終わり（program.ts の runProgram）で済むのを待つ。
import { basename } from 'node:path';
import type { Context } from '../context.ts';
import type { Sent } from './messages.ts';
import { pagesRequest, reason, sender } from './store.ts';

/** 写せなかった記録の file（状態の folder の中）。 */
export const MESSAGE_RECORDS_FILE = 'message-records.jsonl';

/** 写せなかった記録の 1 行。 */
export interface MessageRecordFailure {
  at: string
  /** 送った記録（log.jsonl）の id。 */
  id: string
  /** 写せなかった訳の短い字。 */
  reason: string
}

/** 置き場が受けるメッセージの id の形（返事の先の id も同じ）。 */
const MESSAGE_ID = /^[A-Za-z0-9._-]{1,128}$/;
/** 置き場が受ける Key の形。 */
const MESSAGE_KEY = /^[A-Za-z0-9._-]{1,255}$/;
/** 置き場が受ける本文の長さ（字。Unicode の符号位置で数える）。 */
const TEXT_MAX = 8000;
/** 長い本文を切った時に、後ろに付ける字。 */
const CUT_MARK = '…（長いので切った）';
/** 訳の字の上限。 */
const REASON_MAX = 200;

/** 置き場の道の 1 段に置ける字か（`.`・`..` は置き場が断る）。 */
const fits = (form: RegExp, value: string): boolean => form.test(value) && value !== '.' && value !== '..';

/** 本文を、置き場が受ける長さにする。超える時は、頭を残して CUT_MARK を付ける（合わせて TEXT_MAX 字）。 */
function cut(text: string): string {
  const chars = [...text];
  return chars.length <= TEXT_MAX ? text : `${chars.slice(0, TEXT_MAX - CUT_MARK.length).join('')}${CUT_MARK}`;
}

/**
 * 送った記録 1 行を置き場に置く。置けたら undefined、置けなければ訳を返す（投げない）。
 * 状態は carried（今は cmux が運ぶので「ほかの道具で運んだ」。届いたかは置き場に書かない）。受け手の名は、届く担当の Key（TPM 担当は tpm）、無ければ宛先の字。
 * id の形が置き場の決まりに合わない時は、字を替えずに、写さない。Key・返事の先は、形が合う時だけ付ける。送り手の付随する id は、ページを置く時と同じ（store.ts の sender）。
 */
async function put(ctx: Context, sent: Sent): Promise<string | undefined> {
  if (!fits(MESSAGE_ID, sent.id)) return 'id の形が、置き場の決まりに合わない（写していない）';
  try {
    const r = await pagesRequest(ctx, {
      op: 'PutMessage',
      query: new URLSearchParams({ project: basename(ctx.state.dir), id: sent.id, ...sender(ctx) }),
      message: {
        ...(fits(MESSAGE_KEY, sent.key) ? { key: sent.key } : {}),
        heading: sent.heading,
        from: sent.from,
        to: sent.recipient?.key ?? sent.to,
        text: cut(sent.text),
        sentAt: new Date(sent.at),
        state: 'carried',
        ...(sent.replyTo !== undefined && MESSAGE_ID.test(sent.replyTo) ? { replyTo: sent.replyTo } : {}),
      },
    });
    if (r.code === '201' || r.code === '200') return undefined;
    return r.code === '000' ? '置き場が応えない' : `${r.code} ${reason(r.body)}`;
  }
  catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** 始めて、まだ済んでいない写し。 */
const pending = new Set<Promise<void>>();

/**
 * 送った記録 1 行を、置き場に写し始める（待たない。送りを止めない・遅らせない）。
 * 写せなかった時だけ、MESSAGE_RECORDS_FILE に 1 行残す（それも書けなければ、何もしない）。済むのを待つのは {@link messageRecordsSettled}。
 */
export function copyMessageRecord(ctx: Context, sent: Sent): void {
  const copying = put(ctx, sent)
    .then((why) => {
      if (why !== undefined) ctx.state.append(MESSAGE_RECORDS_FILE, { at: ctx.now().toISOString(), id: sent.id, reason: why.slice(0, REASON_MAX) } satisfies MessageRecordFailure);
    })
    .catch(() => undefined)
    .finally(() => pending.delete(copying));
  pending.add(copying);
}

/** 始めた写しがみな済む（置けた・写せなかった事を残した）のを待つ。命令の終わりと、試験が呼ぶ。誤りは投げない。 */
export async function messageRecordsSettled(): Promise<void> {
  while (pending.size > 0) await Promise.all(pending);
}
