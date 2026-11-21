//! JSON の口: 置く・探す・DB の写し。

use crate::db::{Filter, NewPage, PageMeta, PutError};
use crate::{AppState, error, internal, text};
use axum::Json;
use axum::body::{Body, Bytes};
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use tokio_util::io::ReaderStream;

const DEFAULT_LIMIT: i64 = 100;
const MAX_LIMIT: i64 = 1000;

#[derive(Deserialize)]
pub struct PutParams {
    project: String,
    key: String,
    kind: String,
    role: String,
    #[serde(default)]
    workspace: String,
    n: Option<i64>,
    created_at: Option<String>,
}

#[derive(Serialize)]
pub struct Page {
    #[serde(flatten)]
    meta: PageMeta,
    /// このサーバーの中の path。`<置き場の URL><path>` で開ける。
    path: String,
}

impl From<PageMeta> for Page {
    fn from(meta: PageMeta) -> Self {
        let path = page_path(&meta.project, &meta.key, &meta.kind, meta.n);
        Self { meta, path }
    }
}

pub fn page_path(project: &str, key: &str, kind: &str, n: i64) -> String {
    format!("/{project}/{key}/{kind}-{n}.html")
}

pub async fn put(
    State(state): State<AppState>,
    Query(p): Query<PutParams>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let checks = [
        (
            is_segment(&p.project) && p.project != "api",
            "project は英数字と . _ - で 128 字まで",
        ),
        (is_segment(&p.key), "key は英数字と . _ - で 128 字まで"),
        (
            is_name(&p.kind),
            "kind は英小文字で始まり、英小文字・数字・- で 32 字まで",
        ),
        (
            is_name(&p.role),
            "role は英小文字で始まり、英小文字・数字・- で 32 字まで",
        ),
        (
            is_workspace(&p.workspace),
            "workspace は英数字と : . _ - で 64 字まで",
        ),
        (p.n.is_none_or(|n| n >= 1), "n は 1 以上"),
        (
            p.created_at.as_deref().is_none_or(is_timestamp),
            "created_at は 2026-01-02T03:04:05.678Z の形（UTC）",
        ),
        (!body.is_empty(), "本文が空"),
    ];
    if let Some((_, message)) = checks.iter().find(|(ok, _)| !ok) {
        return error(StatusCode::BAD_REQUEST, message);
    }
    let html = String::from_utf8_lossy(&body);
    let (title, plain) = (text::title(&html), text::plain(&html));
    let placed = state
        .db
        .put(NewPage {
            project: &p.project,
            key: &p.key,
            kind: &p.kind,
            role: &p.role,
            workspace: &p.workspace,
            title: &title,
            text: &plain,
            body: &body,
            n: p.n,
            created_at: p.created_at.as_deref(),
        })
        .await;
    match placed {
        Ok(meta) => {
            let page = Page::from(meta);
            println!(
                "put {} role={} workspace={} size={}",
                page.path, page.meta.role, page.meta.workspace, page.meta.size
            );
            // 置いた側がそのまま開けるよう、要求の Host で URL を組む。
            let host = headers
                .get(header::HOST)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("127.0.0.1");
            let url = format!("http://{host}{}", page.path);
            let mut value = serde_json::to_value(&page).unwrap_or_default();
            // 聞いている UI が無ければ送り先が無いだけなので、失敗は見ない。
            let _ = state.events.send(value.to_string());
            value["url"] = url.clone().into();
            (StatusCode::CREATED, [(header::LOCATION, url)], Json(value)).into_response()
        }
        Err(PutError::Taken) => error(StatusCode::CONFLICT, "その番号は、もう使われている"),
        Err(PutError::Db(e)) => internal(e),
    }
}

#[derive(Deserialize)]
pub struct ListParams {
    project: Option<String>,
    key: Option<String>,
    kind: Option<String>,
    role: Option<String>,
    workspace: Option<String>,
    q: Option<String>,
    sort: Option<String>,
    limit: Option<i64>,
    before: Option<String>,
    after: Option<String>,
}

