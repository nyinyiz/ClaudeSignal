use axum::{
    extract::State,
    http::{header, HeaderValue},
    response::{Html, IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde_json::json;

use crate::{
    server::AppState, status::ServerEvent, usage::UsageSnapshot, usage_history,
    websocket::ws_handler,
};

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/", get(index))
        .route("/styles.css", get(styles))
        .route("/app.js", get(app_js))
        .route("/api/health", get(health))
        .route("/api/status", get(status))
        .route("/api/logs", get(logs))
        .route("/api/usage", get(usage).post(update_usage))
        .route("/api/usage/history", get(usage_history))
        .route("/ws", get(ws_handler))
        .with_state(state)
}

async fn index() -> Html<&'static str> {
    Html(include_str!("../web/index.html"))
}

async fn styles() -> Response {
    typed_static(include_str!("../web/styles.css"), "text/css; charset=utf-8")
}

async fn app_js() -> Response {
    typed_static(
        include_str!("../web/app.js"),
        "application/javascript; charset=utf-8",
    )
}

fn typed_static(body: &'static str, content_type: &'static str) -> Response {
    let mut response = body.into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    response
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({
        "ok": true,
        "name": "ClaudeSignal",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

async fn status(State(state): State<AppState>) -> Json<crate::status::StatusSnapshot> {
    Json(state.status_store.snapshot().await)
}

async fn logs(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({ "logs": state.status_store.logs().await }))
}

async fn usage(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({ "usage": state.usage_store.snapshot().await }))
}

async fn update_usage(
    State(state): State<AppState>,
    Json(payload): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let snapshot = UsageSnapshot::from_status_line_json(&payload);
    state.usage_store.set(snapshot.clone()).await;
    let _ = state.broadcaster.send(ServerEvent::Usage(snapshot.clone()));
    Json(json!({ "ok": true, "usage": snapshot }))
}

async fn usage_history() -> Json<usage_history::UsageHistorySnapshot> {
    Json(usage_history::scan_default())
}
