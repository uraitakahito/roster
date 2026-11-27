// smithy-typescript generated code
/**
 * Describes one specific validation failure for an input member.
 * @public
 */
export interface ValidationExceptionField {
  /**
   * A JSONPointer expression to the structure member whose value failed to satisfy the modeled constraints.
   * @public
   */
  path: string | undefined;

  /**
   * A detailed description of the validation failure.
   * @public
   */
  message: string | undefined;
}

/**
 * アクターを指す時の短い形。
 * @public
 */
export interface ActorSummary {
  /**
   * アクターの id（castlist が出す UUID v7 の字。小文字の 16 進）。
   * @public
   */
  id: string | undefined;

  /**
   * `<接頭辞>.<番号>`（番号は出し手と接頭辞ごとに 1 から）。
   * @public
   */
  name: string | undefined;

  /**
   * アクターの種類: `ai` か `human`。
   * enum にしないのは、smithy-rs（codegen-server 0.1.40）が、答えに要る enum のある操作の要求の例（`@httpRequestTests`）から、
   * 空の字の enum を作って落ちる試験を作るため。wire の形は enum と同じ字。ただし smithy diff は、string から enum への型の替えを
   * 壊す変わり（ERROR。ChangedShapeType）とする（2026-11-24 に確かめた）ので、enum に替えるなら v1.0.0 を出す前にする。
   * @public
   */
  kind: string | undefined;
}

/**
 * @public
 */
export interface AddReviewMarksInput {
  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  project: string | undefined;

  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  key: string | undefined;

  /**
   * 種類と役割の名: 英小文字で始まり、英小文字・数字・`-` で 32 字まで。
   * @public
   */
  kind: string | undefined;

  /**
   * ページの番号（種類ごと）と file の番号（語と拡張子ごと）。id なので数の字にする: 頭に 0 の無い 1 以上の数（18 桁まで）。
   * @public
   */
  n: string | undefined;

  /**
   * レビューの判定（種類が `review` のページだけ）。
   * @public
   */
  verdict?: string | undefined;

  /**
   * 見た物・見てほしい物（足すだけ）。
   * @public
   */
  targets?: string[] | undefined;
}

/**
 * 送り手の記録: 置いた時の付随する id と、castlist の答え（置いた時の物。後から書き換えない）。
 * @public
 */
export interface Sender {
  /**
   * 付随する id を出した物。
   * @public
   */
  issuer: string | undefined;

  /**
   * 付随する id。
   * @public
   */
  ref: string | undefined;

  /**
   * castlist が答えたアクター。castlist の無い pagetray が置いた物には無い。
   * @public
   */
  actor?: ActorSummary | undefined;

  /**
   * castlist が答えた時刻（答えの `asOf`）。`actor` と一緒にだけある。
   * @public
   */
  resolvedAt?: Date | undefined;
}

/**
 * ページの記録の欄（本文は入らない）。
 * @public
 */
export interface AddReviewMarksOutput {
  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  project: string | undefined;

  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  key: string | undefined;

  /**
   * 種類と役割の名: 英小文字で始まり、英小文字・数字・`-` で 32 字まで。
   * @public
   */
  kind: string | undefined;

  /**
   * ページの番号（種類ごと）と file の番号（語と拡張子ごと）。id なので数の字にする: 頭に 0 の無い 1 以上の数（18 桁まで）。
   * @public
   */
  n: string | undefined;

  /**
   * 本文の初めの `<title>`（文字参照を戻し、空白を 1 つにまとめる）。無ければ空。
   * @public
   */
  title: string | undefined;

  /**
   * 種類と役割の名: 英小文字で始まり、英小文字・数字・`-` で 32 字まで。
   * @public
   */
  role: string | undefined;

  /**
   * workspace の ID: 英数字と `:`・`.`・`_`・`-` で 64 字まで（空でもよい）。
   * @public
   */
  workspace: string | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  createdAt: Date | undefined;

  /**
   * 本文の byte の数。
   * @public
   */
  size: number | undefined;

  /**
   * この server の中の path（`/<project>/<key>/<kind>-<n>.html`）。
   * @public
   */
  path: string | undefined;

  /**
   * 送り手。付随する id を書いて置いた時だけ。
   * @public
   */
  sender?: Sender | undefined;

  /**
   * 返事待ちにした時刻。返事を求めていなければ無い。
   * @public
   */
  askedAt?: Date | undefined;

