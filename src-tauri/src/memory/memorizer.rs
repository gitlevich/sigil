use std::fs;
use std::path::Path;
use uuid::Uuid;

use crate::models::settings::{AiProfile, AiProvider};
use super::{CompletedTurn, MemoryError, MemoryState};
use super::indexer;

/// Find DesignPartner/Memory directory by walking the sigil tree.
/// Falls back to `.sigil/memory/` if not found.
fn find_design_partner_memory(root_path: &str) -> Option<std::path::PathBuf> {
    let root = Path::new(root_path);
    for entry in walkdir::WalkDir::new(root).max_depth(6).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_dir() && entry.file_name() == "Memory" {
            let parent = entry.path().parent()?;
            if parent.file_name()?.to_string_lossy() == "DesignPartner" {
                return Some(entry.path().to_path_buf());
            }
        }
    }
    None
}

const EXTRACTION_PROMPT: &str = r#"You are extracting atomic facts from a conversation turn for long-term memory storage. Extract 0-5 facts that are worth remembering across sessions.

Rules:
- Each fact must be a single, self-contained statement
- Only extract facts that would be useful in future conversations
- Skip transient details (what tool was used, formatting requests, etc.)
- Include: design decisions, user preferences, domain knowledge, structural insights
- Include: things the user taught you, corrections, clarifications
- If no facts are worth extracting, return "NONE"

Format: one fact per line, prefixed with "- "

Conversation turn:
"#;

/// Extract facts from a completed turn and write them as memory sigils.
pub async fn memorize_turn(
    state: &MemoryState,
    turn: &CompletedTurn,
    profile: &AiProfile,
) -> Result<usize, MemoryError> {
    let memory_dir = find_design_partner_memory(&turn.root_path)
        .unwrap_or_else(|| Path::new(&turn.root_path).join(".sigil").join("memory"));

    if !memory_dir.exists() {
        fs::create_dir_all(&memory_dir).map_err(MemoryError::Io)?;
    }

    let turn_text = format!("User: {}\n\nAssistant: {}", turn.user_message, turn.assistant_message);
    let facts = extract_facts(&turn_text, profile).await?;

    if facts.is_empty() {
        return Ok(0);
    }

    let mut written = 0;
    for fact in &facts {
        // Check for near-duplicates before writing
        if is_near_duplicate(fact, state)? {
            continue;
        }

        let id = Uuid::new_v4().to_string();
        let short_id = &id[..8];
        let file_name = format!("fact-{}.md", short_id);
        let file_path = memory_dir.join(&file_name);
        fs::write(&file_path, fact).map_err(MemoryError::Io)?;

        // Index the new fact immediately
        let path_str = file_path.to_string_lossy().to_string();
        indexer::reindex_file(&path_str, &state.db, state.embedder.as_ref())?;
        written += 1;
    }

    Ok(written)
}

/// Check if a fact is too similar to an existing memory (noise floor).
fn is_near_duplicate(fact: &str, state: &MemoryState) -> Result<bool, MemoryError> {
    let embeddings = state.embedder.embed(&[fact])?;
    let embedding = embeddings.into_iter().next()
        .ok_or_else(|| MemoryError::Embedding("No embedding returned".to_string()))?;

    let neighbors = state.db.nearest_neighbors(&embedding, 1)?;
    if let Some(closest) = neighbors.first() {
        // Threshold: 0.95 cosine similarity = near-duplicate
        Ok(closest.score > 0.95)
    } else {
        Ok(false)
    }
}

/// Call the LLM to extract facts from a conversation turn.
async fn extract_facts(turn_text: &str, profile: &AiProfile) -> Result<Vec<String>, MemoryError> {
    let prompt = format!("{}{}", EXTRACTION_PROMPT, turn_text);

    let response = call_llm(&prompt, profile).await?;

    if response.trim() == "NONE" || response.trim().is_empty() {
        return Ok(Vec::new());
    }

    let facts: Vec<String> = response.lines()
        .map(|line| line.trim())
        .filter(|line| line.starts_with("- "))
        .map(|line| line[2..].trim().to_string())
        .filter(|f| !f.is_empty() && f.len() > 10) // Skip trivially short facts
        .collect();

    Ok(facts)
}

/// Make a lightweight LLM call for fact extraction.
async fn call_llm(prompt: &str, profile: &AiProfile) -> Result<String, MemoryError> {
    let client = reqwest::Client::new();

    match profile.provider {
        AiProvider::Anthropic => {
            let body = serde_json::json!({
                "model": profile.model,
                "max_tokens": 1024,
                "messages": [{"role": "user", "content": prompt}],
            });

            let response = client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", &profile.api_key)
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| MemoryError::Embedding(format!("Network error: {}", e)))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(MemoryError::Embedding(format!("API error {}: {}", status, body)));
            }

            let resp: serde_json::Value = response.json().await
                .map_err(|e| MemoryError::Embedding(e.to_string()))?;

            let text = resp["content"][0]["text"].as_str().unwrap_or("").to_string();
            Ok(text)
        }
        AiProvider::OpenAI => {
            let body = serde_json::json!({
                "model": profile.model,
                "max_completion_tokens": 1024,
                "messages": [{"role": "user", "content": prompt}],
            });

            let response = client
                .post("https://api.openai.com/v1/chat/completions")
                .header("Authorization", format!("Bearer {}", profile.api_key))
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| MemoryError::Embedding(format!("Network error: {}", e)))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(MemoryError::Embedding(format!("API error {}: {}", status, body)));
            }

            let resp: serde_json::Value = response.json().await
                .map_err(|e| MemoryError::Embedding(e.to_string()))?;

            let text = resp["choices"][0]["message"]["content"].as_str().unwrap_or("").to_string();
            Ok(text)
        }
    }
}
