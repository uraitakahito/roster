$version: "2"

// castlist（アクターの台帳）の API。docs/src/api.md の決まりを、定義として書く。
namespace ai.castlist

use ai.common#ActorId
use ai.common#ActorKind
use ai.common#ActorRef
use ai.common#ActorSummary
use ai.common#Conflict
use ai.common#DateTime
use ai.common#Forbidden
use ai.common#InternalError
use ai.common#MaxResults
use ai.common#NextToken
use ai.common#NotFound
use ai.common#PayloadTooLarge
use ai.common#Unavailable
use aws.protocols#restJson1
use smithy.framework#ValidationException
use smithy.test#httpRequestTests
use smithy.test#httpResponseTests

@restJson1
@title("castlist")
service Castlist {
    version: "1.0"
    operations: [
        GetHealth
        RegisterActor
        GetActor
        ListActors
        GetLineage
        ListActorSettings
        GetActorSettingAt
        ResolveActors
        PutEvent
        ListEvents
        PutLink
        PutSetting
        ListSettings
        GetGraph
    ]

    // 操作の前の守りの層（server の生成した骨の外）が返す誤り。どの操作の答えにもなり得る。
    errors: [
        Forbidden
        PayloadTooLarge
        Unavailable
    ]
}

/// 動いているかと、castlist の今の時刻（送り手が、自分の時計との差を測る）。
@readonly
@http(method: "GET", uri: "/healthz")
@httpRequestTests([
    {
        id: "GetHealthRequest"
        documentation: "本文も引数も無い"
        protocol: restJson1
        method: "GET"
        uri: "/healthz"
    }
])
@httpResponseTests([
    {
        id: "GetHealthResponse"
        documentation: "状態・版・今の時刻を返す"
        protocol: restJson1
        code: 200
        headers: { "Content-Type": "application/json" }
        body: """
            {"status":"ok","version":"1.0.0","now":"2026-11-24T00:00:00Z"}"""
        bodyMediaType: "application/json"
        params: { status: "ok", version: "1.0.0", now: 1795478400 }
    }
])
operation GetHealth {
    input := {}

    output := {
        /// いつも `ok`。
        @required
        status: String

        /// castlist の版。
        @required
        version: String

        /// castlist の今の時刻。
        @required
        now: DateTime
    }
}

/// アクターを登録する。鍵（`bindings` の初めの物）が出し手（`issuer`）の中に既にあれば、そのアクターを返す（200・`created` は false）。
/// 無ければ新しく作る（201）。id は castlist が出す（UUID v7）。名は `<namePrefix>.<番号>`（番号は出し手と接頭辞ごとに 1 から）。
/// 既にあった時は、`kind`・`namePrefix`・`labels` を見ず、変わった鍵でない付随する id と、変わった頼んだ model と effort だけを足す。
@http(method: "POST", uri: "/api/actors")
@httpRequestTests([
    {
        id: "RegisterActorRequest"
        documentation: "欄の名は camelCase。初めの付随する id が鍵"
        protocol: restJson1
        method: "POST"
        uri: "/api/actors"
        headers: { "Content-Type": "application/json" }
        body: """
            {"issuer":"tpm","kind":"ai","namePrefix":"se","labels":{"project":"castlist"},"bindings":[{"type":"claude.session","value":"s-1"},{"type":"cmux.workspace.ref","value":"workspace:1"}],"sentAt":"2026-11-24T00:00:00Z","settings":{"model":"claude-opus-5-5","effort":"high"}}"""
        bodyMediaType: "application/json"
        params: {
            issuer: "tpm"
            kind: "ai"
            namePrefix: "se"
            labels: { project: "castlist" }
            bindings: [
                { type: "claude.session", value: "s-1" }
                { type: "cmux.workspace.ref", value: "workspace:1" }
            ]
            sentAt: 1795478400
            settings: { model: "claude-opus-5-5", effort: "high" }
        }
    }
    {
        id: "RegisterActorRequestWithoutLabelsAndSettings"
        documentation: "labels と settings は無くてよい"
        protocol: restJson1
        method: "POST"
        uri: "/api/actors"
        headers: { "Content-Type": "application/json" }
        body: """
            {"issuer":"tpm","kind":"human","namePrefix":"pm","bindings":[{"type":"tpm.person","value":"pm"}],"sentAt":"2026-11-24T00:00:00Z"}"""
        bodyMediaType: "application/json"
        params: {
            issuer: "tpm"
            kind: "human"
            namePrefix: "pm"
            bindings: [{ type: "tpm.person", value: "pm" }]
            sentAt: 1795478400
        }
    }
])
@httpResponseTests([
    {
        id: "RegisterActorCreated"
        documentation: "新しく作れば 201"
        protocol: restJson1
        code: 201
        headers: { "Content-Type": "application/json" }
        body: """
            {"actor":{"id":"019abcde-0000-7000-8000-000000000001","name":"se.1","kind":"ai"},"created":true}"""
        bodyMediaType: "application/json"
        params: {
            actor: { id: "019abcde-0000-7000-8000-000000000001", name: "se.1", kind: "ai" }
            created: true
            status: 201
        }
    }
    {
        id: "RegisterActorExisting"
        documentation: "鍵が既にあれば、そのアクターを 200 で返す"
        protocol: restJson1
        code: 200
        headers: { "Content-Type": "application/json" }
        body: """
            {"actor":{"id":"019abcde-0000-7000-8000-000000000001","name":"se.1","kind":"ai"},"created":false}"""
        bodyMediaType: "application/json"
        params: {
            actor: { id: "019abcde-0000-7000-8000-000000000001", name: "se.1", kind: "ai" }
            created: false
            status: 200
        }
    }
])
operation RegisterActor {
    input := {
        /// 出し手（tpm・pagetray など）。名の番号と鍵は、出し手ごとに分かれる。
        @required
        issuer: Name

        @required
        kind: ActorKind

        /// 名の接頭辞（名は `<接頭辞>.<番号>`）。
        @required
        namePrefix: NamePrefix

        /// 札（project など）。新しく作った時だけ書く。
        labels: Labels

        /// 付随する id。初めの物が鍵（1 つのアクターにだけ付く）。鍵でない物は、同じ種類の最新と違う時だけ足す。
        @required
        bindings: Bindings

        /// 送り手の時刻。
        @required
        sentAt: DateTime

        /// 頼んだ model と effort。最新と違う時だけ足す。
        settings: RequestedSettings
    }

    output := {
        @required
        actor: ActorSummary

        /// 新しく作ったか。
        @required
        created: Boolean

        /// 新しく作れば 201、鍵が既にあれば 200。
        @required
        @httpResponseCode
        status: Integer
    }

    errors: [
        ValidationException
        Unavailable
        InternalError
    ]
}

/// 出し手・付随する id の種類・ラベルの鍵・model・effort の名: 英小文字・数字・`-`・`.` で 64 字まで。
@pattern("^[a-z0-9.-]{1,64}$")
string Name

/// 名の接頭辞: 英小文字・数字・`-` で 32 字まで。
@pattern("^[a-z0-9-]{1,32}$")
string NamePrefix

/// 値: 空でなく、制御文字（Unicode の Cc）の無い、256 字までの字。
@length(min: 1, max: 256)
@pattern("^[^\\x00-\\x1F\\x7F-\\x9F]*$")
string Text

/// 札（鍵は名の形）。
map Labels {
    key: Name
    value: Text
}

/// 付随する id 1 つ（claude.session・tpm.person・cmux.workspace.ref など）。
structure Binding {
    @required
    type: Name

    @required
    value: Text
}

/// 付随する id の並び（1 つ以上。初めの物が鍵）。
@length(min: 1)
list Bindings {
    member: Binding
}

/// 頼んだ model と effort。
structure RequestedSettings {
    @required
    model: Name

    @required
    effort: Name
}

