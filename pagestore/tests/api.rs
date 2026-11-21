//! 道筋ごとの試験（JSON の口と本文）。

mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use common::{SE, Server, html, request};
use http_body_util::BodyExt;
use pagestore::{AppState, db::Db, router};
use serde_json::Value;
use std::path::PathBuf;
use tower::ServiceExt;

#[tokio::test]
async fn numbers_start_at_one_and_follow_per_kind() {
    let s = Server::start().await;
    let (status, json) = s
        .put(&format!("{SE}&kind=plan"), &html("計画", "本文"))
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["n"], 1);
    assert_eq!(json["path"], "/p/SKILLS-14/plan-1.html");
    assert_eq!(json["url"], "http://127.0.0.1:8801/p/SKILLS-14/plan-1.html");
    assert_eq!(json["title"], "計画");
    assert_eq!(json["role"], "software-engineer");
    assert_eq!(json["workspace"], "workspace:1");
    assert!(json["created_at"].as_str().unwrap().ends_with('Z'));

    assert_eq!(s.place(&format!("{SE}&kind=plan"), "<p>2</p>").await, 2);
    assert_eq!(s.place(&format!("{SE}&kind=result"), "<p>1</p>").await, 1);
    assert_eq!(
        s.place("project=p&key=t-x&kind=plan&role=tpm", "<p>1</p>")
            .await,
        1
    );
}

#[tokio::test]
async fn fifty_parallel_puts_get_fifty_distinct_numbers_without_gaps() {
    let s = Server::start().await;
    let mut tasks = Vec::new();
    for i in 0..50 {
        let app = s.app.clone();
        tasks.push(tokio::spawn(async move {
            let uri = format!("/api/pages?{SE}&kind=result");
            let body = Body::from(format!("<title>{i}</title>"));
            let response = app.oneshot(request("POST", &uri, body)).await.unwrap();
            assert_eq!(response.status(), StatusCode::CREATED);
            let bytes = response.into_body().collect().await.unwrap().to_bytes();
            serde_json::from_slice::<Value>(&bytes).unwrap()["n"]
                .as_i64()
                .unwrap()
        }));
    }
    let mut numbers = Vec::new();
    for task in tasks {
        numbers.push(task.await.unwrap());
    }
    numbers.sort();
    assert_eq!(numbers, (1..=50).collect::<Vec<i64>>());
}

#[tokio::test]
async fn the_body_comes_back_byte_for_byte_in_a_sandbox() {
    let s = Server::start().await;
    let page = html("題", "中身 <script>1</script>");
    s.place(&format!("{SE}&kind=proposal"), &page).await;
    let (status, headers, body) = s.get("/p/SKILLS-14/proposal-1.html").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, page.as_bytes());
    assert_eq!(headers[header::CONTENT_TYPE], "text/html; charset=utf-8");
    assert_eq!(
        headers[header::CONTENT_SECURITY_POLICY],
        "sandbox allow-scripts"
    );

    for missing in [
        "/p/SKILLS-14/proposal-2.html",
        "/p/SKILLS-14/proposal-01.html",
        "/p/SKILLS-14/x.txt",
        "/p/other/proposal-1.html",
    ] {
        assert_eq!(s.get(missing).await.0, StatusCode::NOT_FOUND, "{missing}");
    }
}

#[tokio::test]
async fn bad_arguments_are_refused() {
    let s = Server::start().await;
    for query in [
        "key=k&kind=plan&role=tpm",
        "project=a/b&key=k&kind=plan&role=tpm",
        "project=api&key=k&kind=plan&role=tpm",
        "project=p&key=..&kind=plan&role=tpm",
        "project=p&key=k&kind=Plan&role=tpm",
        "project=p&key=k&kind=plan&role=T%20P",
        "project=p&key=k&kind=plan&role=tpm&workspace=a%20b",
        "project=p&key=k&kind=plan&role=tpm&n=0",
        "project=p&key=k&kind=plan&role=tpm&created_at=yesterday",
    ] {
        let (status, _, _) = s
            .send(request(
                "POST",
                &format!("/api/pages?{query}"),
                Body::from("<p>x</p>"),
            ))
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{query}");
    }
    let (status, json) = s.put("project=p&key=k&kind=plan&role=tpm", "").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(json["error"], "本文が空");
    assert_eq!(
        s.get("/api/pages?sort=title").await.0,
        StatusCode::BAD_REQUEST
    );
    assert!(s.paths("").await.is_empty());
}

