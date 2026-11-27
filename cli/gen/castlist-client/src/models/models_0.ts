// smithy-typescript generated code
import type { DocumentType as __DocumentType } from "@smithy/types";

/**
 * 付随する id 1 つ（行のまま）。
 * @public
 */
export interface ActorBinding {
  /**
   * 出し手・付随する id の種類・ラベルの鍵・model・effort の名: 英小文字・数字・`-`・`.` で 64 字まで。
   * @public
   */
  issuer: string | undefined;

  /**
   * 出し手・付随する id の種類・ラベルの鍵・model・effort の名: 英小文字・数字・`-`・`.` で 64 字まで。
   * @public
   */
  type: string | undefined;

  /**
   * 値: 空でなく、制御文字（Unicode の Cc）の無い、256 字までの字。
   * @public
   */
  value: string | undefined;

  /**
   * 鍵か（登録の初めの物）。
   * @public
   */
  isKey: boolean | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  sentAt: Date | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  receivedAt: Date | undefined;
}

/**
 * 一覧の 1 行（アクター）。
 * @public
 */
export interface ActorRow {
  /**
   * アクターの id（castlist が出す UUID v7 の字。小文字の 16 進）。
   * @public
   */
  id: string | undefined;

  name: string | undefined;
  /**
   * アクターの種類: `ai` か `human`。
   * enum にしないのは、smithy-rs（codegen-server 0.1.40）が、答えに要る enum のある操作の要求の例（`@httpRequestTests`）から、
   * 空の字の enum を作って落ちる試験を作るため。wire の形は enum と同じ字。ただし smithy diff は、string から enum への型の替えを
   * 壊す変わり（ERROR。ChangedShapeType）とする（2026-11-24 に確かめた）ので、enum に替えるなら v1.0.0 を出す前にする。
   * @public
   */
  kind: string | undefined;

  /**
   * 出し手・付随する id の種類・ラベルの鍵・model・effort の名: 英小文字・数字・`-`・`.` で 64 字まで。
   * @public
   */
  issuer: string | undefined;

  /**
   * 登録の送り手の時刻。
   * @public
   */
  sentAt: Date | undefined;

  /**
   * 登録を受けた castlist の時刻。
   * @public
   */
  receivedAt: Date | undefined;

  clockSkew: boolean | undefined;
  /**
   * ラベル（JSON の鍵の順は決まらない）。
   * @public
   */
  labels: Record<string, string> | undefined;

  /**
   * 初めの登場（entered・reentered・forked）を受けた時刻。
   * @public
   */
  firstEnteredAt?: Date | undefined;

  /**
   * 最後の退場（cleared・exited・closed）を受けた時刻。
   * @public
   */
  lastExitedAt?: Date | undefined;

  /**
   * 最後の退場の種類。
   * @public
   */
  lastExitType?: string | undefined;

  /**
   * 今稼働中か。
   * @public
   */
  present: boolean | undefined;

  /**
   * 今の停止が推しか（GetActor の `state.inferred` と同じ）。
   * @public
   */
  inferred: boolean | undefined;

  /**
   * 稼働を替える出来事（6 種）の最新の種類（GetActor の `state.presence` と同じ）。1 つも無ければ無い。
   * 1.1.0 で足した欄（前の版の答えには無い）。
   * @public
   */
  presence?: string | undefined;

  /**
   * 時刻ずれの行（登録・出来事・model と effort のどれか）を持つか（ListActors の絞りの `skewed` と同じ意味。線は見ない）。
   * `clockSkew` は登録だけの印で、これとは別。1.1.0 で足した欄（前の版の答えには無い）。
   * @public
   */
  skewed?: boolean | undefined;

  /**
   * 最新の model（受けた順で）。
   * @public
   */
  model?: string | undefined;

  /**
   * 最新の effort（受けた順で）。
   * @public
   */
  effort?: string | undefined;

  /**
   * プロフィールの画面の path（`/actors/\{id\}`）。画面は callboard が、この path で出す（castlist は 2.0.0 から画面を持たない）。
   * @public
   */
  url: string | undefined;
}

/**
 * 今の状態。
 * @public
 */
export interface ActorState {
  /**
   * 居る・居ないを替える出来事（6 種）の最新の種類（受けた順で）。1 つも無ければ無い。
   * @public
   */
  presence?: string | undefined;

  /**
   * 居るか（`presence` が entered・reentered・forked）。
   * @public
   */
  present: boolean | undefined;

  /**
   * 今の停止が推し（最後の居る出来事より後の初めの退場が、`detail.inferred` が JSON の true の `closed`）か。居る間は false。
   * @public
   */
  inferred: boolean | undefined;

  /**
   * 初めの `entered` を受けた時刻。
   * @public
   */
  enteredAt?: Date | undefined;

  /**
   * 最後の退場（cleared・exited・closed）を受けた時刻。
   * @public
   */
  exitedAt?: Date | undefined;
}

/**
 * 付随する id 1 つ（claude.session・tpm.person・cmux.workspace.ref など）。
 * @public
 */
export interface Binding {
  /**
   * 出し手・付随する id の種類・ラベルの鍵・model・effort の名: 英小文字・数字・`-`・`.` で 64 字まで。
   * @public
   */
  type: string | undefined;

  /**
   * 値: 空でなく、制御文字（Unicode の Cc）の無い、256 字までの字。
   * @public
   */
  value: string | undefined;
}

/**
 * @public
 */
export interface GetActorInput {
  /**
   * アクターの id（castlist が出す UUID v7 の字。小文字の 16 進）。
   * @public
   */
  actorId: string | undefined;
}

