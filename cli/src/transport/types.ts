// 連携の口。担当を起こし、状態を見せるための道具（cmux など）を、この形で包む。
// 口は居場所の口（SeatPort）だけ。担当どうしのメッセージは、配りの口（mailroom/。NATS JetStream）が運ぶ。
// 決まり（見出し・順番・名簿）はこの上の層が持ち、ここは道具の言葉を知らない。

/** 動いている担当の居場所。address は居場所の宛先で、道具ごとの形の字（cmux なら workspace:12）。 */
export interface Seat {
  address: string
  title: string
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

/** 居場所の口。担当の居場所を作り、題と状態を見せ、閉じる道具を、この形で包む。 */
export interface SeatPort {
  /** 自分の宛先。 */
  whoami(): string
  /** 担当の居場所を作って命令を動かし、宛先を返す。 */
  spawn(options: SpawnOptions): string
  /** 今ある居場所の一覧。 */
  seats(): Seat[]
  /** 居場所の uuid → 宛先（ref）と題。持たない道具（file）は無い。落ちた session の突き合わせが使う。 */
  seatsById?(): Map<string, Seat>
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

/** 連携の口（居場所の口だけ）。道具ごとの adapter（`cmux.ts`・`file.ts`）がこの形を持つ。 */
export type Transport = SeatPort;
