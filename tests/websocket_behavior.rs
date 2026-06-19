use std::net::SocketAddr;

use claude_signal::{
    routes::build_router,
    server::AppState,
    status::{ClaudeStatus, LogStream, ServerEvent},
};
use futures_util::StreamExt;
use tokio::net::TcpListener;
use tokio_tungstenite::connect_async;

async fn start_server() -> (AppState, SocketAddr) {
    let state = AppState::new(200);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = build_router(state.clone());
    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (state, addr)
}

#[tokio::test]
async fn websocket_receives_initial_status_snapshot() {
    let (_state, addr) = start_server().await;
    let url = format!("ws://{addr}/ws");
    let (mut ws, _) = connect_async(&url).await.unwrap();

    let msg = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next())
        .await
        .expect("timed out waiting for initial message")
        .expect("stream ended")
        .expect("ws error");

    let text = msg.into_text().unwrap();
    let event: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(event["type"], "status");
    assert_eq!(event["data"]["status"], "offline");
    assert_eq!(event["data"]["isClaudeRunning"], false);

    ws.close(None).await.ok();
}

#[tokio::test]
async fn websocket_receives_broadcast_events() {
    let (state, addr) = start_server().await;
    let url = format!("ws://{addr}/ws");
    let (mut ws, _) = connect_async(&url).await.unwrap();

    // Consume the initial status snapshot
    let _ = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();

    // Broadcast a log event from the server side
    state.status_store.start_session("test-ws").await;
    let entry = state
        .status_store
        .record_output(LogStream::Stdout, "hello from test")
        .await;
    let _ = state.broadcaster.send(ServerEvent::Log(entry));

    let msg = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next())
        .await
        .expect("timed out waiting for broadcast")
        .expect("stream ended")
        .expect("ws error");

    let text = msg.into_text().unwrap();
    let event: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(event["type"], "log");
    assert_eq!(event["data"]["line"], "hello from test");
    assert_eq!(event["data"]["stream"], "stdout");

    ws.close(None).await.ok();
}

#[tokio::test]
async fn websocket_receives_status_broadcast() {
    let (state, addr) = start_server().await;
    let url = format!("ws://{addr}/ws");
    let (mut ws, _) = connect_async(&url).await.unwrap();

    // Consume initial snapshot
    let _ = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();

    // Update status and broadcast
    state.status_store.start_session("test-ws-2").await;
    state
        .status_store
        .set_status(ClaudeStatus::Thinking)
        .await;
    let snapshot = state.status_store.snapshot().await;
    let _ = state.broadcaster.send(ServerEvent::Status(snapshot));

    let msg = tokio::time::timeout(std::time::Duration::from_secs(2), ws.next())
        .await
        .expect("timed out waiting for status broadcast")
        .expect("stream ended")
        .expect("ws error");

    let text = msg.into_text().unwrap();
    let event: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(event["type"], "status");
    assert_eq!(event["data"]["status"], "thinking");
    assert_eq!(event["data"]["isClaudeRunning"], true);

    ws.close(None).await.ok();
}
