// 課題管理の口。課題に記録（コメント）を書く・読む・課題を閉じる、の 3 つを、道具（Jira・GitHub の Issue）ごとの形に写す。
// 誰が・いつ・どの種類を書くかは、この上の層（決まり）が持つ。

/** 記録の種類（1 行目の【】の中）。 */
export const NOTE_KINDS = ['提案', '計画', '結果', '文書の修正', '確認', '決定'] as const;
export type NoteKind = typeof NOTE_KINDS[number];

export interface NoteLink {
  label: string
  url: string
}

/**
 * 記録 1 件。1 行目は`【<種類>】<担当>: <一言>`。続けてリンク（label: URL）、要点（1 点 1 段落・3 つまで）。
 * 中身は Artifact に書き、記録には写さない。
 */
export interface Note {
  kind: NoteKind
  /** 書いた担当（Software Engineer・TPM・DevOps Engineer）。書き手のアカウントはいつも Product Manager なので、字で書く。 */
  role: string
  summary: string
  links: NoteLink[]
  points: string[]
}

export interface TrackerComment {
  id: string
  /** 段落を改行でつないだ字。 */
  text: string
}

export interface Tracker {
  /** この道具の課題の鍵か。 */
  owns(key: string): boolean
  comment(key: string, note: Note): void
  comments(key: string): TrackerComment[]
  /** 課題を済みにする。 */
  close(key: string): void
}

/** 要点の数の上限。 */
export const MAX_POINTS = 3;

/** 記録の 1 行目。 */
export const noteHead = (note: Note): string => `【${note.kind}】${note.role}: ${note.summary}`;
