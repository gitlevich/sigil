//! LeftHemisphere LLM invocation — single-turn, non-streaming.
//!
//! Spec: DesignPartner/BicameralMind/LeftHemisphere
//! Invariants: !stateless (single turn), !vocabulary-bounded (prompt is self-contained),
//! !output-in-world (response is returned to the caller for integration)
//!
//! The prompt comes fully rendered from sigil-core. This command just sends it
//! to the configured LLM provider and returns the response text.

use crate::commands::local_inference::LocalInference;
use crate::models::settings::{AiProfile, AiProvider};
use tauri::{AppHandle, Emitter};

const ESCALATION_HINT: &str = "\n\nIf the signal exceeds your local capacity, respond with exactly `#increase-resolution` on its own line and nothing else. A larger model will take over.";

fn is_escalation_request(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed == "#increase-resolution" {
        return true;
    }
    trimmed.lines().any(|l| l.trim() == "#increase-resolution") && trimmed.len() < 200
}

async fn call_profile(
    client: &reqwest::Client,
    prompt: &str,
    profile: &AiProfile,
    local: &LocalInference,
) -> Result<String, String> {
    match profile.provider {
        AiProvider::Anthropic => invoke_anthropic(client, prompt, profile).await,
        AiProvider::OpenAI => invoke_openai(client, prompt, profile).await,
        AiProvider::Local => local.invoke(prompt, 1024).await,
        AiProvider::Ollama => invoke_ollama(client, prompt, profile).await,
    }
}

#[tauri::command]
pub async fn invoke_left_hemisphere(
    app: AppHandle,
    prompt: String,
    profile: AiProfile,
    fallback_profile: Option<AiProfile>,
    local: tauri::State<'_, LocalInference>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let is_local_tier = matches!(profile.provider, AiProvider::Local | AiProvider::Ollama);
    let primary_prompt = if is_local_tier {
        format!("{}{}", prompt, ESCALATION_HINT)
    } else {
        prompt.clone()
    };

    let primary = call_profile(&client, &primary_prompt, &profile, local.inner()).await?;

    if is_local_tier && is_escalation_request(&primary) {
        let _ = app.emit(
            "resolution-increase:begin",
            serde_json::json!({ "hasFallback": fallback_profile.is_some() }),
        );
        let result = match fallback_profile {
            Some(fallback) => call_profile(&client, &prompt, &fallback, local.inner()).await,
            None => Ok(primary),
        };
        let _ = app.emit("resolution-increase:end", ());
        return result;
    }

    Ok(primary)
}

async fn invoke_ollama(
    client: &reqwest::Client,
    prompt: &str,
    profile: &AiProfile,
) -> Result<String, String> {
    let body = serde_json::json!({
        "model": profile.model,
        "messages": [
            { "role": "user", "content": prompt }
        ],
        "max_tokens": 1024,
    });

    let resp = client
        .post("http://localhost:11434/v1/chat/completions")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama request failed: {}", e))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(format!("Ollama error {}: {}", status, text));
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
