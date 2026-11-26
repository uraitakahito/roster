$version: "2"

// pagetray（ページの置き場）の API。決まりは docs/src/api.md。共通の形（ai.common）は castlist の release の tag で固めて取った
// model/castlist/common.smithy（ci/gen.sh が版と digest を見る）。
// 例（@httpRequestTests・@httpResponseTests）の id は、castlist の定義と 1 つの model に入って重なれないので、頭に Pagetray を付ける。
namespace ai.pagetray

use ai.common#ActorId
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
@title("pagetray")
service Pagetray {
    version: "1.0"
    operations: [
        GetHealth
        CreatePage
        ListPages
        SetReplyState
        AddReviewMarks
        DeletePages
        CreateFile
        ListFiles
        DeleteFiles
        PutMessage
        ListMessages
    ]

    // 操作の前の守りの層（server の生成した骨の外）が返す誤り。どの操作の答えにもなり得る。
    errors: [
        Forbidden
        PayloadTooLarge
        Unavailable
    ]
}

/// 動いているかと、pagetray の版。
@readonly
@http(method: "GET", uri: "/healthz")
@httpRequestTests([
    {
        id: "PagetrayGetHealthRequest"
        documentation: "本文も引数も無い"
        protocol: restJson1
        method: "GET"
        uri: "/healthz"
    }
])
@httpResponseTests([
    {
        id: "PagetrayGetHealthResponse"
        documentation: "状態と版を返す"
        protocol: restJson1
        code: 200
        headers: { "Content-Type": "application/json" }
        body: """
            {"status":"ok","version":"1.0.0"}"""
        bodyMediaType: "application/json"
        params: { status: "ok", version: "1.0.0" }
    }
])
operation GetHealth {
    input := {}

    output := {
        /// いつも `ok`。
        @required
        status: String

        /// pagetray の版。
        @required
        version: String
    }
}

/// ページを 1 枚置く。本文は HTML をそのまま（`Content-Type: text/html`）。答えに本文は入らない。
/// 番号（`n`）を書かなければ、同じ project・key・kind の置いた番号と消した番号の最大 + 1（初めは 1）。
/// 書けば（取り込み）その番号で置き、置いた・消した番号なら 409（何も替えない）。
/// 題は本文の初めの `<title>`（無ければ空）。
/// 付随する id（`actorIssuer`・`actorRef`）を書けば、送り手を castlist に聞き（書く前に。1 秒・送り直さない）、答えと一緒に残す。
/// castlist に登録の無い送り手は 400、castlist に聞けなければ 503（どちらも何も残さない）。castlist の無い pagetray は、聞かずに付随する id だけを残す。
@http(method: "POST", uri: "/api/projects/{project}/keys/{key}/kinds/{kind}/pages", code: 201)
@httpRequestTests([
    {
        id: "PagetrayCreatePageRequest"
        documentation: "道に project・key・kind、引数に役割と workspace、本文は HTML"
        protocol: restJson1
        method: "POST"
        uri: "/api/projects/ai/keys/AI-36/kinds/plan/pages"
        queryParams: ["role=tpm", "workspace=workspace%3A1"]
        headers: { "Content-Type": "text/html" }
        body: "<title>計画</title><p>本文</p>"
        bodyMediaType: "text/html"
        params: {
            project: "ai"
            key: "AI-36"
            kind: "plan"
            role: "tpm"
            workspace: "workspace:1"
            body: "<title>計画</title><p>本文</p>"
        }
    }
    {
        id: "PagetrayCreatePageImportRequest"
        documentation: "取り込みは、番号（数の字）と置いた時刻を書く"
        protocol: restJson1
        method: "POST"
        uri: "/api/projects/ai/keys/AI-36/kinds/plan/pages"
        queryParams: ["role=tpm", "n=7", "createdAt=2026-11-24T00%3A00%3A00Z"]
        headers: { "Content-Type": "text/html" }
        body: "<p>前の置き場の物</p>"
        bodyMediaType: "text/html"
        params: {
            project: "ai"
            key: "AI-36"
            kind: "plan"
            role: "tpm"
            n: "7"
            createdAt: 1795478400
            body: "<p>前の置き場の物</p>"
        }
    }
    {
        id: "PagetrayCreatePageSenderRequest"
        documentation: "送り手の付随する id は、出した物と参照の組（参照の値に : があってよい）"
        protocol: restJson1
        method: "POST"
        uri: "/api/projects/ai/keys/AI-36/kinds/plan/pages"
        queryParams: ["role=tpm", "actorIssuer=tpm", "actorRef=cmux.workspace.ref%3Aworkspace%3A3"]
        headers: { "Content-Type": "text/html" }
        body: "<p>本文</p>"
        bodyMediaType: "text/html"
        params: {
            project: "ai"
            key: "AI-36"
            kind: "plan"
            role: "tpm"
            actorIssuer: "tpm"
            actorRef: "cmux.workspace.ref:workspace:3"
            body: "<p>本文</p>"
        }
    }
])
@httpResponseTests([
    {
        id: "PagetrayCreatePageCreated"
        documentation: "置けば 201 で、ページの記録（本文は無い）と、要求の Host で組んだ URL を返す"
        protocol: restJson1
        code: 201
        headers: {
            "Content-Type": "application/json"
            "Location": "http://127.0.0.1:8801/ai/AI-36/plan-1.html"
        }
        body: """
            {"project":"ai","key":"AI-36","kind":"plan","n":"1","title":"計画","role":"tpm","workspace":"workspace:1","createdAt":"2026-11-24T00:00:00Z","size":42,"path":"/ai/AI-36/plan-1.html","url":"http://127.0.0.1:8801/ai/AI-36/plan-1.html"}"""
        bodyMediaType: "application/json"
        params: {
            project: "ai"
            key: "AI-36"
            kind: "plan"
            n: "1"
            title: "計画"
            role: "tpm"
            workspace: "workspace:1"
            createdAt: 1795478400
            size: 42
            path: "/ai/AI-36/plan-1.html"
            url: "http://127.0.0.1:8801/ai/AI-36/plan-1.html"
            location: "http://127.0.0.1:8801/ai/AI-36/plan-1.html"
        }
    }
    {
        id: "PagetrayCreatePageCreatedWithSender"
        documentation: "付随する id を書いて置けば、送り手（castlist の答えと、答えた時刻）も返す"
        protocol: restJson1
        code: 201
        headers: {
            "Content-Type": "application/json"
            "Location": "http://127.0.0.1:8801/ai/AI-36/plan-1.html"
        }
        body: """
            {"project":"ai","key":"AI-36","kind":"plan","n":"1","title":"","role":"tpm","workspace":"","createdAt":"2026-11-24T00:00:00Z","size":1,"path":"/ai/AI-36/plan-1.html","sender":{"issuer":"tpm","ref":"claude.session:s-1","actor":{"id":"019abcde-0000-7000-8000-000000000001","name":"se.1","kind":"ai"},"resolvedAt":"2026-11-24T00:00:00Z"},"url":"http://127.0.0.1:8801/ai/AI-36/plan-1.html"}"""
        bodyMediaType: "application/json"
        params: {
            project: "ai"
            key: "AI-36"
            kind: "plan"
            n: "1"
            title: ""
            role: "tpm"
            workspace: ""
            createdAt: 1795478400
            size: 1
            path: "/ai/AI-36/plan-1.html"
            sender: {
                issuer: "tpm"
                ref: "claude.session:s-1"
                actor: { id: "019abcde-0000-7000-8000-000000000001", name: "se.1", kind: "ai" }
                resolvedAt: 1795478400
            }
            url: "http://127.0.0.1:8801/ai/AI-36/plan-1.html"
            location: "http://127.0.0.1:8801/ai/AI-36/plan-1.html"
        }
    }
])
operation CreatePage {
    input := {
        /// 状態の folder の名（URL の 1 段目）。`api`・`.`・`..` は置けない（server が 400）。
        @required
        @httpLabel
        project: Segment

        /// Key（課題の名）。`.`・`..` は置けない（server が 400）。
        @required
        @httpLabel
        key: Segment

        /// 種類（brief・confirm・plan …。名の一覧は持たない）。
        @required
        @httpLabel
        kind: Name

        /// 置いた担当の役割。
        @required
        @httpQuery("role")
        role: Name

        /// 置いた担当の workspace の ID（無ければ空）。
        @httpQuery("workspace")
        workspace: Workspace

        /// 取り込みの時だけ: 番号。無ければ server が決める。
        @httpQuery("n")
        n: PageNumber

        /// 取り込みの時だけ: 置いた時刻（UTC・ミリ秒まで）。無ければ pagetray の今。
        @httpQuery("createdAt")
        createdAt: DateTime

        /// 付随する id を出した物（`actorRef` と組。片方だけは 400）。
        @httpQuery("actorIssuer")
        actorIssuer: Issuer

        /// 付随する id（`種類:値`。`actorIssuer` と組。片方だけは 400）。
        @httpQuery("actorRef")
        actorRef: ActorRef

        /// ページの HTML（空は 400）。UTF-8 でなくても受ける（題と検索の字は、読めない byte を置き換えて取る）。
        @required
        @httpPayload
        body: Html
    }

    output := with [PageFields] {
        /// 要求の `Host` で組んだ、ページの URL。
        @required
        url: String

        /// `url` と同じ。
        @required
        @httpHeader("Location")
        location: String
    }

    errors: [
        ValidationException
        Conflict
        Unavailable
        InternalError
    ]
}

