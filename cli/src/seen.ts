// 受け手がメッセージを見た時刻を決める口。送る前の検査（dismiss・続きの assign）・依頼書の数え・時系列は、みなこれを使う。
// 「見たか」を所ごとに別の決め方で決めると、同じメッセージが所によって見た・見ていないになる（台帳 #110・#129）。
import type { Context } from './context.ts';
import { deliveredLines } from './mail.ts';

/**
 * 前の版（連携の道具（cmux）がメッセージを運んだ頃）の記録 `deliveries.jsonl` の 1 行: メッセージ 1 件の、送った・届いた・読んだ時刻
 * （道具が覚えていた物の写し。ISO の字）。もう増えない（読むだけ）。
 */
export interface MessageTrace {
  id: string
  sentAt?: string
  deliveredAt?: string
  readAt?: string
  /** 返事の先のメッセージの id。 */
  replyTo?: string
}

/** 見せたメッセージの id と、初めて見せた時刻を覚えた file（`shown/<宛先>.jsonc`）。前の版の記録（もう書かない。読むだけ）。 */
export const shownFile = (address: string): string => `shown/${address.replaceAll(/[^A-Za-z0-9._-]/g, '-')}.jsonc`;

/** 見せたメッセージ 1 件。前の版は id の字だけを書いたので、その分は at が無い。 */
export interface Shown {
  id: string
  at?: string
}

/** その居場所に見せたメッセージ（古い順。前の版の記録）。 */
export function readShown(ctx: Context, address: string): Shown[] {
  return (ctx.state.read<(Shown | string)[]>(shownFile(address)) ?? []).map(e => typeof e === 'string' ? { id: e } : e);
}

/**
 * 見た時刻と、その出どころ。
 * - delivered: hook が本文を渡した時刻（手元の渡した記録。mail.ts）。古い行（cmux が運んだ物）では、cmux が画面に配った時刻（deliveries.jsonl）
 * - shown: 送る前の検査・roster inbox が命令の結果に本文を出した時刻（渡した記録の output。届いたには数えない）。
 *   古い行では、roster が受け手に本文を見せた時刻（shown/。時刻の無い前の版の項目は、検査用では送った時刻、記録用では使わない）
 * - legacy: 前の版が送った時に「届いた」と書いた行（送った時刻）
 * - assumed: 古い行で、時刻がどこにも無いので、送った時刻に倒した物（受け手の席は、もう残っていない。止めすぎない側）
 */
export interface Seen {
  at: string
  by: 'delivered' | 'shown' | 'legacy' | 'assumed'
}

/** 届け違いで返したメッセージの控え（前の版の roster returned check が書いた。もう増えない）。 */
export const RETURNED_FILE = 'returned.jsonl';

/** 届け違いで返したメッセージの id。cmux の上では配られて既読になっているが、宛先の担当は見ていない（t-4q2b）。 */
export const returnedIds = (ctx: Context): Set<string> => new Set(ctx.state.lines<{ id: string }>(RETURNED_FILE).map(l => l.id));

/** 口が読む、送った記録の行の欄。 */
export interface SentRef {
  id: string
  /** 送った時刻（ISO）。 */
  at: string
  /** 受け手の宛先。 */
  to: string
  /** 前の版が送った時に書いた「届いたか」。 */
  delivered?: boolean
  /** 運んだ道。NATS で運んだ行に在る（無い行は、前の版で連携の道具（cmux）が運んだ古い行）。 */
  carrier?: 'nats'
}

/** 送った記録の行 1 つの、受け手が見た時刻。undefined はまだ見ていない（検査用）か、分からない（記録用）。 */
export type SeenAt = (sent: SentRef) => Seen | undefined;

/** 同じ時刻なら、この順に出どころを選ぶ（配った時刻が、いちばん確か）。 */
const RANK: Record<Seen['by'], number> = { delivered: 0, shown: 1, legacy: 2, assumed: 3 };

const earliest = (candidates: (Seen | undefined)[]): Seen | undefined =>
  candidates.filter(c => c !== undefined).sort((a, b) => a.at.localeCompare(b.at) || RANK[a.by] - RANK[b.by])[0];

/**
 * 見た時刻を引く口を作る。
 * NATS で運んだ行（carrier が nats）は、手元の渡した記録（delivered.jsonl）だけで決める: hook が渡した行があれば、
 * そのいちばん早い時刻に届いた。命令の結果に出した行（output）は、見せた時刻。どちらも無ければ undefined
 * （配りの口にまだ残っているか、届かないまま終わった物。どちらも、受け手は見ていない）。
 * 古い行（carrier の無い行。前の版で cmux が運んだ物）は、配った時刻（道具の記録の写しの deliveries.jsonl。無ければ前の版の行の delivered:true）と、
 * 見せた時刻（shown/ の受け手の file）の早い方。どれも、もう増えない古い記録（読むだけ。連携の道具には聞かない）。
 * どれも無い時は、live（送る前の検査と依頼書の数え）なら送った時刻に倒す（assumed。古い行の受け手の席は、もう残っていない）。
 * live でない（時系列）なら undefined（分からない）。
 * file は口を作る時に 1 度だけ読み、shown/ は宛先ごとに 1 度だけ読む。
 */
export function seenTimes(ctx: Context, options: { live: boolean }): SeenAt {
  const delivered = new Map<string, string>();
  for (const t of ctx.state.lines<MessageTrace>('deliveries.jsonl')) {
    if (t.deliveredAt === undefined) continue;
    const before = delivered.get(t.id);
    if (before === undefined || t.deliveredAt < before) delivered.set(t.id, t.deliveredAt);
  }
  const shown = new Map<string, Map<string, string | undefined>>();
  const shownTo = (address: string): Map<string, string | undefined> => {
    let m = shown.get(address);
    if (m === undefined) {
      m = new Map(readShown(ctx, address).map(e => [e.id, e.at]));
      shown.set(address, m);
    }
    return m;
  };
  const returned = returnedIds(ctx);
  const handed = new Map<string, Seen>();
  for (const l of deliveredLines(ctx)) {
    const seen: Seen = { at: l.at, by: l.when === 'output' ? 'shown' : 'delivered' };
    handed.set(l.id, earliest([handed.get(l.id), seen]) ?? seen);
  }
  return (sent) => {
    // 届け違いで返した物は、配られていても・同じ居場所で見せていても、宛先の担当は見ていない。
    if (returned.has(sent.id)) return undefined;
    if (sent.carrier === 'nats') return handed.get(sent.id);
    const at = delivered.get(sent.id);
    const s = shownTo(sent.to);
    // 前の版の delivered:true は、道具の配った時刻が無い時だけ使う（同じ配りの写しで、道具の時刻の方が確か）。
    const arrived: Seen | undefined = at !== undefined ? { at, by: 'delivered' } : sent.delivered === true ? { at: sent.at, by: 'legacy' } : undefined;
    // 時刻の無い前の版の shown/ の項目は、検査用では送った時刻に見せた物とする（見せたのは確か）。記録用（時系列）では作った時刻を持ち込まないので使わない。
    const shownAt = s.has(sent.id) ? s.get(sent.id) ?? (options.live ? sent.at : undefined) : undefined;
    const seen = earliest([arrived, shownAt === undefined ? undefined : { at: shownAt, by: 'shown' }]);
    if (seen !== undefined || !options.live) return seen;
    return { at: sent.at, by: 'assumed' };
  };
}
