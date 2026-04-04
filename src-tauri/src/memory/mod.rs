pub mod db;
pub mod embedder;
pub mod indexer;
pub mod retriever;
pub mod memorizer;
pub mod experience;
pub mod sleeper;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;

pub use db::MemoryDb;
pub use embedder::{EmbeddingProvider, FastEmbedProvider};

#[derive(Debug)]
pub enum MemoryError {
    Db(String),
    Embedding(String),
    Io(std::io::Error),
    NotInitialized,
}

impl std::fmt::Display for MemoryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MemoryError::Db(msg) => write!(f, "Memory DB error: {}", msg),
            MemoryError::Embedding(msg) => write!(f, "Embedding error: {}", msg),
            MemoryError::Io(err) => write!(f, "IO error: {}", err),
            MemoryError::NotInitialized => write!(f, "Memory not initialized"),
        }
    }
}

impl From<std::io::Error> for MemoryError {
    fn from(err: std::io::Error) -> Self {
        MemoryError::Io(err)
    }
}

impl From<rusqlite::Error> for MemoryError {
    fn from(err: rusqlite::Error) -> Self {
        MemoryError::Db(err.to_string())
    }
}

pub struct MemoryState {
    pub db: Arc<MemoryDb>,
    pub embedder: Arc<dyn EmbeddingProvider>,
    sigil_root: RwLock<Option<PathBuf>>,
}

impl MemoryState {
    /// Initialize memory for a sigil root. Opens DB and ensures index exists.
    pub async fn open(sigil_root: &Path, embedder: Arc<dyn EmbeddingProvider>) -> Result<Self, MemoryError> {
        let sigil_dir = sigil_root.join(".sigil");
        std::fs::create_dir_all(&sigil_dir)?;
        let db = MemoryDb::open(&sigil_dir.join("memory.db"))?;
        let db = Arc::new(db);

        let state = MemoryState {
            db,
            embedder,
            sigil_root: RwLock::new(Some(sigil_root.to_path_buf())),
        };

        Ok(state)
    }

    pub async fn sigil_root(&self) -> Option<PathBuf> {
        self.sigil_root.read().await.clone()
    }

    pub async fn set_sigil_root(&self, root: PathBuf) {
        *self.sigil_root.write().await = Some(root);
    }
}

/// Data passed after a completed assistant turn.
pub struct CompletedTurn {
    pub root_path: String,
    pub chat_id: String,
    pub user_message: String,
    pub assistant_message: String,
    pub current_path: Vec<String>,
}
