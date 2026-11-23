// レビューの印を置き場（pagetray 0.8.0 から）に書く: レビューの依頼書の「レビュー待ち」と見てほしい物、レビューのページの判定と見た物、上げた件の「上げた」。
// Product Manager と TPM 担当が、TPM 担当を通らないレビューのやりとりを、置き場の一覧の UI で追うための物。
// 書くのは判定の語・見た物の URL・時刻だけ（見てほしい所・判定の一言・メッセージの字は写さない。中身はレビューのページにある）。
// 印を付けられなくても（置き場が古い・応えない・誤りを返す）、命令は止めない（印が付かないだけ。メッセージを送った後に呼ばれるため）。
// 応えない時は、待ちの印を TPM 担当が後で直す手（tpm page reply … --on review）を、直す依頼書ごとに出す。判定と見た物は手では書けない。
import type { Context } from '../context.ts';
import { openReviews, type Review, type Verdict } from '../reviews.ts';
import { TpmError } from '../skill-sets.ts';
import { markFailure, PARTY_SINCE, pageParts, setReply, type ReplyResult } from './reply.ts';
import { call, inStore, pagesUrl, reason, storeAtLeast } from './store.ts';

/** 古い置き場で持てない物の字。 */
const OLD = `レビューの印を持てない（${PARTY_SINCE} から）`;
/** 判定と見た物を書けなかった時に添える字（手では書けない）。 */
const BY_HAND = '判定と見た物は手では書けない。tpm review list と、レビューのページ・依頼書で見る';

/** 頼みの見る物を、置き場に書く形にする: 置き場のページは path（`/<project>/<Key>/<種類>-<番号>.html`。前の置き場の URL でも同じ path）、PR はそのままの URL。 */
function target(ctx: Context, url: string): string {
  const path = inStore(ctx.env, url);
  return path === undefined ? url : `/${path}`;
}

/** 置き場の答え。done のほかに、置き場が断った時の code と訳。 */
type Posted = { result: ReplyResult } | { result: 'refused', why: string };

/** ページ 1 枚に、判定と見た物を書く（POST /api/pages/review）。版は呼ぶ側が見てある。 */
function postMarks(ctx: Context, url: string, marks: { verdict?: Verdict, targets: string[] }): Posted {
  const parts = pageParts(ctx, url);
  if (parts === undefined) return { result: 'foreign' };
  const r = call(ctx, ['-X', 'POST', '-H', 'Content-Type: application/json', '--data-binary', '@-', `${pagesUrl(ctx.env)}/api/pages/review?${new URLSearchParams(parts).toString()}`], JSON.stringify(marks));
  if (r.code === '000') return { result: 'down' };
  if (r.code === '200') return { result: 'done' };
  if (r.code === '404' || r.code === '410') return { result: 'missing' };
  return { result: 'refused', why: `${r.code} ${reason(r.body)}` };
}

/** 印を書く道を 1 つ流す。置き場の誤り（思わぬ code・API の版の違い）は、止めずに 1 行にする。 */
function safely(lines: () => string[]): string[] {
  try {
    return lines();
  }
  catch (e) {
    if (!(e instanceof TpmError)) throw e;
    return [`置き場の印: 付けていない（置き場が誤りを返した: ${e.message}。メッセージは送った）`];
  }
}

/** 待ちの印を 1 つ書いた結果の行。done なら done の字、書けなければ訳と、応えない時の直す手。conflict（その相手の待ちでなかった）は、ignoreConflict なら何も出さない。 */
function replyMark(ctx: Context, url: string, state: 'waiting' | 'answered', on: 'review' | 'tpm', done: string, ignoreConflict = false): string[] {
  // 1 つの印の誤りで、ほかの印（判定・前の依頼書）の行を落とさない。
  return safely(() => {
    const result = setReply(ctx, url, state, on);
    if (result === 'done') return [`置き場の印: ${done} ${url}`];
    if (result === 'conflict' && ignoreConflict) return [];
    return markFailure(url, result, `tpm page reply ${url} --${state} --on ${on}`, OLD);
  });
}