/// ページを探す（新しい順が既定）。どの条件も、書いた物だけで絞る（重ねれば、どれにも合う物）。
/// - `q` は前後の空白を落とし、空なら絞らない。どの語も 3 字以上なら、語ごとに題と本文の全文の索引（trigram）で探す
///   （どの語も含む物。大小を問わない。記号はただの字）。3 字に満たない語があれば、`q` 全体を題と本文の字で探す（大小を分ける）。
/// - `reply` は返事の状態（`waiting`・`answered`）で、`on` はその待ちの相手（既定 `pm`。`reply` と一緒にだけ書く）。
/// - `actor` は送り手の castlist のアクターの id（castlist の答えの無い送り手のページには当たらない）。
/// - 頁は `createdAt` と行の順で続ける（同じ時刻の行が頁の境に並んでも、抜けず重ならない）。
///   `nextToken` は同じ `sort` の答えの物を渡す（違えば 400。ほかの条件は見ない）。
@readonly
@paginated(inputToken: "nextToken", outputToken: "nextToken", pageSize: "maxResults", items: "pages")
@http(method: "GET", uri: "/api/pages")
@httpRequestTests([
    {
        id: "PagetrayListPagesRequest"
        documentation: "どの条件も引数。名は camelCase"
        protocol: restJson1
        method: "GET"
        uri: "/api/pages"
        queryParams: [
            "project=ai"
            "key=AI-36"
            "kind=plan"
            "role=tpm"
            "workspace=workspace%3A1"
            "q=%E8%A8%88%E7%94%BB"
            "reply=waiting"
            "on=review"
            "verdict=approve"
            "actor=019abcde-0000-7000-8000-000000000001"
            "sort=createdAt"
            "maxResults=10"
            "nextToken=abc"
        ]
        params: {
            project: "ai"
            key: "AI-36"
            kind: "plan"
            role: "tpm"
            workspace: "workspace:1"
            q: "計画"
            reply: "waiting"
            on: "review"
            verdict: "approve"
            actor: "019abcde-0000-7000-8000-000000000001"
            sort: "createdAt"
            maxResults: 10
            nextToken: "abc"
        }
    }
    {
        id: "PagetrayListPagesEmptyWorkspaceRequest"
        documentation: "空の workspace も条件（workspace を書かずに置いたページ）"
        protocol: restJson1
        method: "GET"
        uri: "/api/pages"
        queryParams: ["workspace="]
        params: { workspace: "" }
    }
])
@httpResponseTests([
    {
        id: "PagetrayListPagesResponse"
        documentation: "ページの記録（本文と url は無い）。返事・判定・見た物・送り手は、ある時だけ。次の頁があれば nextToken"
        protocol: restJson1
        code: 200
        headers: { "Content-Type": "application/json" }
        body: """
            {"pages":[{"project":"ai","key":"AI-36","kind":"review","n":"2","title":"レビュー","role":"tpm","workspace":"","createdAt":"2026-11-24T00:00:00Z","size":10,"path":"/ai/AI-36/review-2.html","askedAt":"2026-11-24T00:00:01Z","answeredAt":"2026-11-24T00:00:02Z","waitsOn":"tpm","verdict":"approve","targets":["/ai/AI-36/plan-1.html"]}],"nextToken":"abc"}"""
        bodyMediaType: "application/json"
        params: {
            pages: [
                {
                    project: "ai"
                    key: "AI-36"
                    kind: "review"
                    n: "2"
                    title: "レビュー"
                    role: "tpm"
                    workspace: ""
                    createdAt: 1795478400
                    size: 10
                    path: "/ai/AI-36/review-2.html"
                    askedAt: 1795478401
                    answeredAt: 1795478402
                    waitsOn: "tpm"
                    verdict: "approve"
                    targets: ["/ai/AI-36/plan-1.html"]
                }
            ]
            nextToken: "abc"
        }
    }
])
operation ListPages {
    input := {
        @httpQuery("project")
        project: Segment

        @httpQuery("key")
        key: Segment

        @httpQuery("kind")
        kind: Name

        @httpQuery("role")
        role: Name

        /// 空（`workspace=`）も条件: workspace を書かずに置いたページ。
        @httpQuery("workspace")
        workspace: Workspace

        /// 題と本文の字で探す語（空白で分ける）。
        @httpQuery("q")
        q: String

        /// 返事の状態: `waiting`（求めて、まだ答えていない）か `answered`（答えた）。
        @httpQuery("reply")
        reply: ReplyState

        /// `reply` の待ちの相手（既定 `pm`）。`reply` と一緒にだけ書く。
        @httpQuery("on")
        on: Party

        /// レビューの判定。
        @httpQuery("verdict")
        verdict: Verdict

        /// 送り手の castlist のアクターの id。
        @httpQuery("actor")
        actor: ActorId

        /// `-createdAt`（新しい順。既定）か `createdAt`（古い順）。同じ時刻は置いた順（新しい順なら後に置いた物が先）。
        @httpQuery("sort")
        sort: PageSort

        /// 1 頁の数（既定 100）。
        @httpQuery("maxResults")
        maxResults: MaxResults

        /// 前の答えの `nextToken`。
        @httpQuery("nextToken")
        nextToken: NextToken
    }

    output := {
        @required
        pages: Pages

        /// 次の頁の印。終わりなら無い。
        nextToken: NextToken
    }

    errors: [
        ValidationException
        Unavailable
        InternalError
    ]
}

