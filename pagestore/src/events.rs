//! 新着の push（SSE）。ページが置かれるたびに、その記録を 1 件送る。

use crate::AppState;
use axum::extract::State;
use axum::response::sse::{Event, KeepAlive, Sse};
use std::convert::Infallible;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

pub async fn stream(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    // 聞く側が遅れて取りこぼした分は捨てる（一覧を読み直せば出る）。
    let stream = BroadcastStream::new(state.events.subscribe())
        .filter_map(|message| message.ok())
        .map(|json| Ok(Event::default().data(json)));
    Sse::new(stream).keep_alive(KeepAlive::default())
}
