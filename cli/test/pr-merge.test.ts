// roster pr merge（t-pq5v の段 1）: いちばん新しいレビューの判定と、席が見た commit を確かめてから merge する。
// 判じ方は judgeMerge を表で見る。gh は偽の exec で、merge の命令の形（--match-head-commit・方法の旗・--delete-branch 無し・project の外の folder）を見る。
import { describe, expect, test } from 'vitest';
import { judgeMerge, prMerge, type PrView } from '../src/commands/pr.ts';
import { pullKey, type Review } from '../src/reviews.ts';
import { world, type World } from './helpers.ts';

const PR = 'https://github.com/o/r/pull/7';
const PR2 = 'https://github.com/o/r/pull/8';
const H1 = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';
const H2 = '5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e';
const OPEN: PrView = { state: 'OPEN', headRefOid: H1, isDraft: false };

/** 頼み 1 件（番号と欄を替えて作る）。 */
const review = (n: number, fields: Partial<Review> = {}): Review => ({ n, key: 'AI-8', url: PR, by: 'SWE AI-8', askedAt: '2026-11-20T12:00:00.000Z', ...fields });
const judged = (reviews: Review[], pr: PrView = OPEN, url = PR): string => {
  const r = judgeMerge(reviews, url, pr);
  return r.ok ? `通す #${r.review.n}` : r.why;
};

describe('pullKey（PR の名を揃える）', () => {
  test('URL の 4 つの書き方は、みな同じ名になる。大文字と小文字は同じに見る', () => {
    for (const url of [PR, `${PR}/files`, `${PR}/`, 'o/r#7', 'https://github.com/O/R/pull/7?w=1', `${PR}#discussion_r1`]) expect(pullKey(url), url).toBe('o/r#7');
    expect(pullKey('http://127.0.0.1:8801/p/AI-8/plan-1.html')).toBeUndefined();
    expect(pullKey(PR2)).toBe('o/r#8');
  });
});