/// 1 つのアクターの全部（札・付随する id・出来事・model と effort・線・今の状態）。1 つの読む transaction の中で、揃った写しを読む。
/// 札は map（JSON の鍵の順は決まらない。並べる時は client の側で）、ほかの並びは受けた順（seq）。`currentBindings` は種類ごとの最新を種類の順に、`currentSettings` は最新の 1 つ（無ければ無い）。
@readonly
@http(method: "GET", uri: "/api/actors/{actorId}")
@httpRequestTests([
    {
        id: "GetActorRequest"
        documentation: "アクターの id を道に入れる"
        protocol: restJson1
        method: "GET"
        uri: "/api/actors/019abcde-0000-7000-8000-000000000001"
        params: { actorId: "019abcde-0000-7000-8000-000000000001" }
    }
])
@httpResponseTests([
    {
        id: "GetActorResponse"
        documentation: "欄の名は camelCase。出来事の detail は送られた JSON の物と同じ中身（鍵の順は決まらない）"
        protocol: restJson1
        code: 200
        headers: { "Content-Type": "application/json" }
        body: """
            {"id":"019abcde-0000-7000-8000-000000000001","name":"se.1","kind":"ai","issuer":"tpm","sentAt":"2026-11-24T00:00:00Z","receivedAt":"2026-11-24T00:00:01Z","clockSkew":false,"labels":{"project":"castlist"},"bindings":[{"issuer":"tpm","type":"claude.session","value":"s-1","isKey":true,"sentAt":"2026-11-24T00:00:00Z","receivedAt":"2026-11-24T00:00:01Z"}],"currentBindings":[{"issuer":"tpm","type":"claude.session","value":"s-1","isKey":true,"sentAt":"2026-11-24T00:00:00Z","receivedAt":"2026-11-24T00:00:01Z"}],"events":[{"id":"e-1","actorId":"019abcde-0000-7000-8000-000000000001","type":"closed","detail":{"inferred":true,"reason":"workspace_gone"},"sentAt":"2026-11-24T00:00:00Z","receivedAt":"2026-11-24T00:00:01Z","clockSkew":false}],"settings":[{"actorId":"019abcde-0000-7000-8000-000000000001","model":"claude-opus-5-5","effort":"high","source":"requested","sentAt":"2026-11-24T00:00:00Z","receivedAt":"2026-11-24T00:00:01Z","clockSkew":false}],"currentSettings":{"actorId":"019abcde-0000-7000-8000-000000000001","model":"claude-opus-5-5","effort":"high","source":"requested","sentAt":"2026-11-24T00:00:00Z","receivedAt":"2026-11-24T00:00:01Z","clockSkew":false},"linksIn":[{"id":"l-1","type":"launched","from":"019abcde-0000-7000-8000-000000000002","to":"019abcde-0000-7000-8000-000000000001","sentAt":"2026-11-24T00:00:00Z","receivedAt":"2026-11-24T00:00:01Z","clockSkew":false}],"linksOut":[],"state":{"presence":"closed","present":false,"inferred":true,"exitedAt":"2026-11-24T00:00:01Z"},"asOf":"2026-11-24T00:00:02Z"}"""
        bodyMediaType: "application/json"
        params: {
            id: "019abcde-0000-7000-8000-000000000001"
            name: "se.1"
            kind: "ai"
            issuer: "tpm"
            sentAt: 1795478400
            receivedAt: 1795478401
            clockSkew: false
            labels: { project: "castlist" }
            bindings: [
                { issuer: "tpm", type: "claude.session", value: "s-1", isKey: true, sentAt: 1795478400, receivedAt: 1795478401 }
            ]
            currentBindings: [
                { issuer: "tpm", type: "claude.session", value: "s-1", isKey: true, sentAt: 1795478400, receivedAt: 1795478401 }
            ]
            events: [
                {
                    id: "e-1"
                    actorId: "019abcde-0000-7000-8000-000000000001"
                    type: "closed"
                    detail: { inferred: true, reason: "workspace_gone" }
                    sentAt: 1795478400
                    receivedAt: 1795478401
                    clockSkew: false
                }
            ]
            settings: [
                {
                    actorId: "019abcde-0000-7000-8000-000000000001"
                    model: "claude-opus-5-5"
                    effort: "high"
                    source: "requested"
                    sentAt: 1795478400
                    receivedAt: 1795478401
                    clockSkew: false
                }
            ]
            currentSettings: {
                actorId: "019abcde-0000-7000-8000-000000000001"
                model: "claude-opus-5-5"
                effort: "high"
                source: "requested"
                sentAt: 1795478400
                receivedAt: 1795478401
                clockSkew: false
            }
            linksIn: [
                {
                    id: "l-1"
                    type: "launched"
                    from: "019abcde-0000-7000-8000-000000000002"
                    to: "019abcde-0000-7000-8000-000000000001"
                    sentAt: 1795478400
                    receivedAt: 1795478401
                    clockSkew: false
                }
            ]
            linksOut: []
            state: { presence: "closed", present: false, inferred: true, exitedAt: 1795478401 }
            asOf: 1795478402
        }
    }
])
operation GetActor {
    input := {
        @required
        @httpLabel
        actorId: ActorId
    }

    output := {
        @required
        id: ActorId

        /// `<接頭辞>.<番号>`。
        @required
        name: String

        @required
        kind: ActorKind

        /// 出し手。
        @required
        issuer: Name

        /// 登録の送り手の時刻。
        @required
        sentAt: DateTime

        /// 登録を受けた castlist の時刻。
        @required
        receivedAt: DateTime

        /// 送り手の時刻と受けた時刻が 5 分より離れていたか。
        @required
        clockSkew: Boolean

        /// 札（登録の時に書いた物）。
        @required
        labels: Labels

        /// 付随する id の全部（受けた順）。
        @required
        bindings: ActorBindings

        /// 種類ごとの最新（種類の順）。
        @required
        currentBindings: ActorBindings

        /// 出来事の全部（受けた順）。
        @required
        events: Events

        /// model と effort の全部（受けた順）。
        @required
        settings: Settings

        /// model と effort の最新（受けた順で）。1 つも無ければ無い。
        currentSettings: Setting

        /// このアクターへの線（受けた順）。
        @required
        linksIn: Links

        /// このアクターからの線（受けた順）。
        @required
        linksOut: Links

        @required
        state: ActorState

        /// 読み始める前の castlist の時刻。
        @required
        asOf: DateTime
    }

    errors: [
        NotFound
        ValidationException
        Unavailable
        InternalError
    ]
}

