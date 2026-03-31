use std::fs;
use std::path::Path;
use tauri::{AppHandle, Emitter};
use crate::models::chat::{Chat, ChatInfo, ChatMessage, ChatRole};
use crate::models::sigil::Context;
use crate::models::settings::{AiProfile, AiProvider, DEFAULT_SYSTEM_PROMPT};
use crate::commands::sigil::read_sigil;
use crate::commands::tools;

#[derive(Debug, serde::Deserialize)]
struct ContextRelationship {
    from: String,
    to: String,
    policy: String,
}

#[derive(Debug, Default, serde::Deserialize)]
struct ContextRelationshipFile {
    #[serde(default)]
    relationships: Vec<ContextRelationship>,
}

fn read_optional_trimmed(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    let trimmed = content.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn read_context_relationships(context_path: &Path) -> Vec<ContextRelationship> {
    let path = context_path.join("map.json");
    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(_) => return Vec::new(),
    };

    serde_json::from_str::<ContextRelationshipFile>(&content)
        .map(|parsed| parsed.relationships)
        .unwrap_or_default()
}

fn render_named_entry(output: &mut String, token_prefix: &str, name: &str, content: &str) {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        output.push_str(&format!("- {}{}\n", token_prefix, name));
        return;
    }

    if trimmed.contains('\n') {
        output.push_str(&format!("- {}{}:\n", token_prefix, name));
        for line in trimmed.lines() {
            output.push_str(&format!("  {}\n", line));
        }
        return;
    }

    output.push_str(&format!("- {}{}: {}\n", token_prefix, name, trimmed));
}

fn render_context(ctx: &Context, depth: usize, output: &mut String) {
    let prefix = "#".repeat(depth + 2);
    let detail_prefix = "#".repeat(depth + 3);

    output.push_str(&format!("{} {} (path: {})\n\n", prefix, ctx.name, ctx.path));

    if let Some(definition) = read_optional_trimmed(&Path::new(&ctx.path).join("definition.md")) {
        output.push_str(&format!("{} Definition\n\n", detail_prefix));
        output.push_str(&definition);
        output.push_str("\n\n");
    }

    output.push_str(&format!("{} Domain Language\n\n", detail_prefix));
    if ctx.domain_language.trim().is_empty() {
        output.push_str("_empty_\n\n");
    } else {
        output.push_str(&ctx.domain_language);
        output.push_str("\n\n");
    }

    output.push_str(&format!("{} Contrasts\n\n", detail_prefix));
    if ctx.contrasts.is_empty() {
        output.push_str("- none\n\n");
    } else {
        for contrast in &ctx.contrasts {
            render_named_entry(output, "!", &contrast.name, &contrast.content);
        }
        output.push('\n');
    }

    output.push_str(&format!("{} Affordances\n\n", detail_prefix));
    if ctx.affordances.is_empty() {
        output.push_str("- none\n\n");
    } else {
        for affordance in &ctx.affordances {
            render_named_entry(output, "#", &affordance.name, &affordance.content);
        }
        output.push('\n');
    }

    output.push_str(&format!("{} Contained Sigils\n\n", detail_prefix));
    if ctx.children.is_empty() {
        output.push_str("- none\n\n");
    } else {
        for child in &ctx.children {
            output.push_str(&format!("- {}\n", child.name));
        }
        output.push('\n');
    }

    let relationships = read_context_relationships(Path::new(&ctx.path));
    output.push_str(&format!("{} Neighbor Relationships In This Context\n\n", detail_prefix));
    if relationships.is_empty() {
        output.push_str("- none\n\n");
    } else {
        for relationship in relationships {
            output.push_str(&format!(
                "- {} -> {} ({})\n",
                relationship.from, relationship.to, relationship.policy
            ));
        }
        output.push('\n');
    }

    for child in &ctx.children {
        render_context(child, depth + 1, output);
    }
}

