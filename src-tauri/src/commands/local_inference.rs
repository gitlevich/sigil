//! Local inference — spawns the Python sidecar and routes chat to its
//! OpenAI-compatible HTTP endpoint.
//!
//! Spec: DesignPartner/BicameralMind/LeftHemisphere
//! Infrastructure — lives outside the spec-mirroring modules because it's a
//! service the application uses, not a sigil. Same category as SQLite.
//!
//! The sidecar (sidecar/main.py) downloads a GGUF model and starts
//! llama-cpp-python's server on a local port. On startup it writes one line
//! to stdout with the endpoint URL:
//!
//! ```text
//! {"ready": true, "endpoint": "http://127.0.0.1:8765", "model": "..."}
//! ```
//!
//! After that, all traffic is OpenAI-compatible HTTP — same protocol the
//! remote OpenAI path already uses, so tool-calling and streaming come for
//! free once the client points at the local URL. The !stateless invariant
//! holds because each request is self-contained from the model's view.
//!
//! Dev-mode path: looks for `sidecar/.venv/bin/python3` and `sidecar/main.py`
//! relative to the project root. Production bundling (PyInstaller) comes
//! later; the path layout will be overridable then.
//!
//! Resolution order for the sidecar directory:
//!   1. `SIGIL_SIDECAR_DIR` environment variable, if set.
//!   2. The first line of `~/Library/Application Support/com.sigilengineering.sigil/sidecar-path`.
//!   3. Walks up from the current working directory (works in `cargo tauri dev`).
//!   4. Walks up from the running executable (works for the bundled .app when
//!      the sidecar sits next to or above the binary).
//! The bundled .app starts with cwd=`/`, so (1) or (2) is what makes chat work
//! from Finder until PyInstaller bundling lands.
//!
//! The sidecar's stderr is inherited so logs surface in the Tauri console.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;

use serde::Serialize;
use serde_json::json;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, ChildStdout, Command};
use tokio::sync::Mutex;

/// One turn in a conversation, sent as a JSON object to the local endpoint.
#[derive(Debug, Clone, Serialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}

/// One live sidecar process plus the endpoint it advertised.
struct Session {
    /// Kept so the process is killed on drop.
    #[allow(dead_code)]
    child: Child,
    endpoint: String,
    model: String,
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

    /// Ensure the sidecar is running and return (endpoint, model_id).
    /// Spawns on first call; subsequent calls reuse the running instance.
    pub async fn ensure_running(&self) -> Result<(String, String), String> {
        let mut guard = self.session.lock().await;
        if guard.is_none() {
            *guard = Some(spawn_sidecar().await?);
        }
        let session = guard.as_ref().expect("session just set");
        Ok((session.endpoint.clone(), session.model.clone()))
    }

    /// Drop the current session so the next `ensure_running` respawns.
    /// Call this when the sidecar appears dead or a request fails in a way
    /// that suggests the process is gone.
    pub async fn reset(&self) {
        let mut guard = self.session.lock().await;
        *guard = None;
    }

    /// Single-turn invocation — used by @LeftHemisphere callers outside chat.
    /// Talks to the local endpoint via OpenAI-compatible HTTP.
    pub async fn invoke(&self, prompt: &str, max_tokens: u32) -> Result<String, String> {
        let messages = vec![Message {
            role: "user".into(),
            content: prompt.into(),
        }];
        self.invoke_messages(&messages, max_tokens).await
    }

    /// Multi-turn invocation without tools. For tool-calling, the chat flow
    /// in commands::chat uses the OpenAI streaming path pointed at the
    /// endpoint this returns via `ensure_running`.
    pub async fn invoke_messages(
        &self,
        messages: &[Message],
        max_tokens: u32,
    ) -> Result<String, String> {
        let (endpoint, model) = self.ensure_running().await?;
        let url = format!("{}/v1/chat/completions", endpoint.trim_end_matches('/'));

        let body = json!({
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "stream": false,
        });

        let client = reqwest::Client::new();
        let resp = client
            .post(&url)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("local server request failed: {}", e))?;

        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| format!("read response body: {}", e))?;
        if !status.is_success() {
            return Err(format!("local server error {}: {}", status, text));
        }

        let parsed: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| format!("parse response JSON: {} — raw: {}", e, text))?;

        let content = parsed["choices"]
            .as_array()
            .and_then(|arr| arr.first())
            .and_then(|choice| choice["message"]["content"].as_str())
            .unwrap_or("")
            .to_string();
        Ok(content)
    }
}

fn sidecar_dir() -> PathBuf {
    if let Ok(explicit) = std::env::var("SIGIL_SIDECAR_DIR") {
        let p = PathBuf::from(explicit);
        if p.join("main.py").exists() {
            return p;
        }
    }

    if let Ok(home) = std::env::var("HOME") {
        let pointer = PathBuf::from(&home)
            .join("Library/Application Support/com.sigilengineering.sigil/sidecar-path");
        if let Ok(contents) = std::fs::read_to_string(&pointer) {
            let trimmed = contents.trim();
            if !trimmed.is_empty() {
                let p = PathBuf::from(trimmed);
                if p.join("main.py").exists() {
                    return p;
                }
            }
        }
    }

    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let exe = std::env::current_exe().ok();
    let mut roots: Vec<PathBuf> = vec![cwd.clone()];
    if let Some(e) = exe.as_ref() {
        let mut cursor = e.parent().map(PathBuf::from);
        while let Some(dir) = cursor {
            roots.push(dir.clone());
            cursor = dir.parent().map(PathBuf::from);
        }
    }
    for root in &roots {
        for rel in ["sidecar", "../sidecar", "../../sidecar", "../../../sidecar"] {
            let candidate = root.join(rel);
            if candidate.join("main.py").exists() {
                return candidate;
            }
        }
    }

    cwd.join("sidecar")
}

async fn spawn_sidecar() -> Result<Session, String> {
    let dir = sidecar_dir();
    let python = dir.join(".venv/bin/python3");
    let main = dir.join("main.py");

    if !python.exists() {
        return Err(format!(
            "sidecar Python not found at {}. Set SIGIL_SIDECAR_DIR or write the sidecar path to ~/Library/Application Support/com.sigilengineering.sigil/sidecar-path, then run `cd sidecar && uv venv && uv pip install -e .`.",
            python.display()
        ));
    }
    if !main.exists() {
        return Err(format!("sidecar main.py not found at {}", main.display()));
    }

    let mut child = Command::new(&python)
        .arg(&main)
        .current_dir(&dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("spawn sidecar: {}", e))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "no stdout on sidecar child".to_string())?;
    let mut stdout: BufReader<ChildStdout> = BufReader::new(stdout);

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

    let endpoint = ready
        .get("endpoint")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "ready line missing endpoint".to_string())?
        .to_string();
    let model = ready
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("local")
        .to_string();

    Ok(Session {
        child,
        endpoint,
        model,
    })
}
