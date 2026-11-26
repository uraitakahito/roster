// レビューの頼みと判定の記録（状態の folder の reviews/ に、頼み 1 件 1 file）。課題の担当の roster ask review が頼みと依頼書を（席を起こし直す時は TPM 担当の
// roster assign --role staff-engineer も依頼書を）、Staff Engineer 担当の roster report review が判定を足す。どれだけ頼まれ、どう判じられ、どれだけ待ったかを、後から数で言うための物。
// 台帳と同じく、メッセージの字を持つので、roster を動かす機械の外には写さない。
import type { Context } from './context.ts';

/** 判定（`roster report review --verdict` の語）と、ページ・記録に書く字。 */
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
  /** Staff Engineer 担当に渡した依頼書の URL（roster ask review が、頼みから作って置く）。 */
  brief?: string
  verdict?: Verdict
  /** レビューのページの URL。 */
  page?: string
  /** 判定に添えた一言。 */
  summary?: string
  reviewedAt?: string
  /** 見る者の役割。repo の席の頼みは tech-lead（その課題の Tech Lead 担当が見る）。無ければ Staff Engineer 担当（前の版の頼みも）。 */
  reviewer?: 'tech-lead'
  /** 課題の担当が、判定を受けずに TPM 担当に上げた時刻（roster ask tpm --review）。 */
  escalatedAt?: string
}

/** 頼み 1 件の file（状態の folder の `reviews/<番号>.jsonc`）。 */
const fileOf = (n: number): string => `reviews/${n}.jsonc`;

/** 頼みの一覧（番号の順）。 */
export function readReviews(ctx: Context): Review[] {
  return ctx.state.list('reviews').map(name => ctx.state.read<Review>(`reviews/${name}.jsonc`)).filter(r => r !== undefined).sort((a, b) => a.n - b.n);
}

/**
 * 頼みを足す。番号は、今の最大＋1 から、無い番号の file を「在れば失敗」で作って決める（担当が同時に頼んでも同じ番号にならない。台帳と同じ決め方）。
 */
export function addReview(ctx: Context, ask: Omit<Review, 'n' | 'askedAt'>): Review {
  const askedAt = ctx.now().toISOString();
  for (let n = Math.max(0, ...readReviews(ctx).map(r => r.n)) + 1; ; n++) {
    const review: Review = { n, ...ask, askedAt };
    if (ctx.state.create(fileOf(n), review)) return review;
  }
}

/** 頼みを消す（【ask-review】を送れなかった回に、書いた頼みを取り消す）。 */
export const removeReview = (ctx: Context, n: number): void => ctx.state.remove(fileOf(n));

/** 頼みに欄を足す（依頼書・判定）。 */
export function patchReview(ctx: Context, n: number, fields: Partial<Omit<Review, 'n'>>): void {
  const review = ctx.state.read<Review>(fileOf(n));
  if (review !== undefined) ctx.state.write(fileOf(n), { ...review, ...fields });
}

/** その課題の、まだ判定が返っていない頼み。 */
export const openReviews = (ctx: Context, key: string): Review[] => readReviews(ctx).filter(r => r.key === key && r.verdict === undefined);

/** 置き場のページの種類（file の名の頭）を、題に書く名にする。無い種類は file の名だけ。 */
const KIND_NAMES: Record<string, string> = { plan: '計画', proposal: '提案', result: '結果' };
/** 説明に出す見てほしい所の字の数の上限（サイドバーで切れないように）。 */
const DESCRIPTION_LIMIT = 24;

/** 見る物の URL を、題に書く短い名にする（`PR #180`・`計画 plan-2`）。 */
function targetName(url: string): string {
  const pr = /\/pull\/(\d+)/.exec(url);
  if (pr !== null) return `PR #${pr[1] ?? ''}`;
  // 節の印（#）と問い（?）を除いた path の、空でない最後の区切り。読めない URL は元の字のまま。
  const last = URL.canParse(url) ? new URL(url).pathname.split('/').filter(p => p !== '').at(-1) : undefined;
  if (last === undefined) return url;
  const name = last.replace(/\.html$/, '');
  const kind = KIND_NAMES[name.split('-')[0] ?? ''];
  return kind === undefined ? name : `${kind} ${name}`;
}

/**
 * Staff Engineer 担当の席の題に入れる見る物（target）と、題の下の説明（description）を、依頼書にした頼みから作る。
 * 頼みが 2 つ以上なら、番号の新しい頼みに `+<残りの数>` を付ける。説明は新しい頼みの見てほしい所（無ければ付けない）。
 */
export function reviewLabel(asks: Review[]): { target: string, description?: string } {
  const latest = asks.reduce((a, b) => (b.n > a.n ? b : a));
  const more = asks.length > 1 ? ` +${asks.length - 1}` : '';
  const focus = latest.focus === undefined ? undefined : [...latest.focus];
  return {
    target: `${targetName(latest.url)}${more}`,
    ...(focus === undefined ? {} : { description: focus.length > DESCRIPTION_LIMIT ? `${focus.slice(0, DESCRIPTION_LIMIT).join('')}…` : focus.join('') }),
  };
}
