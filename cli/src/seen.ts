// 受け手がメッセージを見た時刻を決める口。送る前の検査（dismiss・続きの assign）・依頼書の数え・時系列は、みなこれを使う。
// 「見たか」を所ごとに別の決め方で決めると、同じメッセージが所によって見た・見ていないになる（台帳 #110・#129）。
import type { Context } from './context.ts';
import type { MessageTrace } from './transport/types.ts';

/** 見せたメッセージの id と、初めて見せた時刻を覚える file（`shown/<宛先>.jsonc`）。 */
export const shownFile = (address: string): string => `shown/${address.replaceAll(/[^A-Za-z0-9._-]/g, '-')}.jsonc`;

/** 見せたメッセージ 1 件。前の版は id の字だけを書いたので、その分は at が無い。 */
export interface Shown {
  id: string
  at?: string
}

/** その居場所に見せたメッセージ（古い順）。 */
export function readShown(ctx: Context, address: string): Shown[] {
  return (ctx.state.read<(Shown | string)[]>(shownFile(address)) ?? []).map(e => typeof e === 'string' ? { id: e } : e);
}

/**
 * 見た時刻と、その出どころ。
 * - delivered: 連携の道具（cmux）が画面に配った時刻
 * - shown: tpm が受け手に本文を見せた時刻（送る前の検査・tpm inbox・tpm hello。時刻の無い前の版の項目は送った時刻）
 * - legacy: 前の版が送った時に「届いた」と書いた行（送った時刻）
 * - assumed: 時刻がどこにも無く、受け手の「まだ配っていない」にも無いので、送った時刻に倒した物（道具が時刻を返さない時。止めすぎない側）
 */
export interface Seen {
  at: string
  by: 'delivered' | 'shown' | 'legacy' | 'assumed'
}

/** 口が読む、送った記録の行の欄。 */
export interface SentRef {
  id: string
  /** 送った時刻（ISO）。 */
  at: string
  /** 受け手の宛先。 */
  to: string
  /** 前の版が送った時に書いた「届いたか」。 */
  delivered?: boolean
}

/** 送った記録の行 1 つの、受け手が見た時刻。undefined はまだ見ていない（検査用）か、分からない（記録用）。 */
export type SeenAt = (sent: SentRef) => Seen | undefined;

/** 同じ時刻なら、この順に出どころを選ぶ（配った時刻が、いちばん確か）。 */
const RANK: Record<Seen['by'], number> = { delivered: 0, shown: 1, legacy: 2, assumed: 3 };

const earliest = (candidates: (Seen | undefined)[]): Seen | undefined =>
  candidates.filter(c => c !== undefined).sort((a, b) => a.at.localeCompare(b.at) || RANK[a.by] - RANK[b.by])[0];

/**
 * 見た時刻を引く口を作る。見た時刻は、配った時刻（道具の history() と、その写しの deliveries.jsonl。無ければ前の版の行の delivered:true）と、
 * 見せた時刻（shown/ の受け手の file）の早い方。
 * live（送る前の検査と依頼書の数え）: どれも無ければ、受け手の「まだ配っていない」（queued）を引き、そこにあれば undefined（まだ見ていない）、
 * 無ければ送った時刻に倒す（assumed）。
 * live でない（時系列）: queued は「今」の受信箱で過去の行には意味が薄く、閉じた居場所では引けないので見ない。どれも無ければ undefined（分からない）。
 * 道具と file は口を作る時に 1 度だけ読み、queued と shown/ は宛先ごとに 1 度だけ読む。
 */
export function seenTimes(ctx: Context, options: { live: boolean }): SeenAt {
  const delivered = new Map<string, string>();
  const keep = (t: MessageTrace): void => {
    if (t.deliveredAt === undefined) return;
    const before = delivered.get(t.id);
    if (before === undefined || t.deliveredAt < before) delivered.set(t.id, t.deliveredAt);
  };
  ctx.state.lines<MessageTrace>('deliveries.jsonl').forEach(keep);
  ctx.transport.history().forEach(keep);
  const shown = new Map<string, Map<string, string | undefined>>();
  const shownTo = (address: string): Map<string, string | undefined> => {
    let m = shown.get(address);
    if (m === undefined) {
      m = new Map(readShown(ctx, address).map(e => [e.id, e.at]));
      shown.set(address, m);
    }
    return m;
  };
  const queued = new Map<string, Set<string>>();
  const queuedTo = (address: string): Set<string> => {
    let q = queued.get(address);
    if (q === undefined) {
      q = new Set(ctx.transport.queued(address));
      queued.set(address, q);
    }
    return q;
  };
  return (sent) => {
    const at = delivered.get(sent.id);
    const s = shownTo(sent.to);
    // 前の版の delivered:true は、道具の配った時刻が無い時だけ使う（同じ配りの写しで、道具の時刻の方が確か）。
    const arrived: Seen | undefined = at !== undefined ? { at, by: 'delivered' } : sent.delivered === true ? { at: sent.at, by: 'legacy' } : undefined;
    const seen = earliest([arrived, s.has(sent.id) ? { at: s.get(sent.id) ?? sent.at, by: 'shown' } : undefined]);
    if (seen !== undefined || !options.live) return seen;
    return queuedTo(sent.to).has(sent.id) ? undefined : { at: sent.at, by: 'assumed' };
  };
}
