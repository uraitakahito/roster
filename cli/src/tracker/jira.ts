// Jira の adapter（命令は acli）。
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Exec } from '../exec.ts';
import { TpmError } from '../skill-sets.ts';
import { adfToText, noteToAdf } from './adf.ts';
import type { Note, Tracker, TrackerComment, TrackerIssue } from './types.ts';

/** 課題を済みにするときの状態の名前。 */
const DONE_STATUS = '完了';

/** view が返すコメント 1 件。 */
interface JiraComment {
  id: string
  body: unknown
  author?: { displayName?: string }
  created?: string
}

/** view の JSON（読む欄だけ）。 */
interface JiraView {
  key?: string
  fields?: {
    summary?: string
    status?: { name?: string }
    description?: unknown
    comment?: { comments?: JiraComment[] }
  }
}

const toComment = (c: JiraComment): TrackerComment => ({
  id: c.id,
  text: adfToText(c.body),
  ...(c.author?.displayName === undefined ? {} : { author: c.author.displayName }),
  ...(c.created === undefined ? {} : { created: c.created }),
});

/** Jira の課題を読み、記録を書く adapter。 */
export class JiraTracker implements Tracker {
  private readonly exec: Exec;

  constructor(exec: Exec) {
    this.exec = exec;
  }

  owns(key: string): boolean {
    return /^[A-Z][A-Z0-9]+-\d+$/.test(key);
  }

  view(key: string): TrackerIssue {
    // comment list は ADF を平らな字にしてリンクを落とすので使わない。view が ADF をそのまま返す。
    const view = JSON.parse(this.run(['view', key, '--fields', 'summary,status,description,comment', '--json'])) as JiraView;
    return {
      key: view.key ?? key,
      tool: 'Jira',
      title: view.fields?.summary ?? '',
      status: view.fields?.status?.name ?? '',
      body: adfToText(view.fields?.description),
      comments: (view.fields?.comment?.comments ?? []).map(toComment),
    };
  }

  comment(key: string, note: Note): void {
    // acli は ADF をファイルから読む。
    const dir = mkdtempSync(join(tmpdir(), 'tpm-jira-'));
    try {
      const file = join(dir, 'comment.json');
      writeFileSync(file, JSON.stringify(noteToAdf(note)));
      this.run(['comment', 'create', '--key', key, '--body-file', file]);
    }
    finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  comments(key: string): TrackerComment[] {
    // comment list は ADF を平らな字にしてリンクを落とすので使わない。view が ADF をそのまま返す。
    const out = this.run(['view', key, '--fields', 'comment', '--json']);
    return ((JSON.parse(out) as JiraView).fields?.comment?.comments ?? []).map(toComment);
  }

  close(key: string): void {
    this.run(['transition', '--key', key, '--status', DONE_STATUS, '--yes']);
  }

  private run(args: string[]): string {
    const r = this.exec('acli', ['jira', 'workitem', ...args]);
    if (r.status !== 0) throw new TpmError(`acli jira workitem ${args.join(' ')} が失敗しました（${r.status}）: ${(r.stderr || r.stdout).trim()}`);
    return r.stdout;
  }
}
