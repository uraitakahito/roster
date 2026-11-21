//! ページの本文を返す。URL は、前の置き場（Nginx）と同じ形。

use crate::api::{is_name, is_segment};
use crate::{AppState, error, internal};
use axum::extract::{Path, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};

pub async fn show(
    State(state): State<AppState>,
    Path((project, key, file)): Path<(String, String, String)>,
) -> Response {
    let Some((kind, n)) = parse_file(&file).filter(|_| is_segment(&project) && is_segment(&key))
    else {
        return not_found();
    };
    match state.db.body(&project, &key, kind, n).await {
        Ok(Some(body)) => (
            [
                (header::CONTENT_TYPE, "text/html; charset=utf-8"),
                // 隔てた枠として出す。ページの中の script は動くが、置き場の名で API を呼べない。
                (header::CONTENT_SECURITY_POLICY, "sandbox allow-scripts"),
                (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            ],
            body,
        )
            .into_response(),
        Ok(None) => match state.db.removed_at(&project, &key, kind, n).await {
            Ok(Some(at)) => error(StatusCode::GONE, &format!("そのページは消した（{at}）")),
            Ok(None) => not_found(),
            Err(e) => internal(e),
        },
        Err(e) => internal(e),
    }
}

/// 置き場の中のページの path（`/<project>/<key>/<kind>-<n>.html`）の形か。
pub fn is_page_path(path: &str) -> bool {
    let mut parts = path.strip_prefix('/').unwrap_or("/").split('/');
    let (project, key, file) = (parts.next(), parts.next(), parts.next());
    parts.next().is_none()
        && project.is_some_and(is_segment)
        && key.is_some_and(is_segment)
        && file.and_then(parse_file).is_some()
}

fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "そのページは無い")
}

/// `<kind>-<n>.html` を分ける。番号は、頭に 0 の無い 1 以上の数だけ（1 枚に URL は 1 つ）。
fn parse_file(file: &str) -> Option<(&str, i64)> {
    let (kind, n) = file.strip_suffix(".html")?.rsplit_once('-')?;
    let ok = is_name(kind) && !n.starts_with('0') && n.bytes().all(|b| b.is_ascii_digit());
    ok.then(|| n.parse().ok()).flatten().map(|n| (kind, n))
}

#[cfg(test)]
mod tests {
    use super::{is_page_path, parse_file};

    #[test]
    fn page_paths_stay_inside_the_store() {
        assert!(is_page_path("/p/SKILLS-14/plan-1.html"));
        for ng in [
            "p/k/plan-1.html",
            "/p/plan-1.html",
            "/p/k/x/plan-1.html",
            "//evil.example/k/plan-1.html",
            "https://evil.example/p/k/plan-1.html",
            "/p/k/plan-1.html?x",
            "",
        ] {
            assert!(!is_page_path(ng), "{ng}");
        }
    }

    #[test]
    fn file_names_split_into_kind_and_number() {
        assert_eq!(parse_file("plan-1.html"), Some(("plan", 1)));
        assert_eq!(parse_file("my-kind-12.html"), Some(("my-kind", 12)));
        for ng in [
            "plan-1",
            "plan.html",
            "plan-01.html",
            "plan-0.html",
            "plan-.html",
            "Plan-1.html",
            "plan-+1.html",
            "plan-99999999999999999999.html",
        ] {
            assert_eq!(parse_file(ng), None, "{ng}");
        }
    }
}