describe('judgeMerge（判じる表）', () => {
  test.each([
    ['頼みが無い', [], 'この PR のレビューの頼みがありません。レビューを頼んでください（roster ask review --url https://github.com/o/r/pull/7）。merge していません'],
    ['判定待ち', [review(1)], 'レビュー #1 の判定がまだです（判定が【review】で届いてから打ってください）。merge していません'],
    ['直すべき', [review(1, { verdict: 'reject', head: H1 })], 'レビュー #1 の判定は「直すべき」です。直して見直しを頼むか、受けないなら roster ask tpm --review 1 で TPM 担当に上げてください。merge していません'],
    ['見られなかった', [review(1, { verdict: 'not-assessed', head: H1 })], 'レビュー #1 の判定は「見られなかった」です。もう 1 度頼んでください（roster ask review --url https://github.com/o/r/pull/7）。merge していません'],
    ['見られなかった（席を閉じて自動で入った物。head も無い）', [review(1, { verdict: 'not-assessed', summary: '席を閉じた' })], 'レビュー #1 の判定は「見られなかった」です。もう 1 度頼んでください（roster ask review --url https://github.com/o/r/pull/7）。merge していません'],
    ['よい', [review(1, { verdict: 'approve', head: H1 })], '通す #1'],
    ['気になる所あり', [review(1, { verdict: 'concerns', head: H1 })], '通す #1'],
    ['見直しで よい → 直すべき（いちばん新しい物で判じる）', [review(1, { verdict: 'approve', head: H2 }), review(2, { verdict: 'reject', head: H1 })], expect.stringMatching(/^レビュー #2 の判定は「直すべき」です/) as string],
    ['見直しで 直すべき → よい', [review(1, { verdict: 'reject', head: H2 }), review(2, { verdict: 'approve', head: H1 })], '通す #2'],
    ['見直しの判定待ち（前の よい があっても）', [review(1, { verdict: 'approve', head: H1 }), review(2)], expect.stringMatching(/^レビュー #2 の判定がまだです/) as string],
    ['直すべき を TPM 担当が進めると決めた（allowed）', [review(1, { verdict: 'reject', head: H1, escalatedAt: '2026-11-20T12:10:00.000Z', allowed: { by: 'tpm', at: '2026-11-20T12:20:00.000Z', note: '指摘は範囲の外' } })], '通す #1'],
    ['allowed でも、見た後に commit が入れば止まる', [review(1, { verdict: 'reject', head: H2, allowed: { by: 'tpm', at: '2026-11-20T12:20:00.000Z', note: 'x' } })], 'レビューの後に commit が入った（見た 5d6e7f8・今 1a2b3c4）。見直しを頼んでください（直しや rebase だけなら --light で足りる）。merge していません'],
    ['見た commit が無い（push があった・前の版の頼み）', [review(1, { verdict: 'approve' })], 'レビュー #1 が見た commit の記録がありません（頼んだ後に push があったか、前の版の頼み）。見直しを頼んでください（直しや rebase だけなら --light で足りる）。merge していません'],
    ['見た commit が今の head と違う', [review(1, { verdict: 'approve', head: H2 })], 'レビューの後に commit が入った（見た 5d6e7f8・今 1a2b3c4）。見直しを頼んでください（直しや rebase だけなら --light で足りる）。merge していません'],
    ['ほかの PR の頼みは見ない', [review(1, { url: PR2, verdict: 'approve', head: H1 })], expect.stringMatching(/^この PR のレビューの頼みがありません/) as string],
  ] as [string, Review[], string][])('%s', (_name, reviews, want) => {
    expect(judged(reviews)).toEqual(want);
  });

  test('URL の書き方が頼みと違っても、同じ PR の頼みで判じる', () => {
    const reviews = [review(1, { url: `${PR}/files`, verdict: 'approve', head: H1 })];
    for (const url of [PR, 'O/R#7', `${PR}/`, 'https://github.com/o/r/pull/7?x=1']) expect(judged(reviews, OPEN, url), url).toBe('通す #1');
  });

  test('まとめた頼み: PR ごとに、その PR の head と判定で判じる', () => {
    const brief = 'http://127.0.0.1:8801/p/AI-8/brief-2.html';
    const reviews = [review(2, { url: PR, brief, verdict: 'approve', head: H1 }), review(3, { url: PR2, brief, verdict: 'reject', head: H2 })];
    expect(judged(reviews, OPEN, PR)).toBe('通す #2');
    expect(judged(reviews, { ...OPEN, headRefOid: H2 }, PR2)).toMatch(/^レビュー #3 の判定は「直すべき」です/);
  });

  test('閉じた PR・merge 済みの PR・draft は断る', () => {
    const reviews = [review(1, { verdict: 'approve', head: H1 })];
    expect(judged(reviews, { ...OPEN, state: 'CLOSED' })).toBe('この PR は開いていません（CLOSED）。merge していません');
    expect(judged(reviews, { ...OPEN, state: 'MERGED' })).toBe('この PR は開いていません（MERGED）。merge していません');
    expect(judged(reviews, { ...OPEN, isDraft: true })).toBe('この PR は draft です（ready にしてから打ってください）。merge していません');
  });
});

describe('prMerge（gh を打つ）', () => {
  /** PR #7 が開いていて head が H1、頼み #1 が「よい」で H1 を見た世界。 */
  function ready(fields: Partial<Review> = {}): World {
    const w = world();
    w.prs.set(PR, 'OPEN');
    w.prFields.set(PR, { headRefOid: H1, isDraft: false });
    w.tpm.state.write('reviews/1.jsonc', review(1, { verdict: 'approve', head: H1, headFrom: 'checkout', page: 'http://127.0.0.1:8801/p/AI-8/review-1.html', ...fields }));
    return w;
  }
  const METHODS = 'gh api repos/o/r --jq {merge:.allow_merge_commit,squash:.allow_squash_merge,rebase:.allow_rebase_merge}';
  const merges = (w: World) => w.calls.filter(c => c.cmd === 'gh' && c.args[0] === 'pr' && c.args[1] === 'merge');

  test('通れば gh pr merge を --match-head-commit と方法の旗で打つ。--delete-branch は付けず、project の外の folder で打つ', () => {
    const w = ready();
    expect(prMerge(w.tpm, `${PR}/files`, { method: 'squash' })).toEqual([
      `merge した: ${PR}（--squash・1a2b3c4）`,
      '通した頼み: #1 よい（見た 1a2b3c4）・レビューのページ http://127.0.0.1:8801/p/AI-8/review-1.html',
      `次: roster watch main ${PR} を裏で起こして main の workflow を待ち、roster report merged --pr ${PR} で知らせる`,
    ]);
    const [call] = merges(w);
    expect(call?.args).toEqual(['pr', 'merge', PR, '--match-head-commit', H1, '--squash']);
    expect(call?.args).not.toContain('--delete-branch');
    expect(call?.options?.cwd).toBe(w.tpm.state.dir);
    expect(call?.options?.cwd?.startsWith(w.project)).toBe(false);
  });

  test('旗が無ければ、repo の許す方法が 1 つならそれ。いくつもあれば、旗を求めて断る', () => {
    const w = ready();
    w.answers.set(METHODS, { status: 0, stdout: '{"merge":false,"squash":true,"rebase":false}', stderr: '' });
    expect(prMerge(w.tpm, PR, {})[0]).toBe(`merge した: ${PR}（--squash・1a2b3c4）`);
    const many = ready();
    many.answers.set(METHODS, { status: 0, stdout: '{"merge":true,"squash":true,"rebase":false}', stderr: '' });
    expect(() => prMerge(many.tpm, PR, {})).toThrow('repo が許す merge の方法がいくつもあります（merge・squash）。--merge・--squash のどれかを付けて打ち直してください。merge していません');
    expect(merges(many)).toEqual([]);
  });

  test('断る時は gh pr merge を打たない（判定待ち・head 違い・draft・閉じた PR・PR を読めない）', () => {
    const pending = ready({ verdict: undefined, head: undefined });
    expect(() => prMerge(pending.tpm, PR, { method: 'merge' })).toThrow(/^レビュー #1 の判定がまだです/);
    const pushed = ready();
    pushed.prFields.set(PR, { headRefOid: H2, isDraft: false });
    expect(() => prMerge(pushed.tpm, PR, { method: 'merge' })).toThrow('レビューの後に commit が入った（見た 1a2b3c4・今 5d6e7f8）');
    const draft = ready();
    draft.prFields.set(PR, { headRefOid: H1, isDraft: true });
    expect(() => prMerge(draft.tpm, PR, { method: 'merge' })).toThrow(/draft です/);
    const closed = ready();
    closed.prs.set(PR, 'CLOSED');
    expect(() => prMerge(closed.tpm, PR, { method: 'merge' })).toThrow(/開いていません（CLOSED）/);
    const unread = ready();
    unread.prs.set(PR, undefined);
    expect(() => prMerge(unread.tpm, PR, { method: 'merge' })).toThrow(/^PR を gh で読めません。merge していません: gh: not logged in/);
    for (const w of [pending, pushed, draft, closed, unread]) expect(merges(w)).toEqual([]);
    expect(() => prMerge(ready().tpm, 'cli/src/pr.ts', {})).toThrow(/PR の URL/);
  });

  test('gh pr merge が断れば（確かめた後の push など）、止まって訳を出す', () => {
    const w = ready();
    w.answers.set(`gh pr merge ${PR} --match-head-commit ${H1} --rebase`, { status: 1, stdout: '', stderr: 'Head branch was modified' });
    expect(() => prMerge(w.tpm, PR, { method: 'rebase' })).toThrow('gh pr merge が通りませんでした（確かめた後に push があれば、GitHub が断る）: Head branch was modified');
  });
});