  /**
   * 答えた時刻。まだ答えていなければ無い。
   * @public
   */
  answeredAt?: Date | undefined;

  /**
   * 誰の返事を待つか（`review`・`tpm`）。Product Manager を待つ・返事を求めていないページには無い。
   * @public
   */
  waitsOn?: string | undefined;

  /**
   * レビューの判定。書いていなければ無い。
   * @public
   */
  verdict?: string | undefined;

  /**
   * 見た物・見てほしい物（書いた順）。無ければ欄が無い。
   * @public
   */
  targets?: string[] | undefined;
}

/**
 * @public
 */
export interface CreateFileInput {
  /**
   * 状態の folder の名。`api`・`.`・`..` は置けない（server が 400）。
   * @public
   */
  project: string | undefined;

  /**
   * Key。`.`・`..` は置けない（server が 400）。
   * @public
   */
  key: string | undefined;

  /**
   * `<語>.<拡張子>`。番号は server が付ける。受ける拡張子かは server が見る（ほかは 415）。
   * @public
   */
  name: string | undefined;

  /**
   * 置いた担当の役割。一覧の UI から上げる時のほかは要る（無ければ server が 400）。
   * @public
   */
  role?: string | undefined;

  /**
   * 置いた担当の workspace の ID（無ければ空）。
   * @public
   */
  workspace?: string | undefined;

  /**
   * 取り込みの時だけ: 番号。無ければ server が決める。
   * @public
   */
  n?: string | undefined;

  /**
   * 取り込みの時だけ: 置いた時刻（UTC・ミリ秒まで）。無ければ pagetray の今。
   * @public
   */
  createdAt?: Date | undefined;

  /**
   * 付随する id を出した物（`actorRef` と組。片方だけは 400）。
   * @public
   */
  actorIssuer?: string | undefined;

  /**
   * 付随する id（`種類:値`。`actorIssuer` と組。片方だけは 400）。
   * @public
   */
  actorRef?: string | undefined;

  /**
   * 中身の種類。拡張子の種類と同じ物（`;` の後ろと大小は問わない）。
   * @public
   */
  contentType: string | undefined;

  /**
   * file の中身（空は 400。16 MiB まで）。
   * @public
   */
  body: Uint8Array | undefined;
}

/**
 * file の記録の欄（中身は入らない）。
 * @public
 */
export interface CreateFileOutput {
  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  project: string | undefined;

  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  key: string | undefined;

  /**
   * 名の語（`screen`）。
   * @public
   */
  name: string | undefined;

  /**
   * 拡張子（`png`）。
   * @public
   */
  ext: string | undefined;

  /**
   * ページの番号（種類ごと）と file の番号（語と拡張子ごと）。id なので数の字にする: 頭に 0 の無い 1 以上の数（18 桁まで）。
   * @public
   */
  n: string | undefined;

  /**
   * 返す時の `Content-Type`（拡張子から決まる。字の file は `; charset=utf-8` 付き）。
   * @public
   */
  type: string | undefined;

  /**
   * 中身の byte の数。
   * @public
   */
  size: number | undefined;

  /**
   * 中身の SHA-256（16 進の小文字）。
   * @public
   */
  sha256: string | undefined;

  /**
   * 種類と役割の名: 英小文字で始まり、英小文字・数字・`-` で 32 字まで。
   * @public
   */
  role: string | undefined;

  /**
   * workspace の ID: 英数字と `:`・`.`・`_`・`-` で 64 字まで（空でもよい）。
   * @public
   */
  workspace: string | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  createdAt: Date | undefined;

  /**
   * この server の中の path（`/<project>/<key>/files/<語>-<n>.<拡張子>`）。
   * @public
   */
  path: string | undefined;

  /**
   * 送り手。付随する id を書いて置いた時だけ。
   * @public
   */
  sender?: Sender | undefined;

  /**
   * 要求の `Host` で組んだ、file の URL。
   * @public
   */
  url: string | undefined;

  /**
   * `url` と同じ。
   * @public
   */
  location: string | undefined;
}

/**
 * @public
 */
export interface CreatePageInput {
  /**
   * 状態の folder の名（URL の 1 段目）。`api`・`.`・`..` は置けない（server が 400）。
   * @public
   */
  project: string | undefined;

  /**
   * Key（課題の名）。`.`・`..` は置けない（server が 400）。
   * @public
   */
  key: string | undefined;