/// ページ 1 枚の返事の状態を書く。答えは、そのページの記録。同じ状態を 2 度書いても同じ答え（時刻は初めの物を保つ）。
/// - `waiting`: 待ちの相手を `on`（既定 `pm`）にし、答えた時刻を消す。答えた後にもう 1 度求めれば、求めた時刻を今にする
///   （相手を替えてよい）。今ほかの相手を待っていれば 409（待ちを黙って移さない）。
/// - `answered`: 答えた時刻を入れる。待ちの相手が `on` と違えば 409。`pm` は、求めていないページも答えたにでき
///   （求めた時刻と答えた時刻は同じ）、ほかの相手は、求めたページだけ。
/// - 無いページと消したページは 404。409 の時は何も替えない。
@idempotent
@http(method: "PUT", uri: "/api/projects/{project}/keys/{key}/kinds/{kind}/pages/{n}/reply")
@httpRequestTests([
    {
        id: "PagetraySetReplyStateRequest"
        documentation: "道でページを名指し、本文に状態と待ちの相手"
        protocol: restJson1
        method: "PUT"
        uri: "/api/projects/ai/keys/AI-36/kinds/brief/pages/1/reply"
        headers: { "Content-Type": "application/json" }
        body: """
            {"state":"waiting","on":"review"}"""
        bodyMediaType: "application/json"
        params: {
            project: "ai"
            key: "AI-36"
            kind: "brief"
            n: "1"
            state: "waiting"
            on: "review"
        }
    }
])
@httpResponseTests([
    {
        id: "PagetraySetReplyStateResponse"
        documentation: "答えはページの記録。Product Manager の待ちには waitsOn が無い"
        protocol: restJson1
        code: 200
        headers: { "Content-Type": "application/json" }
        body: """
            {"project":"ai","key":"AI-36","kind":"confirm","n":"1","title":"確認","role":"tpm","workspace":"","createdAt":"2026-11-24T00:00:00Z","size":10,"path":"/ai/AI-36/confirm-1.html","askedAt":"2026-11-24T00:00:01Z"}"""
        bodyMediaType: "application/json"
        params: {
            project: "ai"
            key: "AI-36"
            kind: "confirm"
            n: "1"
            title: "確認"
            role: "tpm"
            workspace: ""
            createdAt: 1795478400
            size: 10
            path: "/ai/AI-36/confirm-1.html"
            askedAt: 1795478401
        }
    }
])
operation SetReplyState {
    input := {
        @required
        @httpLabel
        project: Segment

        @required
        @httpLabel
        key: Segment

        @required
        @httpLabel
        kind: Name

        @required
        @httpLabel
        n: PageNumber

        /// `waiting`（返事を求める）か `answered`（答えた）。
        @required
        state: ReplyState

        /// 待ちの相手（既定 `pm`）。
        on: Party
    }

    output := with [PageFields, PageState] {}

    errors: [
        ValidationException
        NotFound
        Conflict
        Unavailable
        InternalError
    ]
}

/// レビューの印を書く。答えは、そのページの記録。本文は無くてもよい（何も替えずに記録を返す）。
/// - `verdict` は、書けば替わり、書かなければ前のまま（消す道は無い）。種類が `review` のページだけ（ほかは 400）。
/// - `targets` は、置き場のページの path（`/<project>/<key>/<kind>-<n>.html`）か、空白と制御字の無い `https://` の URL
///   （2048 字まで）を、1 度に 100 個まで。足すだけで、同じ物は 1 つ、書いた順。足すとページ 1 枚で 100 個を超えるなら 400
///   （判定も替えない）。
/// - 無いページと消したページは 404。ページを消すと、見た物も消える。
@http(method: "POST", uri: "/api/projects/{project}/keys/{key}/kinds/{kind}/pages/{n}/review")
@httpRequestTests([
    {
        id: "PagetrayAddReviewMarksRequest"
        documentation: "道でページを名指し、本文に判定と見た物"
        protocol: restJson1
        method: "POST"
        uri: "/api/projects/ai/keys/AI-36/kinds/review/pages/1/review"
        headers: { "Content-Type": "application/json" }
        body: """
            {"verdict":"concerns","targets":["/ai/AI-36/plan-1.html","https://github.com/o/r/pull/1"]}"""
        bodyMediaType: "application/json"
        params: {
            project: "ai"
            key: "AI-36"
            kind: "review"
            n: "1"
            verdict: "concerns"
            targets: ["/ai/AI-36/plan-1.html", "https://github.com/o/r/pull/1"]
        }
    }
])
@httpResponseTests([
    {
        id: "PagetrayAddReviewMarksResponse"
        documentation: "答えはページの記録（判定と見た物の入った物）"
        protocol: restJson1
        code: 200
        headers: { "Content-Type": "application/json" }
        body: """
            {"project":"ai","key":"AI-36","kind":"review","n":"1","title":"","role":"tpm","workspace":"","createdAt":"2026-11-24T00:00:00Z","size":1,"path":"/ai/AI-36/review-1.html","verdict":"concerns","targets":["/ai/AI-36/plan-1.html"]}"""
        bodyMediaType: "application/json"
        params: {
            project: "ai"
            key: "AI-36"
            kind: "review"
            n: "1"
            title: ""
            role: "tpm"
            workspace: ""
            createdAt: 1795478400
            size: 1
            path: "/ai/AI-36/review-1.html"
            verdict: "concerns"
            targets: ["/ai/AI-36/plan-1.html"]
        }
    }
])
operation AddReviewMarks {
    input := {
        @required
        @httpLabel
        project: Segment

        @required
        @httpLabel
        key: Segment

        @required
        @httpLabel
        kind: Name

        @required
        @httpLabel
        n: PageNumber

        /// レビューの判定（種類が `review` のページだけ）。
        verdict: Verdict

        /// 見た物・見てほしい物（足すだけ）。
        targets: Targets
    }

    output := with [PageFields, PageState] {}

    errors: [
        ValidationException
        NotFound
        Unavailable
        InternalError
    ]
}

