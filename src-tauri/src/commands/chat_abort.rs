//! Chat cancellation — lets the frontend interrupt an in-flight inference.
//!
//! Infrastructure. The @LeftHemisphere's inference (remote or local) runs as
//! one long HTTP request; cancelling from the frontend means aborting that
//! future. We hold a oneshot sender per active chat; the sender is
//! `begin`-ed when send_chat_message starts, stored in app state, and
//! triggered by `cancel_chat`. The stream driver races its work against
//! the receiver via tokio::select!; cancellation drops the HTTP future and
//! closes the connection.

use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};

/// App-lifetime state: at most one pending abort handle.
#[derive(Default, Clone)]
pub struct ChatAbort {
    pending: Arc<Mutex<Option<oneshot::Sender<()>>>>,
}

impl ChatAbort {
    pub fn new() -> Self {
        Self::default()
    }

    /// Start a new cancellable chat. Any previous pending abort is cancelled —
    /// only one chat runs at a time. Returns the receiver to race against.
    pub async fn begin(&self) -> oneshot::Receiver<()> {
        let (tx, rx) = oneshot::channel();
        let mut guard = self.pending.lock().await;
        if let Some(old) = guard.take() {
            let _ = old.send(());
        }
        *guard = Some(tx);
        rx
    }

    /// Clear the pending handle without cancelling — call after the chat
    /// completes normally so a later cancel_chat doesn't fire on nothing.
    pub async fn finish(&self) {
        let mut guard = self.pending.lock().await;
        *guard = None;
    }

    /// Cancel the current chat, if any.
    pub async fn cancel(&self) {
        let mut guard = self.pending.lock().await;
        if let Some(tx) = guard.take() {
            let _ = tx.send(());
        }
    }
}

#[tauri::command]
pub async fn cancel_chat(abort: tauri::State<'_, ChatAbort>) -> Result<(), String> {
    abort.cancel().await;
    Ok(())
}
