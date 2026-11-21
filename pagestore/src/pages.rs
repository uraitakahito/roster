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
        Ok(None) => not_found(),
        Err(e) => internal(e),
    }
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
    use super::parse_file;

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
