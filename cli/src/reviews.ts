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
  /**
   * 依頼書を渡した席の起こしの id（席の名簿の launch。castlist の無い project と前の版の頼みには無い）。【ask-review】は起こした回の受け箱へ届くので、
   * 席の今の id と違えば、前の回に渡した頼み（roster review list が見分ける）。
   */
  launch?: string
  /**
   * 頼みを渡したメッセージの id（【ask-review】の行。1 通でいくつかの頼みを渡した時は、同じ id）。判定（【review】）の返事の先になる。
   * 前の版の頼みには無い（その判定は、返事の先を持たない）。
   */
  ask?: string
  verdict?: Verdict
  /** レビューのページの URL。 */
  page?: string
  /** 判定に添えた一言。 */
  summary?: string
  reviewedAt?: string
  /** 見る者の役割。repo の席の頼みは tech-lead（その課題の Tech Lead 担当が見る）。無ければ Staff Engineer 担当（前の版の頼みも）。 */
  reviewer?: 'tech-lead'
  /** 見る Tech Lead 担当の名簿の Key（reviewer が tech-lead の頼みだけ。頼んだ repo の席を閉じた後も、誰の頼みの列かを引ける）。 */
  lead?: string
  /** 課題の担当が、判定を受けずに TPM 担当に上げた時刻（roster ask tpm --review）。 */
  escalatedAt?: string
  /** PR の頼みだけ: 頼んだ時の PR の head（gh pr view の headRefOid。読めなければ無い）。 */
  askedHead?: string
  /** PR の頼みだけ: 席が見た commit（roster report review が書く。決められなければ無い）。 */
  head?: string
  /** head の出どころ: checkout（頼みより後に roster review checkout で出した head）か asked（判定の時の head が askedHead と同じ）。 */
  headFrom?: 'checkout' | 'asked'
  /** 軽い見方でよい頼み（roster ask review --light。版上げ・CHANGELOG・文書・lock だけの差分）。 */
  light?: boolean
  /** 「直すべき」を受けずに進めると TPM 担当が決めた時の記録（roster review allow）。 */
  allowed?: Allowed
}

/** roster review allow の記録。 */
export interface Allowed {
  /** 決めた者（役割の無い session の actor の Key。TPM 担当の席では、Key の代わりの字）。 */
  by: string
  at: string
  /** 決めたこと。 */
  note: string
  /** 決めたことを書いたページ。 */
  page?: string
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

/**
 * その Tech Lead 担当が返していない、repo の席の頼み（依頼書にした物）。頼みの lead の欄で引くので、頼んだ席を閉じた後も、
 * Tech Lead 担当を起こし直した後も引ける（【ask-review】は起こした回の受け箱へ届くので、起こし直した席は受け取らない）。
 */
export const leadReviews = (ctx: Context, lead: string): Review[] =>
  readReviews(ctx).filter(r => r.verdict === undefined && r.brief !== undefined && r.reviewer === 'tech-lead' && r.lead === lead);

/** PR の URL か `<owner>/<repo>#<番号>` を読んだ物（大文字と小文字は元のまま）。 */
export interface PullName {
  owner: string
  repo: string
  number: number
  /** gh に渡す URL（`https://github.com/<owner>/<repo>/pull/<番号>`。後ろの /files・/・?・# を落とした形）。 */
  url: string
}

/** github.com の PR の URL（host は github.com だけ。ほかの host の PR は、名を揃えると github.com の同じ名の PR と取り違えるので受けない）。 */
const PULL_URL = /^https:\/\/github\.com\/([^\s/]+)\/([^\s/#?]+)\/pull\/(\d+)(?:[/?#]\S*)?$/i;
const PULL_SHORT = /^([^\s/#]+)\/([^\s/#]+)#(\d+)$/;

/** github.com の PR の URL（後ろに /files などが付いても）か `<owner>/<repo>#<番号>` を読む。読めなければ undefined。 */
export function parsePullName(text: string): PullName | undefined {
  const url = PULL_URL.exec(text.trim());
  if (url !== null) {
    const [, owner = '', repo = '', n = ''] = url;
    return { owner, repo, number: Number(n), url: `https://github.com/${owner}/${repo}/pull/${n}` };
  }
  const short = PULL_SHORT.exec(text.trim());
  if (short === null) return undefined;
  const [, owner = '', repo = '', n = ''] = short;
  return { owner, repo, number: Number(n), url: `https://github.com/${owner}/${repo}/pull/${n}` };
}

/** PR を揃えた名（`<owner>/<repo>#<番号>` の小文字）。書き方が違っても同じ PR なら同じ字。PR でなければ undefined。 */
export function pullKey(text: string): string | undefined {
  const p = parsePullName(text);
  return p === undefined ? undefined : `${p.owner}/${p.repo}#${p.number}`.toLowerCase();
}

/** 同じ見る物か（PR は pullKey で、ページは URL の字で比べる）。 */
export const sameTarget = (a: string, b: string): boolean => {
  const key = pullKey(a);
  return key === undefined ? a === b : key === pullKey(b);
};

/** その PR の頼みのうち、番号のいちばん大きい物（無ければ undefined）。 */
export function latestReview(reviews: Review[], key: string): Review | undefined {
  return reviews.filter(r => pullKey(r.url) === key).reduce<Review | undefined>((a, b) => (a === undefined || b.n > a.n ? b : a), undefined);
}

/** 判定の短い字（`#12 よい（見た 1a2b3c4）`）。判定がまだなら「判定待ち」。 */
export function reviewNote(r: Review): string {
  const verdict = r.verdict === undefined ? '判定待ち' : VERDICTS[r.verdict];
  return `#${r.n} ${verdict}${r.head === undefined ? '' : `（見た ${r.head.slice(0, 7)}）`}${r.allowed === undefined ? '' : '・TPM 担当が進めると決めた'}`;
}

/** 席が出した PR の head（見た commit の元）。by は書いた席の Key。 */
export interface SeatHead {
  head: string
  at: string
  by: string
}

/**
 * PR ごとの file（状態の folder の `review-heads/<課題の Key>/<揃えた PR の名を URL の形に符号にした字>.jsonc`）。
 * PR ごとに分けるので、同じ場所で checkout が並んでも、ほかの PR の分を消さない（書くのは隣に書いてから名を替える）。
 */
const headFile = (key: string, pull: string): string => `review-heads/${key}/${encodeURIComponent(pull)}.jsonc`;

/** その課題のレビューの場所で、席が出した PR の head（無ければ undefined）。 */
export function readHead(ctx: Context, key: string, url: string): SeatHead | undefined {
  const pull = pullKey(url);
  return pull === undefined ? undefined : ctx.state.read<SeatHead>(headFile(key, pull));
}

/**
 * 席が出した PR の head と時刻と、書いた席の Key を書く。呼ぶのは、Staff の席の roster review checkout と、
 * roster ask review が席を起こす時の checkout だけ（課題の担当が出した head は、席が見た commit にしない）。
 */
export function recordHead(ctx: Context, key: string, url: string, head: string, by: string): void {
  const pull = pullKey(url);
  if (pull === undefined) return;
  ctx.state.write(headFile(key, pull), { head, at: ctx.now().toISOString(), by } satisfies SeatHead);
}

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
