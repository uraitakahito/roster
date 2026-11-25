$version: "2"

// pagetray と castlist が共に使う形（共通の名前空間）。castlist の repo に置き、pagetray と roster は release の tag で固めて取る。
namespace ai.common

/// 次の頁の印。中は読まず、前の答えの `nextToken` をそのまま渡す。
@length(min: 1, max: 512)
string NextToken

/// 1 頁の数。
@range(min: 1, max: 1000)
integer MaxResults

/// 時刻（RFC 3339）。
@timestampFormat("date-time")
timestamp DateTime

/// 受けない要求。castlist を動かす機械の外からの名（`Host`）と、browser の中のページからの書く要求（`Origin` の付いた
/// `GET`・`HEAD` のほか）を断る。どの操作の前でも効く（server の守りの層）。
@error("client")
@httpError(403)
structure Forbidden {
    @required
    message: String
}

/// 本文が上限より大きい。どの操作の前でも効く（server の守りの層。上限は server が決める）。
@error("client")
@httpError(413)
structure PayloadTooLarge {
    @required
    message: String
}

/// 名指した物が無い。
@error("client")
@httpError(404)
structure NotFound {
    @required
    message: String
}

/// 同じ id の物がもうあり、中身が違う。
@error("client")
@httpError(409)
structure Conflict {
    @required
    message: String
}

/// 消した物（番号は 2 度使わない）。
@error("client")
@httpError(410)
structure Gone {
    @required
    message: String
}

/// server の中で失敗した（DB の誤りなど）。送り直しても直らない見込みなので、@retryable は付けない。
/// 訳は server の記録に書き、答えの `message` は決まった字にする（中の誤りの字を外に出さない）。
@error("server")
@httpError(500)
structure InternalError {
    @required
    message: String
}

/// 混んでいる・時間がかかりすぎた・呼ぶ先が答えない。少し待って送り直す。
/// 時間切れは、どの操作の前でも効く（server の守りの層）。
@error("server")
@httpError(503)
@retryable
structure Unavailable {
    @required
    message: String
}

/// アクターの id（castlist が出す UUID v7 の字。小文字の 16 進）。
@pattern("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
string ActorId

/// アクターの種類: `ai` か `human`。
/// enum にしないのは、smithy-rs（codegen-server 0.1.40）が、答えに要る enum のある操作の要求の例（`@httpRequestTests`）から、
/// 空の字の enum を作って落ちる試験を作るため。wire の形は enum と同じ字。ただし smithy diff は、string から enum への型の替えを
/// 壊す変わり（ERROR。ChangedShapeType）とする（2026-11-24 に確かめた）ので、enum に替えるなら v1.0.0 を出す前にする。
@pattern("^(ai|human)$")
string ActorKind

/// アクターを指す時の短い形。
structure ActorSummary {
    @required
    id: ActorId

    /// `<接頭辞>.<番号>`（番号は出し手と接頭辞ごとに 1 から）。
    @required
    name: String

    @required
    kind: ActorKind
}

/// 付随する id を指す参照: `種類:値`。初めの `:` で分ける（種類は `:` を持たないので、値に `:` があってよい）。
/// 種類は英小文字・数字・`-`・`.` で 64 字まで。値は空でなく、制御文字（Unicode の Cc）の無い、256 字まで。
@pattern("^[a-z0-9.-]{1,64}:[^\\x00-\\x1F\\x7F-\\x9F]{1,256}$")
string ActorRef