#[tokio::test]
async fn a_page_over_the_limit_is_refused() {
    let s = Server::start().await;
    let big = vec![b'a'; pagestore::MAX_BODY + 1];
    let (status, _, _) = s
        .send(request(
            "POST",
            &format!("/api/pages?{SE}&kind=plan"),
            Body::from(big),
        ))
        .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn an_import_keeps_its_number_and_time_and_a_taken_number_is_a_conflict() {
    let s = Server::start().await;
    let query = "project=p&key=k&kind=brief&role=tpm&n=3&created_at=2026-11-20T01:02:03Z";
    let (status, json) = s.put(query, "<title>古い</title>").await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["n"], 3);
    assert_eq!(json["created_at"], "2026-11-20T01:02:03Z");

    let (status, json) = s.put(query, "<title>別</title>").await;
    assert_eq!(status, StatusCode::CONFLICT, "{json}");
    let (_, _, body) = s.get("/p/k/brief-3.html").await;
    assert_eq!(body, "<title>古い</title>".as_bytes());

    // 番号を任せると、取り込んだ番号の次になる。
    assert_eq!(
        s.place("project=p&key=k&kind=brief&role=tpm", "<p>x</p>")
            .await,
        4
    );
    // 検索の索引も、失敗した分は入っていない。
    assert!(s.paths("q=別").await.is_empty());
}

#[tokio::test]
async fn filters_combine_and_sort_by_time() {
    let s = Server::start().await;
    let at = |day: u8| format!("created_at=2026-11-{day:02}T00:00:00Z");
    s.place(
        &format!(
            "project=p&key=A-1&kind=brief&role=tpm&workspace=w:1&{}",
            at(1)
        ),
        "<p>a</p>",
    )
    .await;
    s.place(
        &format!(
            "project=p&key=A-1&kind=plan&role=software-engineer&workspace=w:2&{}",
            at(2)
        ),
        "<p>b</p>",
    )
    .await;
    s.place(
        &format!(
            "project=p&key=B-2&kind=plan&role=software-engineer&workspace=w:3&{}",
            at(3)
        ),
        "<p>c</p>",
    )
    .await;
    s.place(
        &format!(
            "project=q&key=A-1&kind=result&role=devops-engineer&workspace=w:2&{}",
            at(4)
        ),
        "<p>d</p>",
    )
    .await;

    let all = [
        "/q/A-1/result-1.html",
        "/p/B-2/plan-1.html",
        "/p/A-1/plan-1.html",
        "/p/A-1/brief-1.html",
    ];
    assert_eq!(s.paths("").await, all);
    assert_eq!(s.paths("sort=-created_at").await, all);
    let mut oldest = all;
    oldest.reverse();
    assert_eq!(s.paths("sort=created_at").await, oldest);

    assert_eq!(
        s.paths("role=software-engineer").await,
        ["/p/B-2/plan-1.html", "/p/A-1/plan-1.html"]
    );
    assert_eq!(
        s.paths("workspace=w:2").await,
        ["/q/A-1/result-1.html", "/p/A-1/plan-1.html"]
    );
    assert_eq!(
        s.paths("workspace=w:2&project=p").await,
        ["/p/A-1/plan-1.html"]
    );
    assert_eq!(s.paths("key=A-1&kind=brief").await, ["/p/A-1/brief-1.html"]);
    assert_eq!(s.paths("role=tpm&kind=plan").await, [] as [&str; 0]);
    assert_eq!(s.paths("limit=2").await, all[..2]);
    assert_eq!(s.paths("before=2026-11-03T00:00:00Z").await, all[2..]);
    assert_eq!(s.paths("after=2026-11-03T00:00:00Z").await, all[..1]);
    assert_eq!(
        s.paths("sort=created_at&after=2026-11-01T00:00:00Z&limit=2")
            .await,
        ["/p/A-1/plan-1.html", "/p/B-2/plan-1.html"]
    );

    let json = s.json("/api/pages?kind=brief").await;
    let page = &json["pages"][0];
    assert_eq!(page["size"], 8);
    assert!(page.get("body").is_none());
}

