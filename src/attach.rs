use std::{
    fs::{self, OpenOptions},
    net::{SocketAddr, TcpListener, TcpStream},
    path::PathBuf,
    process::{Command, Stdio},
    time::Duration,
};

use serde::{Deserialize, Serialize};
#[cfg(unix)]
use std::os::unix::process::CommandExt;

use crate::network::local_network_ip;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachedSession {
    pub session_id: String,
    pub port: u16,
    pub worker_pid: Option<u32>,
    pub parent_pid: Option<i32>,
    pub cwd: Option<String>,
}

pub fn find_available_port(start: u16) -> anyhow::Result<u16> {
    find_available_port_with(start, |port| {
        let addr: SocketAddr = format!("0.0.0.0:{port}").parse()?;
        Ok(TcpListener::bind(addr).is_ok())
    })
}

fn find_available_port_with(
    start: u16,
    mut is_available: impl FnMut(u16) -> anyhow::Result<bool>,
) -> anyhow::Result<u16> {
    for port in start..start.saturating_add(100) {
        if is_available(port)? {
            return Ok(port);
        }
    }
    anyhow::bail!("no available port found from {start} to {}", start + 99)
}

pub fn attach(
    host: &str,
    start_port: u16,
    session_id: String,
    parent_pid: Option<i32>,
    cwd: Option<String>,
) -> anyhow::Result<AttachedSession> {
    if let Some(existing) = read_session(&session_id)? {
        if port_is_open(existing.port) {
            print_urls(existing.port);
            return Ok(existing);
        }
    }

    let port = find_available_port(start_port)?;
    let current_exe = std::env::current_exe()?;
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(worker_log_path(&session_id))?;
    let mut command = Command::new(current_exe);
    command
        .arg("--host")
        .arg(host)
        .arg("--port")
        .arg(port.to_string())
        .arg("serve-session")
        .arg("--session-id")
        .arg(&session_id)
        .args(
            parent_pid
                .map(|pid| vec!["--parent-pid".to_string(), pid.to_string()])
                .unwrap_or_default(),
        )
        .args(
            cwd.as_ref()
                .map(|cwd| vec!["--cwd".to_string(), cwd.clone()])
                .unwrap_or_default(),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(log));

    #[cfg(unix)]
    // SAFETY: setsid() is async-signal-safe and only affects the forked child.
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }

    let child = command.spawn()?;

    let session = AttachedSession {
        session_id,
        port,
        worker_pid: Some(child.id()),
        parent_pid,
        cwd,
    };
    write_session(&session)?;
    print_urls(port);
    Ok(session)
}

pub fn read_attached_session(session_id: &str) -> anyhow::Result<Option<AttachedSession>> {
    read_session(session_id)
}

pub fn stop(session_id: String) -> anyhow::Result<bool> {
    let Some(session) = read_session(&session_id)? else {
        println!("ClaudeSignal is not running for this session.");
        return Ok(false);
    };

    let stopped = stop_session(&session);
    if stopped {
        let _ = fs::remove_file(session_path(&session.session_id));
    }
    println!("ClaudeSignal stopped for this session.");
    Ok(true)
}

