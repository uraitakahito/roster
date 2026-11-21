// 課題管理の課題の中身を読む（tpm issue view）。どの担当も打つ。
// 読むだけで記録を書かないので、設定の tracker が none の project でも、鍵の形で道具を選んで読む。
import type { Context } from '../context.ts';
import { TpmError } from '../skill-sets.ts';
import { GithubTracker } from '../tracker/github.ts';
import { JiraTracker } from '../tracker/jira.ts';
import type { Tracker, TrackerComment } from '../tracker/types.ts';

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

/** 課題の題・状態・本文・コメントを出す。 */
export function issueView(ctx: Context, key: string): string[] {
  const tracker = issueTracker(ctx, key);
  if (tracker === undefined) {
    throw new TpmError(`${key} は課題管理の課題の鍵ではありません（Jira は SKILLS-12、GitHub の Issue は gh-12 の形）。t- の鍵の課題の中身は依頼書にあります`);
  }
  let issue;
  try {
    issue = tracker.view(key);
  }
  catch (e) {
    if (!(e instanceof TpmError)) throw e;
    throw new TpmError(`${e.message}\n鍵が正しいかと、認証を ${authCheck(tracker)} で確かめてください。認証が無ければ、tpm ask tpm で Product Manager に login を頼んでください`);
  }
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
