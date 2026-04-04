use super::MemoryError;

/// Trait for embedding text into vectors.
/// Implementations must be thread-safe for shared use across async tasks.
pub trait EmbeddingProvider: Send + Sync {
    fn embed(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>, MemoryError>;
    fn dimensions(&self) -> usize;
}

/// Local ONNX-based embeddings via fastembed.
/// Model: AllMiniLmL6V2 (384 dimensions, ~23MB).
pub struct FastEmbedProvider {
    model: fastembed::TextEmbedding,
}

impl FastEmbedProvider {
    pub fn load() -> Result<Self, MemoryError> {
        let model = fastembed::TextEmbedding::try_new(
            fastembed::InitOptions::new(fastembed::EmbeddingModel::AllMiniLML6V2)
                .with_show_download_progress(true),
        )
        .map_err(|e| MemoryError::Embedding(e.to_string()))?;

        Ok(FastEmbedProvider { model })
    }
}

impl EmbeddingProvider for FastEmbedProvider {
    fn embed(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>, MemoryError> {
        let docs: Vec<String> = texts.iter().map(|t| t.to_string()).collect();
        let embeddings = self.model.embed(docs, None)
            .map_err(|e| MemoryError::Embedding(e.to_string()))?;
        Ok(embeddings)
    }

    fn dimensions(&self) -> usize {
        384
    }
}

/// Cosine similarity between two vectors.
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot / (norm_a * norm_b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cosine_similarity_identical() {
        let v = vec![1.0, 2.0, 3.0];
        let sim = cosine_similarity(&v, &v);
        assert!((sim - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_cosine_similarity_orthogonal() {
        let a = vec![1.0, 0.0];
        let b = vec![0.0, 1.0];
        let sim = cosine_similarity(&a, &b);
        assert!(sim.abs() < 1e-6);
    }

    #[test]
    fn test_cosine_similarity_zero_vector() {
        let a = vec![1.0, 2.0];
        let b = vec![0.0, 0.0];
        assert_eq!(cosine_similarity(&a, &b), 0.0);
    }
}