pub async fn list(State(state): State<AppState>, Query(p): Query<ListParams>) -> Response {
    let oldest_first = match p.sort.as_deref() {
        None | Some("-created_at") => false,
        Some("created_at") => true,
        Some(_) => {
            return error(StatusCode::BAD_REQUEST, "sort は created_at か -created_at");
        }
    };
    let filter = Filter {
        project: p.project,
        key: p.key,
        kind: p.kind,
        role: p.role,
        workspace: p.workspace,
        q: p.q,
        before: p.before,
        after: p.after,
        oldest_first,
        limit: p.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT),
    };
    match state.db.list(&filter).await {
        Ok(rows) => {
            let pages: Vec<Page> = rows.into_iter().map(Page::from).collect();
            Json(serde_json::json!({ "pages": pages })).into_response()
        }
        Err(e) => internal(e),
    }
}

/// DB の写しを 1 つの file で返す（`curl -o pages.db <URL>/api/backup`）。
pub async fn backup(State(state): State<AppState>) -> Response {
    let path = match state.db.backup().await {
        Ok(path) => path,
        Err(e) => return internal(e),
    };
    let file = tokio::fs::File::open(&path).await;
    // 開いた後は名が要らない。消しても、読み終えるまで中身は残る。
    let _ = tokio::fs::remove_file(&path).await;
    match file {
        Ok(file) => (
            [
                (header::CONTENT_TYPE, "application/vnd.sqlite3"),
                (
                    header::CONTENT_DISPOSITION,
                    "attachment; filename=\"pages.db\"",
                ),
            ],
            Body::from_stream(ReaderStream::new(file)),
        )
            .into_response(),
        Err(e) => internal(e),
    }
}

/// URL の 1 段になる字（project・key）。
pub fn is_segment(s: &str) -> bool {
    (1..=128).contains(&s.len())
        && s != "."
        && s != ".."
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

/// 種類と役割の名の形。名の一覧は持たない。
pub fn is_name(s: &str) -> bool {
    (1..=32).contains(&s.len())
        && s.as_bytes()[0].is_ascii_lowercase()
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn is_workspace(s: &str) -> bool {
    s.len() <= 64
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b':' | b'.' | b'_' | b'-'))
}

/// `2026-01-02T03:04:05Z` か、秒の小数（3 桁まで）が付いた形。字の順が時刻の順になる形だけを受ける。
fn is_timestamp(s: &str) -> bool {
    let b = s.as_bytes();
    let shape = |pattern: &str| {
        b.len() == pattern.len()
            && pattern.bytes().zip(b).all(|(p, c)| match p {
                b'0' => c.is_ascii_digit(),
                _ => p == *c,
            })
    };
    shape("0000-00-00T00:00:00Z")
        || shape("0000-00-00T00:00:00.0Z")
        || shape("0000-00-00T00:00:00.00Z")
        || shape("0000-00-00T00:00:00.000Z")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_lowercase_words() {
        for ok in ["brief", "issue", "software-engineer", "a1"] {
            assert!(is_name(ok), "{ok}");
        }
        for ng in ["", "Brief", "1a", "-a", "a_b", "a b", &"a".repeat(33)] {
            assert!(!is_name(ng), "{ng}");
        }
    }

    #[test]
    fn segments_cannot_escape_the_path() {
        for ok in ["-Users-me-projects-skills", "SKILLS-14", "t-d7hb", "a.b_c"] {
            assert!(is_segment(ok), "{ok}");
        }
        for ng in ["", ".", "..", "a/b", "a b", "鍵", &"a".repeat(129)] {
            assert!(!is_segment(ng), "{ng}");
        }
    }

    #[test]
    fn workspaces_may_be_empty() {
        assert!(is_workspace(""));
        assert!(is_workspace("workspace:1000090098"));
        assert!(!is_workspace("a b"));
    }

    #[test]
    fn timestamps_are_utc_iso() {
        for ok in [
            "2026-11-21T04:45:22Z",
            "2026-11-21T04:45:22.4Z",
            "2026-11-21T04:45:22.472Z",
        ] {
            assert!(is_timestamp(ok), "{ok}");
        }
        for ng in [
            "2026-11-21 04:45:22",
            "2026-11-21T04:45:22+09:00",
            "2026-11-21T04:45:22.4721Z",
            "",
        ] {
            assert!(!is_timestamp(ng), "{ng}");
        }
    }
}