  /**
   * 種類（brief・confirm・plan …。名の一覧は持たない）。
   * @public
   */
  kind: string | undefined;

  /**
   * 置いた担当の役割。
   * @public
   */
  role: string | undefined;

  /**
   * 置いた担当の workspace の ID（無ければ空）。
   * @public
   */
  workspace?: string | undefined;

  /**
   * 取り込みの時だけ: 番号。無ければ server が決める。
   * @public
   */
  n?: string | undefined;

  /**
   * 取り込みの時だけ: 置いた時刻（UTC・ミリ秒まで）。無ければ pagetray の今。
   * @public
   */
  createdAt?: Date | undefined;

  /**
   * 付随する id を出した物（`actorRef` と組。片方だけは 400）。
   * @public
   */
  actorIssuer?: string | undefined;

  /**
   * 付随する id（`種類:値`。`actorIssuer` と組。片方だけは 400）。
   * @public
   */
  actorRef?: string | undefined;

  /**
   * ページの HTML（空は 400）。UTF-8 でなくても受ける（題と検索の字は、読めない byte を置き換えて取る）。
   * @public
   */
  body: Uint8Array | undefined;
}

/**
 * ページの記録の欄（本文は入らない）。
 * @public
 */
export interface CreatePageOutput {
  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  project: string | undefined;

  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  key: string | undefined;

  /**
   * 種類と役割の名: 英小文字で始まり、英小文字・数字・`-` で 32 字まで。
   * @public
   */
  kind: string | undefined;

  /**
   * ページの番号（種類ごと）と file の番号（語と拡張子ごと）。id なので数の字にする: 頭に 0 の無い 1 以上の数（18 桁まで）。
   * @public
   */
  n: string | undefined;

  /**
   * 本文の初めの `<title>`（文字参照を戻し、空白を 1 つにまとめる）。無ければ空。
   * @public
   */
  title: string | undefined;

  /**
   * 種類と役割の名: 英小文字で始まり、英小文字・数字・`-` で 32 字まで。
   * @public
   */
  role: string | undefined;

  /**
   * workspace の ID: 英数字と `:`・`.`・`_`・`-` で 64 字まで（空でもよい）。
   * @public
   */
  workspace: string | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  createdAt: Date | undefined;

  /**
   * 本文の byte の数。
   * @public
   */
  size: number | undefined;

  /**
   * この server の中の path（`/<project>/<key>/<kind>-<n>.html`）。
   * @public
   */
  path: string | undefined;

  /**
   * 送り手。付随する id を書いて置いた時だけ。
   * @public
   */
  sender?: Sender | undefined;

  /**
   * 要求の `Host` で組んだ、ページの URL。
   * @public
   */
  url: string | undefined;

  /**
   * `url` と同じ。
   * @public
   */
  location: string | undefined;
}

/**
 * @public
 */
export interface DeleteFilesInput {
  /**
   * `.`・`..` は 400（server）。
   * @public
   */
  project: string | undefined;

  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  key?: string | undefined;

  /**
   * `<語>.<拡張子>`。
   * @public
   */
  name?: string | undefined;

  /**
   * 1 つだけ消す時の番号（`key` と `name` が要る）。
   * @public
   */
  n?: string | undefined;
}

/**
 * @public
 */
export interface DeleteFilesOutput {
  /**
   * 消した file の path（`/<project>/<key>/files/<語>-<n>.<拡張子>`。置いた順）。
   * @public
   */
  removed: string[] | undefined;
}

/**
 * @public
 */
export interface DeletePagesInput {
  /**
   * `.`・`..` は 400（server）。
   * @public
   */
  project: string | undefined;

  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  key?: string | undefined;

  /**
   * 種類と役割の名: 英小文字で始まり、英小文字・数字・`-` で 32 字まで。
   * @public
   */
  kind?: string | undefined;

  /**
   * 1 枚だけ消す時の番号（`key` と `kind` が要る）。
   * @public
   */
  n?: string | undefined;
}

/**
 * @public
 */
export interface DeletePagesOutput {
  /**
   * 消したページの path（`/<project>/<key>/<kind>-<n>.html`。置いた順）。
   * @public
   */
  removed: string[] | undefined;
}

/**
 * 絞り込みの候補 1 つ: 値と、その値の記録の数。
 * @public
 */
export interface FacetCount {
  value: string | undefined;
  count: number | undefined;
  /**
   * 値に添える字（送り手の名・workspace の Key）。ある時だけ（1.3.0 から）。
   * @public
   */
  note?: string | undefined;
}