/// 合うページをみな消す（戻せない）。`project` は要り、`key`・`kind`・`n` は書けば絞る（`n` には `key` と `kind` が要る）。
/// 番号は消した時刻と残し、2 度使わない（消したページの URL は 410）。全文の索引の行と見た物も消え、送り手の行は残る。
/// 答えは消したページの path（置いた順）。合う物が無ければ空。
@idempotent
@http(method: "DELETE", uri: "/api/pages")
@httpRequestTests([
    {
        id: "PagetrayDeletePagesRequest"
        documentation: "引数で消すページを絞る"
        protocol: restJson1
        method: "DELETE"
        uri: "/api/pages"
        queryParams: ["project=ai", "key=AI-36", "kind=plan", "n=2"]
        params: { project: "ai", key: "AI-36", kind: "plan", n: "2" }
    }
])
@httpResponseTests([
    {
        id: "PagetrayDeletePagesResponse"
        documentation: "消したページの path"
        protocol: restJson1
        code: 200
        headers: { "Content-Type": "application/json" }
        body: """
            {"removed":["/ai/AI-36/plan-2.html"]}"""
        bodyMediaType: "application/json"
        params: { removed: ["/ai/AI-36/plan-2.html"] }
    }
])
operation DeletePages {
    input := {
        /// `.`・`..` は 400（server）。
        @required
        @httpQuery("project")
        project: Segment

        @httpQuery("key")
        key: Segment

        @httpQuery("kind")
        kind: Name

        /// 1 枚だけ消す時の番号（`key` と `kind` が要る）。
        @httpQuery("n")
        n: PageNumber
    }

    output := {
        /// 消したページの path（`/<project>/<key>/<kind>-<n>.html`。置いた順）。
        @required
        removed: Paths
    }

    errors: [
        ValidationException
        Unavailable
        InternalError
    ]
}

/// file を 1 つ置く。本文は中身をそのまま（`Content-Type` は拡張子の種類と同じ。`;` の後ろと大小は問わない）。答えに中身は入らない。
/// 受ける拡張子は png・jpg・jpeg・gif・webp・pdf・txt・log・md・csv・json。ほかの拡張子・拡張子と合わない
/// `Content-Type`・頭が拡張子の形でない中身（字の file は UTF-8 で NUL の無い物）は 415。
/// 番号（`n`）を書かなければ、同じ project・key・語・拡張子の置いた番号と消した番号の最大 + 1（初めは 1）。
/// 書けば（取り込み）その番号で置き、置いた・消した番号なら 409（何も替えない）。
/// 送り手は CreatePage と同じ（castlist には、ほかの検査（400・415）の後に聞く）。
/// 一覧の UI の form から上げた物（守りの層が `Origin` の例外として通した物）は、役割 `product-manager`・workspace 空で残し、
/// `n`・`createdAt`・`actorIssuer`・`actorRef` を読まない（`role` も書かなくてよい）。ほかの要求は `role` が要る（無ければ 400）。
@http(method: "POST", uri: "/api/projects/{project}/keys/{key}/files", code: 201)
@httpRequestTests([
    {
        id: "PagetrayCreateFileRequest"
        documentation: "道に project・key、引数に名（語.拡張子）と役割、本文は中身、Content-Type は拡張子の種類"
        protocol: restJson1
        method: "POST"
        uri: "/api/projects/ai/keys/AI-36/files"
        queryParams: ["name=screen.png", "role=tpm", "workspace=workspace%3A1"]
        headers: { "Content-Type": "image/png" }
        body: "png"
        params: {
            project: "ai"
            key: "AI-36"
            name: "screen.png"
            role: "tpm"
            workspace: "workspace:1"
            contentType: "image/png"
            body: "png"
        }
    }
    {
        id: "PagetrayCreateFileImportRequest"
        documentation: "取り込みは、番号と置いた時刻を書く。Content-Type の後ろの引数はそのまま渡る"
        protocol: restJson1
        method: "POST"
        uri: "/api/projects/ai/keys/AI-36/files"
        queryParams: ["name=notes.md", "role=tpm", "n=2", "createdAt=2026-11-24T00%3A00%3A00Z"]
        headers: { "Content-Type": "text/markdown; charset=utf-8" }
        body: "メモ"
        params: {
            project: "ai"
            key: "AI-36"
            name: "notes.md"
            role: "tpm"
            n: "2"
            createdAt: 1795478400
            contentType: "text/markdown; charset=utf-8"
            body: "メモ"
        }
    }
])
@httpResponseTests([
    {
        id: "PagetrayCreateFileCreated"
        documentation: "置けば 201 で、file の記録（中身は無い）と、要求の Host で組んだ URL を返す"
        protocol: restJson1
        code: 201
        headers: {
            "Content-Type": "application/json"
            "Location": "http://127.0.0.1:8801/ai/AI-36/files/screen-1.png"
        }
        body: """
            {"project":"ai","key":"AI-36","name":"screen","ext":"png","n":"1","type":"image/png","size":3,"sha256":"8f8cbb7dcf46e0bc7d53265749a6c17d116093a6ba95e442764060c76fd4a86c","role":"tpm","workspace":"","createdAt":"2026-11-24T00:00:00Z","path":"/ai/AI-36/files/screen-1.png","url":"http://127.0.0.1:8801/ai/AI-36/files/screen-1.png"}"""
        bodyMediaType: "application/json"
        params: {
            project: "ai"
            key: "AI-36"
            name: "screen"
            ext: "png"
            n: "1"
            type: "image/png"
            size: 3
            sha256: "8f8cbb7dcf46e0bc7d53265749a6c17d116093a6ba95e442764060c76fd4a86c"
            role: "tpm"
            workspace: ""
            createdAt: 1795478400
            path: "/ai/AI-36/files/screen-1.png"
            url: "http://127.0.0.1:8801/ai/AI-36/files/screen-1.png"
            location: "http://127.0.0.1:8801/ai/AI-36/files/screen-1.png"
        }
    }
])
operation CreateFile {
    input := {
        /// 状態の folder の名。`api`・`.`・`..` は置けない（server が 400）。
        @required
        @httpLabel
        project: Segment

        /// Key。`.`・`..` は置けない（server が 400）。
        @required
        @httpLabel
        key: Segment

        /// `<語>.<拡張子>`。番号は server が付ける。受ける拡張子かは server が見る（ほかは 415）。
        @required
        @httpQuery("name")
        name: FileName

        /// 置いた担当の役割。一覧の UI から上げる時のほかは要る（無ければ server が 400）。
        @httpQuery("role")
        role: Name

        /// 置いた担当の workspace の ID（無ければ空）。
        @httpQuery("workspace")
        workspace: Workspace

        /// 取り込みの時だけ: 番号。無ければ server が決める。
        @httpQuery("n")
        n: PageNumber

        /// 取り込みの時だけ: 置いた時刻（UTC・ミリ秒まで）。無ければ pagetray の今。
        @httpQuery("createdAt")
        createdAt: DateTime

        /// 付随する id を出した物（`actorRef` と組。片方だけは 400）。
        @httpQuery("actorIssuer")
        actorIssuer: Issuer

        /// 付随する id（`種類:値`。`actorIssuer` と組。片方だけは 400）。
        @httpQuery("actorRef")
        actorRef: ActorRef

        /// 中身の種類。拡張子の種類と同じ物（`;` の後ろと大小は問わない）。
        @required
        @httpHeader("Content-Type")
        contentType: String

        /// file の中身（空は 400。16 MiB まで）。
        @required
        @httpPayload
        body: FileBody
    }

    output := with [FileFields] {
        /// 要求の `Host` で組んだ、file の URL。
        @required
        url: String

        /// `url` と同じ。
        @required
        @httpHeader("Location")
        location: String
    }

    errors: [
        ValidationException
        UnsupportedMediaType
        Conflict
        Unavailable
        InternalError
    ]
}

