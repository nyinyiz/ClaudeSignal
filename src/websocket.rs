use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use tokio::time::{self, Duration};

use crate::{server::AppState, status::ServerEvent};

pub async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let mut events = state.broadcaster.subscribe();
    let snapshot = state.status_store.snapshot().await;

    if let Ok(text) = serde_json::to_string(&ServerEvent::Status(snapshot)) {
        if sender.send(Message::Text(text)).await.is_err() {
            return;
        }
    }

    let mut heartbeat = time::interval(Duration::from_secs(15));

    loop {
        tokio::select! {
            event = events.recv() => {
                match event {
                    Ok(event) => {
                        if let Ok(text) = serde_json::to_string(&event) {
                            if sender.send(Message::Text(text)).await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            _ = heartbeat.tick() => {
                let event = ServerEvent::Heartbeat { timestamp: Utc::now() };
                if let Ok(text) = serde_json::to_string(&event) {
                    if sender.send(Message::Text(text)).await.is_err() {
                        break;
                    }
                }
            }
            incoming = receiver.next() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
        }
    }
}