/**
 * model と effort 1 つ（欄は SettingFields）。
 * @public
 */
export interface Setting {
  /**
   * 送り手の id。登録の時に頼んだ物には無い。
   * @public
   */
  id?: string | undefined;

  /**
   * アクターの id（castlist が出す UUID v7 の字。小文字の 16 進）。
   * @public
   */
  actorId: string | undefined;

  /**
   * 出し手・付随する id の種類・ラベルの鍵・model・effort の名: 英小文字・数字・`-`・`.` で 64 字まで。
   * @public
   */
  model: string | undefined;

  /**
   * 出し手・付随する id の種類・ラベルの鍵・model・effort の名: 英小文字・数字・`-`・`.` で 64 字まで。
   * @public
   */
  effort: string | undefined;

  /**
   * model と effort の出: 頼んだ（`requested`）・見た（`observed`）。
   * @public
   */
  source: string | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  sentAt: Date | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  receivedAt: Date | undefined;

  clockSkew: boolean | undefined;
}

/**
 * 出来事 1 つ（欄は EventFields）。
 * @public
 */
export interface Event {
  /**
   * 送り手が付ける id（出来事・線・model と effort・トークンの数と費え）: 空白の無い ASCII の印字できる字で 128 字まで。
   * @public
   */
  id: string | undefined;

  /**
   * アクターの id（castlist が出す UUID v7 の字。小文字の 16 進）。
   * @public
   */
  actorId: string | undefined;

  /**
   * 出来事の種類（10 種）。
   * 居る・居ないを替えるのは entered・reentered・forked（居る）と cleared・exited・closed（居ない）。
   * @public
   */
  type: string | undefined;

  /**
   * 送られた JSON の物と同じ中身（無ければ空の物）。鍵の順と字の並びは、送られた物と同じとは限らない。
   * @public
   */
  detail: __DocumentType | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  sentAt: Date | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  receivedAt: Date | undefined;

  clockSkew: boolean | undefined;
}

/**
 * 線 1 つ（欄は LinkFields）。
 * @public
 */
export interface Link {
  /**
   * 送り手が付ける id（出来事・線・model と effort・トークンの数と費え）: 空白の無い ASCII の印字できる字で 128 字まで。
   * @public
   */
  id: string | undefined;

  /**
   * 線の種類: 起こした（`launched`）・後を継いだ（`continued`）。
   * @public
   */
  type: string | undefined;

  /**
   * アクターの id（castlist が出す UUID v7 の字。小文字の 16 進）。
   * @public
   */
  from: string | undefined;

  /**
   * アクターの id（castlist が出す UUID v7 の字。小文字の 16 進）。
   * @public
   */
  to: string | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  sentAt: Date | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  receivedAt: Date | undefined;

  clockSkew: boolean | undefined;
}

/**
 * @public
 */
export interface GetActorOutput {
  /**
   * アクターの id（castlist が出す UUID v7 の字。小文字の 16 進）。
   * @public
   */
  id: string | undefined;

  /**
   * `<接頭辞>.<番号>`。
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

  /**
   * 出し手。
   * @public
   */
  issuer: string | undefined;

  /**
   * 登録の送り手の時刻。
   * @public
   */
  sentAt: Date | undefined;

  /**
   * 登録を受けた castlist の時刻。
   * @public
   */
  receivedAt: Date | undefined;

  /**
   * 送り手の時刻と受けた時刻が 5 分より離れていたか。
   * @public
   */
  clockSkew: boolean | undefined;

  /**
   * 札（登録の時に書いた物）。
   * @public
   */
  labels: Record<string, string> | undefined;

  /**
   * 付随する id の全部（受けた順）。
   * @public
   */
  bindings: ActorBinding[] | undefined;

  /**
   * 種類ごとの最新（種類の順）。
   * @public
   */
  currentBindings: ActorBinding[] | undefined;

  /**
   * 出来事の全部（受けた順）。
   * @public
   */
  events: Event[] | undefined;

  /**
   * model と effort の全部（受けた順）。
   * @public
   */
  settings: Setting[] | undefined;

  /**
   * model と effort の最新（受けた順で）。1 つも無ければ無い。
   * @public
   */
  currentSettings?: Setting | undefined;

  /**
   * このアクターへの線（受けた順）。
   * @public
   */
  linksIn: Link[] | undefined;

  /**
   * このアクターからの線（受けた順）。
   * @public
   */
  linksOut: Link[] | undefined;

  /**
   * 今の状態。
   * @public
   */
  state: ActorState | undefined;

  /**
   * 読み始める前の castlist の時刻。
   * @public
   */
  asOf: Date | undefined;
}

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
 * @public
 */
export interface GetActorSettingAtInput {
  /**
   * アクターの id（castlist が出す UUID v7 の字。小文字の 16 進）。
   * @public
   */
  actorId: string | undefined;

  /**
   * 効いていた物を引く時刻。
   * @public
   */
  time: Date | undefined;
}

/**
 * @public
 */
export interface GetActorSettingAtOutput {
  /**
   * 読み始める前の castlist の時刻。
   * @public
   */
  asOf: Date | undefined;

  /**
   * アクターの id（castlist が出す UUID v7 の字。小文字の 16 進）。
   * @public
   */
  actorId: string | undefined;

  /**
   * 問いの時刻を、比べた形（UTC・ミリ秒まで）に直した物。
   * @public
   */
  at: Date | undefined;

  /**
   * その時に効いていた行。無ければ無い。
   * @public
   */
  setting?: Setting | undefined;
}

/**
 * @public
 */
export interface GetGraphInput {
  /**
   * このラベル（`鍵:値`）を持つアクター。
   * @public
   */
  label?: string | undefined;

