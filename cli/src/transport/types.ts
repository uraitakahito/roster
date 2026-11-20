// 連携の口。担当どうしが知らせを送り、担当を起こし、状態を見せるための道具（cmux など）を、この形で包む。
// 決まり（見出し・順番・名簿）はこの上の層が持ち、ここは道具の言葉を知らない。

/** 動いている担当の居場所。address は知らせの宛先で、道具ごとの形の字（cmux なら workspace:12）。 */
export interface Seat {
  address: string
  title: string
}

/** 送った知らせ。delivered は、相手に届いたところまで見られたか。 */
export interface Delivery {
  id: string
  delivered: boolean
}

export interface SpawnOptions {
  title: string
  cwd: string
  /** 居場所で動かす命令（sh の 1 行）。 */
  command: string
}

/** サイドバーなどに出す状態の鍵。この 2 つだけを使う。 */
export type StatusKey = 'model' | 'wait';

export interface Transport {
  /** 自分の宛先。 */
  whoami(): string
  /** 知らせを送り、届いたかまで見る。replyTo は、返事の先の知らせの id。 */
  send(to: string, from: string, text: string, replyTo?: string): Delivery
  /** 担当の居場所を作って命令を動かし、宛先を返す。 */
  spawn(options: SpawnOptions): string
  /** 今ある居場所の一覧。 */
  seats(): Seat[]
  /** 居場所が出している状態（鍵 → 字）。居場所が無ければ undefined。 */
  status(address: string): Record<string, string> | undefined
  /** 自分の居場所の題を替える。 */
  setTitle(title: string): void
  /** 自分の状態を出す。 */
  setStatus(key: StatusKey, text: string): void
  /** 居場所の画面の字（起きない訳を読む）。 */
  screen(address: string): string
  /** URL を自分の居場所で開いて人に見せる。 */
  show(url: string): void
  /** 居場所を閉じる。 */
  close(address: string): void
}
