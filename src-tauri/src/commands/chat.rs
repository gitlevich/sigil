use std::fs;
use std::path::Path;
use futures_util::StreamExt;
use tauri::{AppHandle, Emitter};
use crate::models::chat::{ChatMessage, ChatRole};
use crate::models::settings::{AiProvider, Settings};
use crate::commands::sigil::read_sigil;

fn assemble_sigil_context(root_path: &str) -> Result<String, String> {
    let sigil = read_sigil(root_path.to_string())?;
    let mut output = String::new();

    output.push_str("# Vision\n\n");
    output.push_str(&sigil.vision);
    output.push_str("\n\n");

    fn render_context(ctx: &crate::models::sigil::Context, depth: usize, output: &mut String) {
        let prefix = "#".repeat(depth + 1);
        output.push_str(&format!("{} {}\n\n", prefix, ctx.name));

        output.push_str(&format!("{}# Domain Language\n\n", "#".repeat(depth + 2)));
        output.push_str(&ctx.domain_language);
        output.push_str("\n\n");

        if let Some(ref tech) = ctx.technical_decisions {
            output.push_str(&format!("{} Technical Decisions\n\n", "#".repeat(depth + 2)));
            output.push_str(tech);
            output.push_str("\n\n");
        }

        for child in &ctx.children {
            render_context(child, depth + 1, output);
        }
    }

    render_context(&sigil.root, 0, &mut output);
    Ok(output)
}

#[tauri::command]
pub fn read_chat(root_path: String) -> Result<Vec<ChatMessage>, String> {
    let chat_path = Path::new(&root_path).join("chat.json");
    if !chat_path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&chat_path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_chat(root_path: String, messages: Vec<ChatMessage>) -> Result<(), String> {
    let chat_path = Path::new(&root_path).join("chat.json");
    let content = serde_json::to_string_pretty(&messages).map_err(|e| e.to_string())?;
    fs::write(&chat_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_chat_message(
    app: AppHandle,
    root_path: String,
    message: String,
    settings: Settings,
) -> Result<(), String> {
    let spec_context = assemble_sigil_context(&root_path)?;
    let mut history = read_chat(root_path.clone())?;

    history.push(ChatMessage {
        role: ChatRole::User,
        content: message,
    });

    match settings.provider {
        AiProvider::Anthropic => {
            stream_anthropic(&app, &spec_context, &history, &settings).await?;
        }
        AiProvider::OpenAI => {
            stream_openai(&app, &spec_context, &history, &settings).await?;
        }
    }

    Ok(())
}

async fn stream_anthropic(
    app: &AppHandle,
    spec_context: &str,
    history: &[ChatMessage],
    settings: &Settings,
) -> Result<(), String> {
    let client = reqwest::Client::new();

    let messages: Vec<serde_json::Value> = history
        .iter()
        .map(|m| {
            serde_json::json!({
                "role": match m.role { ChatRole::User => "user", ChatRole::Assistant => "assistant" },
                "content": m.content,
            })
        })
        .collect();

    let body = serde_json::json!({
        "model": settings.model,
        "max_tokens": 4096,
        "system": format!("{}\n\n---\n\nHere is the full sigil:\n\n{}", settings.system_prompt, spec_context),
        "messages": messages,
        "stream": true,
    });

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &settings.api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let error_body = response.text().await.unwrap_or_default();
        return Err(format!("Anthropic API error {}: {}", status, error_body));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].to_string();
            buffer = buffer[line_end + 1..].to_string();

            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" {
                    let _ = app.emit("chat-stream-end", ());
                    return Ok(());
                }
                if let Ok(event) = serde_json::from_str::<serde_json::Value>(data) {
                    if event["type"] == "content_block_delta" {
                        if let Some(text) = event["delta"]["text"].as_str() {
                            let _ = app.emit("chat-token", text.to_string());
                        }
                    }
                    if event["type"] == "message_stop" {
                        let _ = app.emit("chat-stream-end", ());
                        return Ok(());
                    }
                }
            }
        }
    }

    let _ = app.emit("chat-stream-end", ());
    Ok(())
}

async fn stream_openai(
    app: &AppHandle,
    spec_context: &str,
    history: &[ChatMessage],
    settings: &Settings,
) -> Result<(), String> {
    let client = reqwest::Client::new();

    let mut messages: Vec<serde_json::Value> = vec![serde_json::json!({
        "role": "system",
        "content": format!("{}\n\n---\n\nHere is the full sigil:\n\n{}", settings.system_prompt, spec_context),
    })];

    for m in history {
        messages.push(serde_json::json!({
            "role": match m.role { ChatRole::User => "user", ChatRole::Assistant => "assistant" },
            "content": m.content,
        }));
    }

    let body = serde_json::json!({
        "model": settings.model,
        "messages": messages,
        "stream": true,
    });

    let response = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", settings.api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let error_body = response.text().await.unwrap_or_default();
        return Err(format!("OpenAI API error {}: {}", status, error_body));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].to_string();
            buffer = buffer[line_end + 1..].to_string();

            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" {
                    let _ = app.emit("chat-stream-end", ());
                    return Ok(());
                }
                if let Ok(event) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(text) = event["choices"][0]["delta"]["content"].as_str() {
                        let _ = app.emit("chat-token", text.to_string());
                    }
                }
            }
        }
    }

    let _ = app.emit("chat-stream-end", ());
    Ok(())
}
