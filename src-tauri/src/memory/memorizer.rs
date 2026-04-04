use std::fs;
use std::path::Path;

use crate::models::settings::{AiProfile, AiProvider};
use super::{CompletedTurn, MemoryError, MemoryState};
use super::indexer;

/// Known sub-sigils that are NOT concept sigils (skip during scans).
const STRUCTURAL_DIRS: &[&str] = &[
    "ContrastIndex", "Entanglement", "Experience", "Sleep",
];

/// Find DesignPartner/Memory directory by walking the sigil tree.
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

/// List existing concept sigil names under Memory/.
fn list_existing_concepts(memory_dir: &Path) -> Vec<String> {
    let mut names = Vec::new();
    if let Ok(entries) = fs::read_dir(memory_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_dir() {
                let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                if !STRUCTURAL_DIRS.contains(&name.as_str()) && path.join("language.md").exists() {
                    names.push(name);
                }
            }
        }
    }
    names
}

const EXTRACTION_PROMPT: &str = r#"You are extracting knowledge from a conversation turn into concept sigils for long-term memory.

Identify 0-5 concepts worth remembering (people, places, decisions, components, preferences, domain knowledge). For each concept, provide:
- name: PascalCase identifier (e.g. "Vlad", "SanFrancisco", "AtlasComponent")
- language: What you know about this concept, written as a short paragraph. Use @References to connect to other concepts (e.g. "@Vlad prefers concise responses").

Rules:
- Only extract concepts that would be useful in future conversations
- Skip transient details (tool use, formatting, navigation)
- Include: design decisions, user preferences, domain knowledge, structural insights, corrections
- Use @PascalCase references to link concepts together
- If nothing is worth extracting, return "NONE"

Respond with ONLY a JSON array (no markdown fencing), or the word "NONE":
[{"name": "ConceptName", "language": "What I know, with @References to other concepts."}]

EXISTING CONCEPTS (refine these rather than creating duplicates):
"#;

const REFINEMENT_PROMPT: &str = r#"You are refining a concept sigil's knowledge by merging existing knowledge with new information from a conversation.

EXISTING KNOWLEDGE:
---
{existing}
---

NEW INFORMATION:
---
{new_info}
---

Write an updated language.md paragraph that merges both. Keep it concise. Preserve all @References from both sources, add new ones where connections exist. Do not lose existing knowledge — only add, clarify, or correct.

Respond with ONLY the updated paragraph text (no markdown fencing, no preamble).
"#;

#[derive(Debug, serde::Deserialize)]
struct ExtractedConcept {
    name: String,
    language: String,
}

/// Extract concepts from a completed turn and write them as concept sigils.
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

    let existing = list_existing_concepts(&memory_dir);
    let turn_text = format!("User: {}\n\nAssistant: {}", turn.user_message, turn.assistant_message);
    let concepts = extract_concepts(&turn_text, &existing, profile).await?;

    if concepts.is_empty() {
        return Ok(0);
    }

    let mut written = 0;
    for concept in &concepts {
        let concept_dir = memory_dir.join(&concept.name);
        let language_path = concept_dir.join("language.md");

        if language_path.exists() {
            // Refine existing concept
            let existing_language = fs::read_to_string(&language_path).unwrap_or_default();
            let refined = refine_concept(&existing_language, &concept.language, profile).await?;
            fs::write(&language_path, &refined).map_err(MemoryError::Io)?;
        } else {
            // Check for near-duplicate before creating
            if is_near_duplicate(&concept.language, state)? {
                continue;
            }
            // Crystallize new concept
            fs::create_dir_all(&concept_dir).map_err(MemoryError::Io)?;
            fs::write(&language_path, &concept.language).map_err(MemoryError::Io)?;
        }

        // Index immediately
        let path_str = language_path.to_string_lossy().to_string();
        indexer::reindex_file(&path_str, &state.db, state.embedder.as_ref())?;
        written += 1;
    }

    Ok(written)
}

/// Check if a concept's language is too similar to an existing memory.
fn is_near_duplicate(language: &str, state: &MemoryState) -> Result<bool, MemoryError> {
    let embeddings = state.embedder.embed(&[language])?;
    let embedding = embeddings.into_iter().next()
        .ok_or_else(|| MemoryError::Embedding("No embedding returned".to_string()))?;

    let neighbors = state.db.nearest_neighbors(&embedding, 1)?;
    if let Some(closest) = neighbors.first() {
        Ok(closest.score > 0.95)
    } else {
        Ok(false)
    }
}

/// Call the LLM to extract concepts from a conversation turn.
async fn extract_concepts(
    turn_text: &str,
    existing: &[String],
    profile: &AiProfile,
) -> Result<Vec<ExtractedConcept>, MemoryError> {
    let existing_list = if existing.is_empty() {
        "(none yet)".to_string()
    } else {
        existing.join(", ")
    };

    let prompt = format!("{}{}\n\nConversation turn:\n{}", EXTRACTION_PROMPT, existing_list, turn_text);
    let response = call_llm(&prompt, profile).await?;

    let trimmed = response.trim();
    if trimmed == "NONE" || trimmed.is_empty() {
        return Ok(Vec::new());
    }

    // Strip markdown fencing if present
    let json_str = trimmed
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    match serde_json::from_str::<Vec<ExtractedConcept>>(json_str) {
        Ok(concepts) => Ok(concepts.into_iter()
            .filter(|c| !c.name.is_empty() && !c.language.is_empty())
            .collect()),
        Err(e) => {
            eprintln!("[memory:memorizer] Failed to parse concept JSON: {} — response: {}", e, trimmed);
            Ok(Vec::new())
        }
    }
}

/// Call the LLM to refine an existing concept with new information.
async fn refine_concept(
    existing: &str,
    new_info: &str,
    profile: &AiProfile,
) -> Result<String, MemoryError> {
    let prompt = REFINEMENT_PROMPT
        .replace("{existing}", existing)
        .replace("{new_info}", new_info);

    let response = call_llm(&prompt, profile).await?;
    Ok(response.trim().to_string())
}

/// Make a lightweight LLM call.
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
