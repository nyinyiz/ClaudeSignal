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

#[tokio::test]
async fn config_route_returns_defaults() {
    let state = AppState::new(200);
    let app = build_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/config")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&bytes).unwrap();
    assert!(json["budget"]["daily_budget_usd"].is_null());
    assert_eq!(json["alerts"]["rate_limit_warn_percent"], 80.0);
    assert_eq!(json["alerts"]["osascript_notifications"], true);
}

#[tokio::test]
async fn health_dashboard_routes_return_expected_types() {
    let state = AppState::new(200);
    let app = build_router(state);

    // /health page returns HTML
    let health_page = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(health_page.status(), StatusCode::OK);
    let ct = health_page.headers().get("content-type").unwrap().to_str().unwrap();
    assert!(ct.contains("text/html"));

    // /health.js returns JavaScript
    let health_js = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/health.js")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(health_js.status(), StatusCode::OK);
    let ct = health_js.headers().get("content-type").unwrap().to_str().unwrap();
    assert!(ct.contains("javascript"));

    // /health-styles.css returns CSS
    let health_css = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/health-styles.css")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(health_css.status(), StatusCode::OK);
    let ct = health_css.headers().get("content-type").unwrap().to_str().unwrap();
    assert!(ct.contains("css"));
}

#[tokio::test]
async fn health_metrics_returns_valid_json() {
    let state = AppState::new(200);
    let app = build_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/health/metrics")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&bytes).unwrap();

    // Check required fields exist and have correct types
    assert!(json["total_tokens"].is_number());
    assert!(json["total_input_tokens"].is_number());
    assert!(json["total_output_tokens"].is_number());
    assert!(json["total_cache_tokens"].is_number());
    assert!(json["total_estimated_cost_usd"].is_number());
    assert!(json["models_used"].is_array());
    assert!(json["tasks_completed"].is_number());
    assert!(json["first_pass_success_rate"].is_number());
    assert!(json["pr_merge_rate"].is_number());
    assert!(json["human_intervention_rate"].is_number());
    assert!(json["risk_distribution"].is_object());
    assert!(json["risk_distribution"]["low"].is_number());
    assert!(json["risk_distribution"]["medium"].is_number());
    assert!(json["risk_distribution"]["high"].is_number());
    assert!(json["findings_high"].is_number());
    assert!(json["findings_medium"].is_number());
    assert!(json["findings_low"].is_number());
}
