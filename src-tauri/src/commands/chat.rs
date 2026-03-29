use std::fs;
use std::path::Path;
use futures_util::StreamExt;
use tauri::{AppHandle, Emitter};
use crate::models::chat::{Chat, ChatInfo, ChatMessage, ChatRole};
use crate::models::settings::{AiProfile, AiProvider, DEFAULT_SYSTEM_PROMPT};
use crate::commands::sigil::read_sigil;
use crate::commands::tools;

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

        for child in &ctx.children {
            render_context(child, depth + 1, output);
        }
    }

    render_context(&sigil.root, 0, &mut output);
    Ok(output)
}

fn chats_dir(root_path: &str) -> std::path::PathBuf {
    Path::new(root_path).join("chats")
}

fn chat_file(root_path: &str, chat_id: &str) -> std::path::PathBuf {
    chats_dir(root_path).join(format!("{}.json", chat_id))
}

/// Migrate legacy chat.json to chats/ directory if needed.
fn migrate_legacy_chat(root_path: &str) -> Result<(), String> {
    let legacy = Path::new(root_path).join("chat.json");
    if !legacy.exists() {
        return Ok(());
    }
    let dir = chats_dir(root_path);
    if !dir.exists() {
        fs::create_dir(&dir).map_err(|e| e.to_string())?;
    }
    let content = fs::read_to_string(&legacy).map_err(|e| e.to_string())?;
    let messages: Vec<ChatMessage> = serde_json::from_str(&content).unwrap_or_default();
    if !messages.is_empty() {
        let chat = Chat {
            id: "default".to_string(),
            name: "Chat 1".to_string(),
            messages,
        };
        let json = serde_json::to_string_pretty(&chat).map_err(|e| e.to_string())?;
        fs::write(chat_file(root_path, "default"), json).map_err(|e| e.to_string())?;
    }
    fs::remove_file(&legacy).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_chats(root_path: String) -> Result<Vec<ChatInfo>, String> {
    migrate_legacy_chat(&root_path)?;
    let dir = chats_dir(&root_path);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut chats = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let modified = path.metadata()
            .and_then(|m| m.modified())
            .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs())
            .unwrap_or(0);
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        if let Ok(chat) = serde_json::from_str::<Chat>(&content) {
            chats.push(ChatInfo {
                id: chat.id,
                name: chat.name,
                message_count: chat.messages.len(),
                last_modified: modified,
            });
        }
    }
    chats.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(chats)
}