/// file を探す（新しい順が既定）。どの条件も、書いた物だけで絞る（重ねれば、どれにも合う物）。
/// - `q` は前後の空白を落とし、空なら絞らない。名（`<語>.<拡張子>`）に、小文字にした `q` を含む物。
/// - `actor` は送り手の castlist のアクターの id（castlist の答えの無い送り手の file には当たらない）。
/// - 頁は `createdAt` と行の順で続ける（ListPages と同じ）。`nextToken` は同じ `sort` の答えの物を渡す。
@readonly
@paginated(inputToken: "nextToken", outputToken: "nextToken", pageSize: "maxResults", items: "files")
@http(method: "GET", uri: "/api/files")
@httpRequestTests([
    {
        id: "PagetrayListFilesRequest"
        documentation: "どの条件も引数"
        protocol: restJson1
        method: "GET"
        uri: "/api/files"
        queryParams: [
            "project=ai"
            "key=AI-36"
            "role=tpm"
            "workspace=workspace%3A1"
            "q=screen"
            "actor=019abcde-0000-7000-8000-000000000001"
            "sort=createdAt"
            "maxResults=10"
            "nextToken=abc"
        ]
        params: {
            project: "ai"
            key: "AI-36"
            role: "tpm"
            workspace: "workspace:1"
            q: "screen"
            actor: "019abcde-0000-7000-8000-000000000001"
            sort: "createdAt"
            maxResults: 10
            nextToken: "abc"
        }
    }
])
@httpResponseTests([
    {
        id: "PagetrayListFilesResponse"
        documentation: "file の記録（中身と url は無い）。送り手は、ある時だけ。次の頁があれば nextToken"
        protocol: restJson1
        code: 200
        headers: { "Content-Type": "application/json" }
        body: """
            {"files":[{"project":"ai","key":"AI-36","name":"screen","ext":"png","n":"1","type":"image/png","size":3,"sha256":"8f8cbb7dcf46e0bc7d53265749a6c17d116093a6ba95e442764060c76fd4a86c","role":"tpm","workspace":"","createdAt":"2026-11-24T00:00:00Z","path":"/ai/AI-36/files/screen-1.png"}],"nextToken":"abc"}"""
        bodyMediaType: "application/json"
        params: {
            files: [
                {
                    project: "ai"
                    key: "AI-36"
                    name: "screen"
                    ext: "png"
                    n: "1"
                    type: "image/png"
                    size: 3
                    sha256: "8f8cbb7dcf46e0bc7d53265749a6c17d116093a6ba95e442764060c76fd4a86c"
                    role: "tpm"
                    workspace: ""
                    createdAt: 1795478400
                    path: "/ai/AI-36/files/screen-1.png"
                }
            ]
            nextToken: "abc"
        }
    }
])
operation ListFiles {
    input := {
        @httpQuery("project")
        project: Segment

        @httpQuery("key")
        key: Segment

        @httpQuery("role")
        role: Name

        /// 空（`workspace=`）も条件: workspace を書かずに置いた file（一覧の UI から上げた物も）。
        @httpQuery("workspace")
        workspace: Workspace

        /// 名（`<語>.<拡張子>`）に含まれる字（大小を問わない）。
        @httpQuery("q")
        q: String

        /// 送り手の castlist のアクターの id。
        @httpQuery("actor")
        actor: ActorId

        /// `-createdAt`（新しい順。既定）か `createdAt`（古い順）。同じ時刻は置いた順。
        @httpQuery("sort")
        sort: PageSort

        /// 1 頁の数（既定 100）。
        @httpQuery("maxResults")
        maxResults: MaxResults

        /// 前の答えの `nextToken`。
        @httpQuery("nextToken")
        nextToken: NextToken
    }

    output := {
        @required
        files: Files

        /// 次の頁の印。終わりなら無い。
        nextToken: NextToken
    }

    errors: [
        ValidationException
        Unavailable
        InternalError
    ]
}

/// 合う file をみな消す（戻せない）。`project` は要り、`key`・`name`・`n` は書けば絞る（`n` には `key` と `name` が要る。
/// `name` だけなら project の中のその名をみな）。番号は消した時刻と残し、2 度使わない（消した file の URL は 410）。
/// ページは消えない。答えは消した file の path（置いた順）。合う物が無ければ空。
@idempotent
@http(method: "DELETE", uri: "/api/files")
@httpRequestTests([
    {
        id: "PagetrayDeleteFilesRequest"
        documentation: "引数で消す file を絞る"
        protocol: restJson1
        method: "DELETE"
        uri: "/api/files"
        queryParams: ["project=ai", "key=AI-36", "name=screen.png", "n=2"]
        params: { project: "ai", key: "AI-36", name: "screen.png", n: "2" }
    }
])
@httpResponseTests([
    {
        id: "PagetrayDeleteFilesResponse"
        documentation: "消した file の path"
        protocol: restJson1
        code: 200
        headers: { "Content-Type": "application/json" }
        body: """
            {"removed":["/ai/AI-36/files/screen-2.png"]}"""
        bodyMediaType: "application/json"
        params: { removed: ["/ai/AI-36/files/screen-2.png"] }
    }
])
operation DeleteFiles {
    input := {
        /// `.`・`..` は 400（server）。
        @required
        @httpQuery("project")
        project: Segment

        @httpQuery("key")
        key: Segment

        /// `<語>.<拡張子>`。
        @httpQuery("name")
        name: FileName

        /// 1 つだけ消す時の番号（`key` と `name` が要る）。
        @httpQuery("n")
        n: PageNumber
    }

    output := {
        /// 消した file の path（`/<project>/<key>/files/<語>-<n>.<拡張子>`。置いた順）。
        @required
        removed: Paths
    }

    errors: [
        ValidationException
        Unavailable
        InternalError
    ]
}

