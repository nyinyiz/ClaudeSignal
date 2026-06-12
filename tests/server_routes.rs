use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use claude_signal::{routes::build_router, server::AppState, status_store::StatusStore};
use http_body_util::BodyExt;
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::broadcast;
use tower::ServiceExt;

#[tokio::test]
async fn health_status_and_logs_routes_return_expected_json() {
    let (tx, _) = broadcast::channel(32);
    let state = AppState {
        status_store: Arc::new(StatusStore::new(200)),
        broadcaster: tx,
    };
    let app = build_router(state);

    let health = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(health.status(), StatusCode::OK);
    let bytes = health.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["ok"], true);
    assert_eq!(json["name"], "ClaudeSignal");
    assert_eq!(json["version"], "0.1.0");

    let status = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/status")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(status.status(), StatusCode::OK);
    let bytes = status.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["status"], "offline");
    assert_eq!(json["isClaudeRunning"], false);

    let logs = app
        .oneshot(
            Request::builder()
                .uri("/api/logs")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(logs.status(), StatusCode::OK);
    let bytes = logs.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert!(json["logs"].as_array().unwrap().is_empty());
}