  /**
   * 登録を受けた時刻の窓の始め（含む）。
   * @public
   */
  from?: Date | undefined;

  /**
   * 登録を受けた時刻の窓の終わり（含む）。
   * @public
   */
  to?: Date | undefined;
}

/**
 * 図の点 1 つ: 登録の欄と、今の状態と、最新の model と effort。
 * @public
 */
export interface GraphNode {
  /**
   * アクターの id（castlist が出す UUID v7 の字。小文字の 16 進）。
   * @public
   */
  id: string | undefined;

  /**
   * `<接頭辞>.<番号>`。
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

  /**
   * 出し手。
   * @public
   */
  issuer: string | undefined;

  /**
   * 登録の送り手の時刻。
   * @public
   */
  sentAt: Date | undefined;

  /**
   * 登録を受けた castlist の時刻。
   * @public
   */
  receivedAt: Date | undefined;

  /**
   * 送り手の時刻と受けた時刻が 5 分より離れていたか。
   * @public
   */
  clockSkew: boolean | undefined;

  /**
   * 今の状態（GetActor の state と同じ形）。
   * @public
   */
  state: ActorState | undefined;

  /**
   * model と effort の最新（受けた順で）。1 つも無ければ無い。
   * @public
   */
  currentSettings?: Setting | undefined;
}

/**
 * @public
 */
export interface GetGraphOutput {
  /**
   * 読み始める前の castlist の時刻。
   * @public
   */
  asOf: Date | undefined;

  /**
   * 絞った組と、組に触れる線の向こうの端のアクター（受けた順）。
   * @public
   */
  nodes: GraphNode[] | undefined;

  /**
   * 組に触れる線の全部（受けた順）。
   * @public
   */
  edges: Link[] | undefined;
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
   * castlist の版。
   * @public
   */
  version: string | undefined;

  /**
   * castlist の今の時刻。
   * @public
   */
  now: Date | undefined;
}

/**
 * @public
 */
export interface GetLineageInput {
  /**
   * アクターの id（castlist が出す UUID v7 の字。小文字の 16 進）。
   * @public
   */
  actorId: string | undefined;

  /**
   * `up`・`down`・`both`（既定）。
   * @public
   */
  direction?: string | undefined;

  /**
   * 辿る段の数（1 から 20）。無ければ上 20 段・下 1 段。
   * @public
   */
  depth?: number | undefined;

  /**
   * 線の種類で絞る（上りと下りの両方）。
   * @public
   */
  type?: string | undefined;
}

/**
 * @public
 */
export interface GetLineageOutput {
  /**
   * 読み始める前の castlist の時刻。
   * @public
   */
  asOf: Date | undefined;

  /**
   * 起点のアクター。
   * @public
   */
  actorId: string | undefined;

  /**
   * 起点と、辿って着いたアクター（初めの登場の順。同じなら受けた順）。
   * @public
   */
  nodes: ActorRow[] | undefined;

  /**
   * 辿った線（受けた順）。
   * @public
   */
  edges: Link[] | undefined;
}

/**
 * @public
 */
export interface GetTimelineInput {
  /**
   * このラベル（`鍵:値`）を持つアクター。
   * @public
   */
  label?: string | undefined;

  /**
   * 登録を受けた時刻の窓の始め（含む）。
   * @public
   */
  from?: Date | undefined;

  /**
   * 登録を受けた時刻の窓の終わり（含む）。
   * @public
   */
  to?: Date | undefined;
}

/**
 * タイムラインの出来事 1 つ（帯と印に要る欄だけ。`detail` の全部は GetActor・ListEvents で読む）。
 * @public
 */
export interface TimelineEvent {
  /**
   * アクターの id（castlist が出す UUID v7 の字。小文字の 16 進）。
   * @public
   */
  actorId: string | undefined;

  /**
   * 出来事の種類（10 種）。
   * 居る・居ないを替えるのは entered・reentered・forked（居る）と cleared・exited・closed（居ない）。
   * @public
   */
  type: string | undefined;

  /**
   * 出来事を受けた castlist の時刻。
   * @public
   */
  receivedAt: Date | undefined;

  /**
   * 推しの幕引きか（`closed` で、`detail.inferred` が JSON の true）。
   * @public
   */
  inferred: boolean | undefined;

  /**
   * `detail.reason`（字の時だけ）。
   * @public
   */
  reason?: string | undefined;
}

/**
 * @public
 */
export interface GetTimelineOutput {
  /**
   * 読み始める前の castlist の時刻。
   * @public
   */
  asOf: Date | undefined;

  /**
   * 絞った組と、組に触れる線の向こうの端のアクター（受けた順）。GetGraph の `nodes` と同じ。
   * @public
   */
  nodes: GraphNode[] | undefined;

  /**
   * 組に触れる線の全部（受けた順）。GetGraph の `edges` と同じ。
   * @public
   */
  edges: Link[] | undefined;

  /**
   * 点のアクターの出来事の全部（受けた順）。
   * @public
   */
  events: TimelineEvent[] | undefined;

  /**
   * 点のアクターの model と effort の行の全部（受けた順）。
   * @public
   */
  settings: Setting[] | undefined;
}

/**
 * @public
 */
export interface ListActorsInput {
  /**
   * ラベル（`鍵:値`）。重ねれば、どれも持つアクター。
   * @public
   */
  label?: string[] | undefined;

  /**
   * 付随する id（`種類:値`）。
   * @public
   */
  binding?: string | undefined;

  /**
   * `binding` を引く時刻（既定は `asOf`）。`binding` と一緒にだけ付ける。
   * @public
   */
  at?: Date | undefined;