/// メッセージの記録を 1 件置く・書き足す（同じ project と id に、何度打ってもよい）。pagetray は、ほかの道具（roster）が配った
/// メッセージの記録を写して見せるだけで、配らず、状態を自分で決めず、期限を持たない。
/// - 初めての id なら作る（201。状態は来たまま）。もうある id なら書き足す（200）。書き足しは、届く順に依らない
///   （「渡した」の記録が「送った」の記録より先に届いても、同じ記録になる）:
///   - `state` は前へだけ進む。強さは `waiting`＝`carried` ＜ `expired`＝`undeliverable` ＜ `delivered` で、今より強い時だけ替える。
///   - `deliveries` は大きい方を保つ。`via` は、`state` を替えた時か、今が空の時だけ入れる（どちらも、書かなければ前のまま）。
///   - `deliveredAt` は、まだ無い時だけ入れる（初めの時刻を保つ）。
/// - `key`・`heading`・`from`・`to`・`text`・`sentAt`・`replyTo` は、初めに置いた値を保つ（違う値が来ても変えず、
///   誤りにもしない）。形は、書き足す時も見る。
/// - 送り手として残すのは、「送った側」の書き込み（`state` が `waiting` か `carried`）の物だけ。その書き込みに付随する id
///   （`actorIssuer`・`actorRef`）があれば、CreatePage と同じく castlist に聞き、登録の無い送り手は 400、聞けなければ 503
///   （どちらも何も替えない）。記録の送り手がまだ空なら入れ、もう入っていれば替えない。ほかの `state` の書き込みは、
///   付随する id が付いていても castlist に聞かず、送り手として残さない（組と形は見る。片方だけは 400）。
/// - 時刻（`sentAt`・`deliveredAt`）は UTC・ミリ秒まで（細かい時刻は 400）。
@idempotent
@http(method: "PUT", uri: "/api/projects/{project}/messages/{id}")
@httpRequestTests([
    {
        id: "PagetrayPutMessageRequest"
        documentation: "道に project と id、本文（JSON）にメッセージの中身と状態"
        protocol: restJson1
        method: "PUT"
        uri: "/api/projects/ai/messages/m-1"
        headers: { "Content-Type": "application/json" }
        body: """
            {"key":"AI-25","heading":"request","from":"t-1.swe.1","to":"tpm","text":"本文","sentAt":"2026-11-24T00:00:00Z","state":"delivered","deliveredAt":"2026-11-24T00:00:01Z","via":"prompt","deliveries":2,"replyTo":"m-0"}"""
        bodyMediaType: "application/json"
        params: {
            project: "ai"
            id: "m-1"
            key: "AI-25"
            heading: "request"
            from: "t-1.swe.1"
            to: "tpm"
            text: "本文"
            sentAt: 1795478400
            state: "delivered"
            deliveredAt: 1795478401
            via: "prompt"
            deliveries: 2
            replyTo: "m-0"
        }
    }
    {
        id: "PagetrayPutMessageSenderRequest"
        documentation: "送り手の付随する id は引数。本文は要る欄だけでもよい"
        protocol: restJson1
        method: "PUT"
        uri: "/api/projects/ai/messages/m-1"
        queryParams: ["actorIssuer=tpm", "actorRef=claude.session%3As-1"]
        headers: { "Content-Type": "application/json" }
        body: """
            {"heading":"request","from":"t-1.swe.1","to":"tpm","text":"本文","sentAt":"2026-11-24T00:00:00Z","state":"waiting"}"""
        bodyMediaType: "application/json"
        params: {
            project: "ai"
            id: "m-1"
            actorIssuer: "tpm"
            actorRef: "claude.session:s-1"
            heading: "request"
            from: "t-1.swe.1"
            to: "tpm"
            text: "本文"
            sentAt: 1795478400
            state: "waiting"
        }
    }
])
@httpResponseTests([
    {
        id: "PagetrayPutMessageCreated"
        documentation: "初めての id なら 201 で、その記録（任意の欄は、ある時だけ）"
        protocol: restJson1
        code: 201
        headers: { "Content-Type": "application/json" }
        body: """
            {"project":"ai","id":"m-1","heading":"request","from":"t-1.swe.1","to":"tpm","text":"本文","sentAt":"2026-11-24T00:00:00Z","state":"waiting","createdAt":"2026-11-24T00:00:01Z","updatedAt":"2026-11-24T00:00:01Z"}"""
        bodyMediaType: "application/json"
        params: {
            status: 201
            project: "ai"
            id: "m-1"
            heading: "request"
            from: "t-1.swe.1"
            to: "tpm"
            text: "本文"
            sentAt: 1795478400
            state: "waiting"
            createdAt: 1795478401
            updatedAt: 1795478401
        }
    }
    {
        id: "PagetrayPutMessageAppended"
        documentation: "もうある id なら 200 で、書き足した後の記録"
        protocol: restJson1
        code: 200
        headers: { "Content-Type": "application/json" }
        body: """
            {"project":"ai","id":"m-1","key":"AI-25","heading":"request","from":"t-1.swe.1","to":"tpm","text":"本文","sentAt":"2026-11-24T00:00:00Z","state":"delivered","deliveredAt":"2026-11-24T00:00:02Z","via":"prompt","deliveries":2,"replyTo":"m-0","createdAt":"2026-11-24T00:00:01Z","updatedAt":"2026-11-24T00:00:02Z","sender":{"issuer":"tpm","ref":"claude.session:s-1"}}"""
        bodyMediaType: "application/json"
        params: {
            status: 200
            project: "ai"
            id: "m-1"
            key: "AI-25"
            heading: "request"
            from: "t-1.swe.1"
            to: "tpm"
            text: "本文"
            sentAt: 1795478400
            state: "delivered"
            deliveredAt: 1795478402
            via: "prompt"
            deliveries: 2
            replyTo: "m-0"
            createdAt: 1795478401
            updatedAt: 1795478402
            sender: { issuer: "tpm", ref: "claude.session:s-1" }
        }
    }
])
operation PutMessage {
    input := {
        /// 状態の folder の名（ページの project と同じ）。`api`・`.`・`..` は置けない（server が 400）。
        @required
        @httpLabel
        project: Segment

        /// メッセージの id（呼ぶ側が付ける。project の中で 1 つ）。`.`・`..` は置けない（server が 400）。
        @required
        @httpLabel
        id: MessageId

        /// 付随する id を出した物（`actorRef` と組。片方だけは 400）。
        @httpQuery("actorIssuer")
        actorIssuer: Issuer

        /// 付随する id（`種類:値`。`actorIssuer` と組。片方だけは 400）。
        @httpQuery("actorRef")
        actorRef: ActorRef

        /// Key（課題の名）。`.`・`..` は置けない（server が 400）。
        key: Segment

        /// メッセージの見出しの名。
        @required
        heading: MessageHeading

        /// 送り手の名。
        @required
        from: MessageParty

        /// 受け手の名。
        @required
        to: MessageParty

        /// 本文。字のまま持つ（HTML として解釈しない）。
        @required
        text: MessageText

        /// 送った時刻（UTC・ミリ秒まで）。
        @required
        sentAt: DateTime

        /// 状態。書き足す時は、今の状態より強い時だけ替わる。
        @required
        state: MessageState

        /// 届いた時刻（UTC・ミリ秒まで）。まだ無い時だけ入る。
        deliveredAt: DateTime

        /// どの時に渡したかの名。
        via: MessageVia

        /// 受け手に本文を出した回数（呼ぶ側が数えて書く）。書き足す時は、大きい方を保つ。
        deliveries: MessageDeliveries

        /// 返事の先のメッセージの id。
        replyTo: MessageId
    }

    output := with [MessageFields] {
        /// 新しく作れば 201、もうある id に書き足せば 200。
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

/// メッセージの記録を探す（送った時刻の新しい順が既定）。どの条件も、書いた物だけで絞る（重ねれば、どれにも合う物）。
/// - `to`・`from`・`state`・`heading`・`project`・`key` は、同じ値の物。
/// - `q` は前後の空白を落とし、空なら絞らない。本文か `from` か `to` に、`q` を含む物（大小を分ける）。
/// - 頁は `sentAt` と行の順で続ける（ListPages と同じ作り）。`nextToken` は同じ `sort` の答えの物を渡す（違えば 400）。
@readonly
@paginated(inputToken: "nextToken", outputToken: "nextToken", pageSize: "maxResults", items: "messages")
@http(method: "GET", uri: "/api/messages")
@httpRequestTests([
    {
        id: "PagetrayListMessagesRequest"
        documentation: "どの条件も引数"
        protocol: restJson1
        method: "GET"
        uri: "/api/messages"
        queryParams: [
            "project=ai"
            "key=AI-25"
            "to=tpm"
            "from=t-1.swe.1"
            "state=waiting"
            "heading=request"
            "q=%E6%9C%AC%E6%96%87"
            "sort=sentAt"
            "maxResults=10"
            "nextToken=abc"
        ]
        params: {
            project: "ai"
            key: "AI-25"
            to: "tpm"
            from: "t-1.swe.1"
            state: "waiting"
            heading: "request"
            q: "本文"
            sort: "sentAt"
            maxResults: 10
            nextToken: "abc"
        }
    }
])
@httpResponseTests([
    {
        id: "PagetrayListMessagesResponse"
        documentation: "メッセージの記録。任意の欄は、ある時だけ。次の頁があれば nextToken"
        protocol: restJson1
        code: 200
        headers: { "Content-Type": "application/json" }
        body: """
            {"messages":[{"project":"ai","id":"m-1","key":"AI-25","heading":"request","from":"t-1.swe.1","to":"tpm","text":"本文","sentAt":"2026-11-24T00:00:00Z","state":"delivered","deliveredAt":"2026-11-24T00:00:02Z","via":"prompt","deliveries":2,"replyTo":"m-0","createdAt":"2026-11-24T00:00:01Z","updatedAt":"2026-11-24T00:00:02Z"}],"nextToken":"abc"}"""
        bodyMediaType: "application/json"
        params: {
            messages: [
                {
                    project: "ai"
                    id: "m-1"
                    key: "AI-25"
                    heading: "request"
                    from: "t-1.swe.1"
                    to: "tpm"
                    text: "本文"
                    sentAt: 1795478400
                    state: "delivered"
                    deliveredAt: 1795478402
                    via: "prompt"
                    deliveries: 2
                    replyTo: "m-0"
                    createdAt: 1795478401
                    updatedAt: 1795478402
                }
            ]
            nextToken: "abc"
        }
    }
])
operation ListMessages {
    input := {
        @httpQuery("project")
        project: Segment

        @httpQuery("key")
        key: Segment

        /// 受け手の名（同じ値の物）。
        @httpQuery("to")
        to: MessageParty

        /// 送り手の名（同じ値の物）。
        @httpQuery("from")
        from: MessageParty

        @httpQuery("state")
        state: MessageState

        @httpQuery("heading")
        heading: MessageHeading

        /// 本文と `from`・`to` に含まれる字。
        @httpQuery("q")
        q: String

        /// `-sentAt`（新しい順。既定）か `sentAt`（古い順）。同じ時刻は置いた順（新しい順なら後に置いた物が先）。
        @httpQuery("sort")
        sort: MessageSort

        /// 1 頁の数（既定 100）。
        @httpQuery("maxResults")
        maxResults: MaxResults

        /// 前の答えの `nextToken`。
        @httpQuery("nextToken")
        nextToken: NextToken
    }

    output := {
        @required
        messages: Messages

        /// 次の頁の印。終わりなら無い。
        nextToken: NextToken
    }

    errors: [
        ValidationException
        Unavailable
        InternalError
    ]
}

/// file の種類を受けない: 受けない拡張子・拡張子と合わない `Content-Type`・頭が拡張子の形でない中身（CreateFile）。
/// 生成した層が返す `UnsupportedMediaTypeException`（操作の決めた `Content-Type` でない要求）とは別。
@error("client")
@httpError(415)
structure UnsupportedMediaType {
    @required
    message: String
}

/// file の記録の欄（中身は入らない）。
@mixin
structure FileFields {
    @required
    project: Segment

    @required
    key: Segment

    /// 名の語（`screen`）。
    @required
    name: FileStem

    /// 拡張子（`png`）。
    @required
    ext: String

    @required
    n: PageNumber

    /// 返す時の `Content-Type`（拡張子から決まる。字の file は `; charset=utf-8` 付き）。
    @required
    type: String

    /// 中身の byte の数。
    @required
    size: Long

    /// 中身の SHA-256（16 進の小文字）。
    @required
    sha256: String

    @required
    role: Name

    @required
    workspace: Workspace

    @required
    createdAt: DateTime

    /// この server の中の path（`/<project>/<key>/files/<語>-<n>.<拡張子>`）。
    @required
    path: String

    /// 送り手。付随する id を書いて置いた時だけ。
    sender: Sender
}

/// 一覧の file の記録（中身と url は入らない）。
structure File with [FileFields] {}

list Files {
    member: File
}

/// ページの記録の欄（本文は入らない）。
@mixin
structure PageFields {
    @required
    project: Segment

    @required
    key: Segment

    @required
    kind: Name

    @required
    n: PageNumber

    /// 本文の初めの `<title>`（文字参照を戻し、空白を 1 つにまとめる）。無ければ空。
    @required
    title: String

    @required
    role: Name

    @required
    workspace: Workspace

    @required
    createdAt: DateTime

    /// 本文の byte の数。
    @required
    size: Long

    /// この server の中の path（`/<project>/<key>/<kind>-<n>.html`）。
    @required
    path: String

    /// 送り手。付随する id を書いて置いた時だけ。
    sender: Sender
}

/// 送り手の記録: 置いた時の付随する id と、castlist の答え（置いた時の物。後から書き換えない）。
structure Sender {
    /// 付随する id を出した物。
    @required
    issuer: Issuer

    /// 付随する id。
    @required
    ref: ActorRef

    /// castlist が答えたアクター。castlist の無い pagetray が置いた物には無い。
    actor: ActorSummary

    /// castlist が答えた時刻（答えの `asOf`）。`actor` と一緒にだけある。
    resolvedAt: DateTime
}

/// ページの返事と印の欄（どれも、ある時だけ）。置いた時は無い。
@mixin
structure PageState {
    /// 返事待ちにした時刻。返事を求めていなければ無い。
    askedAt: DateTime

    /// 答えた時刻。まだ答えていなければ無い。
    answeredAt: DateTime

    /// 誰の返事を待つか（`review`・`tpm`）。Product Manager を待つ・返事を求めていないページには無い。
    waitsOn: Party

    /// レビューの判定。書いていなければ無い。
    verdict: Verdict

    /// 見た物・見てほしい物（書いた順）。無ければ欄が無い。
    targets: Targets
}

/// 一覧のページの記録（本文と url は入らない）。
structure Page with [PageFields, PageState] {}

list Pages {
    member: Page
}

/// メッセージの記録の欄。
@mixin
structure MessageFields {
    @required
    project: Segment

    @required
    id: MessageId

    /// Key（課題の名）。書いて置いた時だけ。
    key: Segment

    /// メッセージの見出しの名。
    @required
    heading: MessageHeading

    /// 送り手の名。
    @required
    from: MessageParty

    /// 受け手の名。
    @required
    to: MessageParty

    /// 本文（字のまま）。
    @required
    text: MessageText

    /// 送った時刻。
    @required
    sentAt: DateTime

    @required
    state: MessageState

    /// 届いた時刻（初めに書かれた物）。まだ無ければ無い。
    deliveredAt: DateTime

    /// どの時に渡したかの名。書いていなければ無い。
    via: MessageVia

    /// 受け手に本文を出した回数（呼ぶ側が数えて書く）。書いていなければ無い。
    deliveries: MessageDeliveries

    /// 返事の先のメッセージの id。書いて置いた時だけ。
    replyTo: MessageId

    /// pagetray が初めて受けた時刻。
    @required
    createdAt: DateTime

    /// 最後に書き足された時刻（置いただけなら `createdAt` と同じ）。
    @required
    updatedAt: DateTime

    /// 送り手（castlist で確かめた物）。「送った側」の書き込み（`waiting`・`carried`）に、付随する id を書いた時だけ。
    sender: Sender
}

/// 一覧のメッセージの記録。
structure Message with [MessageFields] {}

list Messages {
    member: Message
}

/// メッセージの id: 英数字と `.`・`_`・`-` で 128 字まで。
@pattern("^[A-Za-z0-9._-]{1,128}$")
string MessageId

/// メッセージの見出しの名: 英小文字で始まり、英小文字・数字・`-` で 32 字まで（名の一覧は持たない）。
@pattern("^[a-z][a-z0-9-]{0,31}$")
string MessageHeading

/// どの時に渡したかの名: 英小文字で始まり、英小文字・数字・`-` で 32 字まで（名の一覧は持たない）。
@pattern("^[a-z][a-z0-9-]{0,31}$")
string MessageVia

/// 送り手・受け手の名: 1〜200 字。
@length(min: 1, max: 200)
string MessageParty

/// メッセージの本文: 1〜8000 字。
@length(min: 1, max: 8000)
string MessageText

/// 受け手に本文を出した回数（呼ぶ側が数えて書く）: 1 以上。
@range(min: 1)
integer MessageDeliveries

/// メッセージの状態: `waiting`（まだ届いていない）・`delivered`（届いた）・`undeliverable`（渡せない）・`expired`（期限切れ）・
/// `carried`（ほかの道具で運んだ）。
@pattern("^(waiting|delivered|undeliverable|expired|carried)$")
string MessageState

/// メッセージの一覧の並べ方: `-sentAt`（新しい順）か `sentAt`（古い順）。
@pattern("^-?sentAt$")
string MessageSort

/// ページの path の並び。
list Paths {
    member: String
}

/// 見た物・見てほしい物の並び。形（ページの path か https の URL）と数（100 個まで）は server が見る。
list Targets {
    member: String
}

/// 返事の状態: `waiting`（求めて、まだ答えていない）か `answered`（答えた）。
@pattern("^(waiting|answered)$")
string ReplyState

/// 返事の待ちの相手: `pm`（Product Manager）・`review`・`tpm`。
@pattern("^(pm|review|tpm)$")
string Party

/// レビューの判定。
@pattern("^(approve|concerns|reject|not-assessed)$")
string Verdict

/// 一覧（ページと file）の並べ方: `-createdAt`（新しい順）か `createdAt`（古い順）。
@pattern("^-?createdAt$")
string PageSort

/// URL の 1 段になる字（project・key）: 英数字と `.`・`_`・`-` で 255 字まで。
@pattern("^[A-Za-z0-9._-]{1,255}$")
string Segment

/// 種類と役割の名: 英小文字で始まり、英小文字・数字・`-` で 32 字まで。
@pattern("^[a-z][a-z0-9-]{0,31}$")
string Name

/// workspace の ID: 英数字と `:`・`.`・`_`・`-` で 64 字まで（空でもよい）。
@pattern("^[A-Za-z0-9:._-]{0,64}$")
string Workspace

/// ページの番号（種類ごと）と file の番号（語と拡張子ごと）。id なので数の字にする: 頭に 0 の無い 1 以上の数（18 桁まで）。
@pattern("^[1-9][0-9]{0,17}$")
string PageNumber

/// 付随する id を出した物: 英小文字・数字・`-`・`.` で 64 字まで（castlist の出し手の名と同じ形）。
@pattern("^[a-z0-9.-]{1,64}$")
string Issuer

/// ページの HTML。
@mediaType("text/html")
blob Html

/// file の名（`<語>.<拡張子>`）。語は英小文字か数字で始まり、英小文字・数字・`-`・`_` で 64 字まで。拡張子は英数字で 16 字まで
/// （受ける拡張子かは server が見る）。`.` は 1 つだけ。
@pattern("^[a-z0-9][a-z0-9_-]{0,63}\\.[A-Za-z0-9]{1,16}$")
string FileName

/// file の名の語（`<語>.<拡張子>` の `<語>`）。
@pattern("^[a-z0-9][a-z0-9_-]{0,63}$")
string FileStem

/// file の中身（種類は要求の `Content-Type`）。
blob FileBody
