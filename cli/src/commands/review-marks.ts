// レビューの印を置き場（pagetray 0.8.0 から）に書く: レビューの依頼書の「レビュー待ち」と見てほしい物、レビューのページの判定と見た物、上げた件の「上げた」。
// Product Manager と TPM 担当が、TPM 担当を通らないレビューのやりとりを、置き場の一覧の UI で追うための物。
// 書くのは判定の語・見た物の URL・時刻だけ（見てほしい所・判定の一言・メッセージの字は写さない。中身はレビューのページにある）。
// 印を付けられなくても（置き場が古い・応えない）、命令は止めない（印が付かないだけ）。
import type { Context } from '../context.ts';
import { openReviews, type Review, type Verdict } from '../reviews.ts';
import { markFailure, PARTY_SINCE, pageParts, replyLine, setReply, type ReplyResult } from './reply.ts';
import { call, inStore, pagesUrl, storeAtLeast } from './store.ts';

/** 置き場の印の字（古い置き場で持てない物）。 */
const OLD = `レビューの印を持てない（${PARTY_SINCE} から）`;

/** 頼みの見る物を、置き場に書く形にする: 置き場のページは path（`/<project>/<Key>/<種類>-<番号>.html`。前の置き場の URL でも同じ path）、PR はそのままの URL。 */
function target(ctx: Context, url: string): string {
  const path = inStore(ctx.env, url);
  return path === undefined ? url : `/${path}`;
}

/** ページ 1 枚に、判定と見た物を書く（POST /api/pages/review）。 */
function postMarks(ctx: Context, url: string, marks: { verdict?: Verdict, targets: string[] }): ReplyResult {
  const parts = pageParts(ctx, url);
  if (parts === undefined) return 'foreign';
  const since = storeAtLeast(ctx, PARTY_SINCE);
  if (since !== 'yes') return since;
  const r = call(ctx, ['-X', 'POST', '-H', 'Content-Type: application/json', '--data-binary', '@-', `${pagesUrl(ctx.env)}/api/pages/review?${new URLSearchParams(parts).toString()}`], JSON.stringify(marks));
  if (r.code === '000') return 'down';
  if (r.code === '200') return 'done';
  if (r.code === '404' || r.code === '410') return 'missing';
  // 置き場が断った（見た物の形など）。印が付かないだけなので、止めずに訳を出す。
  return 'conflict';
}

/** 見た物を書けなかった訳の 1 行。 */
function targetsLine(ctx: Context, url: string, result: ReplyResult): string[] {
  if (result === 'conflict') return [`置き場の印: 見た物を書いていない（置き場が断った: ${url}）`];
  return markFailure(url, result, '（見た物は手では書けない。レビューの依頼書と tpm review list で見る）', OLD);
}

/**
 * 頼みを依頼書にした時（tpm ask review・席の起こし直し・tpm assign --role staff-engineer）: 依頼書に見る物を書き、「レビュー待ち」にする。
 * previous は、頼みが前に持っていた依頼書（起こし直しで置き換えた物）。まだ返っていない頼みがほかに残っていなければ、待ちを外す。
 */
export function markBrief(ctx: Context, url: string, asks: Review[], previous: string[]): string[] {
  if (asks.length === 0) return [];
  const since = storeAtLeast(ctx, PARTY_SINCE);
  if (since !== 'yes') return markFailure(url, since, `tpm page reply ${url} --waiting --on review`, OLD);
  const wrote = postMarks(ctx, url, { targets: asks.map(r => target(ctx, r.url)) });
  const lines = wrote === 'done' ? [] : targetsLine(ctx, url, wrote);
  lines.push(...replyLine(ctx, url, 'waiting', undefined, 'review'));
  const key = asks[0]?.key ?? '';
  const held = new Set(openReviews(ctx, key).map(r => r.brief));
  for (const old of new Set(previous)) {
    if (old === url || held.has(old)) continue;
    const result = setReply(ctx, old, 'answered', 'review');
    // 前の依頼書が待ちでなかった（古い置き場の時に置いた物）なら、外す物が無いだけ。
    if (result === 'done') lines.push(`置き場の印: 置き換えたので、前の依頼書のレビュー待ちを外した ${old}`);
    else if (result !== 'conflict') lines.push(...markFailure(old, result, `tpm page reply ${old} --answered --on review`, OLD));
  }
  return lines;
}

/** 判定を返した時（tpm report review）: レビューのページに判定と見た物を書き、済ませた頼みの依頼書の「レビュー待ち」を外す。 */
export function markVerdict(ctx: Context, page: string, verdict: Verdict, asks: Review[]): string[] {
  const since = storeAtLeast(ctx, PARTY_SINCE);
  if (since !== 'yes') return markFailure(page, since, '（判定は手では書けない。tpm review list で見る）', OLD);
  const wrote = postMarks(ctx, page, { verdict, targets: asks.map(r => target(ctx, r.url)) });
  const lines = wrote === 'done' ? [`置き場の印: 判定と見た物を書いた ${page}`] : targetsLine(ctx, page, wrote);
  for (const brief of new Set(asks.map(r => r.brief).filter(b => b !== undefined))) {
    const result = setReply(ctx, brief, 'answered', 'review');
    if (result === 'done') lines.push(`置き場の印: レビュー済みにした ${brief}`);
    else if (result !== 'conflict') lines.push(...markFailure(brief, result, `tpm page reply ${brief} --answered --on review`, OLD));
  }
  return lines;
}

/** 判定を受けずに TPM 担当に上げた時（tpm ask tpm --review）: レビューのページを「上げた」（TPM 担当の返事待ち）にする。TPM 担当が決めたら tpm page reply --answered --on tpm で外す。 */
export const markEscalated = (ctx: Context, page: string): string[] => replyLine(ctx, page, 'waiting', '上げた（TPM 担当の返事待ち）にした', 'tpm');