  /**
   * 稼働した期間の窓の始め（両端を含む）。
   * @public
   */
  activeFrom?: Date | undefined;

  /**
   * 稼働した期間の窓の終わり（両端を含む）。
   * @public
   */
  activeTo?: Date | undefined;

  /**
   * アクターの種類: `ai` か `human`。
   * enum にしないのは、smithy-rs（codegen-server 0.1.40）が、答えに要る enum のある操作の要求の例（`@httpRequestTests`）から、
   * 空の字の enum を作って落ちる試験を作るため。wire の形は enum と同じ字。ただし smithy diff は、string から enum への型の替えを
   * 壊す変わり（ERROR。ChangedShapeType）とする（2026-11-24 に確かめた）ので、enum に替えるなら v1.0.0 を出す前にする。
   * @public
   */
  kind?: string | undefined;

  /**
   * その名の model の行を 1 つでも持つ。
   * @public
   */
  model?: string | undefined;

  /**
   * その名の effort の行を 1 つでも持つ。
   * @public
   */
  effort?: string | undefined;

  /**
   * 今稼働中か。
   * @public
   */
  active?: boolean | undefined;

  /**
   * このアクターが起こした（launched）。
   * @public
   */
  launchedBy?: string | undefined;

  /**
   * 時刻ずれの行を持つ（true だけ）。
   * @public
   */
  skewed?: boolean | undefined;

  /**
   * `entered`（初めの登場。既定）か `exited`（最後の退場）。
   * @public
   */
  sort?: string | undefined;

  /**
   * `asc`（既定）か `desc`。
   * @public
   */
  order?: string | undefined;

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
export interface ListActorsOutput {
  /**
   * 読み始める前の castlist の時刻。
   * @public
   */
  asOf: Date | undefined;

  actors: ActorRow[] | undefined;
  /**
   * 次の頁の印。終わりなら無い。
   * @public
   */
  nextToken?: string | undefined;
}

/**
 * @public
 */
export interface ListActorSettingsInput {
  /**
   * アクターの id（castlist が出す UUID v7 の字。小文字の 16 進）。
   * @public
   */
  actorId: string | undefined;
}

/**
 * @public
 */
export interface ListActorSettingsOutput {
  /**
   * 読み始める前の castlist の時刻。
   * @public
   */
  asOf: Date | undefined;

  /**
   * アクターの id（castlist が出す UUID v7 の字。小文字の 16 進）。
   * @public
   */
  actorId: string | undefined;

  /**
   * 受けた順。
   * @public
   */
  settings: Setting[] | undefined;
}

/**
 * @public
 */
export interface ListEventsInput {
  /**
   * 出来事の種類。重ねれば、どれか。
   * @public
   */
  type?: string[] | undefined;

  /**
   * このアクターの出来事。
   * @public
   */
  actor?: string | undefined;

  /**
   * 受けた時刻の窓の始め（含む）。
   * @public
   */
  from?: Date | undefined;

  /**
   * 受けた時刻の窓の終わり（含む）。
   * @public
   */
  to?: Date | undefined;

  /**
   * `detail.reason` がこの字と等しい。
   * @public
   */
  reason?: string | undefined;

  /**
   * `detail.source` がこの字と等しい。
   * @public
   */
  source?: string | undefined;

  /**
   * 時刻ずれの行（true だけ）。
   * @public
   */
  skewed?: boolean | undefined;

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
 * 探した出来事の 1 行（出来事の欄に、アクターの名を足した物）。
 * @public
 */
export interface EventRow {
  /**
   * 送り手が付ける id（出来事・線・model と effort・トークンの数と費え）: 空白の無い ASCII の印字できる字で 128 字まで。
   * @public
   */
  id: string | undefined;

  /**
   * アクターの id（castlist が出す UUID v7 の字。小文字の 16 進）。
   * @public
   */
  actorId: string | undefined;

  /**
   * 出来事の種類（10 種）。
   * 居る・居ないを替えるのは entered・reentered・forked（居る）と cleared・exited・closed（居ない）。
   * @public
   */
  type: string | undefined;

  /**
   * 送られた JSON の物と同じ中身（無ければ空の物）。鍵の順と字の並びは、送られた物と同じとは限らない。
   * @public
   */
  detail: __DocumentType | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  sentAt: Date | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  receivedAt: Date | undefined;

  clockSkew: boolean | undefined;
  /**
   * アクターの名（`<接頭辞>.<番号>`）。
   * @public
   */
  actorName: string | undefined;
}

/**
 * @public
 */
export interface ListEventsOutput {
  /**
   * 読み始める前の castlist の時刻。
   * @public
   */
  asOf: Date | undefined;

  /**
   * 受けた順。
   * @public
   */
  events: EventRow[] | undefined;

  /**
   * 次の頁の印。終わりなら無い。
   * @public
   */
  nextToken?: string | undefined;
}

/**
 * @public
 */
export interface ListSettingsInput {
  /**
   * 出し手・付随する id の種類・ラベルの鍵・model・effort の名: 英小文字・数字・`-`・`.` で 64 字まで。
   * @public
   */
  model?: string | undefined;

  /**
   * 出し手・付随する id の種類・ラベルの鍵・model・effort の名: 英小文字・数字・`-`・`.` で 64 字まで。
   * @public
   */
  effort?: string | undefined;

  /**
   * `requested`（頼んだ）か `observed`（見た）。
   * @public
   */
  source?: string | undefined;

  /**
   * 受けた時刻の窓の始め（含む）。
   * @public
   */
  from?: Date | undefined;