#[tokio::test]
async fn search_finds_japanese_text_and_titles_but_not_markup() {
    let s = Server::start().await;
    s.place(
        &format!("{SE}&kind=plan"),
        &html("置き場の計画", "一覧の UI で絞り込みと並べ替えができる"),
    )
    .await;
    s.place(
        &format!("{SE}&kind=result"),
        &html("結果", "container を起こした"),
    )
    .await;

    let plan = ["/p/SKILLS-14/plan-1.html"];
    assert_eq!(s.paths("q=絞り込み").await, plan);
    assert_eq!(s.paths("q=置き場の計画").await, plan);
    assert_eq!(s.paths("q=絞り込み%20並べ替え").await, plan);
    assert_eq!(s.paths("q=絞り込み%20起こした").await, [] as [&str; 0]);
    // 3 字に満たない語は、端から見て探す。
    assert_eq!(s.paths("q=UI").await, plan);
    assert_eq!(s.paths("q=結果").await, ["/p/SKILLS-14/result-1.html"]);
    // 検索の記号は、ただの字として扱う。
    assert_eq!(s.paths("q=%22絞り込み").await, [] as [&str; 0]);
    assert_eq!(s.paths("q=AND%20OR%20NOT").await, [] as [&str; 0]);
    // tag と style の中身は索引に入らない。
    assert_eq!(s.paths("q=margin").await, [] as [&str; 0]);
    assert_eq!(s.paths("q=doctype").await, [] as [&str; 0]);
    assert_eq!(s.paths("q=container&kind=plan").await, [] as [&str; 0]);
    assert_eq!(s.paths("q=CONTAINER").await, ["/p/SKILLS-14/result-1.html"]);
}

#[tokio::test]
async fn only_local_hosts_are_served() {
    let s = Server::start().await;
    for (host, expected) in [
        ("127.0.0.1:8801", StatusCode::OK),
        ("localhost:8801", StatusCode::OK),
        ("127.0.0.1", StatusCode::OK),
        ("evil.example:8801", StatusCode::FORBIDDEN),
        ("127.0.0.1.evil.example", StatusCode::FORBIDDEN),
    ] {
        let request = Request::builder()
            .uri("/healthz")
            .header(header::HOST, host)
            .body(Body::empty())
            .unwrap();
        assert_eq!(s.send(request).await.0, expected, "{host}");
    }
    let no_host = Request::builder()
        .uri("/healthz")
        .body(Body::empty())
        .unwrap();
    assert_eq!(s.send(no_host).await.0, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn a_page_in_a_browser_cannot_put() {
    let s = Server::start().await;
    for origin in ["null", "http://127.0.0.1:8801", "https://evil.example"] {
        let request = Request::builder()
            .method("POST")
            .uri(format!("/api/pages?{SE}&kind=plan"))
            .header(header::HOST, "127.0.0.1:8801")
            .header(header::ORIGIN, origin)
            .body(Body::from("<p>x</p>"))
            .unwrap();
        assert_eq!(s.send(request).await.0, StatusCode::FORBIDDEN, "{origin}");
    }
    assert!(s.paths("").await.is_empty());
}

#[tokio::test]
async fn the_backup_is_a_database_that_opens_with_every_page() {
    let s = Server::start().await;
    s.place(&format!("{SE}&kind=plan"), &html("計画", "控えに入る字"))
        .await;
    s.place(&format!("{SE}&kind=plan"), "<p>2</p>").await;
    let (status, headers, bytes) = s.get("/api/backup").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers[header::CONTENT_TYPE], "application/vnd.sqlite3");
    assert!(bytes.starts_with(b"SQLite format 3\0"));

    let mut copy = s.path.clone().into_os_string();
    copy.push(".restored");
    let copy = PathBuf::from(copy);
    std::fs::write(&copy, &bytes).unwrap();
    let restored = Db::open(&copy).await.unwrap();
    assert_eq!(
        restored
            .body("p", "SKILLS-14", "plan", 2)
            .await
            .unwrap()
            .unwrap(),
        b"<p>2</p>"
    );
    restored.close().await;
    for suffix in ["", "-wal", "-shm"] {
        let mut name = copy.clone().into_os_string();
        name.push(suffix);
        let _ = std::fs::remove_file(name);
    }

    // 写しを作る時の file は残さない。
    let dir = s.path.parent().unwrap();
    let stem = s.path.file_name().unwrap().to_string_lossy().into_owned();
    let left: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with(&format!("{stem}.backup-")))
        .collect();
    assert!(left.is_empty(), "{left:?}");
}

