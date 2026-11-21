//! 一覧の UI。サーバーが HTML を組んで返す。絞り込み・並べ替え・検索は link と form で動き、
//! 条件は URL に出る。script は、新着の印・未読の印・時刻の表示だけに使う。

use crate::api::page_path;
use crate::db::{Count, Filter, PageMeta};
use crate::{AppState, internal, pages};
use askama::Template;
use axum::extract::{Path, Query, State};
use axum::response::{Html, IntoResponse, Response};
use serde::Deserialize;

/// 1 度に出す件数。続きは「もっと古いページ」の link で出す。
const PAGE_SIZE: i64 = 200;

#[derive(Clone, Default, Deserialize)]
pub struct View {
    project: Option<String>,
    key: Option<String>,
    kind: Option<String>,
    role: Option<String>,
    workspace: Option<String>,
    q: Option<String>,
    sort: Option<String>,
    /// 並びの続きを出す時の境の時刻。
    at: Option<String>,
    /// 右の枠に出すページの path。
    open: Option<String>,
}

impl View {
    fn oldest_first(&self) -> bool {
        self.sort.as_deref() == Some("created_at")
    }

    /// この条件の一覧の URL。空の条件は出さない。
    fn href(&self) -> String {
        let pairs = [
            ("project", &self.project),
            ("key", &self.key),
            ("kind", &self.kind),
            ("role", &self.role),
            ("workspace", &self.workspace),
            ("q", &self.q),
            ("sort", &self.sort),
            ("at", &self.at),
            ("open", &self.open),
        ];
        let query: Vec<String> = pairs
            .into_iter()
            .filter_map(|(name, value)| Some(format!("{name}={}", encode(value.as_deref()?))))
            .collect();
        if query.is_empty() {
            "/".to_owned()
        } else {
            format!("/?{}", query.join("&"))
        }
    }

    /// 条件を 1 つ変えた一覧の URL。並びの続きの境は、条件が変わると意味が無いので外す。
    fn with(&self, change: impl FnOnce(&mut View)) -> String {
        let mut next = self.clone();
        next.at = None;
        change(&mut next);
        next.href()
    }
}

struct Choice {
    label: String,
    note: String,
    count: i64,
    href: String,
    active: bool,
}

struct Facet {
    title: &'static str,
    choices: Vec<Choice>,
}

struct Row {
    path: String,
    href: String,
    active: bool,
    key: String,
    name: String,
    title: String,
    role: String,
    workspace: String,
    created_at: String,
    /// script が動かない時に出す時刻（UTC）。
    time: String,
}

