// 課題管理の口。課題を読む（題・状態・本文・コメント）・課題に記録（コメント）を書く・課題を閉じる、の 3 つを、道具（Jira・GitHub の Issue）ごとの形に写す。
// 誰が・いつ・どの種類を書くかは、この上の層（決まり）が持つ。

/** 記録の種類（1 行目の【】の中）。 */
export const NOTE_KINDS = ['提案', '計画', '結果', '監査', 'レビュー', '文書の修正', '確認', '決定'] as const;
/** 記録の種類の 1 つ。 */
export type NoteKind = typeof NOTE_KINDS[number];

/** 記録に載せるリンク 1 つ（`label: URL` の 1 段落になる）。 */
export interface NoteLink {
  label: string
  url: string
}

/**
 * 記録 1 件。1 行目は`【<種類>】<担当>: <一言>`。続けてリンク（label: URL）、要点（1 点 1 段落・3 つまで）。
 * 中身はページに書き、記録には写さない。
 */
export interface Note {
  kind: NoteKind
  /** 書いた担当（Software Engineer・TPM・DevOps Engineer）。書き手のアカウントはいつも Product Manager なので、字で書く。 */
  role: string
  summary: string
  links: NoteLink[]
  points: string[]
}

/** 課題から読んだコメント 1 件（view が返す）。 */
export interface TrackerComment {
  id: string
  /** 段落を改行でつないだ字。 */
  text: string
  /** 書いた人（読めたときだけ）。 */
  author?: string
  /** 書いた時刻（道具が返す字のまま）。 */
  created?: string
}

/** 課題 1 件の中身（roster issue view が出す）。 */
export interface TrackerIssue {
  key: string
  /** 道具の名（Jira・GitHub の Issue）。 */
  tool: string
  title: string
  status: string
  /** 課題のページ（道具が返すときだけ）。 */
  url?: string
  /** 本文。段落を改行でつないだ字。 */
  body: string
  comments: TrackerComment[]
}

/** 課題管理の口。道具ごとの adapter（`jira.ts`・`github.ts`）と、Key の形でそれを選ぶ `routed.ts` がこの形を持つ。 */
export interface Tracker {
  /** この道具の課題の Key か。 */
  owns(key: string): boolean
  /** 課題の題・状態・本文・コメントを読む。 */
  view(key: string): TrackerIssue
  /** 課題に記録を 1 件書く。 */
  comment(key: string, note: Note): void
  /** 課題を済みにする。 */
  close(key: string): void
}

/** 要点の数の上限。 */
export const MAX_POINTS = 3;

/** 記録の 1 行目。 */
export const noteHead = (note: Note): string => `【${note.kind}】${note.role}: ${note.summary}`;