/// アクターを条件で探す（監査の検索）。条件はどれも AND。時刻の条件は、どれも castlist が受けた時刻（`receivedAt`）で比べる。
/// 索引で引ける条件（`label`・`binding`・`activeFrom`・`activeTo`・`active` が true・`model`・`effort`・`launchedBy`・`skewed`）が
/// 1 つも無ければ 400（`kind` と `active` が false は、それだけでは数えない）。
/// - `label` は `鍵:値`。重ねれば、どれも持つアクター。
/// - `binding` は `種類:値`。`at`（既定は `asOf`）までに受けた、その値の付随する id の最新の行（出し手と鍵かを問わない）のアクター 1 つ。
///   `at` は `binding` と一緒にだけ付ける（無ければ 400）。
/// - `activeFrom`・`activeTo` は稼働した期間（初めの登場から最後の退場まで。稼働中なら今まで）が窓に掛かるアクター（両端を含む）。
///   登場していないアクターは入らない。
/// - `active` は今稼働中か。`model`・`effort` は、その名の model か effort の行を 1 つでも持つ。`launchedBy` は、そのアクターが起こした（launched）。
/// - `skewed` は時刻ずれの行（アクター・出来事・model と effort）を持つ。true だけを受ける（false は 400。絞らないなら付けない）。
/// - 並びは `sort`（`entered` は初めの登場・`exited` は最後の退場。既定 `entered`）と `order`（既定 `asc`）。値の無いアクターは昇順で先・降順で後。
///   同じ値は受けた順（同じ向き）。
/// - 頁は keyset で分ける（並べる値と受けた順で後ろから続けるので、辿る間に行が足されても、元の組に穴も重なりも出ない）。
///   `nextToken` は同じ `sort` と `order` の答えの物を渡す（違えば 400。ほかの条件は見ない）。
@readonly
@paginated(inputToken: "nextToken", outputToken: "nextToken", pageSize: "maxResults", items: "actors")
@http(method: "GET", uri: "/api/actors")
@httpRequestTests([
    {
        id: "ListActorsRequest"
        documentation: "引数の名は camelCase。label は重ねられる"
        protocol: restJson1
        method: "GET"
        uri: "/api/actors"
        queryParams: [
            "label=project%3Acastlist"
            "label=tpm.role%3Aauditor"
            "binding=cmux.workspace.ref%3Aworkspace%3A3"
            "at=2026-11-24T00%3A00%3A00Z"
            "activeFrom=2026-11-24T00%3A00%3A00Z"
            "activeTo=2026-11-25T00%3A00%3A00Z"
            "kind=ai"
            "model=claude-opus-5-5"
            "effort=high"
            "active=true"
            "launchedBy=019abcde-0000-7000-8000-000000000002"
            "skewed=true"
            "sort=exited"
            "order=desc"
            "maxResults=10"
            "nextToken=abc"
        ]
        params: {
            label: ["project:castlist", "tpm.role:auditor"]
            binding: "cmux.workspace.ref:workspace:3"
            at: 1795478400
            activeFrom: 1795478400
            activeTo: 1795564800
            kind: "ai"
            model: "claude-opus-5-5"
            effort: "high"
            active: true
            launchedBy: "019abcde-0000-7000-8000-000000000002"
            skewed: true
            sort: "exited"
            order: "desc"
            maxResults: 10
            nextToken: "abc"
        }
    }
])
@httpResponseTests([
    {
        id: "ListActorsResponse"
        documentation: "行は一覧の形（url はプロフィールの頁）。次の頁が無ければ nextToken が無い"
        protocol: restJson1
        code: 200
        headers: { "Content-Type": "application/json" }
        body: """
            {"asOf":"2026-11-24T00:00:02Z","actors":[{"id":"019abcde-0000-7000-8000-000000000001","name":"se.1","kind":"ai","issuer":"tpm","sentAt":"2026-11-24T00:00:00Z","receivedAt":"2026-11-24T00:00:01Z","clockSkew":false,"labels":{"project":"castlist"},"firstEnteredAt":"2026-11-24T00:00:01Z","lastExitedAt":"2026-11-24T00:00:02Z","lastExitType":"closed","present":false,"inferred":true,"model":"claude-opus-5-5","effort":"high","url":"/actors/019abcde-0000-7000-8000-000000000001"}]}"""
        bodyMediaType: "application/json"
        params: {
            asOf: 1795478402
            actors: [
                {
                    id: "019abcde-0000-7000-8000-000000000001"
                    name: "se.1"
                    kind: "ai"
                    issuer: "tpm"
                    sentAt: 1795478400
                    receivedAt: 1795478401
                    clockSkew: false
                    labels: { project: "castlist" }
                    firstEnteredAt: 1795478401
                    lastExitedAt: 1795478402
                    lastExitType: "closed"
                    present: false
                    inferred: true
                    model: "claude-opus-5-5"
                    effort: "high"
                    url: "/actors/019abcde-0000-7000-8000-000000000001"
                }
            ]
        }
    }
    {
        id: "ListActorsResponseWithNextToken"
        documentation: "次の頁があれば nextToken を付ける"
        protocol: restJson1
        code: 200
        headers: { "Content-Type": "application/json" }
        body: """
            {"asOf":"2026-11-24T00:00:00Z","actors":[],"nextToken":"abc"}"""
        bodyMediaType: "application/json"
        params: { asOf: 1795478400, actors: [], nextToken: "abc" }
    }
])
operation ListActors {
    input := {
        /// ラベル（`鍵:値`）。重ねれば、どれも持つアクター。
        @httpQuery("label")
        label: LabelFilters

        /// 付随する id（`種類:値`）。
        @httpQuery("binding")
        binding: ActorRef

        /// `binding` を引く時刻（既定は `asOf`）。`binding` と一緒にだけ付ける。
        @httpQuery("at")
        at: DateTime

        /// 稼働した期間の窓の始め（両端を含む）。
        @httpQuery("activeFrom")
        activeFrom: DateTime

        /// 稼働した期間の窓の終わり（両端を含む）。
        @httpQuery("activeTo")
        activeTo: DateTime

        @httpQuery("kind")
        kind: ActorKind

        /// その名の model の行を 1 つでも持つ。
        @httpQuery("model")
        model: Name

        /// その名の effort の行を 1 つでも持つ。
        @httpQuery("effort")
        effort: Name

        /// 今稼働中か。
        @httpQuery("active")
        active: Boolean

        /// このアクターが起こした（launched）。
        @httpQuery("launchedBy")
        launchedBy: ActorId

        /// 時刻ずれの行を持つ（true だけ）。
        @httpQuery("skewed")
        skewed: Boolean

        /// `entered`（初めの登場。既定）か `exited`（最後の退場）。
        @httpQuery("sort")
        sort: ActorSort

        /// `asc`（既定）か `desc`。
        @httpQuery("order")
        order: SortOrder

        /// 1 頁の数（既定 100）。
        @httpQuery("maxResults")
        maxResults: MaxResults

        /// 前の答えの `nextToken`。
        @httpQuery("nextToken")
        nextToken: NextToken
    }

    output := {
        /// 読み始める前の castlist の時刻。
        @required
        asOf: DateTime

        @required
        actors: ActorRows

        /// 次の頁の印。終わりなら無い。
        nextToken: NextToken
    }

    errors: [
        ValidationException
        Unavailable
        InternalError
    ]
}

/// ラベルの絞り: `鍵:値`。初めの `:` で分ける。鍵は名の形、値は空でなく制御文字の無い 256 字まで。
@pattern("^[a-z0-9.-]{1,64}:[^\\x00-\\x1F\\x7F-\\x9F]{1,256}$")
string LabelFilter

list LabelFilters {
    member: LabelFilter
}

/// アクターの一覧の並べ方: 初めの登場（`entered`）・最後の退場（`exited`）。
@pattern("^(entered|exited)$")
string ActorSort

/// 並べる向き。
@pattern("^(asc|desc)$")
string SortOrder

/// 一覧の 1 行（アクター）。
structure ActorRow {
    @required
    id: ActorId

    @required
    name: String

    @required
    kind: ActorKind

    @required
    issuer: Name

    /// 登録の送り手の時刻。
    @required
    sentAt: DateTime

    /// 登録を受けた castlist の時刻。
    @required
    receivedAt: DateTime

    @required
    clockSkew: Boolean

    /// ラベル（JSON の鍵の順は決まらない）。
    @required
    labels: Labels

    /// 初めの登場（entered・reentered・forked）を受けた時刻。
    firstEnteredAt: DateTime

    /// 最後の退場（cleared・exited・closed）を受けた時刻。
    lastExitedAt: DateTime

    /// 最後の退場の種類。
    lastExitType: EventType

    /// 今稼働中か。
    @required
    present: Boolean

    /// 今の停止が推しか（GetActor の `state.inferred` と同じ）。
    @required
    inferred: Boolean

    /// 最新の model（受けた順で）。
    model: Name

    /// 最新の effort（受けた順で）。
    effort: Name

    /// プロフィールの頁の path（`/actors/{id}`）。
    @required
    url: String
}

list ActorRows {
    member: ActorRow
}