  /**
   * 受けた時刻の窓の終わり（含む）。
   * @public
   */
  to?: Date | undefined;

  /**
   * 見た物が、その前に頼んだ物と違う行（true だけ）。
   * @public
   */
  mismatch?: boolean | undefined;

  /**
   * 時刻ずれの行（true だけ）。
   * @public
   */
  skewed?: boolean | undefined;

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
 * 探した model と effort の 1 行（model と effort の欄に、アクターの名を足した物）。
 * @public
 */
export interface SettingRow {
  /**
   * 送り手の id。登録の時に頼んだ物には無い。
   * @public
   */
  id?: string | undefined;

  /**
   * アクターの id（castlist が出す UUID v7 の字。小文字の 16 進）。
   * @public
   */
  actorId: string | undefined;

  /**
   * 出し手・付随する id の種類・ラベルの鍵・model・effort の名: 英小文字・数字・`-`・`.` で 64 字まで。
   * @public
   */
  model: string | undefined;

  /**
   * 出し手・付随する id の種類・ラベルの鍵・model・effort の名: 英小文字・数字・`-`・`.` で 64 字まで。
   * @public
   */
  effort: string | undefined;

  /**
   * model と effort の出: 頼んだ（`requested`）・見た（`observed`）。
   * @public
   */
  source: string | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  sentAt: Date | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  receivedAt: Date | undefined;

  clockSkew: boolean | undefined;
  /**
   * アクターの名（`<接頭辞>.<番号>`）。
   * @public
   */
  actorName: string | undefined;
}

/**
 * @public
 */
export interface ListSettingsOutput {
  /**
   * 読み始める前の castlist の時刻。
   * @public
   */
  asOf: Date | undefined;

  /**
   * 受けた順。
   * @public
   */
  settings: SettingRow[] | undefined;

  /**
   * 次の頁の印。終わりなら無い。
   * @public
   */
  nextToken?: string | undefined;
}

/**
 * @public
 */
export interface ListUsageInput {
  /**
   * 区間の終わりの時刻（`toAt`）の窓の始め（含む）。
   * @public
   */
  from: Date | undefined;

  /**
   * 区間の終わりの時刻（`toAt`）の窓の終わり（含まない）。`from` から 31 日まで。
   * @public
   */
  to: Date | undefined;

  /**
   * ラベル（`鍵:値`）。重ねれば、どれも持つアクターの行。
   * @public
   */
  label?: string[] | undefined;

  /**
   * そのアクターの行。
   * @public
   */
  actorId?: string | undefined;

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
 * トークンの数と費えの行に出てきたアクター（id・名・ラベル）。
 * @public
 */
export interface UsageActor {
  /**
   * アクターの id（castlist が出す UUID v7 の字。小文字の 16 進）。
   * @public
   */
  id: string | undefined;

  /**
   * `<接頭辞>.<番号>`。
   * @public
   */
  name: string | undefined;

  /**
   * ラベル（JSON の鍵の順は決まらない）。
   * @public
   */
  labels: Record<string, string> | undefined;
}

/**
 * 文脈の長さの段 1 つの、回の数と額。
 * @public
 */
export interface UsageBucket {
  /**
   * 文脈の長さの段の番号: n 段は n×25,000 以上 (n+1)×25,000 未満のトークン。40 は 1,000,000 以上。
   * @public
   */
  bucket: number | undefined;

  /**
   * その段の回の数。
   * @public
   */
  turns: number | undefined;

  /**
   * その段の額（100 万分の 1 ドル）。
   * @public
   */
  costMicroUsd: number | undefined;
}

/**
 * トークンの数と費えの 1 行（欄は UsageFields）。
 * @public
 */
export interface Usage {
  /**
   * 送り手の id。
   * @public
   */
  id: string | undefined;

  /**
   * アクターの id（castlist が出す UUID v7 の字。小文字の 16 進）。
   * @public
   */
  actorId: string | undefined;

  /**
   * 出し手・付随する id の種類・ラベルの鍵・model・effort の名: 英小文字・数字・`-`・`.` で 64 字まで。
   * @public
   */
  model: string | undefined;

  /**
   * 手伝い（subagent）の種類の名。本体の回なら無い。
   * @public
   */
  agent?: string | undefined;

  /**
   * 値: 空でなく、制御文字（Unicode の Cc）の無い、256 字までの字。
   * @public
   */
  speed: string | undefined;

  /**
   * 値: 空でなく、制御文字（Unicode の Cc）の無い、256 字までの字。
   * @public
   */
  serviceTier: string | undefined;

  /**
   * 区間の始めの回の時刻（ミリ秒まで）。
   * @public
   */
  fromAt: Date | undefined;

  /**
   * 区間の終わりの回の時刻（ミリ秒まで）。
   * @public
   */
  toAt: Date | undefined;

  /**
   * 回の数（1 以上）。
   * @public
   */
  turns: number | undefined;

  /**
   * 0 以上の数（トークンの数・web の検索と取得の回数・額・文脈の長さ）。
   * @public
   */
  inputTokens: number | undefined;

  /**
   * 0 以上の数（トークンの数・web の検索と取得の回数・額・文脈の長さ）。
   * @public
   */
  outputTokens: number | undefined;

  /**
   * 0 以上の数（トークンの数・web の検索と取得の回数・額・文脈の長さ）。
   * @public
   */
  cacheReadTokens: number | undefined;

  /**
   * 0 以上の数（トークンの数・web の検索と取得の回数・額・文脈の長さ）。
   * @public
   */
  cacheWrite5mTokens: number | undefined;

