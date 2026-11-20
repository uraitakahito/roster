// Jira の adapter（命令は acli）。
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Exec } from '../exec.ts';
import { TpmError } from '../skill-sets.ts';
import { adfToText, noteToAdf } from './adf.ts';
import type { Note, Tracker, TrackerComment } from './types.ts';

/** 課題を済みにするときの状態の名前。 */
const DONE_STATUS = '完了';

/** Jira の課題に記録を書く adapter。 */
export class JiraTracker implements Tracker {
  private readonly exec: Exec;

  constructor(exec: Exec) {
    this.exec = exec;
  }

  owns(key: string): boolean {
    return /^[A-Z][A-Z0-9]+-\d+$/.test(key);
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
    const view = JSON.parse(out) as { fields?: { comment?: { comments?: { id: string, body: unknown }[] } } };
    return (view.fields?.comment?.comments ?? []).map(c => ({ id: c.id, text: adfToText(c.body) }));
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