/**
 * 一覧の file の記録（中身と url は入らない）。
 * @public
 */
export interface File {
  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  project: string | undefined;

  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  key: string | undefined;

  /**
   * 名の語（`screen`）。
   * @public
   */
  name: string | undefined;

  /**
   * 拡張子（`png`）。
   * @public
   */
  ext: string | undefined;

  /**
   * ページの番号（種類ごと）と file の番号（語と拡張子ごと）。id なので数の字にする: 頭に 0 の無い 1 以上の数（18 桁まで）。
   * @public
   */
  n: string | undefined;

  /**
   * 返す時の `Content-Type`（拡張子から決まる。字の file は `; charset=utf-8` 付き）。
   * @public
   */
  type: string | undefined;

  /**
   * 中身の byte の数。
   * @public
   */
  size: number | undefined;

  /**
   * 中身の SHA-256（16 進の小文字）。
   * @public
   */
  sha256: string | undefined;

  /**
   * 種類と役割の名: 英小文字で始まり、英小文字・数字・`-` で 32 字まで。
   * @public
   */
  role: string | undefined;

  /**
   * workspace の ID: 英数字と `:`・`.`・`_`・`-` で 64 字まで（空でもよい）。
   * @public
   */
  workspace: string | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  createdAt: Date | undefined;

  /**
   * この server の中の path（`/<project>/<key>/files/<語>-<n>.<拡張子>`）。
   * @public
   */
  path: string | undefined;

  /**
   * 送り手。付随する id を書いて置いた時だけ。
   * @public
   */
  sender?: Sender | undefined;
}

/**
 * 受ける file の種類 1 つ。
 * @public
 */
export interface FileType {
  /**
   * 拡張子（`.` は付けない）。
   * @public
   */
  ext: string | undefined;

  /**
   * その file を返す時の `Content-Type`。
   * @public
   */
  type: string | undefined;
}

/**
 * @public
 */
export interface GetFileRulesInput {}

/**
 * @public
 */
export interface GetFileRulesOutput {
  /**
   * 受ける拡張子と、その file を返す時の `Content-Type`。
   * @public
   */
  types: FileType[] | undefined;

  /**
   * file 1 つの大きさの上限（byte）。
   * @public
   */
  maxBytes: number | undefined;
}

/**
 * @public
 */
export interface GetHealthInput {}

/**
 * @public
 */
export interface GetHealthOutput {
  /**
   * いつも `ok`。
   * @public
   */
  status: string | undefined;

  /**
   * pagetray の版。
   * @public
   */
  version: string | undefined;
}

/**
 * @public
 */
export interface GetMessageFacetsInput {
  /**
   * 今絞っている受け手の名（絞らない。候補に必ず入れる値）。
   * @public
   */
  to?: string | undefined;

  /**
   * 今絞っている送り手の名（絞らない。候補に必ず入れる値）。
   * @public
   */
  from?: string | undefined;

  /**
   * 今絞っている Key（絞らない。候補に必ず入れる値）。
   * @public
   */
  key?: string | undefined;
}

/**
 * @public
 */
export interface GetMessageFacetsOutput {
  /**
   * 状態（`MessageState` の字）ごとの数。
   * @public
   */
  states: FacetCount[] | undefined;

  /**
   * 受け手の名ごとの数。
   * @public
   */
  to: FacetCount[] | undefined;

  /**
   * 送り手の名ごとの数。
   * @public
   */
  from: FacetCount[] | undefined;

  /**
   * Key ごとの数。
   * @public
   */
  keys: FacetCount[] | undefined;

  /**
   * project ごとの数。
   * @public
   */
  projects: FacetCount[] | undefined;
}

/**
 * @public
 */
export interface GetPageFacetsInput {}

/**
 * @public
 */
export interface GetPageFacetsOutput {
  /**
   * Product Manager の返事待ちのページの数。
   * @public
   */
  waiting: number | undefined;

  /**
   * Product Manager が答えたページの数。
   * @public
   */
  answered: number | undefined;

  /**
   * レビュー待ちのページ（レビューの依頼書）の数。
   * @public
   */
  reviewWaiting: number | undefined;

  /**
   * TPM 担当に上げて、まだ決まっていないページ（レビューのページ）の数。
   * @public
   */
  escalated: number | undefined;

