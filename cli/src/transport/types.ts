// 連携の口。担当どうしがメッセージを送り、担当を起こし、状態を見せるための道具（cmux など）を、この形で包む。
// 決まり（見出し・順番・名簿）はこの上の層が持ち、ここは道具の言葉を知らない。

/** 動いている担当の居場所。address はメッセージの宛先で、道具ごとの形の字（cmux なら workspace:12）。 */
export interface Seat {
  address: string
  title: string
}

/** 送ったメッセージ。delivered は、相手に届いたところまで見られたか。 */
export interface Delivery {
  id: string
  delivered: boolean
}

/** 自分宛てのメッセージ。 */
export interface Incoming {
  id: string
  from: string
  text: string
}

/** メッセージ 1 件の、送った・届いた・読んだ時刻（道具が覚えている物。ISO の字）。 */
export interface MessageTrace {
  id: string
  sentAt?: string
  deliveredAt?: string
  readAt?: string
  /** 返事の先のメッセージの id。 */
  replyTo?: string
}

/** 居場所を作るときに渡す物。title は居場所の題、cwd は命令を動かす folder。 */
export interface SpawnOptions {
  title: string
  cwd: string
  /** 居場所で動かす命令（sh の 1 行）。 */
  command: string
  /** 題の下に出す説明。 */
  description?: string
}

/** 居場所の題と説明。説明が無ければ、前の説明を消す。 */
export interface SeatLabel {
  title: string
  description?: string
}

/** サイドバーなどに出す状態の鍵。この 2 つだけを使う。 */
export type StatusKey = 'model' | 'wait';

/** 連携の口。道具ごとの adapter（`cmux.ts`・`file.ts`）がこの形を持つ。 */
export interface Transport {
  /** 自分の宛先。 */
  whoami(): string
  /** メッセージを送り、届いたかまで見る。replyTo は、返事の先のメッセージの id。 */
  send(to: string, from: string, text: string, replyTo?: string): Delivery
  /** 自分宛てで、まだ届いていないメッセージ（手を動かしている間は届かない道具がある）。 */
  pending(): Incoming[]
  /** 宛先に送り、まだ届いていないメッセージの id（送る前の検査が、自分の送った物の届きを見る）。 */
  queued(to: string): string[]
  /** 道具が覚えているメッセージの時刻（宛先を問わない。閉じた居場所の分も）。道具が持たない・読めないなら空。 */
  history(): MessageTrace[]
  /** 担当の居場所を作って命令を動かし、宛先を返す。 */
  spawn(options: SpawnOptions): string
  /** 今ある居場所の一覧。 */
  seats(): Seat[]
  /** 居場所が出している状態（鍵 → 字）。居場所が無ければ undefined。 */
  status(address: string): Record<string, string> | undefined
  /** 自分の居場所の題を替える。 */
  setTitle(title: string): void
  /** ほかの居場所の題と説明を替える（TPM 担当が、起こした席に新しい依頼書を渡すとき）。 */
  relabel(address: string, label: SeatLabel): void
  /** 居場所に色を付ける（cmux の色の名か #hex。サイドバーの帯）。 */
  setColor(address: string, color: string): void
  /** 自分の状態を出す。 */
  setStatus(key: StatusKey, text: string): void
  /** 居場所の画面の字（名乗らない訳を読む）。 */
  screen(address: string): string
  /** URL を自分の居場所で開いて人に見せる。 */
  show(url: string): void
  /** 居場所を閉じる。 */
  close(address: string): void
}
