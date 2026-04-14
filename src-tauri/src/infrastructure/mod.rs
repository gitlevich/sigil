pub mod db;
pub mod embedder;

pub use db::MemoryDb;
pub use embedder::{EmbeddingProvider, FastEmbedProvider};

#[derive(Debug)]
pub enum InfraError {
    Db(String),
    Embedding(String),
    Io(std::io::Error),
}

impl std::fmt::Display for InfraError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            InfraError::Db(msg) => write!(f, "DB error: {}", msg),
            InfraError::Embedding(msg) => write!(f, "Embedding error: {}", msg),
            InfraError::Io(err) => write!(f, "IO error: {}", err),
        }
    }
}

impl From<std::io::Error> for InfraError {
    fn from(err: std::io::Error) -> Self {
        InfraError::Io(err)
    }
}

impl From<rusqlite::Error> for InfraError {
    fn from(err: rusqlite::Error) -> Self {
        InfraError::Db(err.to_string())
    }
}