  /**
   * 送り手（castlist のアクター）ごとの数。
   * @public
   */
  senders: FacetCount[] | undefined;

  /**
   * 役割ごとの数。
   * @public
   */
  roles: FacetCount[] | undefined;

  /**
   * workspace の ID ごとの数。
   * @public
   */
  workspaces: FacetCount[] | undefined;

  /**
   * 種類ごとの数。
   * @public
   */
  kinds: FacetCount[] | undefined;

  /**
   * Key ごとの数。
   * @public
   */
  keys: FacetCount[] | undefined;

  /**
   * project ごとの数。
   * @public
   */
  projects: FacetCount[] | undefined;

  /**
   * レビューの判定ごとの数。
   * @public
   */
  verdicts: FacetCount[] | undefined;
}

/**
 * @public
 */
export interface ListFilesInput {
  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  project?: string | undefined;

  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  key?: string | undefined;

  /**
   * 種類と役割の名: 英小文字で始まり、英小文字・数字・`-` で 32 字まで。
   * @public
   */
  role?: string | undefined;

  /**
   * 空（`workspace=`）も条件: workspace を書かずに置いた file（一覧の UI から上げた物も）。
   * @public
   */
  workspace?: string | undefined;

  /**
   * 名（`<語>.<拡張子>`）に含まれる字（大小を問わない）。
   * @public
   */
  q?: string | undefined;

  /**
   * 送り手の castlist のアクターの id。
   * @public
   */
  actor?: string | undefined;

  /**
   * `-createdAt`（新しい順。既定）か `createdAt`（古い順）。同じ時刻は置いた順。
   * @public
   */
  sort?: string | undefined;

  /**
   * 1 頁の数（既定 100）。
   * @public
   */
  maxResults?: number | undefined;

  /**
   * 前の答えの `nextToken`。
   * @public
   */
  nextToken?: string | undefined;
}

/**
 * @public
 */
export interface ListFilesOutput {
  files: File[] | undefined;
  /**
   * 次の頁の印。終わりなら無い。
   * @public
   */
  nextToken?: string | undefined;
}

/**
 * @public
 */
export interface ListMessagesInput {
  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  project?: string | undefined;

  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  key?: string | undefined;

  /**
   * 受け手の名（同じ値の物）。
   * @public
   */
  to?: string | undefined;

  /**
   * 送り手の名（同じ値の物）。
   * @public
   */
  from?: string | undefined;

  /**
   * メッセージの状態: `waiting`（まだ届いていない）・`delivered`（届いた）・`undeliverable`（渡せない）・`expired`（期限切れ）・
   * `carried`（ほかの道具で運んだ）。
   * @public
   */
  state?: string | undefined;

  /**
   * メッセージの見出しの名: 英小文字で始まり、英小文字・数字・`-` で 32 字まで（名の一覧は持たない）。
   * @public
   */
  heading?: string | undefined;

  /**
   * 本文と `from`・`to` に含まれる字。
   * @public
   */
  q?: string | undefined;

  /**
   * `-sentAt`（新しい順。既定）か `sentAt`（古い順）。同じ時刻は置いた順（新しい順なら後に置いた物が先）。
   * @public
   */
  sort?: string | undefined;

  /**
   * 1 頁の数（既定 100）。
   * @public
   */
  maxResults?: number | undefined;

  /**
   * 前の答えの `nextToken`。
   * @public
   */
  nextToken?: string | undefined;
}

/**
 * 一覧のメッセージの記録。
 * @public
 */
export interface Message {
  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  project: string | undefined;

  /**
   * メッセージの id: 英数字と `.`・`_`・`-` で 128 字まで。
   * @public
   */
  id: string | undefined;

  /**
   * Key（課題の名）。書いて置いた時だけ。
   * @public
   */
  key?: string | undefined;

  /**
   * メッセージの見出しの名。
   * @public
   */
  heading: string | undefined;

  /**
   * 送り手の名。
   * @public
   */
  from: string | undefined;

  /**
   * 受け手の名。
   * @public
   */
  to: string | undefined;

  /**
   * 本文（字のまま）。
   * @public
   */
  text: string | undefined;

  /**
   * 送った時刻。
   * @public
   */
  sentAt: Date | undefined;

  /**
   * メッセージの状態: `waiting`（まだ届いていない）・`delivered`（届いた）・`undeliverable`（渡せない）・`expired`（期限切れ）・
   * `carried`（ほかの道具で運んだ）。
   * @public
   */
  state: string | undefined;

