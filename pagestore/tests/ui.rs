//! 一覧の UI と、新着の push の試験。

mod common;

use axum::body::Body;
use axum::http::{StatusCode, header};
use common::{SE, Server, html, request};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

/// 役割・workspace・鍵・種類の違う 4 枚を、1 日ずつずらして置く。
async fn seeded() -> Server {
    let s = Server::start().await;
    let at = |day: u8| format!("created_at=2026-11-{day:02}T00:00:00Z");
    s.place(
        &format!("project=p&key=A-1&kind=brief&role=tpm&{}", at(1)),
        &html("依頼書", "頼む"),
    )
    .await;
    s.place(
        &format!(
            "project=p&key=A-1&kind=plan&role=software-engineer&workspace=w:2&{}",
            at(2)
        ),
        &html("計画", "絞り込みを作る"),
    )
    .await;
    s.place(
        &format!(
            "project=p&key=B-2&kind=plan&role=software-engineer&workspace=w:3&{}",
            at(3)
        ),
        &html("別の計画", "並べ替え"),
    )
    .await;
    s.place(
        &format!(
            "project=q&key=A-1&kind=result&role=devops-engineer&workspace=w:2&{}",
            at(4)
        ),
        &html("結果", "起こした"),
    )
    .await;
    s
}

/// 一覧に出たページの path を、出た順に。
fn listed(page: &str) -> Vec<&str> {
    page.split("<li data-path=\"")
        .skip(1)
        .map(|rest| rest.split('"').next().unwrap())
        .collect()
}

