use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    time::Duration,
};

use anyhow::Context;
use serde_json::Value;

use crate::{attach, usage::UsageSnapshot};

pub fn run(default_port: u16) -> anyhow::Result<()> {
    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .context("failed to read Claude status-line JSON")?;

    let payload: Value =
        serde_json::from_str(&input).context("failed to parse status-line JSON")?;
    let snapshot = UsageSnapshot::from_status_line_json(&payload);

    if let Some(port) = usage_port(&snapshot, default_port) {
        let _ = post_usage(port, &input);
    }

    println!("{}", snapshot.status_line_text());
    Ok(())
}

fn usage_port(snapshot: &UsageSnapshot, default_port: u16) -> Option<u16> {
    if let Ok(port) = std::env::var("CLAUDE_SIGNAL_PORT") {
        if let Ok(port) = port.parse() {
            return Some(port);
        }
    }

    let Some(session_id) = std::env::var("CLAUDE_SIGNAL_SESSION_ID")
        .ok()
        .or_else(|| snapshot.session_id.clone())
    else {
        return Some(default_port);
    };

    attach::read_attached_session(&session_id)
        .ok()
        .flatten()
        .map(|session| session.port)
        .or(Some(default_port))
}

fn post_usage(port: u16, body: &str) -> anyhow::Result<()> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(250))?;
    stream.set_read_timeout(Some(Duration::from_millis(250)))?;
    stream.set_write_timeout(Some(Duration::from_millis(250)))?;

    write!(
        stream,
        "POST /api/usage HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    )?;

    let mut response = [0_u8; 64];
    let _ = stream.read(&mut response);
    Ok(())
}
