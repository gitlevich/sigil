use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, WebviewWindow};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use uuid::Uuid;

const PROTOCOL: &str = "sigil-external-ai-jsonl-v1";
const DEFAULT_TIMEOUT_MS: u64 = 300_000;
const MAX_TIMEOUT_MS: u64 = 1_800_000;

#[derive(Clone)]
pub struct ExternalAiBridge {
    inner: Arc<Mutex<ExternalAiBridgeInner>>,
}

#[derive(Default)]
struct ExternalAiBridgeInner {
    server: Option<ExternalAiBridgeServer>,
    workspaces: HashMap<String, WorkspaceRegistration>,
    pending: HashMap<String, PendingRequest>,
}

#[derive(Debug, Clone)]
struct ExternalAiBridgeServer {
    host: String,
    port: u16,
    token: String,
    pid: u32,
}

#[derive(Debug, Clone)]
struct WorkspaceRegistration {
    window_label: String,
}

struct PendingRequest {
    connection_id: String,
    tx: mpsc::UnboundedSender<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAiBridgeDiscovery {
    pub protocol: String,
    pub host: String,
    pub port: u16,
    pub token: String,
    pub root_path: String,
    pub pid: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAiBridgeMessage {
    pub request_id: String,
    pub root_path: String,
    pub message: String,
    #[serde(default)]
    pub current_path: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExternalAiClientLine {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    token: Option<String>,
    #[serde(default)]
    request_id: Option<String>,
    #[serde(default)]
    root_path: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    current_path: Option<Vec<String>>,
    #[serde(default)]
    timeout_ms: Option<u64>,
}

impl ExternalAiBridge {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(ExternalAiBridgeInner::default())),
        }
    }

    async fn ensure_server_started(
        &self,
        app: AppHandle,
    ) -> Result<ExternalAiBridgeServer, String> {
        if let Some(server) = self.server() {
            return Ok(server);
        }

        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|e| format!("Failed to bind external AI bridge: {}", e))?;
        let local_addr = listener
            .local_addr()
            .map_err(|e| format!("Failed to read external AI bridge address: {}", e))?;
        let server = ExternalAiBridgeServer {
            host: "127.0.0.1".to_string(),
            port: local_addr.port(),
            token: Uuid::new_v4().to_string(),
            pid: std::process::id(),
        };

        {
            let mut inner = self.inner.lock().expect("ExternalAiBridge mutex poisoned");
            if let Some(existing) = &inner.server {
                return Ok(existing.clone());
            }
            inner.server = Some(server.clone());
        }

        let bridge = self.clone();
        tauri::async_runtime::spawn(async move {
            bridge.serve(app, listener).await;
        });

