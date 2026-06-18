use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use claude_signal::{routes::build_router, server::AppState};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

#[tokio::test]
async fn health_status_and_logs_routes_return_expected_json() {
    let state = AppState::new(200);
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

#[tokio::test]
async fn usage_routes_accept_status_line_payloads() {
    let state = AppState::new(200);
    let app = build_router(state);

    let payload = serde_json::json!({
        "session_id": "session-a",
        "model": { "display_name": "Claude Sonnet" },
        "context_window": {
            "total_input_tokens": 82000,
            "total_output_tokens": 4200,
            "context_window_size": 200000,
            "used_percentage": 41,
            "remaining_percentage": 59,
            "current_usage": {
                "input_tokens": 32000,
                "output_tokens": 4200,
                "cache_creation_input_tokens": 1200,
                "cache_read_input_tokens": 48000
            }
        },
        "cost": { "total_cost_usd": 0.18 },
        "rate_limits": {
            "five_hour": { "used_percentage": 64, "resets_at": 1781622000 },
            "seven_day": { "used_percentage": 37, "resets_at": 1781946000 }
        }
    });

    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/usage")
                .header("content-type", "application/json")
                .body(Body::from(payload.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let usage = app
        .oneshot(
            Request::builder()
                .uri("/api/usage")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(usage.status(), StatusCode::OK);
    let bytes = usage.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["usage"]["sessionId"], "session-a");
    assert_eq!(json["usage"]["modelName"], "Claude Sonnet");
    assert_eq!(json["usage"]["contextTokensUsed"], 82000);
    assert_eq!(json["usage"]["contextTokensRemaining"], 118000);
    assert_eq!(json["usage"]["contextWindowSize"], 200000);
    assert_eq!(json["usage"]["contextPercentUsed"].as_f64(), Some(41.0));
    assert_eq!(json["usage"]["inputTokens"], 32000);
    assert_eq!(json["usage"]["fiveHourPercent"].as_f64(), Some(64.0));
    assert_eq!(
        json["usage"]["fiveHourResetsAt"],
        "2026-06-16T15:00:00+00:00"
    );
    assert_eq!(json["usage"]["sevenDayPercent"].as_f64(), Some(37.0));
}
