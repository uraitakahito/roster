// tpm review list: レビューの頼みと判定を、数で読む（reviews.jsonl）。読むだけなので、どの担当も打てる。
import type { Command } from 'commander';
import { createContext, type Context } from '../context.ts';
import { readReviews, VERDICTS, type Review, type Verdict } from '../reviews.ts';

/** 時刻の字（ISO）を、月日と時分にする。 */
const short = (iso: string): string => iso.slice(5, 16).replace('T', ' ');
const minutes = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / 60000);

/** 頼み 1 件の行。 */
function line(r: Review): string {
  const state = r.verdict !== undefined ? VERDICTS[r.verdict] : r.brief === undefined ? 'まだ（席に渡していない）' : 'まだ（席が見ている）';
  const when = `${short(r.askedAt)} に頼んだ${r.reviewedAt === undefined ? '' : `・${minutes(r.askedAt, r.reviewedAt)} 分で返った`}`;
  return [`#${r.n}`, r.key, state, r.url, when, ...(r.page === undefined ? [] : [r.page])].join('  ');
}

/** 結果のページ（result-N.html）を載せた【done】を出した課題の Key。 */
function resultKeys(ctx: Context): string[] {
  const done = ctx.state.lines<{ key: string, heading: string, text: string }>('log.jsonl').filter(l => l.heading === 'done' && /\/result-[1-9]\d*\.html/.test(l.text));
  return [...new Set(done.map(l => l.key))];
}

/**
 * レビューの頼みごとの行（課題・判定・見る物・頼んでから返るまでの時間・レビューのページ）と、合わせた数。
 * 終わりに、結果の【done】を出した課題のうち、レビューを 1 度も頼んでいない課題を数える（頼む時を見直す材料）。key があれば、その課題の頼みだけ。
 */
export function reviewList(ctx: Context, options: { key?: string }): string[] {
  const all = readReviews(ctx);
  const reviews = options.key === undefined ? all : all.filter(r => r.key === options.key);
  if (reviews.length === 0) return [options.key === undefined ? 'レビューの頼みは無い' : `${options.key} のレビューの頼みは無い`];
  const count = (v: Verdict): number => reviews.filter(r => r.verdict === v).length;
  const counts = (Object.keys(VERDICTS) as Verdict[]).map(v => `${VERDICTS[v]} ${count(v)}`).join('・');
  const lines = [...reviews.map(line), `頼み ${reviews.length} 件: ${counts}・まだ ${reviews.filter(r => r.verdict === undefined).length}`];
  if (options.key !== undefined) return lines;
  const asked = new Set(all.map(r => r.key));
  const results = resultKeys(ctx);
  const without = results.filter(k => !asked.has(k));
  return [...lines, `結果の【done】を出した課題 ${results.length} 件のうち、レビューを頼んでいない課題: ${without.length} 件${without.length === 0 ? '' : `（${without.join('・')}）`}`];
}

/** `tpm review` の命令を命令の木に足す。 */
export function registerReview(program: Command, print: (lines: string[]) => void): void {
  const review = program.command('review').description('レビューの頼みと判定を読む（頼むのは tpm ask review、返すのは tpm report review）');
  review.command('list').description('頼みごとの行と、合わせた数（頼んだ回数・判定ごとの数・レビューを頼んでいない課題）')
    .option('--key <Key>', 'その課題の頼みだけ')
    .action((options: { key?: string }) => print(reviewList(createContext(), options)));
}