        Ok(server)
    }

    fn server(&self) -> Option<ExternalAiBridgeServer> {
        self.inner
            .lock()
            .expect("ExternalAiBridge mutex poisoned")
            .server
            .clone()
    }

    fn register_workspace(&self, root_path: String, window_label: String) {
        self.inner
            .lock()
            .expect("ExternalAiBridge mutex poisoned")
            .workspaces
            .insert(root_path, WorkspaceRegistration { window_label });
    }

    fn unregister_workspace(&self, root_path: &str) {
        self.inner
            .lock()
            .expect("ExternalAiBridge mutex poisoned")
            .workspaces
            .remove(root_path);
    }

    fn discovery_for(
        &self,
        server: &ExternalAiBridgeServer,
        root_path: String,
    ) -> ExternalAiBridgeDiscovery {
        ExternalAiBridgeDiscovery {
            protocol: PROTOCOL.to_string(),
            host: server.host.clone(),
            port: server.port,
            token: server.token.clone(),
            root_path,
            pid: server.pid,
        }
    }

    fn send_ack(&self, request_id: &str, ok: bool, message: String) -> Result<(), String> {
        let tx = self.pending_tx(request_id)?;
        send_json(
            &tx,
            json!({
                "type": "ack",
                "requestId": request_id,
                "ok": ok,
                "message": message,
            }),
        )
    }

    fn send_final(&self, request_id: &str, ok: bool, message: String) -> Result<(), String> {
        let tx = {
            let mut inner = self.inner.lock().expect("ExternalAiBridge mutex poisoned");
            inner
                .pending
                .remove(request_id)
                .map(|pending| pending.tx)
                .ok_or_else(|| format!("No pending external AI request {}", request_id))?
        };
        send_json(
            &tx,
            json!({
                "type": "final",
                "requestId": request_id,
                "ok": ok,
                "message": message,
            }),
        )
    }

    fn pending_tx(&self, request_id: &str) -> Result<mpsc::UnboundedSender<String>, String> {
        self.inner
            .lock()
            .expect("ExternalAiBridge mutex poisoned")
            .pending
            .get(request_id)
            .map(|pending| pending.tx.clone())
            .ok_or_else(|| format!("No pending external AI request {}", request_id))
    }

    fn remove_connection_requests(&self, connection_id: &str) {
        self.inner
            .lock()
            .expect("ExternalAiBridge mutex poisoned")
            .pending
            .retain(|_, pending| pending.connection_id != connection_id);
    }

    fn timeout_request(&self, request_id: &str) {
        let tx = {
            let mut inner = self.inner.lock().expect("ExternalAiBridge mutex poisoned");
            inner.pending.remove(request_id).map(|pending| pending.tx)
        };
        if let Some(tx) = tx {
            let _ = send_json(
                &tx,
                json!({
                    "type": "final",
                    "requestId": request_id,
                    "ok": false,
                    "message": "Timed out waiting for Sigil to complete the external AI request.",
                }),
            );
        }
    }

    async fn serve(&self, app: AppHandle, listener: TcpListener) {
        while let Ok((stream, _)) = listener.accept().await {
            let bridge = self.clone();
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                bridge.handle_connection(app, stream).await;
            });
        }
    }

    async fn handle_connection(&self, app: AppHandle, stream: TcpStream) {
        let connection_id = Uuid::new_v4().to_string();
        let (reader, mut writer) = stream.into_split();
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        let writer_task = tauri::async_runtime::spawn(async move {
            while let Some(line) = rx.recv().await {
                if writer.write_all(line.as_bytes()).await.is_err() {
                    break;
                }
                if writer.write_all(b"\n").await.is_err() {
                    break;
                }
            }
        });

        let _ = send_json(
            &tx,
            json!({
                "type": "hello",
                "protocol": PROTOCOL,
            }),
        );

        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            self.handle_client_line(&app, &connection_id, &tx, &line);
        }

        self.remove_connection_requests(&connection_id);
        drop(tx);
        let _ = writer_task.await;
    }

    fn handle_client_line(
        &self,
        app: &AppHandle,
        connection_id: &str,
        tx: &mpsc::UnboundedSender<String>,
        line: &str,
    ) {
        let request = match serde_json::from_str::<ExternalAiClientLine>(line) {
            Ok(request) => request,
            Err(err) => {
                let _ = send_error(tx, None, format!("Malformed external AI bridge message: {}", err));
                return;
            }
        };
        if request.kind != "send" {
            let _ = send_error(tx, request.request_id.as_deref(), "Unsupported external AI bridge message type".to_string());
            return;
        }
        let server = match self.server() {
            Some(server) => server,
            None => {
                let _ = send_error(tx, request.request_id.as_deref(), "External AI bridge is not running".to_string());
                return;
            }
        };
        if request.token.as_deref() != Some(server.token.as_str()) {
            let _ = send_error(tx, request.request_id.as_deref(), "Invalid external AI bridge token".to_string());
            return;
        }

        let request_id = request
            .request_id
            .unwrap_or_else(|| format!("external-{}", Uuid::new_v4()));
        if let Err(err) = validate_request_id(&request_id) {
            let _ = send_error(tx, Some(&request_id), err);
            return;
        }

        let root_path = match request.root_path {
            Some(root_path) if !root_path.trim().is_empty() => root_path,
            _ => {
                let _ = send_error(tx, Some(&request_id), "rootPath is required".to_string());
                return;
            }
        };
        let message = match request.message {
            Some(message) if !message.trim().is_empty() => message,
            _ => {
                let _ = send_error(tx, Some(&request_id), "message is required".to_string());
                return;
            }
        };

        let window_label = {
            let mut inner = self.inner.lock().expect("ExternalAiBridge mutex poisoned");
            if inner.pending.contains_key(&request_id) {
                let _ = send_error(tx, Some(&request_id), "Duplicate external AI request id".to_string());
                return;
            }
            let Some(registration) = inner.workspaces.get(&root_path).cloned() else {
                let _ = send_error(tx, Some(&request_id), "No open Sigil workspace is registered for rootPath".to_string());
                return;
            };
            inner.pending.insert(
                request_id.clone(),
                PendingRequest {
                    connection_id: connection_id.to_string(),
                    tx: tx.clone(),
                },
            );
            registration.window_label
        };

        if send_json(
            tx,
            json!({
                "type": "accepted",
                "requestId": request_id,
            }),
        )
        .is_err()
        {
            self.remove_connection_requests(connection_id);
            return;
        }

        let payload = ExternalAiBridgeMessage {
            request_id: request_id.clone(),
            root_path,
            message,
            current_path: request.current_path,
        };
        if app.emit_to(&window_label, "external-ai:message", payload).is_err() {
            let _ = self.send_final(
                &request_id,
                false,
                "Failed to deliver external AI request to the Sigil window".to_string(),
            );
            return;
        }

        let timeout_ms = request
            .timeout_ms
            .unwrap_or(DEFAULT_TIMEOUT_MS)
            .clamp(1_000, MAX_TIMEOUT_MS);
        let bridge = self.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(timeout_ms)).await;
            bridge.timeout_request(&request_id);
        });
    }
}

