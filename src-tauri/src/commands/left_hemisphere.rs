//! LeftHemisphere LLM invocation — single-turn, non-streaming.
//!
//! Spec: DesignPartner/BicameralMind/LeftHemisphere
//! Invariants: !stateless (single turn), !vocabulary-bounded (prompt is self-contained),
//! !output-in-world (response is returned to the caller for integration)
//!
//! The prompt comes fully rendered from sigil-core. This command just sends it
//! to the configured LLM provider and returns the response text.

use crate::models::settings::{AiProfile, AiProvider};

#[tauri::command]
pub async fn invoke_left_hemisphere(
    prompt: String,
    profile: AiProfile,
) -> Result<String, String> {
    let client = reqwest::Client::new();

    match profile.provider {
        AiProvider::Anthropic => invoke_anthropic(&client, &prompt, &profile).await,
        AiProvider::OpenAI => invoke_openai(&client, &prompt, &profile).await,
    }
}

async fn invoke_anthropic(
    client: &reqwest::Client,
    prompt: &str,
    profile: &AiProfile,
) -> Result<String, String> {
    let body = serde_json::json!({
        "model": profile.model,
        "max_tokens": 1024,
        "messages": [
            { "role": "user", "content": prompt }
        ]
    });

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &profile.api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Anthropic request failed: {}", e))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(format!("Anthropic error {}: {}", status, text));
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("JSON parse error: {}", e))?;

    // Extract text from the first content block
    let content = parsed["content"]
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|block| block["text"].as_str())
        .unwrap_or("")
        .to_string();

    Ok(content)
}

async fn invoke_openai(
    client: &reqwest::Client,
    prompt: &str,
    profile: &AiProfile,
) -> Result<String, String> {
    let body = serde_json::json!({
        "model": profile.model,
        "max_tokens": 1024,
        "messages": [
            { "role": "user", "content": prompt }
        ]
    });

    let resp = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", profile.api_key))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenAI request failed: {}", e))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(format!("OpenAI error {}: {}", status, text));
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("JSON parse error: {}", e))?;

    let content = parsed["choices"]
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|choice| choice["message"]["content"].as_str())
        .unwrap_or("")
        .to_string();

    Ok(content)
}