/// 起こした・継いだ線を上り下りする。上りは人で止める（人は含む。起点が人なら上らない）。
/// 既定の深さは上 20 段・下 1 段で、`depth` を付ければ両方にそれを使う。`type` は上りと下りの両方の線を絞る。
/// `nodes` は一覧の形を初めの登場の順（同じなら受けた順）に、`edges` は線を受けた順に、重ならずに返す。
@readonly
@http(method: "GET", uri: "/api/actors/{actorId}/lineage")
@httpRequestTests([
    {
        id: "GetLineageRequest"
        documentation: "向き・深さ・線の種類は引数"
        protocol: restJson1
        method: "GET"
        uri: "/api/actors/019abcde-0000-7000-8000-000000000001/lineage"
        queryParams: ["direction=up", "depth=3", "type=launched"]
        params: {
            actorId: "019abcde-0000-7000-8000-000000000001"
            direction: "up"
            depth: 3
            type: "launched"
        }
    }
])
@httpResponseTests([
    {
        id: "GetLineageResponse"
        documentation: "点は一覧の形、線は GetActor の線と同じ形"
        protocol: restJson1
        code: 200
        headers: { "Content-Type": "application/json" }
        body: """
            {"asOf":"2026-11-24T00:00:02Z","actorId":"019abcde-0000-7000-8000-000000000001","nodes":[{"id":"019abcde-0000-7000-8000-000000000001","name":"se.1","kind":"ai","issuer":"tpm","sentAt":"2026-11-24T00:00:00Z","receivedAt":"2026-11-24T00:00:01Z","clockSkew":false,"labels":{},"present":false,"inferred":false,"url":"/actors/019abcde-0000-7000-8000-000000000001"}],"edges":[{"id":"l-1","type":"launched","from":"019abcde-0000-7000-8000-000000000002","to":"019abcde-0000-7000-8000-000000000001","sentAt":"2026-11-24T00:00:00Z","receivedAt":"2026-11-24T00:00:01Z","clockSkew":false}]}"""
        bodyMediaType: "application/json"
        params: {
            asOf: 1795478402
            actorId: "019abcde-0000-7000-8000-000000000001"
            nodes: [
                {
                    id: "019abcde-0000-7000-8000-000000000001"
                    name: "se.1"
                    kind: "ai"
                    issuer: "tpm"
                    sentAt: 1795478400
                    receivedAt: 1795478401
                    clockSkew: false
                    labels: {}
                    present: false
                    inferred: false
                    url: "/actors/019abcde-0000-7000-8000-000000000001"
                }
            ]
            edges: [
                {
                    id: "l-1"
                    type: "launched"
                    from: "019abcde-0000-7000-8000-000000000002"
                    to: "019abcde-0000-7000-8000-000000000001"
                    sentAt: 1795478400
                    receivedAt: 1795478401
                    clockSkew: false
                }
            ]
        }
    }
])
operation GetLineage {
    input := {
        @required
        @httpLabel
        actorId: ActorId

        /// `up`・`down`・`both`（既定）。
        @httpQuery("direction")
        direction: LineageDirection

        /// 辿る段の数（1 から 20）。無ければ上 20 段・下 1 段。
        @httpQuery("depth")
        depth: LineageDepth

        /// 線の種類で絞る（上りと下りの両方）。
        @httpQuery("type")
        type: LinkType
    }

    output := {
        /// 読み始める前の castlist の時刻。
        @required
        asOf: DateTime

        /// 起点のアクター。
        @required
        actorId: ActorId

        /// 起点と、辿って着いたアクター（初めの登場の順。同じなら受けた順）。
        @required
        nodes: ActorRows

        /// 辿った線（受けた順）。
        @required
        edges: Links
    }

    errors: [
        NotFound
        ValidationException
        Unavailable
        InternalError
    ]
}

/// 線を辿る向き。
@pattern("^(up|down|both)$")
string LineageDirection

/// 線を辿る段の数。
@range(min: 1, max: 20)
integer LineageDepth

/// あるアクターの model と effort の行の全部（受けた順）。頁は分けない（1 つのアクターの行は少ない。今の server と同じ）。
@readonly
@http(method: "GET", uri: "/api/actors/{actorId}/settings")
@httpRequestTests([
    {
        id: "ListActorSettingsRequest"
        documentation: "引数は無い"
        protocol: restJson1
        method: "GET"
        uri: "/api/actors/019abcde-0000-7000-8000-000000000001/settings"
        params: { actorId: "019abcde-0000-7000-8000-000000000001" }
    }
])
@httpResponseTests([
    {
        id: "ListActorSettingsResponse"
        documentation: "行は GetActor の model と effort と同じ形（登録の時に頼んだ物には id が無い）"
        protocol: restJson1
        code: 200
        headers: { "Content-Type": "application/json" }
        body: """
            {"asOf":"2026-11-24T00:00:02Z","actorId":"019abcde-0000-7000-8000-000000000001","settings":[{"actorId":"019abcde-0000-7000-8000-000000000001","model":"claude-opus-5-5","effort":"high","source":"requested","sentAt":"2026-11-24T00:00:00Z","receivedAt":"2026-11-24T00:00:01Z","clockSkew":false},{"id":"t-1","actorId":"019abcde-0000-7000-8000-000000000001","model":"claude-sonnet-5","effort":"high","source":"observed","sentAt":"2026-11-24T00:00:01Z","receivedAt":"2026-11-24T00:00:02Z","clockSkew":false}]}"""
        bodyMediaType: "application/json"
        params: {
            asOf: 1795478402
            actorId: "019abcde-0000-7000-8000-000000000001"
            settings: [
                {
                    actorId: "019abcde-0000-7000-8000-000000000001"
                    model: "claude-opus-5-5"
                    effort: "high"
                    source: "requested"
                    sentAt: 1795478400
                    receivedAt: 1795478401
                    clockSkew: false
                }
                {
                    id: "t-1"
                    actorId: "019abcde-0000-7000-8000-000000000001"
                    model: "claude-sonnet-5"
                    effort: "high"
                    source: "observed"
                    sentAt: 1795478401
                    receivedAt: 1795478402
                    clockSkew: false
                }
            ]
        }
    }
])
operation ListActorSettings {
    input := {
        @required
        @httpLabel
        actorId: ActorId
    }

    output := {
        /// 読み始める前の castlist の時刻。
        @required
        asOf: DateTime

        @required
        actorId: ActorId

        /// 受けた順。
        @required
        settings: Settings
    }

    errors: [
        NotFound
        ValidationException
        Unavailable
        InternalError
    ]
}

/// ある時刻に効いていた model と effort: 受けた時刻（`receivedAt`）がその時刻まで（含む）の行のうち、最新（受けた順で）の 1 つ。
/// 無ければ `setting` が無い。`time` は DB に残す字（UTC・ミリ秒まで。ミリ秒より下は切る）に直して比べ、直した物を `at` で返す。
@readonly
@http(method: "GET", uri: "/api/actors/{actorId}/settings/at")
@httpRequestTests([
    {
        id: "GetActorSettingAtRequest"
        documentation: "時刻は引数 time"
        protocol: restJson1
        method: "GET"
        uri: "/api/actors/019abcde-0000-7000-8000-000000000001/settings/at"
        queryParams: ["time=2026-11-24T00%3A00%3A01Z"]
        params: { actorId: "019abcde-0000-7000-8000-000000000001", time: 1795478401 }
    }
])
@httpResponseTests([
    {
        id: "GetActorSettingAtResponse"
        documentation: "その時に効いていた 1 行"
        protocol: restJson1
        code: 200
        headers: { "Content-Type": "application/json" }
        body: """
            {"asOf":"2026-11-24T00:00:02Z","actorId":"019abcde-0000-7000-8000-000000000001","at":"2026-11-24T00:00:01Z","setting":{"actorId":"019abcde-0000-7000-8000-000000000001","model":"claude-opus-5-5","effort":"high","source":"requested","sentAt":"2026-11-24T00:00:00Z","receivedAt":"2026-11-24T00:00:01Z","clockSkew":false}}"""
        bodyMediaType: "application/json"
        params: {
            asOf: 1795478402
            actorId: "019abcde-0000-7000-8000-000000000001"
            at: 1795478401
            setting: {
                actorId: "019abcde-0000-7000-8000-000000000001"
                model: "claude-opus-5-5"
                effort: "high"
                source: "requested"
                sentAt: 1795478400
                receivedAt: 1795478401
                clockSkew: false
            }
        }
    }
    {
        id: "GetActorSettingAtResponseNone"
        documentation: "その時までに行が無ければ setting が無い"
        protocol: restJson1
        code: 200
        headers: { "Content-Type": "application/json" }
        body: """
            {"asOf":"2026-11-24T00:00:02Z","actorId":"019abcde-0000-7000-8000-000000000001","at":"2000-01-01T00:00:00Z"}"""
        bodyMediaType: "application/json"
        params: {
            asOf: 1795478402
            actorId: "019abcde-0000-7000-8000-000000000001"
            at: 946684800
        }
    }
])
operation GetActorSettingAt {
    input := {
        @required
        @httpLabel
        actorId: ActorId

        /// 効いていた物を引く時刻。
        @required
        @httpQuery("time")
        time: DateTime
    }

    output := {
        /// 読み始める前の castlist の時刻。
        @required
        asOf: DateTime

        @required
        actorId: ActorId

        /// 問いの時刻を、比べた形（UTC・ミリ秒まで）に直した物。
        @required
        at: DateTime

        /// その時に効いていた行。無ければ無い。
        setting: Setting
    }

    errors: [
        NotFound
        ValidationException
        Unavailable
        InternalError
    ]
}