/** 置き場が 0.8.0 より前・応えない時の行。応えない時は、直す手をみな並べる（fixes）。 */
function unmarked(url: string, since: 'old' | 'down', fixes: string[]): string[] {
  if (since === 'old') return markFailure(url, 'old', '', OLD);
  return [
    `置き場の印: 付けていない（置き場が応えない。メッセージは送った。${BY_HAND}）`,
    ...fixes.map(fix => `  後で TPM 担当が直せる: ${fix}`),
  ];
}

/**
 * 頼みを依頼書にした時（tpm ask review・席の起こし直し・tpm assign --role staff-engineer）: 依頼書に見る物を書き、「レビュー待ち」にする。
 * previous は、頼みが前に持っていた依頼書（起こし直しで置き換えた物）。まだ返っていない頼みがほかに残っていなければ、待ちを外す。
 * 席を起こす道では、居場所ができた後に呼ぶ（起こせなかった回に、依頼書の待ちを残さない）。
 */
export function markBrief(ctx: Context, url: string, asks: Review[], previous: string[]): string[] {
  if (asks.length === 0) return [];
  return safely(() => {
    const key = asks[0]?.key ?? '';
    const held = new Set(openReviews(ctx, key).map(r => r.brief));
    const replaced = [...new Set(previous)].filter(old => old !== url && !held.has(old));
    const since = storeAtLeast(ctx, PARTY_SINCE);
    if (since !== 'yes') {
      return unmarked(url, since, [`tpm page reply ${url} --waiting --on review`, ...replaced.map(old => `tpm page reply ${old} --answered --on review`)]);
    }
    const wrote = postMarks(ctx, url, { targets: asks.map(r => target(ctx, r.url)) });
    const lines: string[] = [];
    if (wrote.result === 'refused') lines.push(`置き場の印: 見る物を書いていない（置き場が断った: ${wrote.why}）`);
    else if (wrote.result === 'down') lines.push(`置き場の印: 見る物を書いていない（置き場が応えない。${BY_HAND}）`);
    else if (wrote.result !== 'done') lines.push(...markFailure(url, wrote.result, '', OLD));
    lines.push(...replyMark(ctx, url, 'waiting', 'review', 'レビュー待ちにした'));
    // 前の依頼書が待ちでなかった（古い置き場の時に置いた物）なら、外す物が無いだけ。
    for (const old of replaced) lines.push(...replyMark(ctx, old, 'answered', 'review', '置き換えたので、前の依頼書のレビュー待ちを外した', true));
    return lines;
  });
}

/** 判定を返した時（tpm report review）: レビューのページに判定と見た物を書き、済ませた頼みの依頼書の「レビュー待ち」を外す。 */
export function markVerdict(ctx: Context, page: string, verdict: Verdict, asks: Review[]): string[] {
  return safely(() => {
    const briefs = [...new Set(asks.flatMap(r => r.brief === undefined ? [] : [r.brief]))];
    const since = storeAtLeast(ctx, PARTY_SINCE);
    if (since !== 'yes') return unmarked(page, since, briefs.map(brief => `tpm page reply ${brief} --answered --on review`));
    const wrote = postMarks(ctx, page, { verdict, targets: asks.map(r => target(ctx, r.url)) });
    const lines = wrote.result === 'done'
      ? [`置き場の印: 判定と見た物を書いた ${page}`]
      : wrote.result === 'refused'
        ? [`置き場の印: 判定と見た物を書いていない（置き場が断った: ${wrote.why}）`]
        : wrote.result === 'down'
          ? [`置き場の印: 判定と見た物を書いていない（置き場が応えない。${BY_HAND}）`]
          : markFailure(page, wrote.result, '', OLD);
    for (const brief of briefs) lines.push(...replyMark(ctx, brief, 'answered', 'review', 'レビュー済みにした', true));
    return lines;
  });
}

/** 判定を受けずに TPM 担当に上げた時（tpm ask tpm --review）: レビューのページを「上げた」（TPM 担当の返事待ち）にする。TPM 担当が決めたら tpm page reply --answered --on tpm で外す。 */
export function markEscalated(ctx: Context, page: string): string[] {
  return safely(() => {
    const since = storeAtLeast(ctx, PARTY_SINCE);
    if (since !== 'yes') return since === 'old' ? markFailure(page, 'old', '', OLD) : markFailure(page, 'down', `tpm page reply ${page} --waiting --on tpm`, OLD);
    return replyMark(ctx, page, 'waiting', 'tpm', '上げた（TPM 担当の返事待ち）にした');
  });
}
