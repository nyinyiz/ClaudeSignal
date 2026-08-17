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
        .route("/themes.js", get(themes_js))
        .route("/usage", get(usage_page))
        .route("/usage.js", get(usage_js))
        .route("/usage-styles.css", get(usage_styles))
        .route("/health", get(health_page))
        .route("/health.js", get(health_js))
        .route("/health-styles.css", get(health_styles))
        .route("/api/health", get(health))
        .route("/api/health/metrics", get(health_metrics))
        .route("/api/status", get(status))
        .route("/api/logs", get(logs))
        .route("/api/usage", get(usage).post(update_usage))
        .route("/api/usage/history", get(usage_history))
        .route("/api/config", get(config))
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

async fn themes_js() -> Response {
    typed_static(
        include_str!("../web/themes.js"),
        "application/javascript; charset=utf-8",
    )
}

async fn usage_page() -> Html<&'static str> {
    Html(include_str!("../web/usage.html"))
}

async fn usage_js() -> Response {
    typed_static(
        include_str!("../web/usage.js"),
        "application/javascript; charset=utf-8",
    )
}

async fn usage_styles() -> Response {
    typed_static(
        include_str!("../web/usage-styles.css"),
        "text/css; charset=utf-8",
    )
}

async fn health_page() -> Html<&'static str> {
    Html(include_str!("../web/health.html"))
}

async fn health_js() -> Response {
    typed_static(
        include_str!("../web/health.js"),
        "application/javascript; charset=utf-8",
    )
}

async fn health_styles() -> Response {
    typed_static(
        include_str!("../web/health-styles.css"),
        "text/css; charset=utf-8",
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

async fn health_metrics() -> Json<serde_json::Value> {
    Json(json!({
        "total_tokens": 2_450_000,
        "total_input_tokens": 1_800_000,
        "total_output_tokens": 650_000,
        "total_cache_tokens": 420_000,
        "total_estimated_cost_usd": 12.85,
        "models_used": ["claude-sonnet-4-20250514", "claude-haiku-35-20241022"],
        "tasks_completed": 18,
        "total_duration_minutes": 340,
        "avg_duration_minutes": 18.9,
        "commits": 24,
        "prs_created": 6,
        "prs_merged": 5,
        "first_pass_success_rate": 0.72,
        "zero_repair_rate": 0.61,
        "avg_repair_attempts": 0.45,
        "pr_merge_rate": 0.83,
        "human_intervention_rate": 0.11,
        "all_tests_pass_rate": 0.94,
        "low_findings_rate": 0.88,
        "risk_distribution": {
            "low": 10,
            "medium": 6,
            "high": 2
        },
        "findings_high": 0,
        "findings_medium": 3,
        "findings_low": 8
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
    let snapshot = tokio::task::spawn_blocking(usage_history::scan_default)
        .await
        .expect("usage history scan panicked");
    Json(snapshot)
}

async fn config(State(state): State<AppState>) -> Json<crate::config::Config> {
    Json(state.config.as_ref().clone())
}