#[tauri::command]
pub fn read_chat(root_path: String, chat_id: String) -> Result<Chat, String> {
    let path = chat_file(&root_path, &chat_id);
    if !path.exists() {
        return Ok(Chat {
            id: chat_id,
            name: "New Chat".to_string(),
            messages: Vec::new(),
        });
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_chat(root_path: String, chat: Chat) -> Result<(), String> {
    let dir = chats_dir(&root_path);
    if !dir.exists() {
        fs::create_dir(&dir).map_err(|e| e.to_string())?;
    }
    let path = chat_file(&root_path, &chat.id);
    let content = serde_json::to_string_pretty(&chat).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_chat(root_path: String, chat_id: String) -> Result<(), String> {
    let path = chat_file(&root_path, &chat_id);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn rename_chat(root_path: String, chat_id: String, new_name: String) -> Result<(), String> {
    let path = chat_file(&root_path, &chat_id);
    if !path.exists() {
        return Err("Chat not found".to_string());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut chat: Chat = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    chat.name = new_name;
    let json = serde_json::to_string_pretty(&chat).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_models(provider: String, api_key: String) -> Result<Vec<String>, String> {
    let client = reqwest::Client::new();

    match provider.as_str() {
        "anthropic" => {
            let response = client
                .get("https://api.anthropic.com/v1/models?limit=100")
                .header("x-api-key", &api_key)
                .header("anthropic-version", "2023-06-01")
                .send()
                .await
                .map_err(|e| format!("Network error: {}", e))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(format!("Anthropic API error {}: {}", status, body));
            }

            let body: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
            let models = body["data"]
                .as_array()
                .map(|arr| {
                    let mut ids: Vec<String> = arr
                        .iter()
                        .filter_map(|m| m["id"].as_str().map(String::from))
                        .collect();
                    ids.sort();
                    ids
                })
                .unwrap_or_default();
            Ok(models)
        }
        "openai" => {
            let response = client
                .get("https://api.openai.com/v1/models")
                .header("Authorization", format!("Bearer {}", api_key))
                .send()
                .await
                .map_err(|e| format!("Network error: {}", e))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(format!("OpenAI API error {}: {}", status, body));
            }

            let body: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
            let models = body["data"]
                .as_array()
                .map(|arr| {
                    let mut ids: Vec<String> = arr
                        .iter()
                        .filter_map(|m| m["id"].as_str().map(String::from))
                        // Filter to chat-capable models
                        .filter(|id| id.starts_with("gpt-") || id.starts_with("o1") || id.starts_with("o3") || id.starts_with("o4"))
                        .collect();
                    ids.sort();
                    ids
                })
                .unwrap_or_default();
            Ok(models)
        }
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

#[tauri::command]
pub async fn send_chat_message(
    app: AppHandle,
    root_path: String,
    chat_id: String,
    message: String,
    profile: AiProfile,
    system_prompt: String,
) -> Result<(), String> {
    let spec_context = assemble_sigil_context(&root_path)?;

    let system_prompt = if system_prompt.trim().is_empty() {
        DEFAULT_SYSTEM_PROMPT.to_string()
    } else {
        system_prompt
    };

    let chat = read_chat(root_path.clone(), chat_id)?;
    let mut history = chat.messages;
    history.push(ChatMessage {
        role: ChatRole::User,
        content: message,
    });

    let result = match profile.provider {
        AiProvider::Anthropic => {
            stream_anthropic(&app, &spec_context, &history, &profile, &system_prompt).await
        }
        AiProvider::OpenAI => {
            stream_openai(&app, &spec_context, &history, &profile, &system_prompt).await
        }
    };

    if let Err(ref err) = result {
        // Emit the error so the frontend can display it even if the
        // invoke promise rejection doesn't surface properly
        let _ = app.emit("chat-error", err.clone());
        let _ = app.emit("chat-stream-end", ());
    }

    result
}

async fn stream_anthropic(
    app: &AppHandle,
    sigil_context: &str,
    history: &[ChatMessage],
    profile: &AiProfile,
    system_prompt: &str,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let tool_defs = tools::tool_definitions();

    let mut messages: Vec<serde_json::Value> = history
        .iter()
        .map(|m| {
            serde_json::json!({
                "role": match m.role { ChatRole::User => "user", ChatRole::Assistant => "assistant" },
                "content": m.content,
            })
        })
        .collect();

    let system = format!("{}\n\n---\n\nHere is the full sigil:\n\n{}", system_prompt, sigil_context);

    // Tool use loop: keep calling until the model responds with text only (no tool_use)
    loop {
        let body = serde_json::json!({
            "model": profile.model,
            "max_tokens": 4096,
            "system": system,
            "messages": messages,
            "tools": tool_defs,
        });

        let response = client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &profile.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Network error: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_body = response.text().await.unwrap_or_default();
            return Err(format!("Anthropic API error {}: {}", status, error_body));
        }

        let resp_body: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
        let stop_reason = resp_body["stop_reason"].as_str().unwrap_or("");
        let content = resp_body["content"].as_array().cloned().unwrap_or_default();

        // Emit any text blocks to the frontend
        for block in &content {
            if block["type"] == "text" {
                if let Some(text) = block["text"].as_str() {
                    let _ = app.emit("chat-token", text.to_string());
                }
            }
        }

        // If the model wants to use tools, execute them and continue the loop
        if stop_reason == "tool_use" {
            let tool_blocks: Vec<&serde_json::Value> = content
                .iter()
                .filter(|b| b["type"] == "tool_use")
                .collect();

            if tool_blocks.is_empty() {
                break;
            }

            // Add the assistant message with all content blocks
            messages.push(serde_json::json!({
                "role": "assistant",
                "content": content,
            }));

            // Execute each tool and collect results
            let mut tool_results = Vec::new();
            for tool_block in &tool_blocks {
                let tool_name = tool_block["name"].as_str().unwrap_or("");
                let tool_id = tool_block["id"].as_str().unwrap_or("");
                let tool_input = &tool_block["input"];

                let _ = app.emit("chat-tool-use", serde_json::json!({
                    "name": tool_name,
                    "input": tool_input,
                }));

                let result = match tools::execute_tool(tool_name, tool_input) {
                    Ok(output) => serde_json::json!({
                        "type": "tool_result",
                        "tool_use_id": tool_id,
                        "content": output,
                    }),
                    Err(err) => serde_json::json!({
                        "type": "tool_result",
                        "tool_use_id": tool_id,
                        "content": format!("Error: {}", err),
                        "is_error": true,
                    }),
                };
                tool_results.push(result);
            }

            // Add tool results as user message
            messages.push(serde_json::json!({
                "role": "user",
                "content": tool_results,
            }));

            // Notify frontend that the sigil may have changed
            let _ = app.emit("sigil-changed", ());

            // Continue the loop — the model will see the tool results
            continue;
        }

        // No tool use — we're done
        break;
    }

    let _ = app.emit("chat-stream-end", ());
    Ok(())
}

async fn stream_openai(
    app: &AppHandle,
    sigil_context: &str,
    history: &[ChatMessage],
    profile: &AiProfile,
    system_prompt: &str,
) -> Result<(), String> {
    let client = reqwest::Client::new();

    let mut messages: Vec<serde_json::Value> = vec![serde_json::json!({
        "role": "system",
        "content": format!("{}\n\n---\n\nHere is the full sigil:\n\n{}", system_prompt, sigil_context),
    })];

    for m in history {
        messages.push(serde_json::json!({
            "role": match m.role { ChatRole::User => "user", ChatRole::Assistant => "assistant" },
            "content": m.content,
        }));
    }

    let body = serde_json::json!({
        "model": profile.model,
        "messages": messages,
        "stream": true,
    });

    let response = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", profile.api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_body = response.text().await.unwrap_or_default();
        return Err(format!("OpenAI API error {}: {}", status, error_body));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
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
