// 課題管理の課題の中身を読む（tpm issue view）。どの担当も打つ。
// 読むだけで記録を書かないので、設定の tracker が none の project でも、鍵の形で道具を選んで読む。
import type { Context } from '../context.ts';
import { TpmError } from '../skill-sets.ts';
import { GithubTracker } from '../tracker/github.ts';
import { JiraTracker } from '../tracker/jira.ts';
import type { Tracker, TrackerComment, TrackerIssue } from '../tracker/types.ts';
import { putPage } from './page.ts';

/** 鍵を読める道具。設定の道具が持つ鍵ならそれ、無ければ鍵の形で選ぶ（Jira が先。t- の鍵はどれも持たない）。 */
export function issueTracker(ctx: Context, key: string): Tracker | undefined {
  return [ctx.tracker, new JiraTracker(ctx.exec), new GithubTracker(ctx.exec, ctx.project)].find(t => t.owns(key));
}

/** 道具の認証を確かめる命令。 */
const authCheck = (tracker: Tracker): string => (tracker instanceof JiraTracker ? 'acli jira auth status' : 'gh auth status');

/** コメントの見出し。書いた人と時刻は、読めたときだけ添える。 */
function commentHead(c: TrackerComment, i: number): string {
  const by = [c.author, c.created].filter(v => v !== undefined);
  return `--- コメント ${i + 1}${by.length === 0 ? '' : `（${by.join('・')}）`}`;
}

/** 課題を読む。読める道具が無い鍵・読めなかったときは、直し方を添えて止まる。 */
function readIssue(ctx: Context, key: string): TrackerIssue {
  const tracker = issueTracker(ctx, key);
  if (tracker === undefined) {
    throw new TpmError(`${key} は課題管理の課題の鍵ではありません（Jira は SKILLS-12、GitHub の Issue は gh-12 の形）。t- の鍵の課題の中身は依頼書にあります`);
  }
  try {
    return tracker.view(key);
  }
  catch (e) {
    if (!(e instanceof TpmError)) throw e;
    throw new TpmError(`${e.message}\n鍵が正しいかと、認証を ${authCheck(tracker)} で確かめてください。認証が無ければ、tpm ask tpm で Product Manager に login を頼んでください`);
  }
}

/** 課題の題・状態・本文・コメントを出す。 */
export function issueView(ctx: Context, key: string): string[] {
  const issue = readIssue(ctx, key);
  return [
    `課題: ${issue.key}（${issue.tool}）`,
    `題: ${issue.title}`,
    `状態: ${issue.status}`,
    ...(issue.url === undefined ? [] : [`URL: ${issue.url}`]),
    '--- 本文',
    issue.body === '' ? '（無し）' : issue.body,
    ...(issue.comments.length === 0 ? ['--- コメント: 無し'] : issue.comments.flatMap((c, i) => [commentHead(c, i), c.text])),
  ];
}

/** HTML に入れる字の escape。 */
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c] ?? c);

/** 課題の写しのページ（HTML）。本文とコメントは字のまま <pre> に入れる（課題の中の tag は動かさない）。 */
export function issuePage(issue: TrackerIssue, at: Date): string {
  const e = escapeHtml;
  const comments = issue.comments.length === 0
    ? ['<p>無し</p>']
    : issue.comments.map((c, i) => `<h3>${e(commentHead(c, i).replace(/^--- /, ''))}</h3>\n<pre>${e(c.text)}</pre>`);
  return [
    '<!doctype html>',
    `<html lang="ja"><head><meta charset="utf-8"><title>${e(issue.key)} 課題の写し</title>`,
    '<style>body{font:16px/1.7 system-ui,sans-serif;max-width:50rem;margin:0 auto;padding:1rem 16px 3rem}pre{white-space:pre-wrap;background:#f6f7f9;border:1px solid #d4d4d8;padding:.6rem}@media (prefers-color-scheme:dark){body{background:#161618;color:#e8e8ea}pre{background:#202024;border-color:#3a3a3e}}</style>',
    '</head><body>',
    `<h1>${e(issue.key)}: ${e(issue.title)}</h1>`,
    '<ul>',
    `<li>道具: ${e(issue.tool)}</li>`,
    `<li>状態: ${e(issue.status)}</li>`,
    ...(issue.url === undefined ? [] : [`<li>URL: <a href="${e(issue.url)}">${e(issue.url)}</a></li>`]),
    `<li>写した時刻: ${e(at.toISOString())}（tpm assign が tpm issue view と同じ中身を写した。新しい中身は tpm issue view ${e(issue.key)}）</li>`,
    '</ul>',
    '<h2>本文</h2>',
    issue.body === '' ? '<p>無し</p>' : `<pre>${e(issue.body)}</pre>`,
    '<h2>コメント</h2>',
    ...comments,
    '</body></html>',
    '',
  ].join('\n');
}

/**
 * 課題の写しのページを置き、URL を返す（tpm assign）。issueKey が読める形でなければ（t- の鍵・Dependabot の PR）何もせず undefined。
 * 読めなければ、--no-issue-copy で抜けられることを添えて止まる。ページは担当の鍵（roleKey）の folder に置く。
 */
export function copyIssue(ctx: Context, issueKey: string, roleKey: string): string | undefined {
  if (issueTracker(ctx, issueKey) === undefined) return undefined;
  let issue;
  try {
    issue = readIssue(ctx, issueKey);
  }
  catch (e) {
    if (!(e instanceof TpmError)) throw e;
    throw new TpmError(`${issueKey} の課題の写しを作れませんでした: ${e.message}\n読めないまま振るなら、訳を添えて --no-issue-copy "<訳>" を付けてください（訳は担当に届きます）`);
  }
  return putPage(ctx, { text: issuePage(issue, ctx.now()) }, 'issue', roleKey).url;
}