fn validate_request_id(request_id: &str) -> Result<(), String> {
    if request_id.is_empty() {
        return Err("requestId is empty".to_string());
    }
    if request_id.len() > 128 {
        return Err("requestId is too long".to_string());
    }
    if !request_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("requestId must contain only letters, numbers, dash, or underscore".to_string());
    }
    Ok(())
}

fn send_json(tx: &mpsc::UnboundedSender<String>, value: serde_json::Value) -> Result<(), String> {
    tx.send(value.to_string())
        .map_err(|_| "External AI bridge client disconnected".to_string())
}

fn send_error(
    tx: &mpsc::UnboundedSender<String>,
    request_id: Option<&str>,
    message: String,
) -> Result<(), String> {
    send_json(
        tx,
        json!({
            "type": "error",
            "requestId": request_id,
            "message": message,
        }),
    )
}

fn discovery_path(root_path: &str) -> std::path::PathBuf {
    Path::new(root_path)
        .join(".private")
        .join("external-ai")
        .join("server.json")
}

fn write_discovery_file(
    root_path: &str,
    discovery: &ExternalAiBridgeDiscovery,
) -> Result<(), String> {
    let path = discovery_path(root_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
    }
    let tmp_path = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(discovery).map_err(|e| e.to_string())?;
    fs::write(&tmp_path, json)
        .map_err(|e| format!("Failed to write {}: {}", tmp_path.display(), e))?;
    fs::rename(&tmp_path, &path)
        .map_err(|e| format!("Failed to publish {}: {}", path.display(), e))?;
    Ok(())
}