/// model と effort の行を、アクターをまたいで探す（監査の検索）。条件はどれも AND で、無くてもよい。並びは受けた順。
/// - `model`・`effort`・`source` はその名・出の行。`from`・`to` は受けた時刻（`receivedAt`）の窓（両端を含む）。
/// - `mismatch` は、見た（`observed`）行のうち、同じアクターのそれより前の最新の頼んだ（`requested`）行と、model か effort が違う物。
///   前に頼んだ行の無い見た行は入らない。true だけを受ける（false は 400。絞らないなら付けない）。
/// - `skewed` は時刻ずれの行。true だけを受ける（false は 400）。
/// - 頁は受けた順で後ろから続ける（辿る間に行が足されても、元の組に穴も重なりも出ない）。`nextToken` はこの検索の答えの物を渡す（違えば 400）。
@readonly
@paginated(inputToken: "nextToken", outputToken: "nextToken", pageSize: "maxResults", items: "settings")
@http(method: "GET", uri: "/api/settings")
@httpRequestTests([
    {
        id: "ListSettingsRequest"
        documentation: "引数の名は camelCase"
        protocol: restJson1
        method: "GET"
        uri: "/api/settings"
        queryParams: [
            "model=claude-opus-5-5"
            "effort=high"
            "source=observed"
            "from=2026-11-24T00%3A00%3A00Z"
            "to=2026-11-25T00%3A00%3A00Z"
            "mismatch=true"
            "skewed=true"
            "maxResults=10"
            "nextToken=abc"
        ]
        params: {
            model: "claude-opus-5-5"
            effort: "high"
            source: "observed"
            from: 1795478400
            to: 1795564800
            mismatch: true
            skewed: true
            maxResults: 10
            nextToken: "abc"
        }
    }
])
@httpResponseTests([
    {
        id: "ListSettingsResponse"
        documentation: "行は model と effort の形にアクターの名を足した物"
        protocol: restJson1
        code: 200
        headers: { "Content-Type": "application/json" }
        body: """
            {"asOf":"2026-11-24T00:00:02Z","settings":[{"id":"t-1","actorId":"019abcde-0000-7000-8000-000000000001","actorName":"se.1","model":"claude-sonnet-5","effort":"high","source":"observed","sentAt":"2026-11-24T00:00:01Z","receivedAt":"2026-11-24T00:00:02Z","clockSkew":false}],"nextToken":"abc"}"""
        bodyMediaType: "application/json"
        params: {
            asOf: 1795478402
            settings: [
                {
                    id: "t-1"
                    actorId: "019abcde-0000-7000-8000-000000000001"
                    actorName: "se.1"
                    model: "claude-sonnet-5"
                    effort: "high"
                    source: "observed"
                    sentAt: 1795478401
                    receivedAt: 1795478402
                    clockSkew: false
                }
            ]
            nextToken: "abc"
        }
    }
])
operation ListSettings {
    input := {
        @httpQuery("model")
        model: Name

        @httpQuery("effort")
        effort: Name

        /// `requested`（頼んだ）か `observed`（見た）。
        @httpQuery("source")
        source: SettingSource

        /// 受けた時刻の窓の始め（含む）。
        @httpQuery("from")
        from: DateTime

        /// 受けた時刻の窓の終わり（含む）。
        @httpQuery("to")
        to: DateTime

        /// 見た物が、その前に頼んだ物と違う行（true だけ）。
        @httpQuery("mismatch")
        mismatch: Boolean

        /// 時刻ずれの行（true だけ）。
        @httpQuery("skewed")
        skewed: Boolean

        /// 1 頁の数（既定 100）。
        @httpQuery("maxResults")
        maxResults: MaxResults

        /// 前の答えの `nextToken`。
        @httpQuery("nextToken")
        nextToken: NextToken
    }

    output := {
        /// 読み始める前の castlist の時刻。
        @required
        asOf: DateTime

        /// 受けた順。
        @required
        settings: SettingRows

        /// 次の頁の印。終わりなら無い。
        nextToken: NextToken
    }

    errors: [
        ValidationException
        Unavailable
        InternalError
    ]
}

/// 出来事を、アクターをまたいで探す（監査の検索）。条件はどれも AND で、無くてもよい。並びは受けた順。
/// - `type` は重ねれば、どれかの種類（OR）。`actor` はそのアクターの出来事。`from`・`to` は受けた時刻（`receivedAt`）の窓（両端を含む）。
/// - `reason`・`source` は `detail` の同じ名の欄が、その字と等しい出来事。
/// - `skewed` は時刻ずれの行。true だけを受ける（false は 400）。
/// - 頁は受けた順で後ろから続ける（辿る間に行が足されても、元の組に穴も重なりも出ない）。`nextToken` はこの検索の答えの物を渡す（違えば 400）。
@readonly
@paginated(inputToken: "nextToken", outputToken: "nextToken", pageSize: "maxResults", items: "events")
@http(method: "GET", uri: "/api/events")
@httpRequestTests([
    {
        id: "ListEventsRequest"
        documentation: "引数の名は camelCase。type は重ねられる"
        protocol: restJson1
        method: "GET"
        uri: "/api/events"
        queryParams: [
            "type=model_unreadable"
            "type=closed"
            "actor=019abcde-0000-7000-8000-000000000001"
            "from=2026-11-24T00%3A00%3A00Z"
            "to=2026-11-25T00%3A00%3A00Z"
            "reason=timeout"
            "source=clear"
            "skewed=true"
            "maxResults=10"
            "nextToken=abc"
        ]
        params: {
            type: ["model_unreadable", "closed"]
            actor: "019abcde-0000-7000-8000-000000000001"
            from: 1795478400
            to: 1795564800
            reason: "timeout"
            source: "clear"
            skewed: true
            maxResults: 10
            nextToken: "abc"
        }
    }
])
@httpResponseTests([
    {
        id: "ListEventsResponse"
        documentation: "行は出来事の形にアクターの名を足した物"
        protocol: restJson1
        code: 200
        headers: { "Content-Type": "application/json" }
        body: """
            {"asOf":"2026-11-24T00:00:02Z","events":[{"id":"e-1","actorId":"019abcde-0000-7000-8000-000000000001","actorName":"se.1","type":"model_unreadable","detail":{"reason":"timeout"},"sentAt":"2026-11-24T00:00:00Z","receivedAt":"2026-11-24T00:00:01Z","clockSkew":false}]}"""
        bodyMediaType: "application/json"
        params: {
            asOf: 1795478402
            events: [
                {
                    id: "e-1"
                    actorId: "019abcde-0000-7000-8000-000000000001"
                    actorName: "se.1"
                    type: "model_unreadable"
                    detail: { reason: "timeout" }
                    sentAt: 1795478400
                    receivedAt: 1795478401
                    clockSkew: false
                }
            ]
        }
    }
])
operation ListEvents {
    input := {
        /// 出来事の種類。重ねれば、どれか。
        @httpQuery("type")
        type: EventTypes

        /// このアクターの出来事。
        @httpQuery("actor")
        actor: ActorId

        /// 受けた時刻の窓の始め（含む）。
        @httpQuery("from")
        from: DateTime

        /// 受けた時刻の窓の終わり（含む）。
        @httpQuery("to")
        to: DateTime

        /// `detail.reason` がこの字と等しい。
        @httpQuery("reason")
        reason: Text

        /// `detail.source` がこの字と等しい。
        @httpQuery("source")
        source: Text

        /// 時刻ずれの行（true だけ）。
        @httpQuery("skewed")
        skewed: Boolean

        /// 1 頁の数（既定 100）。
        @httpQuery("maxResults")
        maxResults: MaxResults

        /// 前の答えの `nextToken`。
        @httpQuery("nextToken")
        nextToken: NextToken
    }

    output := {
        /// 読み始める前の castlist の時刻。
        @required
        asOf: DateTime

        /// 受けた順。
        @required
        events: EventRows

        /// 次の頁の印。終わりなら無い。
        nextToken: NextToken
    }

    errors: [
        ValidationException
        Unavailable
        InternalError
    ]
}

