//! Local inference — spawns and communicates with the Python sidecar.
//!
//! Spec: DesignPartner/BicameralMind/LeftHemisphere
//! Infrastructure — lives outside the spec-mirroring modules because it's a
//! service the application uses, not a sigil. Same category as SQLite.
//!
//! The sidecar (sidecar/main.py) loads Phi-3 via mlx-lm and answers JSON
//! requests over stdin/stdout. One process per app lifetime; serialized
//! access via a single Mutex. The !stateless invariant holds because each
//! request is self-contained — no context carries between invocations from
//! the model's point of view.
//!
//! Dev-mode path: looks for `sidecar/.venv/bin/python3` and `sidecar/main.py`
//! relative to the project root. Production bundling (PyInstaller) comes
//! later; the path layout will be overridable then.
//!
//! The sidecar's stderr is inherited so logs surface in the Tauri console.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;

use serde::Serialize;
use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

/// One turn in a conversation, sent to the sidecar so Phi-3's chat template
/// can frame it correctly. Using the proper template lets the model stop at
/// its own `<|end|>` token instead of generating the full max_tokens.
#[derive(Debug, Clone, Serialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}

/// One live sidecar process with its I/O streams.
struct Session {
    /// Kept so the process is killed on drop.
    #[allow(dead_code)]
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

/// App-lifetime state: at most one sidecar, lazy-spawned on first use.
#[derive(Default, Clone)]
pub struct LocalInference {
    session: Arc<Mutex<Option<Session>>>,
}

impl LocalInference {
    pub fn new() -> Self {
        Self::default()
    }

    /// Send a single-turn prompt and return the generated content.
    /// Convenience wrapper around `invoke_messages` for @LeftHemisphere callers.
    pub async fn invoke(&self, prompt: &str, max_tokens: u32) -> Result<String, String> {
        let messages = vec![Message {
            role: "user".into(),
            content: prompt.into(),
        }];
        self.invoke_messages(&messages, max_tokens).await
    }

    /// Send a full conversation and return the generated content.
    ///
    /// Spawns the sidecar on first call; subsequent calls reuse it. Serialized:
    /// two concurrent callers wait on the same Mutex. The sidecar applies
    /// Phi-3's chat template, which is what lets generation stop at `<|end|>`.
    pub async fn invoke_messages(
        &self,
        messages: &[Message],
        max_tokens: u32,
    ) -> Result<String, String> {
        let mut guard = self.session.lock().await;
        if guard.is_none() {
            *guard = Some(spawn_sidecar().await?);
        }

        let request = json!({
            "id": "req",
            "messages": messages,
            "max_tokens": max_tokens,
        });
        let mut line = serde_json::to_string(&request)
            .map_err(|e| format!("encode request: {}", e))?;
        line.push('\n');

        // Drop the dead session and bubble up the error — the next call will
        // respawn. This handles sidecar crashes, user-killed processes, and
        // pipe closures without leaving the app stuck on a corpse.
        let result = {
            let session = guard.as_mut().expect("session just set");
            exchange(session, &line).await
        };
        if result.is_err() {
            *guard = None;
        }
        result
    }
}

async fn exchange(session: &mut Session, line: &str) -> Result<String, String> {
    session
        .stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("write sidecar stdin: {}", e))?;
    session
        .stdin
        .flush()
        .await
        .map_err(|e| format!("flush sidecar stdin: {}", e))?;

    let mut response_line = String::new();
    session
        .stdout
        .read_line(&mut response_line)
        .await
        .map_err(|e| format!("read sidecar stdout: {}", e))?;
    if response_line.is_empty() {
        return Err("sidecar closed stdout".into());
    }

    let response: serde_json::Value = serde_json::from_str(response_line.trim())
        .map_err(|e| format!("parse sidecar response: {} — raw: {}", e, response_line))?;

    if let Some(err) = response.get("error").and_then(|v| v.as_str()) {
        return Err(err.to_string());
    }

    Ok(response
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string())
}

fn sidecar_dir() -> PathBuf {
    // In dev, cwd at run time is src-tauri/. Walk up one level to find sidecar/.
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let candidates = [
        cwd.join("sidecar"),
        cwd.join("../sidecar"),
        cwd.parent().map(|p| p.join("sidecar")).unwrap_or_default(),
    ];
    for c in candidates.iter() {
        if c.join("main.py").exists() {
            return c.clone();
        }
    }
    // Fall back to a sensible default; spawn will error informatively.
    cwd.join("sidecar")
}

async fn spawn_sidecar() -> Result<Session, String> {
    let dir = sidecar_dir();
    let python = dir.join(".venv/bin/python3");
    let main = dir.join("main.py");

    if !python.exists() {
        return Err(format!(
            "sidecar Python not found at {}. Run `cd sidecar && uv venv && uv pip install -e .` first.",
            python.display()
        ));
    }
    if !main.exists() {
        return Err(format!("sidecar main.py not found at {}", main.display()));
    }

    let mut child = Command::new(&python)
        .arg(&main)
        .current_dir(&dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("spawn sidecar: {}", e))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "no stdin on sidecar child".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "no stdout on sidecar child".to_string())?;
    let mut stdout = BufReader::new(stdout);

    // First line from the sidecar is its readiness handshake.
    let mut ready_line = String::new();
    stdout
        .read_line(&mut ready_line)
        .await
        .map_err(|e| format!("read sidecar ready line: {}", e))?;
    let ready: serde_json::Value = serde_json::from_str(ready_line.trim())
        .map_err(|e| format!("parse ready line: {} — raw: {}", e, ready_line))?;
    if ready.get("ready").and_then(|v| v.as_bool()) != Some(true) {
        let err = ready
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("sidecar not ready")
            .to_string();
        return Err(err);
    }

    Ok(Session {
        child,
        stdin,
        stdout,
    })
}