  /**
   * 0 以上の数（トークンの数・web の検索と取得の回数・額・文脈の長さ）。
   * @public
   */
  cacheWrite1hTokens: number | undefined;

  /**
   * web の検索の回数。
   * @public
   */
  webSearchRequests: number | undefined;

  /**
   * web の取得の回数。
   * @public
   */
  webFetchRequests: number | undefined;

  /**
   * 額（100 万分の 1 ドル）。
   * @public
   */
  costMicroUsd: number | undefined;

  /**
   * 区間の内でいちばん長い文脈（トークン）。同じ時の行をまとめる時は、大きい方を取る。
   * @public
   */
  maxContext: number | undefined;

  /**
   * 文脈の長さの段ごとの数（`bucket` の順）。
   * @public
   */
  buckets: UsageBucket[] | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  sentAt: Date | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  receivedAt: Date | undefined;

  clockSkew: boolean | undefined;
}

/**
 * @public
 */
export interface ListUsageOutput {
  /**
   * 読み始める前の castlist の時刻。
   * @public
   */
  asOf: Date | undefined;

  /**
   * 受けた順。
   * @public
   */
  usage: Usage[] | undefined;

  /**
   * この頁の行に出てきたアクターを 1 度ずつ（行に初めて出た順）。
   * @public
   */
  actors: UsageActor[] | undefined;

  /**
   * 次の頁の印。終わりなら無い。
   * @public
   */
  nextToken?: string | undefined;
}

/**
 * @public
 */
export interface PutEventInput {
  /**
   * 送り手の決める id。
   * @public
   */
  eventId: string | undefined;

  /**
   * 出し手。`by` は出し手の中で引く。
   * @public
   */
  issuer: string | undefined;

  /**
   * 出来事のアクター（鍵の付随する id）。
   * @public
   */
  by: string | undefined;

  /**
   * 出来事の種類（10 種）。
   * 居る・居ないを替えるのは entered・reentered・forked（居る）と cleared・exited・closed（居ない）。
   * @public
   */
  type: string | undefined;

  /**
   * JSON の物（無ければ `\{\}`）。
   * 無い時の要求の例は書かない: smithy-rs（codegen-server 0.1.40）は、例の params に無い Document を、
   * 無い物（None）でなく JSON の null（Some(Null)）として比べる試験を作り、読んだ物（None）と合わずに落ちるため。
   * 無い時の振る舞いは、server の試験（crates/server/tests/events.rs）が見る。
   * @public
   */
  detail?: __DocumentType | undefined;

  /**
   * 送り手の時刻。
   * @public
   */
  sentAt: Date | undefined;
}

/**
 * 出来事の欄（GetActor の出来事と、PutEvent の答えで同じ形）。
 * @public
 */
export interface PutEventOutput {
  /**
   * 送り手が付ける id（出来事・線・model と effort・トークンの数と費え）: 空白の無い ASCII の印字できる字で 128 字まで。
   * @public
   */
  id: string | undefined;

  /**
   * アクターの id（castlist が出す UUID v7 の字。小文字の 16 進）。
   * @public
   */
  actorId: string | undefined;

  /**
   * 出来事の種類（10 種）。
   * 居る・居ないを替えるのは entered・reentered・forked（居る）と cleared・exited・closed（居ない）。
   * @public
   */
  type: string | undefined;

  /**
   * 送られた JSON の物と同じ中身（無ければ空の物）。鍵の順と字の並びは、送られた物と同じとは限らない。
   * @public
   */
  detail: __DocumentType | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  sentAt: Date | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  receivedAt: Date | undefined;

  clockSkew: boolean | undefined;
  /**
   * 新しく足せば 201、同じ id で同じ本文なら 200。
   * @public
   */
  status: number | undefined;
}

/**
 * @public
 */
export interface PutLinkInput {
  /**
   * 送り手の決める id。
   * @public
   */
  linkId: string | undefined;

  /**
   * 出し手。`from` と `to` は出し手の中で引く。
   * @public
   */
  issuer: string | undefined;

  /**
   * 線の種類: 起こした（`launched`）・後を継いだ（`continued`）。
   * @public
   */
  type: string | undefined;

  /**
   * 起こした・前のアクター（鍵の付随する id）。
   * @public
   */
  from: string | undefined;

  /**
   * 起こされた・後を継いだアクター（鍵の付随する id）。
   * @public
   */
  to: string | undefined;

  /**
   * 送り手の時刻。
   * @public
   */
  sentAt: Date | undefined;
}

/**
 * 線の欄（`from` が `to` を起こした・`to` が `from` の後を継いだ）。GetActor の線と、PutLink の答えで同じ形。
 * 答えの `from`・`to` はアクターの id（PutLink の要求の `from`・`to` は付随する id の参照 `種類:値` で、castlist が引き当てた物）。
 * @public
 */
export interface PutLinkOutput {
  /**
   * 送り手が付ける id（出来事・線・model と effort・トークンの数と費え）: 空白の無い ASCII の印字できる字で 128 字まで。
   * @public
   */
  id: string | undefined;

  /**
   * 線の種類: 起こした（`launched`）・後を継いだ（`continued`）。
   * @public
   */
  type: string | undefined;

  /**
   * アクターの id（castlist が出す UUID v7 の字。小文字の 16 進）。
   * @public
   */
  from: string | undefined;

  /**
   * アクターの id（castlist が出す UUID v7 の字。小文字の 16 進）。
   * @public
   */
  to: string | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  sentAt: Date | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  receivedAt: Date | undefined;

  clockSkew: boolean | undefined;
  /**
   * 新しく足せば 201、同じ id で同じ本文なら 200。
   * @public
   */
  status: number | undefined;
}

/**
 * @public
 */
export interface PutSettingInput {
  /**
   * 送り手の決める id。
   * @public
   */
  settingId: string | undefined;