fn assemble_sigil_context(root_path: &str) -> Result<String, String> {
    let sigil = read_sigil(root_path.to_string())?;
    let mut output = String::new();

    output.push_str(&format!("Sigil root: {}\n\n", root_path));

    output.push_str("# Vision\n\n");
    output.push_str(&sigil.vision);
    output.push_str("\n\n");

    output.push_str("# Sigil Artifact\n\n");
    output.push_str("Each context below includes its definition, domain language, contrasts, affordances, contained sigils, and neighbor relationships as read from the filesystem artifact.\n\n");

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
    let tool_defs = tools::tool_definitions();

    let openai_tools: Vec<serde_json::Value> = tool_defs
        .iter()
        .map(|t| serde_json::json!({
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["input_schema"],
            }
        }))
        .collect();

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

    loop {
        let body = serde_json::json!({
            "model": profile.model,
            "messages": messages,
            "tools": openai_tools,
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

        let resp_body: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
        let choice = &resp_body["choices"][0];
        let message = &choice["message"];

        let tool_calls = message["tool_calls"]
            .as_array()
            .filter(|arr| !arr.is_empty());

        if let Some(calls) = tool_calls {
            // Emit any accompanying text before handling tools
            if let Some(text) = message["content"].as_str() {
                if !text.is_empty() {
                    let _ = app.emit("chat-token", text.to_string());
                }
            }

            messages.push(message.clone());

            for call in calls {
                let tool_name = call["function"]["name"].as_str().unwrap_or("");
                let tool_id = call["id"].as_str().unwrap_or("");
                let args_str = call["function"]["arguments"].as_str().unwrap_or("{}");
                let tool_input: serde_json::Value =
                    serde_json::from_str(args_str).unwrap_or_default();

                let _ = app.emit("chat-tool-use", serde_json::json!({
                    "name": tool_name,
                    "input": &tool_input,
                }));

                let result = match tools::execute_tool(tool_name, &tool_input) {
                    Ok(output) => output,
                    Err(err) => format!("Error: {}", err),
                };

                messages.push(serde_json::json!({
                    "role": "tool",
                    "tool_call_id": tool_id,
                    "content": result,
                }));
            }

            let _ = app.emit("sigil-changed", ());
            continue;
        }

        // No tool calls — emit text and finish
        if let Some(text) = message["content"].as_str() {
            if !text.is_empty() {
                let _ = app.emit("chat-token", text.to_string());
            }
        }

        break;
    }

    let _ = app.emit("chat-stream-end", ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup_sigil(tmp: &TempDir) -> std::path::PathBuf {
        let root = tmp.path().join("MyApp");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("vision.md"), "Build the best app").unwrap();
        fs::write(root.join("language.md"), "Root domain language").unwrap();

        let browse = root.join("Browse");
        fs::create_dir(&browse).unwrap();
        fs::write(browse.join("language.md"), "Browse existing sigils").unwrap();

        let edit = root.join("Edit");
        fs::create_dir(&edit).unwrap();
        fs::write(edit.join("language.md"), "Edit the current sigil").unwrap();

        root
    }

    #[test]
    fn test_assemble_sigil_context_includes_explicit_artifact_fields() {
        let tmp = TempDir::new().unwrap();
        let root = setup_sigil(&tmp);

        fs::write(root.join("definition.md"), "Application shell boundary").unwrap();
        fs::write(root.join("contrast-latency.md"), "fast enough for fluent use").unwrap();
        fs::write(root.join("affordance-navigate.md"), "move through the sigil hierarchy").unwrap();
        fs::write(
            root.join("map.json"),
            r#"{
  "relationships": [
    { "from": "Browse", "to": "Edit", "policy": "published-language" }
  ]
}"#,
        )
        .unwrap();

        let browse = root.join("Browse");
        fs::write(browse.join("definition.md"), "Surface for finding existing structure").unwrap();
        fs::write(browse.join("affordance-open.md"), "open a selected sigil").unwrap();
        fs::write(browse.join("contrast-focus.md"), "keep the current target visible").unwrap();

        let context = assemble_sigil_context(root.to_string_lossy().as_ref()).unwrap();

        assert!(context.contains("# Sigil Artifact"));
        assert!(context.contains("Application shell boundary"));
        assert!(context.contains("### Contrasts"));
        assert!(context.contains("- !latency: fast enough for fluent use"));
        assert!(context.contains("### Affordances"));
        assert!(context.contains("- #navigate: move through the sigil hierarchy"));
        assert!(context.contains("### Contained Sigils"));
        assert!(context.contains("- Browse"));
        assert!(context.contains("- Browse -> Edit (published-language)"));
        assert!(context.contains("Surface for finding existing structure"));
        assert!(context.contains("- #open: open a selected sigil"));
    }
}
