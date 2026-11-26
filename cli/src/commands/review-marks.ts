// レビューの印を置き場に書く: レビューの依頼書の「レビュー待ち」と見てほしい物、レビューのページの判定と見た物、上げた件の「上げた」。
// Product Manager と TPM 担当が、TPM 担当を通らないレビューのやりとりを、置き場の一覧の UI で追うための物。
// 書くのは判定の語・見た物の URL・時刻だけ（見てほしい所・判定の一言・メッセージの字は写さない。中身はレビューのページにある）。
// 印を付けられなくても（置き場が応えない・誤りを返す）、命令は止めない（印が付かないだけ。メッセージを送った後に呼ばれるため）。
// 応えない時は、待ちの印を TPM 担当が後で直す手（roster page reply … --on review）を、直す依頼書ごとに出す。判定と見た物は手では書けない。
import type { Context } from '../context.ts';
import { openReviews, type Review, type Verdict } from '../reviews.ts';
import { TpmError } from '../skill-sets.ts';
import { markFailure, pageParts, setReply, type ReplyResult } from './reply.ts';
import { inStore, pagesRequest, reason } from './store.ts';
/** 判定と見た物を書けなかった時に添える字（手では書けない）。 */
const BY_HAND = '判定と見た物は手では書けない。roster review list と、レビューのページ・依頼書で見る';

/** 頼みの見る物を、置き場に書く形にする: 置き場のページは path（`/<project>/<Key>/<種類>-<番号>.html`。前の置き場の URL でも同じ path）、PR はそのままの URL。 */
function target(ctx: Context, url: string): string {
  const path = inStore(ctx.env, url);
  return path === undefined ? url : `/${path}`;
}

/** 置き場の答え。done のほかに、置き場が断った時の code と訳。 */
type Posted = { result: ReplyResult } | { result: 'refused', why: string };

/** ページ 1 枚に、判定と見た物を書く（AddReviewMarks）。 */
async function postMarks(ctx: Context, url: string, marks: { verdict?: Verdict, targets: string[] }): Promise<Posted> {
  const parts = pageParts(ctx, url);
  if (parts === undefined) return { result: 'foreign' };
  const r = await pagesRequest(ctx, { op: 'AddReviewMarks', query: new URLSearchParams(parts), marks });
  if (r.code === '000') return { result: 'down' };
  if (r.code === '200') return { result: 'done' };
  if (r.code === '404') return { result: 'missing' };
  return { result: 'refused', why: `${r.code} ${reason(r.body)}` };
}

/** 印を書く道を 1 つ流す。置き場の誤り（思わぬ code）は、止めずに 1 行にする。 */
async function safely(lines: () => Promise<string[]>): Promise<string[]> {
  try {
    return await lines();
  }
  catch (e) {
    if (!(e instanceof TpmError)) throw e;
    return [`置き場の印: 付けていない（置き場が誤りを返した: ${e.message}。メッセージは送った）`];
  }
}

/** 待ちの印を 1 つ書いた結果の行。done なら done の字、書けなければ訳と、応えない時の直す手。conflict（その相手の待ちでなかった）は、ignoreConflict なら何も出さない。 */
async function replyMark(ctx: Context, url: string, state: 'waiting' | 'answered', on: 'review' | 'tpm', done: string, ignoreConflict = false): Promise<string[]> {
  // 1 つの印の誤りで、ほかの印（判定・前の依頼書）の行を落とさない。
  return await safely(async () => {
    const result = await setReply(ctx, url, state, on);
    if (result === 'done') return [`置き場の印: ${done} ${url}`];
    if (result === 'conflict' && ignoreConflict) return [];
    return markFailure(url, result, `roster page reply ${url} --${state} --on ${on}`);
  });
}

/** 置き場が応えない時の行。直す手をみな並べる（fixes）。 */
function unmarked(fixes: string[]): string[] {
  return [
    `置き場の印: 付けていない（置き場が応えない。メッセージは送った。${BY_HAND}）`,
    ...fixes.map(fix => `  後で TPM 担当が直せる: ${fix}`),
  ];
}

/**
 * 頼みを依頼書にした時（roster ask review・席の起こし直し・roster assign --role staff-engineer）: 依頼書に見る物を書き、「レビュー待ち」にする。
 * previous は、頼みが前に持っていた依頼書（起こし直しで置き換えた物）。まだ返っていない頼みがほかに残っていなければ、待ちを外す。
 * 席を起こす道では、居場所ができた後に呼ぶ（起こせなかった回に、依頼書の待ちを残さない）。
 */
export async function markBrief(ctx: Context, url: string, asks: Review[], previous: string[]): Promise<string[]> {
  if (asks.length === 0) return [];
  return await safely(async () => {
    const key = asks[0]?.key ?? '';
    const held = new Set(openReviews(ctx, key).map(r => r.brief));
    const replaced = [...new Set(previous)].filter(old => old !== url && !held.has(old));
    const wrote = await postMarks(ctx, url, { targets: asks.map(r => target(ctx, r.url)) });
    // 応えなければ、ほかの印も書けないので、直す手をみな並べて終える。
    if (wrote.result === 'down') return unmarked([`roster page reply ${url} --waiting --on review`, ...replaced.map(old => `roster page reply ${old} --answered --on review`)]);
    const lines: string[] = [];
    if (wrote.result === 'refused') lines.push(`置き場の印: 見る物を書いていない（置き場が断った: ${wrote.why}）`);
    else if (wrote.result !== 'done') lines.push(...markFailure(url, wrote.result, ''));
    lines.push(...await replyMark(ctx, url, 'waiting', 'review', 'レビュー待ちにした'));
    // 前の依頼書が待ちでなかった（手で外した物など）なら、外す物が無いだけ。
    for (const old of replaced) lines.push(...await replyMark(ctx, old, 'answered', 'review', '置き換えたので、前の依頼書のレビュー待ちを外した', true));
    return lines;
  });
}

/** 判定を返した時（roster report review）: レビューのページに判定と見た物を書き、済ませた頼みの依頼書の「レビュー待ち」を外す。 */
export async function markVerdict(ctx: Context, page: string, verdict: Verdict, asks: Review[]): Promise<string[]> {
  return await safely(async () => {
    const briefs = [...new Set(asks.flatMap(r => r.brief === undefined ? [] : [r.brief]))];
    const wrote = await postMarks(ctx, page, { verdict, targets: asks.map(r => target(ctx, r.url)) });
    if (wrote.result === 'down') return unmarked(briefs.map(brief => `roster page reply ${brief} --answered --on review`));
    const lines = wrote.result === 'done'
      ? [`置き場の印: 判定と見た物を書いた ${page}`]
      : wrote.result === 'refused'
        ? [`置き場の印: 判定と見た物を書いていない（置き場が断った: ${wrote.why}）`]
        : markFailure(page, wrote.result, '');
    for (const brief of briefs) lines.push(...await replyMark(ctx, brief, 'answered', 'review', 'レビュー済みにした', true));
    return lines;
  });
}

/** 判定を受けずに TPM 担当に上げた時（roster ask tpm --review）: レビューのページを「上げた」（TPM 担当の返事待ち）にする。TPM 担当が決めたら roster page reply --answered --on tpm で外す。 */
export async function markEscalated(ctx: Context, page: string): Promise<string[]> {
  return await replyMark(ctx, page, 'waiting', 'tpm', '上げた（TPM 担当の返事待ち）にした');
}