list EventTypes {
    member: EventType
}

/// 図（タイムライン・相関図）の点と線。`label`（`鍵:値`）と、登録を受けた時刻（`receivedAt`）の窓（`from`・`to`。両端を含む）で
/// アクターの組を絞り、組に触れる線（`from` か `to` が組の中）の全部と、その線の向こうの端のアクター（一歩だけ）も含める（人の根が切れないように）。
/// どれも無ければ全部のアクター。点も線も受けた順（seq）。重い読みの接続（2 本）だけを使い、引き当てなどの軽い読みを待たせない。
/// 引数はどれも 1 つだけ（restJson1 は、2 度付ければ初めの物を使う）。
@readonly
@http(method: "GET", uri: "/api/graph")
@httpRequestTests([
    {
        id: "GetGraphRequest"
        documentation: "ラベルと、登録を受けた時刻の窓は引数"
        protocol: restJson1
        method: "GET"
        uri: "/api/graph"
        queryParams: ["label=tpm.key%3At-23zs", "from=2026-11-24T00%3A00%3A00Z", "to=2026-11-25T00%3A00%3A00Z"]
        params: { label: "tpm.key:t-23zs", from: 1795478400, to: 1795564800 }
    }
    {
        id: "GetGraphRequestWithoutParams"
        documentation: "引数はどれも無くてよい（全部のアクター）"
        protocol: restJson1
        method: "GET"
        uri: "/api/graph"
        params: {}
    }
])
@httpResponseTests([
    {
        id: "GetGraphResponse"
        documentation: "点は登録の欄と今の状態と最新の model と effort、線は GetActor の線と同じ形"
        protocol: restJson1
        code: 200
        headers: { "Content-Type": "application/json" }
        body: """
            {"asOf":"2026-11-24T00:00:02Z","nodes":[{"id":"019abcde-0000-7000-8000-000000000001","name":"se.1","kind":"ai","issuer":"tpm","sentAt":"2026-11-24T00:00:00Z","receivedAt":"2026-11-24T00:00:01Z","clockSkew":false,"state":{"presence":"entered","present":true,"inferred":false,"enteredAt":"2026-11-24T00:00:01Z"},"currentSettings":{"actorId":"019abcde-0000-7000-8000-000000000001","model":"claude-opus-5-5","effort":"high","source":"requested","sentAt":"2026-11-24T00:00:00Z","receivedAt":"2026-11-24T00:00:01Z","clockSkew":false}},{"id":"019abcde-0000-7000-8000-000000000002","name":"pm.1","kind":"human","issuer":"tpm","sentAt":"2026-11-24T00:00:00Z","receivedAt":"2026-11-24T00:00:01Z","clockSkew":false,"state":{"present":false,"inferred":false}}],"edges":[{"id":"l-1","type":"launched","from":"019abcde-0000-7000-8000-000000000002","to":"019abcde-0000-7000-8000-000000000001","sentAt":"2026-11-24T00:00:00Z","receivedAt":"2026-11-24T00:00:01Z","clockSkew":false}]}"""
        bodyMediaType: "application/json"
        params: {
            asOf: 1795478402
            nodes: [
                {
                    id: "019abcde-0000-7000-8000-000000000001"
                    name: "se.1"
                    kind: "ai"
                    issuer: "tpm"
                    sentAt: 1795478400
                    receivedAt: 1795478401
                    clockSkew: false
                    state: { presence: "entered", present: true, inferred: false, enteredAt: 1795478401 }
                    currentSettings: {
                        actorId: "019abcde-0000-7000-8000-000000000001"
                        model: "claude-opus-5-5"
                        effort: "high"
                        source: "requested"
                        sentAt: 1795478400
                        receivedAt: 1795478401
                        clockSkew: false
                    }
                }
                {
                    id: "019abcde-0000-7000-8000-000000000002"
                    name: "pm.1"
                    kind: "human"
                    issuer: "tpm"
                    sentAt: 1795478400
                    receivedAt: 1795478401
                    clockSkew: false
                    state: { present: false, inferred: false }
                }
            ]
            edges: [
                {
                    id: "l-1"
                    type: "launched"
                    from: "019abcde-0000-7000-8000-000000000002"
                    to: "019abcde-0000-7000-8000-000000000001"
                    sentAt: 1795478400
                    receivedAt: 1795478401
                    clockSkew: false
                }
            ]
        }
    }
])
operation GetGraph {
    input := {
        /// このラベル（`鍵:値`）を持つアクター。
        @httpQuery("label")
        label: LabelFilter

        /// 登録を受けた時刻の窓の始め（含む）。
        @httpQuery("from")
        from: DateTime

        /// 登録を受けた時刻の窓の終わり（含む）。
        @httpQuery("to")
        to: DateTime
    }

    output := {
        /// 読み始める前の castlist の時刻。
        @required
        asOf: DateTime

        /// 絞った組と、組に触れる線の向こうの端のアクター（受けた順）。
        @required
        nodes: GraphNodes

        /// 組に触れる線の全部（受けた順）。
        @required
        edges: Links
    }

    errors: [
        ValidationException
        Unavailable
        InternalError
    ]
}

/// 図の点 1 つ: 登録の欄と、今の状態と、最新の model と effort。
structure GraphNode {
    @required
    id: ActorId

    /// `<接頭辞>.<番号>`。
    @required
    name: String

    @required
    kind: ActorKind

    /// 出し手。
    @required
    issuer: Name

    /// 登録の送り手の時刻。
    @required
    sentAt: DateTime

    /// 登録を受けた castlist の時刻。
    @required
    receivedAt: DateTime

    /// 送り手の時刻と受けた時刻が 5 分より離れていたか。
    @required
    clockSkew: Boolean

    /// 今の状態（GetActor の state と同じ形）。
    @required
    state: ActorState

    /// model と effort の最新（受けた順で）。1 つも無ければ無い。
    currentSettings: Setting
}

list GraphNodes {
    member: GraphNode
}

/// 鍵の付随する id（`種類:値`）から、出し手の中のアクターを引く。答えは問いと同じ順で、引けない物（知らない・鍵でない・出し手が違う）は `actor` が無い。
/// 1 つでも形の違う参照があれば、全体を 400 で断る。
@http(method: "POST", uri: "/api/resolve")
@httpRequestTests([
    {
        id: "ResolveActorsRequest"
        documentation: "参照は初めの `:` で種類と値に分ける（値に `:` があってよい）"
        protocol: restJson1
        method: "POST"
        uri: "/api/resolve"
        headers: { "Content-Type": "application/json" }
        body: """
            {"issuer":"tpm","refs":["claude.session:s-1","cmux.workspace.ref:workspace:1"]}"""
        bodyMediaType: "application/json"
        params: { issuer: "tpm", refs: ["claude.session:s-1", "cmux.workspace.ref:workspace:1"] }
    }
])
@httpResponseTests([
    {
        id: "ResolveActorsResponse"
        documentation: "問いと同じ順。引けない物は actor が無い"
        protocol: restJson1
        code: 200
        headers: { "Content-Type": "application/json" }
        body: """
            {"asOf":"2026-11-24T00:00:00Z","results":[{"ref":"claude.session:s-1","actor":{"id":"019abcde-0000-7000-8000-000000000001","name":"se.1","kind":"ai"}},{"ref":"claude.session:none"}]}"""
        bodyMediaType: "application/json"
        params: {
            asOf: 1795478400
            results: [
                {
                    ref: "claude.session:s-1"
                    actor: { id: "019abcde-0000-7000-8000-000000000001", name: "se.1", kind: "ai" }
                }
                { ref: "claude.session:none" }
            ]
        }
    }
])
operation ResolveActors {
    input := {
        /// 出し手。鍵は出し手の中で引く。
        @required
        issuer: Name

        /// 引く参照（1 から 100 個）。
        @required
        refs: ActorRefs
    }

    output := {
        /// 読み始める前の castlist の時刻。
        @required
        asOf: DateTime

        /// 問いと同じ順。
        @required
        results: Resolutions
    }

    errors: [
        ValidationException
        Unavailable
        InternalError
    ]
}

