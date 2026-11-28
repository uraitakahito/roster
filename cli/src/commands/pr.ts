// roster pr merge: PR のいちばん新しいレビューの判定と、席が見た commit を確かめてから merge する（t-pq5v の段 1）。
// 判じるのは judgeMerge（gh を打たない）。merge は gh pr merge --match-head-commit で打つので、確かめと merge の間の push は GitHub が断る。
import { mkdirSync } from 'node:fs';
import type { Command } from 'commander';
import { createContext, type Context } from '../context.ts';
import { latestReview, parsePullName, pullKey, readReviews, reviewNote, VERDICTS, type Review } from '../reviews.ts';
import { TpmError } from '../skill-sets.ts';

/** merge の方法（gh pr merge の旗の名）。 */
export const MERGE_METHODS = ['merge', 'squash', 'rebase'] as const;
/** merge の方法。 */
export type MergeMethod = typeof MERGE_METHODS[number];

/** gh pr view で読んだ PR。 */
export interface PrView {
  state: string
  headRefOid: string
  isDraft: boolean
}

/** judgeMerge の答え: 通すなら、通した頼み。断るなら、その訳。 */
export type MergeJudge = { ok: true, review: Review } | { ok: false, why: string };

/** 見直しを頼む案内。 */
const AGAIN = '見直しを頼んでください（直しや rebase だけなら --light で足りる）';

/**
 * merge してよいかを判じる（gh を打たない）。PR が開いていて draft でなく、その PR（pullKey で揃える）のいちばん新しい頼みの判定が
 * 「よい」か「気になる所あり」（「直すべき」でも roster review allow の記録があれば）で、席が見た commit が今の head と同じ時だけ通す。
 */
export function judgeMerge(reviews: Review[], url: string, pr: PrView): MergeJudge {
  const no = (why: string): MergeJudge => ({ ok: false, why: `${why}。merge していません` });
  if (pr.state !== 'OPEN') return no(`この PR は開いていません（${pr.state}）`);
  if (pr.isDraft) return no('この PR は draft です（ready にしてから打ってください）');
  const key = pullKey(url);
  const latest = key === undefined ? undefined : latestReview(reviews, key);
  if (latest === undefined) return no(`この PR のレビューの頼みがありません。レビューを頼んでください（roster ask review --url ${url}）`);
  switch (latest.verdict) {
    case undefined:
      return no(`レビュー #${latest.n} の判定がまだです（判定が【review】で届いてから打ってください）`);
    case 'not-assessed':
      return no(`レビュー #${latest.n} の判定は「${VERDICTS['not-assessed']}」です。もう 1 度頼んでください（roster ask review --url ${url}）`);
    case 'reject':
      if (latest.allowed === undefined) return no(`レビュー #${latest.n} の判定は「${VERDICTS.reject}」です。直して見直しを頼むか、受けないなら roster ask tpm --review ${latest.n} で TPM 担当に上げてください`);
      break;
    case 'approve':
    case 'concerns':
      break;
  }
  if (latest.head === undefined) return no(`レビュー #${latest.n} が見た commit の記録がありません（頼んだ後に push があったか、前の版の頼み）。${AGAIN}`);
  if (latest.head !== pr.headRefOid) return no(`レビューの後に commit が入った（見た ${latest.head.slice(0, 7)}・今 ${pr.headRefOid.slice(0, 7)}）。${AGAIN}`);
  return { ok: true, review: latest };
}

/** gh の JSON を読む。読めなければ止まる。 */
function ghJson<T>(ctx: Context, args: string[], what: string): T {
  const r = ctx.exec('gh', args);
  if (r.status !== 0) throw new TpmError(`${what}を gh で読めません。merge していません: ${r.stderr.trim()}`);
  try {
    return JSON.parse(r.stdout) as T;
  }
  catch {
    throw new TpmError(`${what}を gh で読めません（JSON でない）。merge していません: ${r.stdout.trim()}`);
  }
}

