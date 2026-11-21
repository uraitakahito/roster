// GitHub の Issue の adapter（命令は gh）。repo は project の folder の repo。
import type { Exec } from '../exec.ts';
import { TpmError } from '../skill-sets.ts';
import { noteHead, type Note, type Tracker, type TrackerComment, type TrackerIssue } from './types.ts';

/** Key は gh-12（workspace の題や branch に使う形）。#12 と 12 も受ける。 */
const KEY = /^(?:gh-|#)?(\d+)$/i;

/** 記録を Markdown にする。段落は空行で分ける。 */
export function noteToMarkdown(note: Note): string {
  return [noteHead(note), ...note.links.map(l => `${l.label}: ${l.url}`), ...note.points].join('\n\n');
}

/** gh issue view --json が返すコメント 1 件。 */
interface GithubComment {
  id: string
  body: string
  author?: { login?: string }
  createdAt?: string
}

const toComment = (c: GithubComment): TrackerComment => ({
  id: c.id,
  text: c.body,
  ...(c.author?.login === undefined ? {} : { author: c.author.login }),
  ...(c.createdAt === undefined ? {} : { created: c.createdAt }),
});

/** GitHub の Issue を読み、記録を書く adapter。 */
export class GithubTracker implements Tracker {
  private readonly exec: Exec;
  private readonly project: string;

  /** project は、gh を打つ folder（その repo の Issue を見る）。 */
  constructor(exec: Exec, project: string) {
    this.exec = exec;
    this.project = project;
  }

  owns(key: string): boolean {
    return KEY.test(key);
  }

  view(key: string): TrackerIssue {
    const n = this.number(key);
    const view = JSON.parse(this.run(['view', n, '--json', 'title,state,url,body,comments'])) as {
      title?: string
      state?: string
      url?: string
      body?: string
      comments?: GithubComment[]
    };
    return {
      key: `gh-${n}`,
      tool: 'GitHub の Issue',
      title: view.title ?? '',
      status: view.state ?? '',
      ...(view.url === undefined ? {} : { url: view.url }),
      body: view.body ?? '',
      comments: (view.comments ?? []).map(toComment),
    };
  }

  comment(key: string, note: Note): void {
    this.run(['comment', this.number(key), '--body-file', '-'], noteToMarkdown(note));
  }

  close(key: string): void {
    // PR の本文に Closes #12 と書くと merge で勝手に閉じる。閉じるのは【dismiss】の後のここだけにする。
    this.run(['close', this.number(key), '--reason', 'completed']);
  }

  private number(key: string): string {
    const n = KEY.exec(key)?.[1];
    if (n === undefined) throw new TpmError(`GitHub の Issue の Key ではありません（gh-12 の形）: ${key}`);
    return n;
  }

  private run(args: string[], input?: string): string {
    const r = this.exec('gh', ['issue', ...args], { cwd: this.project, ...(input === undefined ? {} : { input }) });
    if (r.status !== 0) throw new TpmError(`gh issue ${args.join(' ')} が失敗しました（${r.status}）: ${(r.stderr || r.stdout).trim()}`);
    return r.stdout;
  }
}