  /**
   * 出し手。`by` は出し手の中で引く。
   * @public
   */
  issuer: string | undefined;

  /**
   * model と effort のアクター（鍵の付随する id）。
   * @public
   */
  by: string | undefined;

  /**
   * 出し手・付随する id の種類・ラベルの鍵・model・effort の名: 英小文字・数字・`-`・`.` で 64 字まで。
   * @public
   */
  model: string | undefined;

  /**
   * 出し手・付随する id の種類・ラベルの鍵・model・effort の名: 英小文字・数字・`-`・`.` で 64 字まで。
   * @public
   */
  effort: string | undefined;

  /**
   * model と effort の出: 頼んだ（`requested`）・見た（`observed`）。
   * @public
   */
  source: string | undefined;

  /**
   * 送り手の時刻。
   * @public
   */
  sentAt: Date | undefined;
}

/**
 * model と effort の欄（GetActor の model と effort と、PutSetting の答えで同じ形）。
 * @public
 */
export interface PutSettingOutput {
  /**
   * 送り手の id。登録の時に頼んだ物には無い。
   * @public
   */
  id?: string | undefined;

  /**
   * アクターの id（castlist が出す UUID v7 の字。小文字の 16 進）。
   * @public
   */
  actorId: string | undefined;

  /**
   * 出し手・付随する id の種類・ラベルの鍵・model・effort の名: 英小文字・数字・`-`・`.` で 64 字まで。
   * @public
   */
  model: string | undefined;

  /**
   * 出し手・付随する id の種類・ラベルの鍵・model・effort の名: 英小文字・数字・`-`・`.` で 64 字まで。
   * @public
   */
  effort: string | undefined;

  /**
   * model と effort の出: 頼んだ（`requested`）・見た（`observed`）。
   * @public
   */
  source: string | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  sentAt: Date | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  receivedAt: Date | undefined;

  clockSkew: boolean | undefined;
  /**
   * 新しく足せば 201、同じ id で同じ本文か、最新と同じなら 200。
   * @public
   */
  status: number | undefined;
}

/**
 * @public
 */
export interface PutUsageInput {
  /**
   * 送り手の決める id。
   * @public
   */
  usageId: string | undefined;

  /**
   * 出し手。`by` は出し手の中で引く。
   * @public
   */
  issuer: string | undefined;

  /**
   * トークンを使ったアクター（鍵の付随する id）。
   * @public
   */
  by: string | undefined;

  /**
   * 出し手・付随する id の種類・ラベルの鍵・model・effort の名: 英小文字・数字・`-`・`.` で 64 字まで。
   * @public
   */
  model: string | undefined;

  /**
   * 手伝い（subagent）の種類の名。本体の回なら付けない。
   * @public
   */
  agent?: string | undefined;

  /**
   * 速さの種類の名（例 `standard`）。
   * @public
   */
  speed: string | undefined;

  /**
   * service tier の名（例 `standard`）。
   * @public
   */
  serviceTier: string | undefined;

  /**
   * 区間の始めの回の時刻。
   * @public
   */
  fromAt: Date | undefined;

  /**
   * 区間の終わりの回の時刻。`fromAt` と同じ UTC の時の内。
   * @public
   */
  toAt: Date | undefined;

  /**
   * 回の数。
   * @public
   */
  turns: number | undefined;

  /**
   * 0 以上の数（トークンの数・web の検索と取得の回数・額・文脈の長さ）。
   * @public
   */
  inputTokens: number | undefined;

  /**
   * 0 以上の数（トークンの数・web の検索と取得の回数・額・文脈の長さ）。
   * @public
   */
  outputTokens: number | undefined;

  /**
   * 0 以上の数（トークンの数・web の検索と取得の回数・額・文脈の長さ）。
   * @public
   */
  cacheReadTokens: number | undefined;

  /**
   * 5 分の cache に書いたトークンの数。
   * @public
   */
  cacheWrite5mTokens: number | undefined;

  /**
   * 1 時間の cache に書いたトークンの数。
   * @public
   */
  cacheWrite1hTokens: number | undefined;

  /**
   * web の検索の回数。
   * @public
   */
  webSearchRequests: number | undefined;

  /**
   * web の取得の回数。
   * @public
   */
  webFetchRequests: number | undefined;

  /**
   * 額（100 万分の 1 ドル）。
   * @public
   */
  costMicroUsd: number | undefined;

  /**
   * 区間の内でいちばん長い文脈（トークン）。
   * @public
   */
  maxContext: number | undefined;

  /**
   * 文脈の長さの段ごとの数。
   * @public
   */
  buckets: UsageBucket[] | undefined;

  /**
   * 送り手の時刻。
   * @public
   */
  sentAt: Date | undefined;
}

/**
 * トークンの数と費えの欄（PutUsage の答えと、ListUsage の行で同じ形）。
 * @public
 */
export interface PutUsageOutput {
  /**
   * 送り手の id。
   * @public
   */
  id: string | undefined;

  /**
   * アクターの id（castlist が出す UUID v7 の字。小文字の 16 進）。
   * @public
   */
  actorId: string | undefined;

  /**
   * 出し手・付随する id の種類・ラベルの鍵・model・effort の名: 英小文字・数字・`-`・`.` で 64 字まで。
   * @public
   */
  model: string | undefined;

  /**
   * 手伝い（subagent）の種類の名。本体の回なら無い。
   * @public
   */
  agent?: string | undefined;