#[derive(Template)]
#[template(path = "index.html")]
struct Index {
    q: String,
    hidden: Vec<(&'static str, String)>,
    sort_href: String,
    sort_label: &'static str,
    reload_href: String,
    reset_href: String,
    filtered: bool,
    facets: Vec<Facet>,
    rows: Vec<Row>,
    more_href: Option<String>,
    open: Option<String>,
}

pub async fn index(State(state): State<AppState>, Query(view): Query<View>) -> Response {
    render(state, view).await
}

/// `/<project>/`: 前の置き場の folder の一覧の代わり。
pub async fn project(
    State(state): State<AppState>,
    Path(project): Path<String>,
    Query(view): Query<View>,
) -> Response {
    let project = Some(project);
    render(state, View { project, ..view }).await
}

/// `/<project>/<key>/`
pub async fn key(
    State(state): State<AppState>,
    Path((project, key)): Path<(String, String)>,
    Query(view): Query<View>,
) -> Response {
    let (project, key) = (Some(project), Some(key));
    render(
        state,
        View {
            project,
            key,
            ..view
        },
    )
    .await
}

async fn render(state: AppState, mut view: View) -> Response {
    // 空の欄（検索の form が送る `q=` など）は、条件が無いのと同じに扱う。
    for field in [
        &mut view.project,
        &mut view.key,
        &mut view.kind,
        &mut view.role,
        &mut view.q,
    ] {
        *field = field.take().filter(|v| !v.trim().is_empty());
    }
    view.sort = view.sort.filter(|s| s == "created_at");
    view.open = view.open.filter(|path| pages::is_page_path(path));

    let oldest_first = view.oldest_first();
    let (before, after) = match (view.at.clone(), oldest_first) {
        (at, false) => (at, None),
        (at, true) => (None, at),
    };
    let filter = Filter {
        project: view.project.clone(),
        key: view.key.clone(),
        kind: view.kind.clone(),
        role: view.role.clone(),
        workspace: view.workspace.clone(),
        q: view.q.clone(),
        before,
        after,
        oldest_first,
        limit: PAGE_SIZE,
    };
    let (pages, facets) = match tokio::try_join!(state.db.list(&filter), state.db.facets()) {
        Ok(found) => found,
        Err(e) => return internal(e),
    };

    let more_href = (pages.len() as i64 == PAGE_SIZE)
        .then(|| pages.last().map(|last| last.created_at.clone()))
        .flatten()
        .map(|at| view.with(|v| v.at = Some(at)));
    let facet = |title, counts: Vec<Count>, field: fn(&mut View) -> &mut Option<String>| Facet {
        title,
        choices: counts
            .into_iter()
            .map(|c| {
                let mut probe = view.clone();
                let active = field(&mut probe).as_deref() == Some(c.value.as_str());
                let next = (!active).then(|| c.value.clone());
                Choice {
                    label: if c.value.is_empty() {
                        "（不明）".to_owned()
                    } else {
                        c.value
                    },
                    note: c.note,
                    count: c.count,
                    href: view.with(|v| *field(v) = next),
                    active,
                }
            })
            .collect(),
    };
    let page = Index {
        q: view.q.clone().unwrap_or_default(),
        hidden: [
            ("project", &view.project),
            ("key", &view.key),
            ("kind", &view.kind),
            ("role", &view.role),
            ("workspace", &view.workspace),
            ("sort", &view.sort),
        ]
        .into_iter()
        .filter_map(|(name, value)| Some((name, value.clone()?)))
        .collect(),
        sort_href: view.with(|v| v.sort = (!oldest_first).then(|| "created_at".to_owned())),
        sort_label: if oldest_first {
            "古い順"
        } else {
            "新しい順"
        },
        reload_href: view.with(|_| {}),
        reset_href: View {
            sort: view.sort.clone(),
            ..View::default()
        }
        .href(),
        filtered: [
            &view.project,
            &view.key,
            &view.kind,
            &view.role,
            &view.workspace,
            &view.q,
        ]
        .iter()
        .any(|v| v.is_some()),
        facets: vec![
            facet("担当者（役割）", facets.roles, |v| &mut v.role),
            facet("workspace", facets.workspaces, |v| &mut v.workspace),
            facet("種類", facets.kinds, |v| &mut v.kind),
            facet("鍵", facets.keys, |v| &mut v.key),
            facet("project", facets.projects, |v| &mut v.project),
        ],
        rows: pages.into_iter().map(|meta| row(&view, meta)).collect(),
        more_href,
        open: view.open.clone(),
    };
    match page.render() {
        Ok(html) => Html(html).into_response(),
        Err(e) => internal(e),
    }
}

fn row(view: &View, meta: PageMeta) -> Row {
    let path = page_path(&meta.project, &meta.key, &meta.kind, meta.n);
    let mut next = view.clone();
    next.open = Some(path.clone());
    Row {
        href: next.href(),
        active: view.open.as_deref() == Some(path.as_str()),
        path,
        key: meta.key,
        name: format!("{}-{}", meta.kind, meta.n),
        title: meta.title,
        role: meta.role,
        workspace: meta.workspace,
        // 2026-11-21T04:45:22.472Z → 11-21 04:45
        time: meta
            .created_at
            .get(5..16)
            .unwrap_or_default()
            .replace('T', " "),
        created_at: meta.created_at,
    }
}

/// URL の query の値にする（英数字と - . _ ~ のほかは %XX）。
fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links_carry_the_conditions_and_drop_empty_ones() {
        let view = View {
            role: Some("tpm".into()),
            q: Some("絞り込み &=".into()),
            at: Some("2026-11-21T00:00:00Z".into()),
            ..View::default()
        };
        assert_eq!(
            view.href(),
            "/?role=tpm&q=%E7%B5%9E%E3%82%8A%E8%BE%BC%E3%81%BF%20%26%3D&at=2026-11-21T00%3A00%3A00Z"
        );
        assert_eq!(view.with(|v| v.q = None), "/?role=tpm");
        assert_eq!(View::default().href(), "/");
    }
}
