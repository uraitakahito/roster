//! 接続・移行・SQL。SQL は `query!` が build の時に検査する（`.sqlx/` の file を使う）。

use serde::Serialize;
use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Clone)]
pub struct Db {
    read: SqlitePool,
    /// 書く接続は 1 本だけ。番号（今の最大 ＋ 1）を取る所が 1 列に並ぶ。
    write: SqlitePool,
    path: PathBuf,
}

pub struct NewPage<'a> {
    pub project: &'a str,
    pub key: &'a str,
    pub kind: &'a str,
    pub role: &'a str,
    pub workspace: &'a str,
    pub title: &'a str,
    pub text: &'a str,
    pub body: &'a [u8],
    /// 取り込みの時だけ。無ければサーバーが決める。
    pub n: Option<i64>,
    pub created_at: Option<&'a str>,
}

#[derive(Debug, Serialize)]
pub struct PageMeta {
    pub project: String,
    pub key: String,
    pub kind: String,
    pub n: i64,
    pub title: String,
    pub role: String,
    pub workspace: String,
    pub created_at: String,
    pub size: i64,
}

#[derive(Default)]
pub struct Filter {
    pub project: Option<String>,
    pub key: Option<String>,
    pub kind: Option<String>,
    pub role: Option<String>,
    pub workspace: Option<String>,
    pub q: Option<String>,
    pub before: Option<String>,
    pub after: Option<String>,
    pub oldest_first: bool,
    pub limit: i64,
}

#[derive(Debug)]
pub enum PutError {
    /// 指定した番号は、もう使われている。
    Taken,
    Db(sqlx::Error),
}

impl Db {
    pub async fn open(path: &Path) -> Result<Self, sqlx::Error> {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal);
        let write = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options.clone())
            .await?;
        sqlx::migrate!().run(&write).await?;
        let read = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options.read_only(true))
            .await?;
        Ok(Self {
            read,
            write,
            path: path.to_owned(),
        })
    }

    pub async fn close(&self) {
        self.read.close().await;
        self.write.close().await;
    }

    pub async fn put(&self, page: NewPage<'_>) -> Result<PageMeta, PutError> {
        let mut tx = self.write.begin().await.map_err(PutError::Db)?;
        let row = sqlx::query!(
            r#"insert into pages(project, key, kind, n, title, role, workspace, created_at, body)
               values(?1, ?2, ?3,
                      coalesce(?4, (select coalesce(max(n), 0) + 1 from pages
                                    where project = ?1 and key = ?2 and kind = ?3)),
                      ?5, ?6, ?7,
                      coalesce(?8, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                      ?9)
               returning id as "id!: i64", n as "n!: i64", created_at as "created_at!: String""#,
            page.project,
            page.key,
            page.kind,
            page.n,
            page.title,
            page.role,
            page.workspace,
            page.created_at,
            page.body,
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| match e.as_database_error() {
            Some(d) if d.is_unique_violation() => PutError::Taken,
            _ => PutError::Db(e),
        })?;
        sqlx::query!(
            "insert into pages_fts(rowid, title, text) values(?1, ?2, ?3)",
            row.id,
            page.title,
            page.text,
        )
        .execute(&mut *tx)
        .await
        .map_err(PutError::Db)?;
        tx.commit().await.map_err(PutError::Db)?;
        Ok(PageMeta {
            project: page.project.to_owned(),
            key: page.key.to_owned(),
            kind: page.kind.to_owned(),
            n: row.n,
            title: page.title.to_owned(),
            role: page.role.to_owned(),
            workspace: page.workspace.to_owned(),
            created_at: row.created_at,
            size: page.body.len() as i64,
        })
    }

    pub async fn body(
        &self,
        project: &str,
        key: &str,
        kind: &str,
        n: i64,
    ) -> Result<Option<Vec<u8>>, sqlx::Error> {
        sqlx::query_scalar!(
            "select body from pages where project = ?1 and key = ?2 and kind = ?3 and n = ?4",
            project,
            key,
            kind,
            n,
        )
        .fetch_optional(&self.read)
        .await
    }

    pub async fn list(&self, f: &Filter) -> Result<Vec<PageMeta>, sqlx::Error> {
        let (fts, scan) = search(f.q.as_deref());
        sqlx::query_as!(
            PageMeta,
            r#"select project, key, kind, n, title, role, workspace, created_at,
                      length(body) as "size!: i64"
               from pages
               where (?1 is null or project = ?1)
                 and (?2 is null or key = ?2)
                 and (?3 is null or kind = ?3)
                 and (?4 is null or role = ?4)
                 and (?5 is null or workspace = ?5)
                 and (?6 is null or id in (select rowid from pages_fts where pages_fts match ?6))
                 and (?7 is null or id in (select rowid from pages_fts
                                           where instr(title, ?7) > 0 or instr(text, ?7) > 0))
                 and (?8 is null or created_at < ?8)
                 and (?9 is null or created_at > ?9)
               order by case when ?10 then created_at end asc,
                        case when ?10 then id end asc,
                        created_at desc, id desc
               limit ?11"#,
            f.project,
            f.key,
            f.kind,
            f.role,
            f.workspace,
            fts,
            scan,
            f.before,
            f.after,
            f.oldest_first,
            f.limit,
        )
        .fetch_all(&self.read)
        .await
    }

    /// 動かしたまま、DB の写しを 1 つの file に作る。呼んだ側が読み終えたら消す。
    pub async fn backup(&self) -> Result<PathBuf, sqlx::Error> {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let mut name = self.path.clone().into_os_string();
        name.push(format!(
            ".backup-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        let out = PathBuf::from(name);
        let _ = std::fs::remove_file(&out);
        let target = out.to_string_lossy().into_owned();
        sqlx::query!("vacuum into ?1", target)
            .execute(&self.write)
            .await?;
        Ok(out)
    }
}

/// 探す語を、全文の索引で探す形（3 字以上の語だけの時）か、端から見る形（短い語がある時）に分ける。
fn search(q: Option<&str>) -> (Option<String>, Option<String>) {
    let Some(q) = q.map(str::trim).filter(|q| !q.is_empty()) else {
        return (None, None);
    };
    if q.split_whitespace().all(|term| term.chars().count() >= 3) {
        let phrases: Vec<String> = q
            .split_whitespace()
            .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
            .collect();
        (Some(phrases.join(" ")), None)
    } else {
        (None, Some(q.to_owned()))
    }
}

#[cfg(test)]
mod tests {
    use super::search;

    #[test]
    fn long_terms_become_quoted_phrases() {
        assert_eq!(
            search(Some(" 絞り込み a\"b\"c ")),
            (Some("\"絞り込み\" \"a\"\"b\"\"c\"".into()), None)
        );
    }

    #[test]
    fn a_short_term_falls_back_to_a_scan() {
        assert_eq!(search(Some("一覧 UI")), (None, Some("一覧 UI".into())));
        assert_eq!(search(Some("  ")), (None, None));
        assert_eq!(search(None), (None, None));
    }
}