  /**
   * 届いた時刻（初めに書かれた物）。まだ無ければ無い。
   * @public
   */
  deliveredAt?: Date | undefined;

  /**
   * どの時に渡したかの名。書いていなければ無い。
   * @public
   */
  via?: string | undefined;

  /**
   * 受け手に本文を出した回数（呼ぶ側が数えて書く）。書いていなければ無い。
   * @public
   */
  deliveries?: number | undefined;

  /**
   * 返事の先のメッセージの id。書いて置いた時だけ。
   * @public
   */
  replyTo?: string | undefined;

  /**
   * pagetray が初めて受けた時刻。
   * @public
   */
  createdAt: Date | undefined;

  /**
   * 最後に書き足された時刻（置いただけなら `createdAt` と同じ）。
   * @public
   */
  updatedAt: Date | undefined;

  /**
   * 送り手（castlist で確かめた物）。「送った側」の書き込み（`waiting`・`carried`）に、付随する id を書いた時だけ。
   * @public
   */
  sender?: Sender | undefined;
}

/**
 * @public
 */
export interface ListMessagesOutput {
  messages: Message[] | undefined;
  /**
   * 次の頁の印。終わりなら無い。
   * @public
   */
  nextToken?: string | undefined;
}

/**
 * @public
 */
export interface ListPagesInput {
  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  project?: string | undefined;

  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  key?: string | undefined;

  /**
   * 種類と役割の名: 英小文字で始まり、英小文字・数字・`-` で 32 字まで。
   * @public
   */
  kind?: string | undefined;

  /**
   * 種類と役割の名: 英小文字で始まり、英小文字・数字・`-` で 32 字まで。
   * @public
   */
  role?: string | undefined;

  /**
   * 空（`workspace=`）も条件: workspace を書かずに置いたページ。
   * @public
   */
  workspace?: string | undefined;

  /**
   * 題と本文の字で探す語（空白で分ける）。
   * @public
   */
  q?: string | undefined;

  /**
   * 返事の状態: `waiting`（求めて、まだ答えていない）か `answered`（答えた）。
   * @public
   */
  reply?: string | undefined;

  /**
   * `reply` の待ちの相手（既定 `pm`）。`reply` と一緒にだけ書く。
   * @public
   */
  on?: string | undefined;

  /**
   * レビューの判定。
   * @public
   */
  verdict?: string | undefined;

  /**
   * 送り手の castlist のアクターの id。
   * @public
   */
  actor?: string | undefined;

  /**
   * `-createdAt`（新しい順。既定）か `createdAt`（古い順）。同じ時刻は置いた順（新しい順なら後に置いた物が先）。
   * @public
   */
  sort?: string | undefined;

  /**
   * 1 頁の数（既定 100）。
   * @public
   */
  maxResults?: number | undefined;

  /**
   * 前の答えの `nextToken`。
   * @public
   */
  nextToken?: string | undefined;
}

/**
 * 一覧のページの記録（本文と url は入らない）。
 * @public
 */
export interface Page {
  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  project: string | undefined;

  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  key: string | undefined;

  /**
   * 種類と役割の名: 英小文字で始まり、英小文字・数字・`-` で 32 字まで。
   * @public
   */
  kind: string | undefined;

  /**
   * ページの番号（種類ごと）と file の番号（語と拡張子ごと）。id なので数の字にする: 頭に 0 の無い 1 以上の数（18 桁まで）。
   * @public
   */
  n: string | undefined;

  /**
   * 本文の初めの `<title>`（文字参照を戻し、空白を 1 つにまとめる）。無ければ空。
   * @public
   */
  title: string | undefined;

  /**
   * 種類と役割の名: 英小文字で始まり、英小文字・数字・`-` で 32 字まで。
   * @public
   */
  role: string | undefined;

  /**
   * workspace の ID: 英数字と `:`・`.`・`_`・`-` で 64 字まで（空でもよい）。
   * @public
   */
  workspace: string | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  createdAt: Date | undefined;

  /**
   * 本文の byte の数。
   * @public
   */
  size: number | undefined;

  /**
   * この server の中の path（`/<project>/<key>/<kind>-<n>.html`）。
   * @public
   */
  path: string | undefined;

  /**
   * 送り手。付随する id を書いて置いた時だけ。
   * @public
   */
  sender?: Sender | undefined;

