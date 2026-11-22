// レビューの頼みと判定の記録（状態の folder の reviews.jsonl）。課題の担当の tpm ask review が頼みを、TPM 担当の tpm assign --role staff-engineer が
// 依頼書を、Staff Engineer 担当の tpm report review が判定を足す。どれだけ頼まれ、どう判じられ、どれだけ待ったかを、後から数で言うための物。
// 台帳と同じく、メッセージの字を持つので、tpm を動かす機械の外には写さない。
import type { Context } from './context.ts';

/** 判定（`tpm report review --verdict` の語）と、ページ・記録に書く字。 */
export const VERDICTS = {
  'approve': 'よい',
  'concerns': '気になる所あり',
  'reject': '直すべき',
  'not-assessed': '見られなかった',
} as const;
/** 判定の語。 */
export type Verdict = keyof typeof VERDICTS;

/** レビューの頼み 1 件（判定が返れば、その欄も持つ）。 */
export interface Review {
  /** 頼みの番号（project の中の通し）。 */
  n: number
  /** 課題の Key（頼んだ担当の名簿の Key）。 */
  key: string
  /** 見る物（置き場のページか PR の URL）。 */
  url: string
  /** 見てほしい所。 */
  focus?: string
  /** 頼んだ担当の居場所の題。 */
  by: string
  askedAt: string
  /** Staff Engineer 担当に渡した依頼書の URL（tpm assign が、頼みから作って置く）。 */
  brief?: string
  verdict?: Verdict
  /** レビューのページの URL。 */
  page?: string
  /** 判定に添えた一言。 */
  summary?: string
  reviewedAt?: string
}

const FILE = 'reviews.jsonl';

/** 頼みの一覧（番号の順）。file の行は足すだけで、同じ番号の後ろの行が前の行の欄を上書きする。 */
export function readReviews(ctx: Context): Review[] {
  const byN = new Map<number, Review>();
  for (const line of ctx.state.lines<Partial<Review> & { n: number }>(FILE)) byN.set(line.n, { ...byN.get(line.n), ...line } as Review);
  return [...byN.values()].sort((a, b) => a.n - b.n);
}

/** 頼みを足す。番号を付けて返す。 */
export function addReview(ctx: Context, ask: Omit<Review, 'n' | 'askedAt'>): Review {
  const review: Review = { n: readReviews(ctx).length + 1, ...ask, askedAt: ctx.now().toISOString() };
  ctx.state.append(FILE, review);
  return review;
}

/** 頼みに欄を足す（依頼書・判定）。 */
export function patchReview(ctx: Context, n: number, fields: Partial<Omit<Review, 'n'>>): void {
  ctx.state.append(FILE, { n, ...fields });
}

/** その課題の、まだ判定が返っていない頼み。 */
export const openReviews = (ctx: Context, key: string): Review[] => readReviews(ctx).filter(r => r.key === key && r.verdict === undefined);