/** 旗が無い時の方法: repo の許す方法が 1 つならそれ。いくつもあるか読めなければ、旗を求めて止まる。 */
function repoMethod(ctx: Context, owner: string, repo: string): MergeMethod {
  const allowed = ghJson<Partial<Record<MergeMethod, unknown>>>(ctx, ['api', `repos/${owner}/${repo}`, '--jq', '{merge:.allow_merge_commit,squash:.allow_squash_merge,rebase:.allow_rebase_merge}'], 'repo の許す merge の方法');
  const methods = MERGE_METHODS.filter(m => allowed[m] === true);
  const [only] = methods;
  if (methods.length === 1 && only !== undefined) return only;
  throw new TpmError(methods.length === 0
    ? 'repo の許す merge の方法を読めません。--merge・--squash・--rebase のどれかを付けて打ち直してください。merge していません'
    : `repo が許す merge の方法がいくつもあります（${methods.join('・')}）。--${methods.join('・--')} のどれかを付けて打ち直してください。merge していません`);
}

/**
 * PR を merge する: gh pr view で PR を読み、judgeMerge で判じ、通れば `gh pr merge <URL> --match-head-commit <見た commit> --<方法>` を打つ。
 * gh は project の外の folder（状態の folder）で打つ（worktree の中で打つと、手元の branch を動かそうとして落ちることがある）。
 * --delete-branch は付けない（branch の片付けは今どおり担当がする）。
 */
export function prMerge(ctx: Context, url: string, options: { method?: MergeMethod }): string[] {
  const pull = parsePullName(url);
  if (pull === undefined) throw new TpmError(`PR の URL（https://github.com/<owner>/<repo>/pull/<番号>）か <owner>/<repo>#<番号> にしてください: ${url}`);
  const pr = ghJson<Partial<PrView>>(ctx, ['pr', 'view', pull.url, '--json', 'state,headRefOid,isDraft'], 'PR ');
  const judged = judgeMerge(readReviews(ctx), pull.url, { state: pr.state ?? '', headRefOid: pr.headRefOid ?? '', isDraft: pr.isDraft === true });
  if (!judged.ok) throw new TpmError(judged.why);
  const { review } = judged;
  const head = review.head ?? '';
  const method = options.method ?? repoMethod(ctx, pull.owner, pull.repo);
  mkdirSync(ctx.state.dir, { recursive: true });
  const r = ctx.exec('gh', ['pr', 'merge', pull.url, '--match-head-commit', head, `--${method}`], { cwd: ctx.state.dir });
  if (r.status !== 0) throw new TpmError(`gh pr merge が通りませんでした（確かめた後に push があれば、GitHub が断る）: ${r.stderr.trim()}`);
  return [
    `merge した: ${pull.url}（--${method}・${head.slice(0, 7)}）`,
    `通した頼み: ${reviewNote(review)}${review.page === undefined ? '' : `・レビューのページ ${review.page}`}`,
    `次: roster watch main ${pull.url} を裏で起こして main の workflow を待ち、roster report merged --pr ${pull.url} で知らせる`,
  ];
}

/** `roster pr` の命令を命令の木に足す。 */
export function registerPr(program: Command, print: (lines: string[]) => void): void {
  const pr = program.command('pr').description('PR を扱う');
  pr.command('merge <url>').description('PR のいちばん新しいレビューの判定と、席が見た commit が今の head と同じかを確かめてから merge する（gh pr merge --match-head-commit。--delete-branch は付けない）')
    .option('--merge', 'merge の commit を作る')
    .option('--squash', 'squash して merge する')
    .option('--rebase', 'rebase して merge する')
    .action((url: string, options: Partial<Record<MergeMethod, boolean>>) => {
      const methods = MERGE_METHODS.filter(m => options[m] === true);
      if (methods.length > 1) throw new TpmError('--merge・--squash・--rebase は、どれか 1 つだけを付けてください');
      const [method] = methods;
      print(prMerge(createContext(), url, method === undefined ? {} : { method }));
    });
}
