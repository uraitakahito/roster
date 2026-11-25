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
 * @public
 */
export interface GetHealthInput {
}
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
