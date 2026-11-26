// 配りの口。メッセージを預かり、受け手ごとに配る段取り（取り置き・渡せたの確かめ・渡し直し・上限・期限）を持つ道具を、この形で包む。
// 段取りそのものは道具（NATS JetStream など）が持ち、ここは道具の言葉（stream・consumer）を知らない。
// 受け手に本文を渡す（Claude Code の文脈に入れる）のと、いつ止めるかの決まりは、この上の層が持つ。

/** 受け手の名（名簿の課題の Key と、起こした回の組から作る字）。道具の宛名と取り口の名になるので、英数字と `_` と `-` を 64 字まで。 */
export type Recipient = string;

/** 置くメッセージ。id は置く側が決める（同じ id を、重なり除けの窓の内に置き直しても 1 通になる）。 */
export interface Letter {
  id: string
  /** 送り手の名（居場所の題）。 */
  from: string
  to: Recipient
  text: string
  /** 返事の先のメッセージの id。 */
  replyTo?: string
}

/** 預かったメッセージ。at は道具が預かった時刻（ISO の字）。 */
export interface Stored extends Letter {
  at: string
}

/**
 * 取り置いたメッセージ。deliveries は、道具が受け手の口に渡した回数（1 が初めて）。
 * 口が渡さずに返した回（giveBack・close・1 度に取る字の上限に入りきらずに返した回）も数える（道具がそう数える）ので、
 * 2 より上でも、受け手に本文を出したとは限らない。渡し直しの上限（maxDeliveries）も、この数で数える。
 */
export interface Taken extends Stored {
  deliveries: number
}

/** 受け手の箱の数。waiting はまだ渡していない物、held は取り置き中（渡して、渡せたの返事を待っている）の物。 */
export interface Counts {
  waiting: number
  held: number
}

/** 1 度に取る量の上限。max は通数、chars は本文の字の合わせた数（頭の 1 通は、chars を超えていても取る）。 */
export interface TakeLimit {
  max: number
  chars: number
}

/** 渡し直しの上限を超えたメッセージ。stored は、道具にまだ残っていた時の中身（期限で先に消えていれば無い）。 */
export interface Undeliverable {
  to: Recipient
  deliveries: number
  /** 上限を超えた時刻（ISO の字）。 */
  at: string
  stored?: Stored
}

/** 配りの段取りの値（道具の設定になる）。時間はミリ秒。 */
export interface MailroomLimits {
  /** 取り置きの長さ（渡せたの返事を待つ長さ）。過ぎると、もう 1 度渡す。 */
  holdMs: number
  /** 渡す回数の上限。超えた物は渡すのをやめ、undeliverable() で引ける。 */
  maxDeliveries: number
  /** 届かないまま残った物を消すまでの長さ。 */
  undeliveredTtlMs: number
  /** 預かった物の記録と、上限を超えた知らせを残す長さ。 */
  recordTtlMs: number
  /** 重なり除けの窓（同じ id の置き直しを 1 通にする長さ）。 */
  duplicateWindowMs: number
  /** 1 つの受け手に、1 度に取り置ける通数。 */
  maxHeld: number
}

/** 段取りの値の既定（plan-4 の期限の表。T1・T2・T3・N2・N3）。 */
export const MAILROOM_LIMITS: MailroomLimits = {
  holdMs: 30_000,
  maxDeliveries: 5,
  undeliveredTtlMs: 72 * 60 * 60 * 1000,
  recordTtlMs: 30 * 24 * 60 * 60 * 1000,
  duplicateWindowMs: 2 * 60 * 1000,
  maxHeld: 20,
};

/** 配りの口。道具ごとの adapter（`nats.ts`。試験用は `memory.ts`）がこの形を持つ。 */
export interface Mailroom {
  /** メッセージを預ける。同じ id を窓の内に置き直した時は、duplicate が true（1 通のまま）。 */
  put(letter: Letter): Promise<{ duplicate: boolean }>
  /** 受け手の箱の数（まだ渡していない物と、取り置き中の物）。受け手の取り口が無ければ作る。 */
  counts(to: Recipient): Promise<Counts>
  /** 今ある物を、古い順に取り置いて返す（待たない）。無ければ空。 */
  take(to: Recipient, limit: TakeLimit): Promise<Taken[]>
  /** 来るまで ms 待ち、来たら取り置いて返す。来なければ空。 */
  wait(to: Recipient, limit: TakeLimit, ms: number): Promise<Taken[]>
  /** 取り置いた物を「渡せた」と返す（箱から外れる）。同じ口（同じ process）で取った物だけを受ける。 */
  done(taken: Taken[]): Promise<void>
  /** 取り置いた物を、渡さずに返す（すぐ取り直せる）。同じ口で取った物だけを受ける。 */
  giveBack(taken: Taken[]): Promise<void>
  /** 渡し直しの上限を超えた物を引き、配る箱から片付ける（1 度引いた物は、次には出ない）。 */
  undeliverable(): Promise<Undeliverable[]>
  /** 受け手を片付ける: 取り口を消し、箱に残っていた物を消して返す。 */
  clear(to: Recipient): Promise<Stored[]>
  /** 取り口のある受け手の名。 */
  recipients(): Promise<Recipient[]>
  /** 預かった物の記録（since 以後。古い順）。届いた物も、届かなかった物も入る。 */
  record(since: Date): Promise<Stored[]>
  /** まだ届いていない物（配る箱に残っている物）の id。 */
  outstanding(): Promise<Set<string>>
  /** 預かった物のうち、まだ配る箱に写されていない通数（0 なら、数える・取るが置いた物をみな見ている）。 */
  lag(): Promise<number>
  /** 道具との繋ぎを閉じる。 */
  close(): Promise<void>
}