/// 出来事を足す。id は送り手が決める。同じ id で同じ本文（写しは docs/src/next.md の「データ」）なら、足さずに前の行を 200 で返し、
/// 本文が違えば 409（前の行はそのまま）。同じ id かは `by` を引くより先に見る。新しく足せば 201。
/// `by` は出し手の中の鍵の付随する id で引き、引けなければ 400。`detail` は JSON の物（無ければ `{}`）で、ほかの形は 400。
@idempotent
@http(method: "PUT", uri: "/api/events/{eventId}")
@httpRequestTests([
    {
        id: "PutEventRequest"
        documentation: "id は道に、本文は camelCase。by は鍵の付随する id"
        protocol: restJson1
        method: "PUT"
        uri: "/api/events/e-1"
        headers: { "Content-Type": "application/json" }
        body: """
            {"issuer":"tpm","by":"claude.session:s-1","type":"closed","detail":{"inferred":true,"reason":"workspace_gone"},"sentAt":"2026-11-24T00:00:00Z"}"""
        bodyMediaType: "application/json"
        params: {
            eventId: "e-1"
            issuer: "tpm"
            by: "claude.session:s-1"
            type: "closed"
            detail: { inferred: true, reason: "workspace_gone" }
            sentAt: 1795478400
        }
    }
])
@httpResponseTests([
    {
        id: "PutEventCreated"
        documentation: "新しく足せば 201 で、足した行を返す"
        protocol: restJson1
        code: 201
        headers: { "Content-Type": "application/json" }
        body: """
            {"id":"e-1","actorId":"019abcde-0000-7000-8000-000000000001","type":"closed","detail":{"inferred":true,"reason":"workspace_gone"},"sentAt":"2026-11-24T00:00:00Z","receivedAt":"2026-11-24T00:00:01Z","clockSkew":false}"""
        bodyMediaType: "application/json"
        params: {
            id: "e-1"
            actorId: "019abcde-0000-7000-8000-000000000001"
            type: "closed"
            detail: { inferred: true, reason: "workspace_gone" }
            sentAt: 1795478400
            receivedAt: 1795478401
            clockSkew: false
            status: 201
        }
    }
    {
        id: "PutEventSame"
        documentation: "同じ id で同じ本文なら 200 で、前の行を返す"
        protocol: restJson1
        code: 200
        headers: { "Content-Type": "application/json" }
        body: """
            {"id":"e-2","actorId":"019abcde-0000-7000-8000-000000000001","type":"entered","detail":{},"sentAt":"2026-11-24T00:00:00Z","receivedAt":"2026-11-24T00:00:01Z","clockSkew":false}"""
        bodyMediaType: "application/json"
        params: {
            id: "e-2"
            actorId: "019abcde-0000-7000-8000-000000000001"
            type: "entered"
            detail: {}
            sentAt: 1795478400
            receivedAt: 1795478401
            clockSkew: false
            status: 200
        }
    }
])
operation PutEvent {
    input := {
        /// 送り手の決める id。
        @required
        @httpLabel
        eventId: SenderId

        /// 出し手。`by` は出し手の中で引く。
        @required
        issuer: Name

        /// 出来事のアクター（鍵の付随する id）。
        @required
        by: ActorRef

        @required
        type: EventType

        /// JSON の物（無ければ `{}`）。
        /// 無い時の要求の例は書かない: smithy-rs（codegen-server 0.1.40）は、例の params に無い Document を、
        /// 無い物（None）でなく JSON の null（Some(Null)）として比べる試験を作り、読んだ物（None）と合わずに落ちるため。
        /// 無い時の振る舞いは、server の試験（crates/server/tests/events.rs）が見る。
        detail: Document

        /// 送り手の時刻。
        @required
        sentAt: DateTime
    }

    output := with [EventFields] {
        /// 新しく足せば 201、同じ id で同じ本文なら 200。
        @required
        @httpResponseCode
        status: Integer
    }

    errors: [
        ValidationException
        Conflict
        Unavailable
        InternalError
    ]
}

/// 線を足す。id は送り手が決める。同じ id の扱いは PutEvent と同じ（同じ本文は 200・違えば 409・`from` と `to` を引くより先に見る）。
/// `from` と `to` は出し手の中の鍵の付随する id で引き、引けなければ 400。同じアクターを指せば 400。
/// 起こされる（`launched` の `to` になる）のは、1 つのアクターに 1 度だけ（2 度目は別の id でも 409）。
@idempotent
@http(method: "PUT", uri: "/api/links/{linkId}")
@httpRequestTests([
    {
        id: "PutLinkRequest"
        documentation: "id は道に、本文は camelCase。from と to は鍵の付随する id"
        protocol: restJson1
        method: "PUT"
        uri: "/api/links/l-1"
        headers: { "Content-Type": "application/json" }
        body: """
            {"issuer":"tpm","type":"launched","from":"tpm.person:pm","to":"claude.session:s-1","sentAt":"2026-11-24T00:00:00Z"}"""
        bodyMediaType: "application/json"
        params: {
            linkId: "l-1"
            issuer: "tpm"
            type: "launched"
            from: "tpm.person:pm"
            to: "claude.session:s-1"
            sentAt: 1795478400
        }
    }
])
@httpResponseTests([
    {
        id: "PutLinkCreated"
        documentation: "新しく足せば 201 で、足した行を返す（from と to はアクターの id）"
        protocol: restJson1
        code: 201
        headers: { "Content-Type": "application/json" }
        body: """
            {"id":"l-1","type":"launched","from":"019abcde-0000-7000-8000-000000000002","to":"019abcde-0000-7000-8000-000000000001","sentAt":"2026-11-24T00:00:00Z","receivedAt":"2026-11-24T00:00:01Z","clockSkew":false}"""
        bodyMediaType: "application/json"
        params: {
            id: "l-1"
            type: "launched"
            from: "019abcde-0000-7000-8000-000000000002"
            to: "019abcde-0000-7000-8000-000000000001"
            sentAt: 1795478400
            receivedAt: 1795478401
            clockSkew: false
            status: 201
        }
    }
])
operation PutLink {
    input := {
        /// 送り手の決める id。
        @required
        @httpLabel
        linkId: SenderId

        /// 出し手。`from` と `to` は出し手の中で引く。
        @required
        issuer: Name

        @required
        type: LinkType

        /// 起こした・前のアクター（鍵の付随する id）。
        @required
        from: ActorRef

        /// 起こされた・後を継いだアクター（鍵の付随する id）。
        @required
        to: ActorRef

        /// 送り手の時刻。
        @required
        sentAt: DateTime
    }

    output := with [LinkFields] {
        /// 新しく足せば 201、同じ id で同じ本文なら 200。
        @required
        @httpResponseCode
        status: Integer
    }

    errors: [
        ValidationException
        Conflict
        Unavailable
        InternalError
    ]
}