  /**
   * 値: 空でなく、制御文字（Unicode の Cc）の無い、256 字までの字。
   * @public
   */
  speed: string | undefined;

  /**
   * 値: 空でなく、制御文字（Unicode の Cc）の無い、256 字までの字。
   * @public
   */
  serviceTier: string | undefined;

  /**
   * 区間の始めの回の時刻（ミリ秒まで）。
   * @public
   */
  fromAt: Date | undefined;

  /**
   * 区間の終わりの回の時刻（ミリ秒まで）。
   * @public
   */
  toAt: Date | undefined;

  /**
   * 回の数（1 以上）。
   * @public
   */
  turns: number | undefined;

  /**
   * 0 以上の数（トークンの数・web の検索と取得の回数・額・文脈の長さ）。
   * @public
   */
  inputTokens: number | undefined;

  /**
   * 0 以上の数（トークンの数・web の検索と取得の回数・額・文脈の長さ）。
   * @public
   */
  outputTokens: number | undefined;

  /**
   * 0 以上の数（トークンの数・web の検索と取得の回数・額・文脈の長さ）。
   * @public
   */
  cacheReadTokens: number | undefined;

  /**
   * 0 以上の数（トークンの数・web の検索と取得の回数・額・文脈の長さ）。
   * @public
   */
  cacheWrite5mTokens: number | undefined;

  /**
   * 0 以上の数（トークンの数・web の検索と取得の回数・額・文脈の長さ）。
   * @public
   */
  cacheWrite1hTokens: number | undefined;

  /**
   * web の検索の回数。
   * @public
   */
  webSearchRequests: number | undefined;

  /**
   * web の取得の回数。
   * @public
   */
  webFetchRequests: number | undefined;

  /**
   * 額（100 万分の 1 ドル）。
   * @public
   */
  costMicroUsd: number | undefined;

  /**
   * 区間の内でいちばん長い文脈（トークン）。同じ時の行をまとめる時は、大きい方を取る。
   * @public
   */
  maxContext: number | undefined;

  /**
   * 文脈の長さの段ごとの数（`bucket` の順）。
   * @public
   */
  buckets: UsageBucket[] | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  sentAt: Date | undefined;

  /**
   * 時刻（RFC 3339）。
   * @public
   */
  receivedAt: Date | undefined;

  clockSkew: boolean | undefined;
  /**
   * 新しく足せば 201、同じ id で同じ本文なら 200。
   * @public
   */
  status: number | undefined;
}

/**
 * 頼んだ model と effort。
 * @public
 */
export interface RequestedSettings {
  /**
   * 出し手・付随する id の種類・ラベルの鍵・model・effort の名: 英小文字・数字・`-`・`.` で 64 字まで。
   * @public
   */
  model: string | undefined;

  /**
   * 出し手・付随する id の種類・ラベルの鍵・model・effort の名: 英小文字・数字・`-`・`.` で 64 字まで。
   * @public
   */
  effort: string | undefined;
}

/**
 * @public
 */
export interface RegisterActorInput {
  /**
   * 出し手（tpm・pagetray など）。名の番号と鍵は、出し手ごとに分かれる。
   * @public
   */
  issuer: string | undefined;

  /**
   * アクターの種類: `ai` か `human`。
   * enum にしないのは、smithy-rs（codegen-server 0.1.40）が、答えに要る enum のある操作の要求の例（`@httpRequestTests`）から、
   * 空の字の enum を作って落ちる試験を作るため。wire の形は enum と同じ字。ただし smithy diff は、string から enum への型の替えを
   * 壊す変わり（ERROR。ChangedShapeType）とする（2026-11-24 に確かめた）ので、enum に替えるなら v1.0.0 を出す前にする。
   * @public
   */
  kind: string | undefined;

  /**
   * 名の接頭辞（名は `<接頭辞>.<番号>`）。
   * @public
   */
  namePrefix: string | undefined;

  /**
   * 札（project など）。新しく作った時だけ書く。
   * @public
   */
  labels?: Record<string, string> | undefined;

  /**
   * 付随する id。初めの物が鍵（1 つのアクターにだけ付く）。鍵でない物は、同じ種類の最新と違う時だけ足す。
   * @public
   */
  bindings: Binding[] | undefined;

  /**
   * 送り手の時刻。
   * @public
   */
  sentAt: Date | undefined;

  /**
   * 頼んだ model と effort。最新と違う時だけ足す。
   * @public
   */
  settings?: RequestedSettings | undefined;
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
export interface RegisterActorOutput {
  /**
   * アクターを指す時の短い形。
   * @public
   */
  actor: ActorSummary | undefined;

  /**
   * 新しく作ったか。
   * @public
   */
  created: boolean | undefined;

  /**
   * 新しく作れば 201、鍵が既にあれば 200。
   * @public
   */
  status: number | undefined;
}

/**
 * @public
 */
export interface ResolveActorsInput {
  /**
   * 出し手。鍵は出し手の中で引く。
   * @public
   */
  issuer: string | undefined;

  /**
   * 引く参照（1 から 100 個）。
   * @public
   */
  refs: string[] | undefined;
}

/**
 * 参照 1 つの答え。
 * @public
 */
export interface Resolution {
  /**
   * 問いの参照のまま。
   * @public
   */
  ref: string | undefined;

  /**
   * 引けたアクター。引けなければ無い。
   * @public
   */
  actor?: ActorSummary | undefined;
}

/**
 * @public
 */
export interface ResolveActorsOutput {
  /**
   * 読み始める前の castlist の時刻。
   * @public
   */
  asOf: Date | undefined;

  /**
   * 問いと同じ順。
   * @public
   */
  results: Resolution[] | undefined;
}