  /**
   * 返事待ちにした時刻。返事を求めていなければ無い。
   * @public
   */
  askedAt?: Date | undefined;

  /**
   * 答えた時刻。まだ答えていなければ無い。
   * @public
   */
  answeredAt?: Date | undefined;

  /**
   * 誰の返事を待つか（`review`・`tpm`）。Product Manager を待つ・返事を求めていないページには無い。
   * @public
   */
  waitsOn?: string | undefined;

  /**
   * レビューの判定。書いていなければ無い。
   * @public
   */
  verdict?: string | undefined;

  /**
   * 見た物・見てほしい物（書いた順）。無ければ欄が無い。
   * @public
   */
  targets?: string[] | undefined;
}

/**
 * @public
 */
export interface ListPagesOutput {
  pages: Page[] | undefined;
  /**
   * 次の頁の印。終わりなら無い。
   * @public
   */
  nextToken?: string | undefined;
}

/**
 * @public
 */
export interface ListReviewsInput {
  /**
   * 見られたページの path（`/<project>/<key>/<kind>-<n>.html`）。
   * @public
   */
  target: string[] | undefined;
}

/**
 * 見られたページと、それを見たレビューのページ。
 * @public
 */
export interface ReviewOf {
  /**
   * 見られたページの path。
   * @public
   */
  target: string | undefined;

  /**
   * レビューのページの path。
   * @public
   */
  path: string | undefined;

  /**
   * レビューの判定。書いていなければ無い。
   * @public
   */
  verdict?: string | undefined;
}

/**
 * @public
 */
export interface ListReviewsOutput {
  reviews: ReviewOf[] | undefined;
}

/**
 * @public
 */
export interface PutMessageInput {
  /**
   * 状態の folder の名（ページの project と同じ）。`api`・`.`・`..` は置けない（server が 400）。
   * @public
   */
  project: string | undefined;

  /**
   * メッセージの id（呼ぶ側が付ける。project の中で 1 つ）。`.`・`..` は置けない（server が 400）。
   * @public
   */
  id: string | undefined;

  /**
   * 付随する id を出した物（`actorRef` と組。片方だけは 400）。
   * @public
   */
  actorIssuer?: string | undefined;

  /**
   * 付随する id（`種類:値`。`actorIssuer` と組。片方だけは 400）。
   * @public
   */
  actorRef?: string | undefined;

  /**
   * Key（課題の名）。`.`・`..` は置けない（server が 400）。
   * @public
   */
  key?: string | undefined;

  /**
   * メッセージの見出しの名。
   * @public
   */
  heading: string | undefined;

  /**
   * 送り手の名。
   * @public
   */
  from: string | undefined;

  /**
   * 受け手の名。
   * @public
   */
  to: string | undefined;

  /**
   * 本文。字のまま持つ（HTML として解釈しない）。
   * @public
   */
  text: string | undefined;

  /**
   * 送った時刻（UTC・ミリ秒まで）。
   * @public
   */
  sentAt: Date | undefined;

  /**
   * 状態。書き足す時は、今の状態より強い時だけ替わる。
   * @public
   */
  state: string | undefined;

  /**
   * 届いた時刻（UTC・ミリ秒まで）。まだ無い時だけ入る。
   * @public
   */
  deliveredAt?: Date | undefined;

  /**
   * どの時に渡したかの名。
   * @public
   */
  via?: string | undefined;

  /**
   * 受け手に本文を出した回数（呼ぶ側が数えて書く）。書き足す時は、大きい方を保つ。
   * @public
   */
  deliveries?: number | undefined;

  /**
   * 返事の先のメッセージの id。
   * @public
   */
  replyTo?: string | undefined;
}

/**
 * メッセージの記録の欄。
 * @public
 */
export interface PutMessageOutput {
  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  project: string | undefined;

  /**
   * メッセージの id: 英数字と `.`・`_`・`-` で 128 字まで。
   * @public
   */
  id: string | undefined;

  /**
   * Key（課題の名）。書いて置いた時だけ。
   * @public
   */
  key?: string | undefined;

  /**
   * メッセージの見出しの名。
   * @public
   */
  heading: string | undefined;

  /**
   * 送り手の名。
   * @public
   */
  from: string | undefined;

  /**
   * 受け手の名。
   * @public
   */
  to: string | undefined;

  /**
   * 本文（字のまま）。
   * @public
   */
  text: string | undefined;