pub fn stop_all() -> anyhow::Result<usize> {
    let mut stopped = 0;
    let dir = session_dir();
    if !dir.exists() {
        println!("No ClaudeSignal sessions found.");
        return Ok(0);
    }

    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let text = fs::read_to_string(entry.path())?;
        if let Ok(session) = serde_json::from_str::<AttachedSession>(&text) {
            if stop_session(&session) {
                stopped += 1;
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    println!("Stopped {stopped} ClaudeSignal session(s).");
    Ok(stopped)
}

pub fn print_urls(port: u16) {
    println!("ClaudeSignal started\n");
    println!("Local:");
    println!("  http://localhost:{port}\n");
    println!("Phone:");
    match local_network_ip() {
        Some(ip) => println!("  http://{ip}:{port}\n"),
        None => println!("  Could not detect local network IP. Use localhost on this Mac.\n"),
    }
}

pub async fn monitor_parent(state: crate::server::AppState, parent_pid: Option<i32>) {
    loop {
        tokio::time::sleep(Duration::from_secs(3)).await;
        let snapshot = state.status_store.snapshot().await;
        if let Some(last_activity_at) = snapshot.last_activity_at {
            let inactive = (chrono::Utc::now() - last_activity_at).num_seconds().max(0) as u64;
            if state.status_store.mark_thinking_if_inactive(inactive).await {
                let snapshot = state.status_store.snapshot().await;
                let _ = state
                    .broadcaster
                    .send(crate::status::ServerEvent::Status(snapshot));
            }
        }

        if parent_pid.is_some_and(|pid| pid > 0 && !pid_exists(pid)) {
            state.status_store.mark_offline().await;
            let snapshot = state.status_store.snapshot().await;
            let _ = state
                .broadcaster
                .send(crate::status::ServerEvent::Status(snapshot));
            break;
        }
    }
}

fn port_is_open(port: u16) -> bool {
    TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(200),
    )
    .is_ok()
}

fn pid_exists(pid: i32) -> bool {
    // SAFETY: signal 0 performs an existence check without sending a signal.
    unsafe { libc::kill(pid, 0) == 0 }
}

fn stop_session(session: &AttachedSession) -> bool {
    if let Some(pid) = session.worker_pid {
        if !pid_is_claude_signal(pid as i32) {
            println!(
                "PID {} is no longer a ClaudeSignal process (may have been recycled). Skipping kill.",
                pid
            );
            return false;
        }
        return stop_pid(pid as i32);
    }

    if port_is_open(session.port) {
        println!(
            "Session file has no worker PID. Dashboard on port {} may need manual cleanup.",
            session.port
        );
    }
    false
}

fn pid_is_claude_signal(pid: i32) -> bool {
    if !pid_exists(pid) {
        return false;
    }
    let Ok(current_exe) = std::env::current_exe() else {
        return false;
    };
    let current_name = current_exe
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    if current_name.is_empty() {
        return false;
    }
    #[cfg(target_os = "macos")]
    {
        let mut buf = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
        // SAFETY: buf is large enough for PROC_PIDPATHINFO_MAXSIZE and pid is a valid i32.
        let len = unsafe {
            libc::proc_pidpath(pid, buf.as_mut_ptr() as *mut libc::c_void, buf.len() as u32)
        };
        if len <= 0 {
            return false;
        }
        let path = String::from_utf8_lossy(&buf[..len as usize]);
        path.contains(current_name)
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let exe_link = format!("/proc/{pid}/exe");
        if let Ok(target) = std::fs::read_link(exe_link) {
            let target_name = target.file_name().and_then(|n| n.to_str()).unwrap_or("");
            return target_name == current_name;
        }
        false
    }
    #[cfg(not(unix))]
    {
        let _ = current_name;
        false
    }
}

fn stop_pid(pid: i32) -> bool {
    #[cfg(unix)]
    // SAFETY: pid is verified to be a ClaudeSignal process before this call.
    // Negative pid sends signal to the process group.
    unsafe {
        let group_result = libc::kill(-pid, libc::SIGTERM);
        let pid_result = libc::kill(pid, libc::SIGTERM);
        group_result == 0 || pid_result == 0
    }

    #[cfg(not(unix))]
    {
        let _ = pid;
        false
    }
}

fn session_dir() -> PathBuf {
    std::env::temp_dir().join("claude-signal-sessions")
}

fn session_path(session_id: &str) -> PathBuf {
    session_dir().join(format!("{}.json", safe_session_id(session_id)))
}

fn worker_log_path(session_id: &str) -> PathBuf {
    session_dir().join(format!("{}.log", safe_session_id(session_id)))
}

fn safe_session_id(session_id: &str) -> String {
    let safe_session_id = session_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    safe_session_id
}

fn read_session(session_id: &str) -> anyhow::Result<Option<AttachedSession>> {
    let path = session_path(session_id);
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(path)?;
    Ok(Some(serde_json::from_str(&text)?))
}

fn write_session(session: &AttachedSession) -> anyhow::Result<()> {
    fs::create_dir_all(session_dir())?;
    fs::write(
        session_path(&session.session_id),
        serde_json::to_string_pretty(session)?,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{find_available_port_with, safe_session_id};

    #[test]
    fn finds_next_available_port_when_start_port_is_taken() {
        let available = find_available_port_with(3000, |port| Ok(port != 3000)).unwrap();

        assert_eq!(available, 3001);
    }

    #[test]
    fn safe_session_id_replaces_unsafe_characters() {
        assert_eq!(safe_session_id("abc/123:xyz"), "abc_123_xyz");
    }
}