#[tokio::test]
async fn pages_survive_a_restart() {
    let s = Server::start().await;
    s.place(&format!("{SE}&kind=plan"), "<title>残る</title>")
        .await;
    s.db.close().await;
    let again = Db::open(&s.path).await.unwrap();
    let app = router(AppState::new(again.clone()));
    let response = app
        .oneshot(request("GET", "/p/SKILLS-14/plan-1.html", Body::empty()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    again.close().await;
}

#[tokio::test]
async fn a_removed_page_is_gone_and_its_number_is_never_used_again() {
    let s = Server::start().await;
    for text in ["一つ目の計画", "二つ目の計画"] {
        s.place(&format!("{SE}&kind=plan"), &html(text, text)).await;
    }
    s.place(&format!("{SE}&kind=result"), &html("結果", "残る"))
        .await;

    let (status, json) = s.remove("project=p&key=SKILLS-14&kind=plan&n=2").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        json["removed"],
        serde_json::json!(["/p/SKILLS-14/plan-2.html"])
    );

    let (status, _, body) = s.get("/p/SKILLS-14/plan-2.html").await;
    assert_eq!(status, StatusCode::GONE);
    let message: Value = serde_json::from_slice(&body).unwrap();
    assert!(
        message["error"]
            .as_str()
            .unwrap()
            .starts_with("そのページは消した（")
    );
    // ほかのページは残る。一覧にも検索にも、消したページは出ない。
    assert_eq!(
        s.text("/p/SKILLS-14/plan-1.html").await,
        html("一つ目の計画", "一つ目の計画")
    );
    assert_eq!(
        s.paths("project=p").await,
        ["/p/SKILLS-14/result-1.html", "/p/SKILLS-14/plan-1.html"]
    );
    assert!(s.paths("q=二つ目の計画").await.is_empty());
    assert_eq!(
        s.paths("q=一つ目の計画").await,
        ["/p/SKILLS-14/plan-1.html"]
    );
    // 一番大きい番号を消しても、次は 3（古い URL が別のページを指さない）。
    assert_eq!(s.place(&format!("{SE}&kind=plan"), "<p>3</p>").await, 3);
    // 取り込みで消した番号を名指しても入らない。
    let (status, _) = s
        .put(&format!("{SE}&kind=plan&n=2"), "<p>生き返らない</p>")
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(s.get("/p/SKILLS-14/plan-2.html").await.0, StatusCode::GONE);
    // 2 度目は消す物が無い。
    let (_, json) = s.remove("project=p&key=SKILLS-14&kind=plan&n=2").await;
    assert_eq!(json["removed"], serde_json::json!([]));
}

#[tokio::test]
async fn a_key_or_a_whole_project_is_removed_at_once() {
    let s = Server::start().await;
    s.place(&format!("{SE}&kind=plan"), "<p>1</p>").await;
    s.place(&format!("{SE}&kind=result"), "<p>1</p>").await;
    s.place("project=p&key=t-x&kind=brief&role=tpm", "<p>1</p>")
        .await;
    s.place("project=q&key=t-x&kind=brief&role=tpm", "<p>1</p>")
        .await;

    let (_, json) = s.remove("project=p&key=SKILLS-14").await;
    assert_eq!(
        json["removed"],
        serde_json::json!(["/p/SKILLS-14/plan-1.html", "/p/SKILLS-14/result-1.html"])
    );
    assert_eq!(s.paths("project=p").await, ["/p/t-x/brief-1.html"]);

    let (_, json) = s.remove("project=p").await;
    assert_eq!(json["removed"], serde_json::json!(["/p/t-x/brief-1.html"]));
    // ほかの project は残る。
    assert_eq!(s.paths("").await, ["/q/t-x/brief-1.html"]);
    assert_eq!(
        s.place("project=p&key=t-x&kind=brief&role=tpm", "<p>2</p>")
            .await,
        2
    );
}

#[tokio::test]
async fn removing_needs_a_project_and_a_full_name_for_one_page() {
    let s = Server::start().await;
    s.place(&format!("{SE}&kind=plan"), "<p>1</p>").await;
    for (query, message) in [
        ("key=SKILLS-14", None),
        ("project=..", Some("project は")),
        (
            "project=p&kind=plan&n=1",
            Some("n を書くときは key と kind も書く"),
        ),
        (
            "project=p&key=SKILLS-14&n=1",
            Some("n を書くときは key と kind も書く"),
        ),
        ("project=p&key=SKILLS-14&kind=plan&n=0", Some("n は 1 以上")),
        ("project=p&kind=Plan", Some("kind は")),
    ] {
        let uri = format!("/api/pages?{query}");
        let (status, _, body) = s.send(request("DELETE", &uri, Body::empty())).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{query}");
        if let Some(message) = message {
            let json: Value = serde_json::from_slice(&body).unwrap();
            assert!(
                json["error"].as_str().unwrap().starts_with(message),
                "{query}: {json}"
            );
        }
    }
    // browser の中のページからは消せない。
    let mut from_page = request("DELETE", "/api/pages?project=p", Body::empty());
    from_page
        .headers_mut()
        .insert(header::ORIGIN, "null".parse().unwrap());
    assert_eq!(s.send(from_page).await.0, StatusCode::FORBIDDEN);
    assert_eq!(s.paths("project=p").await, ["/p/SKILLS-14/plan-1.html"]);
}