/// model と effort を足す。id は送り手が決める。同じ id の扱いは PutEvent と同じ（同じ本文は 200・違えば 409・`by` を引くより先に見る）。
/// 新しい id でも、そのアクターの最新（受けた順で。`source` は比べない）と model と effort が同じなら、足さずに最新の行を 200 で返す
/// （その時の id は残らない。なので同じ id を後で送り直すと、その時の最新と比べ直し、間に別の設定が入っていれば新しい行として足す）。
/// 知らない model と effort の名は、初めて来た時に一覧に足す。
@idempotent
@http(method: "PUT", uri: "/api/settings/{settingId}")
@httpRequestTests([
    {
        id: "PutSettingRequest"
        documentation: "id は道に、本文は camelCase。by は鍵の付随する id"
        protocol: restJson1
        method: "PUT"
        uri: "/api/settings/o-1"
        headers: { "Content-Type": "application/json" }
        body: """
            {"issuer":"tpm","by":"claude.session:s-1","model":"claude-opus-5-5","effort":"high","source":"observed","sentAt":"2026-11-24T00:00:00Z"}"""
        bodyMediaType: "application/json"
        params: {
            settingId: "o-1"
            issuer: "tpm"
            by: "claude.session:s-1"
            model: "claude-opus-5-5"
            effort: "high"
            source: "observed"
            sentAt: 1795478400
        }
    }
])
@httpResponseTests([
    {
        id: "PutSettingCreated"
        documentation: "新しく足せば 201 で、足した行を返す"
        protocol: restJson1
        code: 201
        headers: { "Content-Type": "application/json" }
        body: """
            {"id":"o-1","actorId":"019abcde-0000-7000-8000-000000000001","model":"claude-opus-5-5","effort":"high","source":"observed","sentAt":"2026-11-24T00:00:00Z","receivedAt":"2026-11-24T00:00:01Z","clockSkew":false}"""
        bodyMediaType: "application/json"
        params: {
            id: "o-1"
            actorId: "019abcde-0000-7000-8000-000000000001"
            model: "claude-opus-5-5"
            effort: "high"
            source: "observed"
            sentAt: 1795478400
            receivedAt: 1795478401
            clockSkew: false
            status: 201
        }
    }
    {
        id: "PutSettingSameAsLatest"
        documentation: "最新と同じなら 200 で最新の行を返す（登録の時に頼んだ物なら id が無い）"
        protocol: restJson1
        code: 200
        headers: { "Content-Type": "application/json" }
        body: """
            {"actorId":"019abcde-0000-7000-8000-000000000001","model":"claude-opus-5-5","effort":"high","source":"requested","sentAt":"2026-11-24T00:00:00Z","receivedAt":"2026-11-24T00:00:01Z","clockSkew":false}"""
        bodyMediaType: "application/json"
        params: {
            actorId: "019abcde-0000-7000-8000-000000000001"
            model: "claude-opus-5-5"
            effort: "high"
            source: "requested"
            sentAt: 1795478400
            receivedAt: 1795478401
            clockSkew: false
            status: 200
        }
    }
])
operation PutSetting {
    input := {
        /// 送り手の決める id。
        @required
        @httpLabel
        settingId: SenderId

        /// 出し手。`by` は出し手の中で引く。
        @required
        issuer: Name

        /// model と effort のアクター（鍵の付随する id）。
        @required
        by: ActorRef

        @required
        model: Name

        @required
        effort: Name

        @required
        source: SettingSource

        /// 送り手の時刻。
        @required
        sentAt: DateTime
    }

    output := with [SettingFields] {
        /// 新しく足せば 201、同じ id で同じ本文か、最新と同じなら 200。
        @required
        @httpResponseCode
        status: Integer
    }

    errors: [
        ValidationException
        Conflict
        Unavailable
        InternalError
    ]
}

/// 送り手が付ける id（出来事・線・model と effort）: 空白の無い ASCII の印字できる字で 128 字まで。
@pattern("^[\\x21-\\x7E]{1,128}$")
string SenderId

/// 出来事の種類（10 種）。
/// 居る・居ないを替えるのは entered・reentered・forked（居る）と cleared・exited・closed（居ない）。
@pattern("^(entered|reentered|forked|compacted|cleared|exited|closed|reported_in|model_unreadable|retracted)$")
string EventType

/// 線の種類: 起こした（`launched`）・後を継いだ（`continued`）。
@pattern("^(launched|continued)$")
string LinkType

/// model と effort の出: 頼んだ（`requested`）・見た（`observed`）。
@pattern("^(requested|observed)$")
string SettingSource

/// 付随する id 1 つ（行のまま）。
structure ActorBinding {
    @required
    issuer: Name

    @required
    type: Name

    @required
    value: Text

    /// 鍵か（登録の初めの物）。
    @required
    isKey: Boolean

    @required
    sentAt: DateTime

    @required
    receivedAt: DateTime
}

list ActorBindings {
    member: ActorBinding
}

/// 出来事 1 つ（欄は EventFields）。
structure Event with [EventFields] {}

/// 出来事の欄（GetActor の出来事と、PutEvent の答えで同じ形）。
@mixin
structure EventFields {
    @required
    id: SenderId

    @required
    actorId: ActorId

    @required
    type: EventType

    /// 送られた JSON の物と同じ中身（無ければ空の物）。鍵の順と字の並びは、送られた物と同じとは限らない。
    @required
    detail: Document

    @required
    sentAt: DateTime

    @required
    receivedAt: DateTime

    @required
    clockSkew: Boolean
}

list Events {
    member: Event
}

/// 探した出来事の 1 行（出来事の欄に、アクターの名を足した物）。
structure EventRow with [EventFields] {
    /// アクターの名（`<接頭辞>.<番号>`）。
    @required
    actorName: String
}

list EventRows {
    member: EventRow
}

/// model と effort 1 つ（欄は SettingFields）。
structure Setting with [SettingFields] {}

/// model と effort の欄（GetActor の model と effort と、PutSetting の答えで同じ形）。
@mixin
structure SettingFields {
    /// 送り手の id。登録の時に頼んだ物には無い。
    id: SenderId

    @required
    actorId: ActorId

    @required
    model: Name

    @required
    effort: Name

    @required
    source: SettingSource

    @required
    sentAt: DateTime

    @required
    receivedAt: DateTime

    @required
    clockSkew: Boolean
}

list Settings {
    member: Setting
}

/// 探した model と effort の 1 行（model と effort の欄に、アクターの名を足した物）。
structure SettingRow with [SettingFields] {
    /// アクターの名（`<接頭辞>.<番号>`）。
    @required
    actorName: String
}

list SettingRows {
    member: SettingRow
}

/// 線 1 つ（欄は LinkFields）。
structure Link with [LinkFields] {}

/// 線の欄（`from` が `to` を起こした・`to` が `from` の後を継いだ）。GetActor の線と、PutLink の答えで同じ形。
/// 答えの `from`・`to` はアクターの id（PutLink の要求の `from`・`to` は付随する id の参照 `種類:値` で、castlist が引き当てた物）。
@mixin
structure LinkFields {
    @required
    id: SenderId

    @required
    type: LinkType

    @required
    from: ActorId

    @required
    to: ActorId

    @required
    sentAt: DateTime

    @required
    receivedAt: DateTime

    @required
    clockSkew: Boolean
}

list Links {
    member: Link
}

/// 今の状態。
structure ActorState {
    /// 居る・居ないを替える出来事（6 種）の最新の種類（受けた順で）。1 つも無ければ無い。
    presence: EventType

    /// 居るか（`presence` が entered・reentered・forked）。
    @required
    present: Boolean

    /// 今の停止が推し（最後の居る出来事より後の初めの退場が、`detail.inferred` が JSON の true の `closed`）か。居る間は false。
    @required
    inferred: Boolean

    /// 初めの `entered` を受けた時刻。
    enteredAt: DateTime

    /// 最後の退場（cleared・exited・closed）を受けた時刻。
    exitedAt: DateTime
}

/// 引く参照の並び（1 から 100 個）。
@length(min: 1, max: 100)
list ActorRefs {
    member: ActorRef
}

/// 参照 1 つの答え。
structure Resolution {
    /// 問いの参照のまま。
    @required
    ref: ActorRef

    /// 引けたアクター。引けなければ無い。
    actor: ActorSummary
}

list Resolutions {
    member: Resolution
}
