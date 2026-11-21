// 課題管理への書き込みを、状態の folder の tracker.jsonl に残す包み。
// 課題管理の側の履歴は、人も担当も同じ account で書くので、誰の手かが分からない。tpm が書いた物はここに残る（残っていなければ、tpm の手ではない）。
import type { State } from '../state.ts';
import type { Note, NoteKind, Tracker, TrackerIssue } from './types.ts';

/** 課題管理への書き込み 1 件（tracker.jsonl）。 */
export interface TrackerWrite {
  at: string
  /** 打った担当の課題の Key（TPM 担当は tpm）。 */
  by: string
  role: string
  /** 書いた先の課題。 */
  issue: string
  op: 'comment' | 'close'
  /** 記録の種類（comment のとき）。 */
  kind?: NoteKind
  /** 道具の命令が通ったか。 */
  ok: boolean
  error?: string
}

/** 中の課題管理にそのまま渡し、書き込み（comment・close）だけを tracker.jsonl に残す。読む命令は残さない。 */
export class RecordedTracker implements Tracker {
  private readonly inner: Tracker;
  private readonly state: State;
  private readonly who: { by: string, role: string };
  private readonly now: () => Date;

  /** who は打った担当（evidence.ts の actor）。 */
  constructor(inner: Tracker, state: State, who: { by: string, role: string }, now: () => Date = () => new Date()) {
    this.inner = inner;
    this.state = state;
    this.who = who;
    this.now = now;
  }

  owns(key: string): boolean {
    return this.inner.owns(key);
  }

  view(key: string): TrackerIssue {
    return this.inner.view(key);
  }

  comment(key: string, note: Note): void {
    this.write({ issue: key, op: 'comment', kind: note.kind }, () => this.inner.comment(key, note));
  }

  close(key: string): void {
    this.write({ issue: key, op: 'close' }, () => this.inner.close(key));
  }

  /** 書き込みを打ち、通っても失敗しても 1 行残す（失敗は残してから投げ直す）。 */
  private write(what: Pick<TrackerWrite, 'issue' | 'op' | 'kind'>, run: () => void): void {
    const entry = { at: this.now().toISOString(), ...this.who, ...what };
    try {
      run();
    }
    catch (e) {
      this.state.append('tracker.jsonl', { ...entry, ok: false, error: (e as Error).message } satisfies TrackerWrite);
      throw e;
    }
    this.state.append('tracker.jsonl', { ...entry, ok: true } satisfies TrackerWrite);
  }
}
