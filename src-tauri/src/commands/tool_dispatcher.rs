//! Tool-to-frontend dispatcher.
//!
//! Mutating tools don't touch the filesystem directly — they ask the app
//! to perform the action, via its own frontend API, the same path a user
//! click goes through. This keeps Bicameron and the @user on symmetric
//! footing: both act through the workspace's actions, both benefit from
//! the action layer's post-effects (toasts, reloads, cascading updates).
//!
//! Protocol:
//!   1. Tool generates a request_id, registers a oneshot sender, and
//!      emits a `tool:{name}` event with the payload + request_id.
//!   2. Frontend listens, runs the matching workspace action, calls
//!      `tool_result(request_id, ok, message)` to complete.
//!   3. Tool awaits the oneshot receiver with a timeout and returns the
//!      message to the model.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{oneshot, Mutex};

/// The reply the frontend posts back once it has run the action.
#[derive(Clone, Debug)]
pub struct ToolReply {
    pub ok: bool,
    pub message: String,
}

#[derive(Default, Clone)]
pub struct ToolDispatcher {
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<ToolReply>>>>,
}

impl ToolDispatcher {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a pending request. Caller emits the event with `request_id`
    /// then awaits the receiver.
    pub async fn register(&self, request_id: String) -> oneshot::Receiver<ToolReply> {
        let (tx, rx) = oneshot::channel();
        let mut guard = self.pending.lock().await;
        guard.insert(request_id, tx);
        rx
    }

    /// Complete a pending request. Called from the `tool_result` Tauri
    /// command when the frontend reports the action's outcome.
    pub async fn complete(&self, request_id: &str, reply: ToolReply) -> bool {
        let mut guard = self.pending.lock().await;
        match guard.remove(request_id) {
            Some(tx) => {
                let _ = tx.send(reply);
                true
            }
            None => false,
        }
    }

    /// Drop a pending request without replying — used on timeout.
    pub async fn drop_pending(&self, request_id: &str) {
        let mut guard = self.pending.lock().await;
        guard.remove(request_id);
    }
}

/// Dispatch a mutating tool request to the frontend and await the action's
/// result. Returns the frontend-provided message, or an error if the
/// frontend never responded.
pub async fn dispatch<S: serde::Serialize>(
    dispatcher: &ToolDispatcher,
    app: &tauri::AppHandle,
    event_name: &str,
    payload: S,
    timeout_s: u64,
) -> Result<String, String> {
    use tauri::Emitter;

    let request_id = uuid::Uuid::new_v4().to_string();
    let rx = dispatcher.register(request_id.clone()).await;

    let envelope = serde_json::json!({
        "request_id": request_id,
        "payload": payload,
    });
    app.emit(event_name, envelope)
        .map_err(|e| format!("emit {}: {}", event_name, e))?;

    match tokio::time::timeout(Duration::from_secs(timeout_s), rx).await {
        Ok(Ok(reply)) if reply.ok => Ok(reply.message),
        Ok(Ok(reply)) => Err(reply.message),
        Ok(Err(_)) => {
            dispatcher.drop_pending(&request_id).await;
            Err(format!("{} dispatcher cancelled before frontend replied", event_name))
        }
        Err(_) => {
            dispatcher.drop_pending(&request_id).await;
            Err(format!("{} timed out waiting for frontend after {}s", event_name, timeout_s))
        }
    }
}

#[tauri::command]
pub async fn tool_result(
    request_id: String,
    ok: bool,
    message: String,
    dispatcher: tauri::State<'_, ToolDispatcher>,
) -> Result<(), String> {
    eprintln!("[tool_result] id={} ok={} message={}", request_id, ok, message.chars().take(160).collect::<String>());
    let delivered = dispatcher.complete(&request_id, ToolReply { ok, message }).await;
    if !delivered {
        eprintln!("[tool_result] unknown request_id {} — already completed or dropped", request_id);
    }
    Ok(())
}
