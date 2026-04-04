use std::path::Path;
use std::sync::Mutex;
use rusqlite::{params, Connection};
use super::MemoryError;
use super::embedder::cosine_similarity;

pub struct MemoryDb {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone)]
pub struct Chunk {
    pub id: i64,
    pub file_path: String,
    pub chunk_index: usize,
    pub text: String,
    pub embedding: Vec<f32>,
    pub file_hash: String,
    pub indexed_at: i64,
}

#[derive(Debug, Clone)]
pub struct ScoredChunk {
    pub chunk: Chunk,
    pub score: f32,
}

impl MemoryDb {
    pub fn open(db_path: &Path) -> Result<Self, MemoryError> {
        let conn = Connection::open(db_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;
        let db = MemoryDb { conn: Mutex::new(conn) };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<(), MemoryError> {
        let conn = self.conn.lock().map_err(|e| MemoryError::Db(e.to_string()))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS chunks (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path   TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                text        TEXT NOT NULL,
                embedding   BLOB NOT NULL,
                file_hash   TEXT NOT NULL,
                indexed_at  INTEGER NOT NULL,
                UNIQUE(file_path, chunk_index)
            );
            CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_path);

            CREATE TABLE IF NOT EXISTS memory_meta (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )?;

        // Set schema version if not present
        conn.execute(
            "INSERT OR IGNORE INTO memory_meta (key, value) VALUES ('schema_version', '1')",
            [],
        )?;

        Ok(())
    }

    /// Upsert a chunk. Replaces existing entry for the same (file_path, chunk_index).
    pub fn upsert_chunk(&self, file_path: &str, chunk_index: usize, text: &str, embedding: &[f32], file_hash: &str) -> Result<(), MemoryError> {
        let conn = self.conn.lock().map_err(|e| MemoryError::Db(e.to_string()))?;
        let embedding_bytes = embedding_to_bytes(embedding);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        conn.execute(
            "INSERT INTO chunks (file_path, chunk_index, text, embedding, file_hash, indexed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(file_path, chunk_index)
             DO UPDATE SET text = ?3, embedding = ?4, file_hash = ?5, indexed_at = ?6",
            params![file_path, chunk_index as i64, text, embedding_bytes, file_hash, now],
        )?;
        Ok(())
    }

    /// Delete all chunks for a file path.
    pub fn delete_chunks_for_file(&self, file_path: &str) -> Result<(), MemoryError> {
        let conn = self.conn.lock().map_err(|e| MemoryError::Db(e.to_string()))?;
        conn.execute("DELETE FROM chunks WHERE file_path = ?1", params![file_path])?;
        Ok(())
    }

    /// Get the file hash for a path, if indexed.
    pub fn get_file_hash(&self, file_path: &str) -> Result<Option<String>, MemoryError> {
        let conn = self.conn.lock().map_err(|e| MemoryError::Db(e.to_string()))?;
        let mut stmt = conn.prepare("SELECT file_hash FROM chunks WHERE file_path = ?1 LIMIT 1")?;
        let hash = stmt.query_row(params![file_path], |row| row.get::<_, String>(0)).ok();
        Ok(hash)
    }

    /// Find nearest neighbors by cosine similarity. Full scan — fast at sigil scale.
    pub fn nearest_neighbors(&self, query_vec: &[f32], top_k: usize) -> Result<Vec<ScoredChunk>, MemoryError> {
        let conn = self.conn.lock().map_err(|e| MemoryError::Db(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT id, file_path, chunk_index, text, embedding, file_hash, indexed_at FROM chunks"
        )?;

        let mut scored: Vec<ScoredChunk> = stmt.query_map([], |row| {
            let embedding_bytes: Vec<u8> = row.get(4)?;
            let embedding = bytes_to_embedding(&embedding_bytes);
            let score = cosine_similarity(query_vec, &embedding);
            Ok(ScoredChunk {
                chunk: Chunk {
                    id: row.get(0)?,
                    file_path: row.get(1)?,
                    chunk_index: row.get::<_, i64>(2)? as usize,
                    text: row.get(3)?,
                    embedding,
                    file_hash: row.get(5)?,
                    indexed_at: row.get(6)?,
                },
                score,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

        scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(top_k);
        Ok(scored)
    }

    /// Count total chunks in the index.
    pub fn chunk_count(&self) -> Result<usize, MemoryError> {
        let conn = self.conn.lock().map_err(|e| MemoryError::Db(e.to_string()))?;
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get(0))?;
        Ok(count as usize)
    }

    /// Get a metadata value.
    pub fn get_meta(&self, key: &str) -> Result<Option<String>, MemoryError> {
        let conn = self.conn.lock().map_err(|e| MemoryError::Db(e.to_string()))?;
        let val = conn.query_row(
            "SELECT value FROM memory_meta WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        ).ok();
        Ok(val)
    }

    /// Set a metadata value.
    pub fn set_meta(&self, key: &str, value: &str) -> Result<(), MemoryError> {
        let conn = self.conn.lock().map_err(|e| MemoryError::Db(e.to_string()))?;
        conn.execute(
            "INSERT INTO memory_meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = ?2",
            params![key, value],
        )?;
        Ok(())
    }

    /// Get all indexed file paths.
    pub fn indexed_files(&self) -> Result<Vec<String>, MemoryError> {
        let conn = self.conn.lock().map_err(|e| MemoryError::Db(e.to_string()))?;
        let mut stmt = conn.prepare("SELECT DISTINCT file_path FROM chunks")?;
        let paths: Vec<String> = stmt.query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(paths)
    }
}

fn embedding_to_bytes(embedding: &[f32]) -> Vec<u8> {
    embedding.iter().flat_map(|f| f.to_le_bytes()).collect()
}

fn bytes_to_embedding(bytes: &[u8]) -> Vec<f32> {
    bytes.chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn test_db() -> (TempDir, MemoryDb) {
        let tmp = TempDir::new().unwrap();
        let db = MemoryDb::open(&tmp.path().join("test.db")).unwrap();
        (tmp, db)
    }

    #[test]
    fn test_upsert_and_query() {
        let (_tmp, db) = test_db();
        let embedding = vec![1.0_f32; 384];
        db.upsert_chunk("/test/language.md", 0, "hello world", &embedding, "abc123").unwrap();

        let count = db.chunk_count().unwrap();
        assert_eq!(count, 1);

        let hash = db.get_file_hash("/test/language.md").unwrap();
        assert_eq!(hash, Some("abc123".to_string()));
    }

    #[test]
    fn test_nearest_neighbors() {
        let (_tmp, db) = test_db();
        let e1 = vec![1.0_f32, 0.0, 0.0];
        let e2 = vec![0.0_f32, 1.0, 0.0];
        let e3 = vec![0.9_f32, 0.1, 0.0];

        db.upsert_chunk("a.md", 0, "text a", &e1, "h1").unwrap();
        db.upsert_chunk("b.md", 0, "text b", &e2, "h2").unwrap();
        db.upsert_chunk("c.md", 0, "text c", &e3, "h3").unwrap();

        let query = vec![1.0_f32, 0.0, 0.0];
        let results = db.nearest_neighbors(&query, 2).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].chunk.file_path, "a.md");
        assert_eq!(results[1].chunk.file_path, "c.md");
    }

    #[test]
    fn test_delete_chunks_for_file() {
        let (_tmp, db) = test_db();
        let e = vec![1.0_f32; 10];
        db.upsert_chunk("a.md", 0, "chunk 0", &e, "h1").unwrap();
        db.upsert_chunk("a.md", 1, "chunk 1", &e, "h1").unwrap();
        db.upsert_chunk("b.md", 0, "other", &e, "h2").unwrap();

        db.delete_chunks_for_file("a.md").unwrap();
        assert_eq!(db.chunk_count().unwrap(), 1);
    }

    #[test]
    fn test_upsert_replaces_existing() {
        let (_tmp, db) = test_db();
        let e1 = vec![1.0_f32; 10];
        let e2 = vec![2.0_f32; 10];
        db.upsert_chunk("a.md", 0, "old text", &e1, "h1").unwrap();
        db.upsert_chunk("a.md", 0, "new text", &e2, "h2").unwrap();

        assert_eq!(db.chunk_count().unwrap(), 1);
        let hash = db.get_file_hash("a.md").unwrap();
        assert_eq!(hash, Some("h2".to_string()));
    }

    #[test]
    fn test_meta() {
        let (_tmp, db) = test_db();
        assert_eq!(db.get_meta("last_sleep").unwrap(), None);
        db.set_meta("last_sleep", "12345").unwrap();
        assert_eq!(db.get_meta("last_sleep").unwrap(), Some("12345".to_string()));
    }

    #[test]
    fn test_embedding_roundtrip() {
        let original = vec![1.5_f32, -2.3, 0.0, 42.0];
        let bytes = embedding_to_bytes(&original);
        let restored = bytes_to_embedding(&bytes);
        assert_eq!(original, restored);
    }
}