#[tokio::test]
async fn the_index_lists_every_page_newest_first_with_the_filter_choices() {
    let s = seeded().await;
    let page = s.text("/").await;
    assert_eq!(
        listed(&page),
        [
            "/q/A-1/result-1.html",
            "/p/B-2/plan-1.html",
            "/p/A-1/plan-1.html",
            "/p/A-1/brief-1.html"
        ]
    );
    // 絞り込みの候補は、DB にある値と件数。
    assert!(page.contains(r#"<a href="/?role=software-engineer"><span>software-engineer</span><span class="n">2</span></a>"#), "{page}");
    assert!(page.contains(r#"<a href="/?role=tpm"><span>tpm</span><span class="n">1</span></a>"#));
    assert!(
        page.contains(r#"<a href="/?kind=plan"><span>plan</span><span class="n">2</span></a>"#)
    );
    assert!(page.contains(r#"<a href="/?key=A-1"><span>A-1</span><span class="n">3</span></a>"#));
    // サイドメニューの見出しは「Key」（「鍵」とは書かない）。
    assert!(page.contains("<h2>Key</h2>"));
    assert!(!page.contains("<h2>鍵</h2>"));
    // workspace の ID には、その ID で置かれた鍵を添える。ID の無い分は「不明」。
    assert!(page.contains(r#"<a href="/?workspace=w%3A3"><span>w:3<small>B-2</small></span><span class="n">1</span></a>"#));
    assert!(
        page.contains(
            r#"<a href="/?workspace="><span>（不明）</span><span class="n">1</span></a>"#
        )
    );
    assert!(page.contains(r#"<a href="/?workspace=w%3A2"><span>w:2<small>A-1</small></span><span class="n">2</span></a>"#));
    assert!(page.contains("並び: 新しい順"));
    assert!(!page.contains("<iframe"));
    assert!(!page.contains("絞り込みを外す"));
}

#[tokio::test]
async fn filters_narrow_the_list_and_show_in_the_links() {
    let s = seeded().await;
    let page = s.text("/?role=software-engineer").await;
    assert_eq!(listed(&page), ["/p/B-2/plan-1.html", "/p/A-1/plan-1.html"]);
    // 選んだ候補は、もう 1 度押すと外れる。ほかの候補は、今の条件に足される。
    assert!(
        page.contains(
            r#"<a href="/" class="on" aria-current="true"><span>software-engineer</span>"#
        ),
        "{page}"
    );
    assert!(page.contains(r#"<a href="/?role=software-engineer&#38;workspace=w%3A2">"#));
    assert!(page.contains(r#"<a class="btn" href="/">絞り込みを外す</a>"#));
    // ページを選ぶ link は、条件を持ったまま。
    assert!(
        page.contains(r#"<a href="/?role=software-engineer&#38;open=%2Fp%2FB-2%2Fplan-1.html">"#)
    );

    assert_eq!(
        listed(&s.text("/?workspace=w:2").await),
        ["/q/A-1/result-1.html", "/p/A-1/plan-1.html"]
    );
    assert_eq!(
        listed(&s.text("/?workspace=").await),
        ["/p/A-1/brief-1.html"]
    );
    assert_eq!(
        listed(
            &s.text("/?workspace=w:2&role=software-engineer&kind=plan&key=A-1&project=p")
                .await
        ),
        ["/p/A-1/plan-1.html"]
    );
    let none = s.text("/?role=tpm&kind=plan").await;
    assert!(listed(&none).is_empty());
    assert!(none.contains("合うページは無い"));
}

#[tokio::test]
async fn sorting_flips_with_a_link() {
    let s = seeded().await;
    let page = s.text("/?sort=created_at&kind=plan").await;
    assert_eq!(listed(&page), ["/p/A-1/plan-1.html", "/p/B-2/plan-1.html"]);
    assert!(
        page.contains(r#"<a class="btn" href="/?kind=plan" title="並びを替える">並び: 古い順</a>"#),
        "{page}"
    );
    let page = s.text("/?kind=plan").await;
    assert!(page.contains(
        r#"href="/?kind=plan&#38;sort=created_at" title="並びを替える">並び: 新しい順</a>"#
    ));
}

#[tokio::test]
async fn search_keeps_the_other_conditions() {
    let s = seeded().await;
    let page = s
        .text("/?q=%E7%B5%9E%E3%82%8A%E8%BE%BC%E3%81%BF&role=software-engineer")
        .await;
    assert_eq!(listed(&page), ["/p/A-1/plan-1.html"]);
    assert!(page.contains(r#"<input type="hidden" name="role" value="software-engineer">"#));
    assert!(page.contains(r#"<input type="search" name="q" value="絞り込み""#));
    // 空の検索は、条件が無いのと同じ。
    assert_eq!(
        listed(&s.text("/?q=&role=tpm").await),
        ["/p/A-1/brief-1.html"]
    );
}

#[tokio::test]
async fn project_and_key_folders_are_filtered_lists() {
    let s = seeded().await;
    assert_eq!(
        listed(&s.text("/p/").await),
        [
            "/p/B-2/plan-1.html",
            "/p/A-1/plan-1.html",
            "/p/A-1/brief-1.html"
        ]
    );
    assert_eq!(
        listed(&s.text("/p/A-1/").await),
        ["/p/A-1/plan-1.html", "/p/A-1/brief-1.html"]
    );
    assert!(listed(&s.text("/none/").await).is_empty());
}

#[tokio::test]
async fn the_chosen_page_shows_in_a_sandboxed_frame() {
    let s = seeded().await;
    let page = s.text("/?open=/p/A-1/plan-1.html").await;
    assert!(
        page.contains(r#"<iframe src="/p/A-1/plan-1.html" sandbox="allow-scripts""#),
        "{page}"
    );
    assert!(page.contains(r#"<body data-open="/p/A-1/plan-1.html">"#));
    assert!(
        page.contains(
            r#"<a href="/?open=%2Fp%2FA-1%2Fplan-1.html" class="on" aria-current="true">"#
        )
    );
    // 置き場の外を指す物は枠に出さない。
    for open in [
        "https://evil.example/",
        "//evil.example/k/plan-1.html",
        "/api/backup",
        "javascript:alert(1)",
    ] {
        let page = s.text(&format!("/?open={open}")).await;
        assert!(!page.contains("<iframe"), "{open}");
        assert!(!page.contains("evil"), "{open}");
    }
}

#[tokio::test]
async fn text_from_pages_and_urls_is_escaped() {
    let s = Server::start().await;
    s.place(
        &format!("{SE}&kind=plan"),
        "<title>&lt;script&gt;alert(1)&lt;/script&gt; \"q\"</title>",
    )
    .await;
    let page = s.text("/?q=%22%3E%3Cscript%3Ealert(2)%3C/script%3E").await;
    assert!(!page.contains("<script>alert"), "{page}");
    let page = s.text("/").await;
    assert!(!page.contains("<script>alert"), "{page}");
    assert!(
        page.contains("&#60;script&#62;alert(1)") || page.contains("&lt;script&gt;alert(1)"),
        "{page}"
    );
}

#[tokio::test]
async fn long_lists_continue_with_a_link() {
    let s = Server::start().await;
    for i in 0..205 {
        let at = format!("created_at=2026-11-01T00:{:02}:{:02}Z", i / 60, i % 60);
        s.place(
            &format!("project=p&key=k&kind=result&role=tpm&{at}"),
            "<p>x</p>",
        )
        .await;
    }
    let page = s.text("/").await;
    assert_eq!(listed(&page).len(), 200);
    assert!(
        page.contains(r#"<a class="more" href="/?at=2026-11-01T00%3A00%3A05Z">続きを出す</a>"#),
        "{}",
        &page[page.len() - 3000..]
    );
    let rest = s.text("/?at=2026-11-01T00:00:05Z").await;
    assert_eq!(
        listed(&rest),
        [
            "/p/k/result-5.html",
            "/p/k/result-4.html",
            "/p/k/result-3.html",
            "/p/k/result-2.html",
            "/p/k/result-1.html"
        ]
    );
    assert!(!rest.contains("続きを出す"));
    let oldest = s.text("/?sort=created_at&at=2026-11-01T00:03:19Z").await;
    assert_eq!(
        listed(&oldest),
        [
            "/p/k/result-201.html",
            "/p/k/result-202.html",
            "/p/k/result-203.html",
            "/p/k/result-204.html",
            "/p/k/result-205.html"
        ]
    );
}

#[tokio::test]
async fn a_put_is_pushed_to_listeners() {
    let s = Server::start().await;
    let response = s
        .app
        .clone()
        .oneshot(request("GET", "/api/events", Body::empty()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "text/event-stream"
    );
    let mut body = response.into_body();

    s.place(&format!("{SE}&kind=result"), &html("結果", "できた"))
        .await;
    let frame = tokio::time::timeout(std::time::Duration::from_secs(5), body.frame())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let text = String::from_utf8(frame.into_data().unwrap().to_vec()).unwrap();
    let json: Value = serde_json::from_str(text.strip_prefix("data: ").unwrap().trim()).unwrap();
    assert_eq!(json["path"], "/p/SKILLS-14/result-1.html");
    assert_eq!(json["role"], "software-engineer");
    assert_eq!(json["title"], "結果");
}