fn remove_discovery_file(root_path: &str) -> Result<(), String> {
    let path = discovery_path(root_path);
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|e| format!("Failed to remove {}: {}", path.display(), e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn register_external_ai_bridge(
    app: AppHandle,
    window: WebviewWindow,
    root_path: String,
    bridge: tauri::State<'_, ExternalAiBridge>,
) -> Result<ExternalAiBridgeDiscovery, String> {
    let server = bridge.ensure_server_started(app).await?;
    bridge.register_workspace(root_path.clone(), window.label().to_string());
    let discovery = bridge.discovery_for(&server, root_path.clone());
    write_discovery_file(&root_path, &discovery)?;
    Ok(discovery)
}

#[tauri::command]
pub fn unregister_external_ai_bridge(
    root_path: String,
    bridge: tauri::State<'_, ExternalAiBridge>,
) -> Result<(), String> {
    bridge.unregister_workspace(&root_path);
    remove_discovery_file(&root_path)
}

#[tauri::command]
pub fn external_ai_bridge_ack(
    request_id: String,
    ok: bool,
    message: String,
    bridge: tauri::State<'_, ExternalAiBridge>,
) -> Result<(), String> {
    bridge.send_ack(&request_id, ok, message)
}

#[tauri::command]
pub fn external_ai_bridge_complete(
    request_id: String,
    ok: bool,
    message: String,
    bridge: tauri::State<'_, ExternalAiBridge>,
) -> Result<(), String> {
    bridge.send_final(&request_id, ok, message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn writes_and_removes_discovery_file() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().to_string_lossy().to_string();
        let discovery = ExternalAiBridgeDiscovery {
            protocol: PROTOCOL.to_string(),
            host: "127.0.0.1".to_string(),
            port: 3210,
            token: "token".to_string(),
            root_path: root.clone(),
            pid: 42,
        };

        write_discovery_file(&root, &discovery).unwrap();

        let raw = fs::read_to_string(discovery_path(&root)).unwrap();
        let parsed: ExternalAiBridgeDiscovery = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed, discovery);

        remove_discovery_file(&root).unwrap();
        assert!(!discovery_path(&root).exists());
    }

    #[test]
    fn ack_and_complete_route_to_pending_connection() {
        let bridge = ExternalAiBridge::new();
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        bridge
            .inner
            .lock()
            .unwrap()
            .pending
            .insert(
                "request-1".to_string(),
                PendingRequest {
                    connection_id: "connection-1".to_string(),
                    tx,
                },
            );

        bridge
            .send_ack("request-1", true, "Accepted".to_string())
            .unwrap();
        let ack: serde_json::Value = serde_json::from_str(&rx.blocking_recv().unwrap()).unwrap();
        assert_eq!(ack["type"], "ack");
        assert_eq!(ack["requestId"], "request-1");
        assert_eq!(ack["ok"], true);

        bridge
            .send_final("request-1", true, "Done".to_string())
            .unwrap();
        let final_message: serde_json::Value =
            serde_json::from_str(&rx.blocking_recv().unwrap()).unwrap();
        assert_eq!(final_message["type"], "final");
        assert_eq!(final_message["requestId"], "request-1");
        assert_eq!(final_message["message"], "Done");
        assert!(bridge.send_final("request-1", true, "Again".to_string()).is_err());
    }

    #[test]
    fn remove_connection_requests_removes_only_that_connection() {
        let bridge = ExternalAiBridge::new();
        let (tx1, _rx1) = mpsc::unbounded_channel::<String>();
        let (tx2, _rx2) = mpsc::unbounded_channel::<String>();
        {
            let mut inner = bridge.inner.lock().unwrap();
            inner.pending.insert(
                "request-1".to_string(),
                PendingRequest {
                    connection_id: "connection-1".to_string(),
                    tx: tx1,
                },
            );
            inner.pending.insert(
                "request-2".to_string(),
                PendingRequest {
                    connection_id: "connection-2".to_string(),
                    tx: tx2,
                },
            );
        }

        bridge.remove_connection_requests("connection-1");

        let inner = bridge.inner.lock().unwrap();
        assert!(!inner.pending.contains_key("request-1"));
        assert!(inner.pending.contains_key("request-2"));
    }

    #[test]
    fn validates_request_ids() {
        assert!(validate_request_id("external-1_OK").is_ok());
        assert!(validate_request_id("../escape").is_err());
        assert!(validate_request_id("").is_err());
        assert!(validate_request_id(&"x".repeat(129)).is_err());
    }
}
