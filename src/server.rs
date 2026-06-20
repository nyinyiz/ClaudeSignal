use std::{net::SocketAddr, sync::Arc};

use tokio::sync::broadcast;

use crate::{
    network::local_network_ip, routes::build_router, status::ServerEvent,
    status_store::StatusStore, usage::UsageStore,
};

#[derive(Clone)]
pub struct AppState {
    pub status_store: Arc<StatusStore>,
    pub usage_store: Arc<UsageStore>,
    pub broadcaster: broadcast::Sender<ServerEvent>,
}

impl AppState {
    pub fn new(max_logs: usize) -> Self {
        let (broadcaster, _) = broadcast::channel(256);
        Self {
            status_store: Arc::new(StatusStore::new(max_logs)),
            usage_store: Arc::new(UsageStore::new()),
            broadcaster,
        }
    }
}

pub async fn serve(state: AppState, host: &str, port: u16) -> anyhow::Result<()> {
    print_startup(host, port);
    let addr: SocketAddr = format!("{host}:{port}").parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, build_router(state)).await?;
    Ok(())
}

fn print_startup(host: &str, port: u16) {
    println!("ClaudeSignal is running\n");
    println!("Local:");
    println!("  http://localhost:{port}\n");

    let is_lan = host == "0.0.0.0" || host == "::";
    if is_lan {
        println!("Network:");
        match local_network_ip() {
            Some(ip) => {
                println!("  http://{ip}:{port}\n");
                println!("WebSocket:");
                println!("  ws://{ip}:{port}/ws\n");
            }
            None => {
                println!("  Could not detect a local network IP. Use localhost on this Mac.");
                println!("  Bind address: {host}:{port}\n");
            }
        }
    }

    println!("Press Ctrl+C to stop.");
}
