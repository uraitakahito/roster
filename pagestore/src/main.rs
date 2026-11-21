use pagestore::{AppState, db::Db, router};
use std::path::PathBuf;
use tokio::signal::unix::{SignalKind, signal};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = PathBuf::from(env_or("PAGESTORE_DB", "/data/pages.db"));
    let listen = env_or("PAGESTORE_LISTEN", "0.0.0.0:8080");
    let db = Db::open(&path).await?;
    let listener = tokio::net::TcpListener::bind(&listen).await?;
    println!(
        "pagestore {} listen={listen} db={}",
        env!("CARGO_PKG_VERSION"),
        path.display()
    );

    // container の中では PID 1 になる。PID 1 は、受け口を作らないと止める合図を無視する。
    let mut term = signal(SignalKind::terminate())?;
    let mut int = signal(SignalKind::interrupt())?;
    tokio::select! {
        served = axum::serve(listener, router(AppState::new(db.clone()))) => served?,
        _ = term.recv() => {}
        _ = int.recv() => {}
    }
    db.close().await;
    println!("pagestore stopped");
    Ok(())
}

fn env_or(name: &str, default: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| default.to_owned())
}