  /**
   * 送った時刻。
   * @public
   */
  sentAt: Date | undefined;

  /**
   * メッセージの状態: `waiting`（まだ届いていない）・`delivered`（届いた）・`undeliverable`（渡せない）・`expired`（期限切れ）・
   * `carried`（ほかの道具で運んだ）。
   * @public
   */
  state: string | undefined;

  /**
   * 届いた時刻（初めに書かれた物）。まだ無ければ無い。
   * @public
   */
  deliveredAt?: Date | undefined;

  /**
   * どの時に渡したかの名。書いていなければ無い。
   * @public
   */
  via?: string | undefined;

  /**
   * 受け手に本文を出した回数（呼ぶ側が数えて書く）。書いていなければ無い。
   * @public
   */
  deliveries?: number | undefined;

  /**
   * 返事の先のメッセージの id。書いて置いた時だけ。
   * @public
   */
  replyTo?: string | undefined;

  /**
   * pagetray が初めて受けた時刻。
   * @public
   */
  createdAt: Date | undefined;

  /**
   * 最後に書き足された時刻（置いただけなら `createdAt` と同じ）。
   * @public
   */
  updatedAt: Date | undefined;

  /**
   * 送り手（castlist で確かめた物）。「送った側」の書き込み（`waiting`・`carried`）に、付随する id を書いた時だけ。
   * @public
   */
  sender?: Sender | undefined;

  /**
   * 新しく作れば 201、もうある id に書き足せば 200。
   * @public
   */
  status: number | undefined;
}

/**
 * @public
 */
export interface SetReplyStateInput {
  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  project: string | undefined;

  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  key: string | undefined;

  /**
   * 種類と役割の名: 英小文字で始まり、英小文字・数字・`-` で 32 字まで。
   * @public
   */
  kind: string | undefined;

  /**
   * ページの番号（種類ごと）と file の番号（語と拡張子ごと）。id なので数の字にする: 頭に 0 の無い 1 以上の数（18 桁まで）。
   * @public
   */
  n: string | undefined;

  /**
   * `waiting`（返事を求める）か `answered`（答えた）。
   * @public
   */
  state: string | undefined;

  /**
   * 待ちの相手（既定 `pm`）。
   * @public
   */
  on?: string | undefined;
}

/**
 * ページの記録の欄（本文は入らない）。
 * @public
 */
export interface SetReplyStateOutput {
  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  project: string | undefined;

  /**
   * URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
   * @public
   */
  key: string | undefined;

  /**
   * 種類と役割の名: 英小文字で始まり、英小文字・数字・`-` で 32 字まで。
   * @public
   */
  kind: string | undefined;

  /**
   * ページの番号（種類ごと）と file の番号（語と拡張子ごと）。id なので数の字にする: 頭に 0 の無い 1 以上の数（18 桁まで）。
   * @public
   */
  n: string | undefined;

  /**
   * 本文の初めの `<title>`（文字参照を戻し、空白を 1 つにまとめる）。無ければ空。
   * @public
   */
  title: string | undefined;

  /**
   * 種類と役割の名: 英小文字で始まり、英小文字・数字・`-` で 32 字まで。
   * @public
   */
  role: string | undefined;

  /**
   * workspace の ID: 英数字と `:`・`.`・`_`・`-` で 64 字まで（空でもよい）。
   * @public
   */
  workspace: string | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  createdAt: Date | undefined;

  /**
   * 本文の byte の数。
   * @public
   */
  size: number | undefined;

  /**
   * この server の中の path（`/<project>/<key>/<kind>-<n>.html`）。
   * @public
   */
  path: string | undefined;

  /**
   * 送り手。付随する id を書いて置いた時だけ。
   * @public
   */
  sender?: Sender | undefined;

  /**
   * 返事待ちにした時刻。返事を求めていなければ無い。
   * @public
   */
  askedAt?: Date | undefined;

  /**
   * 答えた時刻。まだ答えていなければ無い。
   * @public
   */
  answeredAt?: Date | undefined;

  /**
   * 誰の返事を待つか（`review`・`tpm`）。Product Manager を待つ・返事を求めていないページには無い。
   * @public
   */
  waitsOn?: string | undefined;

  /**
   * レビューの判定。書いていなければ無い。
   * @public
   */
  verdict?: string | undefined;

  /**
   * 見た物・見てほしい物（書いた順）。無ければ欄が無い。
   * @public
   */
  targets?: string[] | undefined;
}
