use std::fs;
use std::path::Path;
use regex::Regex;
use tauri::{Emitter, Manager};
use crate::commands::sigil::{create_context, delete_context, rename_sigil, move_sigil, read_sigil_with_libs};
use crate::commands::chat::render_context;

/// Context about the editor state, passed from the chat handler.
pub struct EditorContext {
    pub root_path: String,
    pub current_path: Vec<String>,
}

/// Define the tools available to the AI agent
pub fn tool_definitions() -> Vec<serde_json::Value> {
    vec![
        // ── Sigil ──
        serde_json::json!({
            "name": "navigate",
            "description": "Navigate the user's editor to a sigil. Opens it in the editor view.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "sigil_path": {
                        "type": "string",
                        "description": "Absolute path to the sigil to navigate to"
                    }
                },
                "required": ["sigil_path"]
            }
        }),
        serde_json::json!({
            "name": "select_text",
            "description": "Select text in the active editor. Use to show the user a specific passage, or to prepare for replace_selected_text. Specify either a line range or a text excerpt to find and select.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "from_line": {
                        "type": "integer",
                        "description": "Start line number (1-based)"
                    },
                    "to_line": {
                        "type": "integer",
                        "description": "End line number (1-based, inclusive)"
                    },
                    "excerpt": {
                        "type": "string",
                        "description": "Text excerpt to find and select. Used when line numbers are not known."
                    }
                }
            }
        }),
        serde_json::json!({
            "name": "replace_selected_text",
            "description": "Replace the currently selected text in the active editor with new text. Use after select_text.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "The replacement text"
                    }
                },
                "required": ["text"]
            }
        }),
        serde_json::json!({
            "name": "write_sigil",
            "description": "Write a sigil's domain language. Creates the sigil directory and language.md if they don't exist.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "sigil_path": {
                        "type": "string",
                        "description": "Absolute path to the sigil directory"
                    },
                    "content": {
                        "type": "string",
                        "description": "Domain language content in markdown"
                    }
                },
                "required": ["sigil_path", "content"]
            }
        }),
        serde_json::json!({
            "name": "read_sigil",
            "description": "Read a sigil recursively — its domain language, affordances, invariants, and all children.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "sigil_path": {
                        "type": "string",
                        "description": "Absolute path to the sigil directory"
                    }
                },
                "required": ["sigil_path"]
            }
        }),
        serde_json::json!({
            "name": "read_tree",
            "description": "Read the entire sigil tree from root — vision, all sigils, affordances, invariants, recursively. Use to understand the full spec. Call with no arguments to read the current sigil.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "root_path": {
                        "type": "string",
                        "description": "Absolute path to the sigil root directory. Omit to use the current sigil root."
                    }
                },
                "required": []
            }
        }),
        serde_json::json!({
            "name": "rename_sigil",
            "description": "Rename a sigil and update all @references across the entire sigil tree.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "root_path": {
                        "type": "string",
                        "description": "Absolute path to the sigil root directory"
                    },
                    "sigil_path": {
                        "type": "string",
                        "description": "Absolute path to the sigil to rename"
                    },
                    "new_name": {
                        "type": "string",
                        "description": "The new name"
                    }
                },
                "required": ["root_path", "sigil_path", "new_name"]
            }
        }),
        serde_json::json!({
            "name": "move_sigil",
            "description": "Move a sigil to a different parent. Interior stays intact.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "root_path": {
                        "type": "string",
                        "description": "Absolute path to the sigil root directory"
                    },
                    "sigil_path": {
                        "type": "string",
                        "description": "Absolute path to the sigil to move"
                    },
                    "new_parent_path": {
                        "type": "string",
                        "description": "Absolute path to the new parent sigil"
                    }
                },
                "required": ["root_path", "sigil_path", "new_parent_path"]
            }
        }),
        serde_json::json!({
            "name": "delete_sigil",
            "description": "Delete a sigil and all its children. Destructive.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "sigil_path": {
                        "type": "string",
                        "description": "Absolute path to the sigil to delete"
                    }
                },
                "required": ["sigil_path"]
            }
        }),
        serde_json::json!({
            "name": "write_vision",
            "description": "Write or replace the vision statement (vision.md) at the sigil root.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "root_path": {
                        "type": "string",
                        "description": "Absolute path to the sigil root directory"
                    },
                    "content": {
                        "type": "string",
                        "description": "Vision statement in markdown"
                    }
                },
                "required": ["root_path", "content"]
            }
        }),
        // ── Affordance ──
        serde_json::json!({
            "name": "write_affordance",
            "description": "Write an affordance on a sigil. Creates affordance-{name}.md if it doesn't exist.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "sigil_path": {
                        "type": "string",
                        "description": "Absolute path to the sigil directory"
                    },
                    "name": {
                        "type": "string",
                        "description": "Affordance name in dash-form (e.g. 'navigate', 'measure-name-fit')"
                    },
                    "content": {
                        "type": "string",
                        "description": "Affordance description in markdown"
                    }
                },
                "required": ["sigil_path", "name", "content"]
            }
        }),
        serde_json::json!({
            "name": "delete_affordance",
            "description": "Delete an affordance from a sigil.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "sigil_path": {
                        "type": "string",
                        "description": "Absolute path to the sigil directory"
                    },
                    "name": {
                        "type": "string",
                        "description": "Affordance name in dash-form"
                    }
                },
                "required": ["sigil_path", "name"]
            }
        }),
        // ── Invariant ──
        serde_json::json!({
            "name": "write_invariant",
            "description": "Write an invariant on a sigil. Creates invariant-{name}.md if it doesn't exist.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "sigil_path": {
                        "type": "string",
                        "description": "Absolute path to the sigil directory"
                    },
                    "name": {
                        "type": "string",
                        "description": "Invariant name in dash-form (e.g. 'no-data-loss', 'vision-is-the-test')"
                    },
                    "content": {
                        "type": "string",
                        "description": "Invariant description in markdown"
                    }
                },
                "required": ["sigil_path", "name", "content"]
            }
        }),
        serde_json::json!({
            "name": "delete_invariant",
            "description": "Delete an invariant from a sigil.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "sigil_path": {
                        "type": "string",
                        "description": "Absolute path to the sigil directory"
                    },
                    "name": {
                        "type": "string",
                        "description": "Invariant name in dash-form"
                    }
                },
                "required": ["sigil_path", "name"]
            }
        }),
        serde_json::json!({
            "name": "browser_state_inspection",
            "description": "See what the user currently has open in the editor. Returns the current sigil path and its content.",
            "input_schema": {
                "type": "object",
                "properties": {}
            }
        }),
        serde_json::json!({
            "name": "web_search",
            "description": "Search the web for information. Use to research questions or satisfy curiosity.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query"
                    }
                },
                "required": ["query"]
            }
        }),
    ]
}

/// Execute a tool call and return the result as a string
pub async fn execute_tool(name: &str, input: &serde_json::Value, app: Option<&tauri::AppHandle>, editor_ctx: Option<&EditorContext>) -> Result<String, String> {
    match name {
        "navigate" => {
            let sigil_path = input["sigil_path"].as_str().ok_or("Missing sigil_path")?;
            if !Path::new(sigil_path).exists() {
                return Err(format!("Sigil not found: {}", sigil_path));
            }
            if let Some(app) = app {
                let _ = app.emit("navigate-to", sigil_path.to_string());
            }
            Ok(format!("Navigated to {}", sigil_path))
        }
        "select_text" => {
            let payload = serde_json::json!({
                "from_line": input.get("from_line"),
                "to_line": input.get("to_line"),
                "excerpt": input.get("excerpt"),
            });
            if let Some(app) = app {
                let _ = app.emit("select-text", payload.to_string());
            }
            // Return the selected text so the partner can see what was selected
            if let Some(ctx) = editor_ctx {
                let mut sigil_dir = Path::new(&ctx.root_path).to_path_buf();
                for seg in &ctx.current_path {
                    sigil_dir = sigil_dir.join(seg);
                }
                let lang_file = sigil_dir.join("language.md");
                if let Ok(content) = fs::read_to_string(&lang_file) {
                    if let Some(excerpt) = input.get("excerpt").and_then(|v| v.as_str()) {
                        if content.contains(excerpt) {
                            return Ok(format!("Selected text:\n\n{}", excerpt));
                        } else {
                            return Err(format!("Excerpt not found in current document: \"{}\"", excerpt));
                        }
                    }
                    if let Some(from_line) = input.get("from_line").and_then(|v| v.as_i64()) {
                        let to_line = input.get("to_line").and_then(|v| v.as_i64()).unwrap_or(from_line);
                        let lines: Vec<&str> = content.lines().collect();
                        let from_idx = (from_line - 1).max(0) as usize;
                        let to_idx = (to_line as usize).min(lines.len());
                        if from_idx < lines.len() {
                            let selected: String = lines[from_idx..to_idx].join("\n");
                            return Ok(format!("Selected lines {}-{}:\n\n{}", from_line, to_line, selected));
                        }
                    }
                }
            }
            Ok("Text selected".to_string())
        }
        "replace_selected_text" => {
            let text = input["text"].as_str().ok_or("Missing text")?;
            if let Some(app) = app {
                let _ = app.emit("replace-selected-text", text.to_string());
            }
            Ok("Text replaced".to_string())
        }
        "write_sigil" | "create_context" | "write_language" | "create_sigil" => {
            let sigil_path = input.get("sigil_path")
                .or(input.get("parent_path"))
                .or(input.get("context_path"))
                .and_then(|v| v.as_str())
                .ok_or("Missing sigil_path")?;
            let content = input["content"].as_str().unwrap_or("");

            // For legacy create_context / create_sigil: parent_path + name → child dir
            if (name == "create_context" || name == "create_sigil") && input.get("name").is_some() {
                let ctx_name = input["name"].as_str().ok_or("Missing name")?;
                let ctx = create_context(sigil_path.to_string(), ctx_name.to_string())?;
                if !content.is_empty() {
                    let file_path = Path::new(&ctx.path).join("language.md");
                    fs::write(&file_path, content).map_err(|e| e.to_string())?;
                }
                return Ok(format!("Created sigil '{}' at {}", ctx.name, ctx.path));
            }

            // Ensure directory exists
            let dir = Path::new(sigil_path);
            if !dir.exists() {
                fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            }
            let file_path = dir.join("language.md");
            fs::write(&file_path, content).map_err(|e| e.to_string())?;
            Ok(format!("Wrote sigil at {}", sigil_path))
        }
        "read_sigil" | "read_context" => {
            let sigil_path = input.get("sigil_path")
                .or(input.get("context_path"))
                .and_then(|v| v.as_str())
                .or_else(|| editor_ctx.map(|c| c.root_path.as_str()))
                .ok_or("Missing sigil_path")?;
            let libs_path = app.and_then(|a| a.path().resource_dir().ok()).map(|p| p.join("Libs")).filter(|p| p.exists());
            let sigil = read_sigil_with_libs(sigil_path.to_string(), libs_path)?;
            let mut output = String::new();
            render_context(&sigil.root, 0, &mut output);
            Ok(output)
        }
        "read_tree" => {
            let root_path = input["root_path"].as_str()
                .or_else(|| editor_ctx.map(|c| c.root_path.as_str()))
                .ok_or("Missing root_path")?;
            let libs_path = app.and_then(|a| a.path().resource_dir().ok()).map(|p| p.join("Libs")).filter(|p| p.exists());
            let sigil = read_sigil_with_libs(root_path.to_string(), libs_path)?;
            let mut output = String::new();
            output.push_str(&format!("Sigil root: {}\n\n", root_path));
            output.push_str("# Vision\n\n");
            output.push_str(&sigil.vision);
            output.push_str("\n\n");
            render_context(&sigil.root, 0, &mut output);
            // Include imported ontologies in the tree output
            if let Some(ref imported) = sigil.imported_ontologies {
                output.push_str("\n\n");
                render_context(imported, 0, &mut output);
            }
            Ok(output)
        }
        "rename_sigil" | "rename_context" => {
            let root = input["root_path"].as_str().ok_or("Missing root_path")?;
            let sigil_path = input.get("sigil_path")
                .or(input.get("context_path"))
                .and_then(|v| v.as_str())
                .ok_or("Missing sigil_path")?;
            let new_name = input["new_name"].as_str().ok_or("Missing new_name")?;
            let result = rename_sigil(root.to_string(), sigil_path.to_string(), new_name.to_string())?;
            Ok(result)
        }
        "move_sigil" => {
            let root = input["root_path"].as_str().ok_or("Missing root_path")?;
            let sigil_path = input.get("sigil_path")
                .or(input.get("context_path"))
                .and_then(|v| v.as_str())
                .ok_or("Missing sigil_path")?;
            let new_parent = input["new_parent_path"].as_str().ok_or("Missing new_parent_path")?;
            let new_path = move_sigil(root.to_string(), sigil_path.to_string(), new_parent.to_string())?;
            Ok(format!("Moved to {}", new_path))
        }
        "delete_sigil" | "delete_context" => {
            let sigil_path = input.get("sigil_path")
                .or(input.get("context_path"))
                .and_then(|v| v.as_str())
                .ok_or("Missing sigil_path")?;
            delete_context(sigil_path.to_string())?;
            Ok(format!("Deleted sigil at {}", sigil_path))
        }
        "write_vision" => {
            let root_path = input["root_path"].as_str().ok_or("Missing root_path")?;
            let content = input["content"].as_str().ok_or("Missing content")?;
            let file_path = Path::new(root_path).join("vision.md");
            fs::write(&file_path, content).map_err(|e| e.to_string())?;
            Ok(format!("Wrote vision.md at {}", root_path))
        }
        "write_affordance" | "create_affordance" => {
            let sigil_path = input["sigil_path"].as_str().ok_or("Missing sigil_path")?;
            let name = input["name"].as_str().ok_or("Missing name")?;
            let content = input["content"].as_str().unwrap_or("");
            let file_path = Path::new(sigil_path).join(format!("affordance-{}.md", name));
            fs::write(&file_path, content).map_err(|e| e.to_string())?;
            Ok(format!("Wrote affordance #{} on {}", name, sigil_path))
        }
        "delete_affordance" => {
            let sigil_path = input["sigil_path"].as_str().ok_or("Missing sigil_path")?;
            let name = input["name"].as_str().ok_or("Missing name")?;
            let file_path = Path::new(sigil_path).join(format!("affordance-{}.md", name));
            if !file_path.exists() {
                return Err(format!("Affordance '{}' not found at {}", name, sigil_path));
            }
            fs::remove_file(&file_path).map_err(|e| e.to_string())?;
            Ok(format!("Deleted affordance #{} from {}", name, sigil_path))
        }
        "write_invariant" | "create_invariant" => {
            let sigil_path = input["sigil_path"].as_str().ok_or("Missing sigil_path")?;
            let name = input["name"].as_str().ok_or("Missing name")?;
            let content = input["content"].as_str().unwrap_or("");
            let file_path = Path::new(sigil_path).join(format!("invariant-{}.md", name));
            fs::write(&file_path, content).map_err(|e| e.to_string())?;
            Ok(format!("Wrote invariant !{} on {}", name, sigil_path))
        }
        "delete_invariant" => {
            let sigil_path = input["sigil_path"].as_str().ok_or("Missing sigil_path")?;
            let name = input["name"].as_str().ok_or("Missing name")?;
            let file_path = Path::new(sigil_path).join(format!("invariant-{}.md", name));
            if !file_path.exists() {
                return Err(format!("Invariant '{}' not found at {}", name, sigil_path));
            }
            fs::remove_file(&file_path).map_err(|e| e.to_string())?;
            Ok(format!("Deleted invariant !{} from {}", name, sigil_path))
        }
        "browser_state_inspection" => {
            if let Some(ctx) = editor_ctx {
                let mut sigil_dir = Path::new(&ctx.root_path).to_path_buf();
                for seg in &ctx.current_path {
                    sigil_dir = sigil_dir.join(seg);
                }
                let current_location = if ctx.current_path.is_empty() {
                    "Root".to_string()
                } else {
                    ctx.current_path.join(" > ")
                };
                let lang_file = sigil_dir.join("language.md");
                let content = fs::read_to_string(&lang_file).unwrap_or_default();
                let mut output = format!("Currently viewing: {}\n", current_location);
                if content.is_empty() {
                    output.push_str("\n(empty document)");
                } else {
                    output.push_str("\nContent:\n\n");
                    for (i, line) in content.lines().enumerate() {
                        output.push_str(&format!("{:>3} | {}\n", i + 1, line));
                    }
                }
                Ok(output)
            } else {
                Err("Editor context not available".to_string())
            }
        }
        "web_search" => {
            let query = input["query"].as_str().ok_or("Missing query")?;
            web_search(query).await
        }
        _ => Err(format!("Unknown tool: {}", name)),
    }
}

/// Search DuckDuckGo HTML and extract result snippets.
async fn web_search(query: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let url = format!("https://html.duckduckgo.com/html/?q={}", urlencoded(query));
    let resp = client.get(&url)
        .send()
        .await
        .map_err(|e| format!("Search request failed: {}", e))?;

    let html = resp.text().await.map_err(|e| format!("Failed to read response: {}", e))?;

    // Parse result blocks: each has class="result__snippet" and class="result__a"
    let title_re = Regex::new(r#"class="result__a"[^>]*>([^<]+)</a>"#).unwrap();
    let snippet_re = Regex::new(r#"class="result__snippet"[^>]*>(.*?)</(?:td|span|a)"#).unwrap();
    let tag_re = Regex::new(r"<[^>]+>").unwrap();

    let titles: Vec<String> = title_re.captures_iter(&html)
        .map(|c| decode_entities(&c[1]).trim().to_string())
        .collect();
    let snippets: Vec<String> = snippet_re.captures_iter(&html)
        .map(|c| decode_entities(&tag_re.replace_all(&c[1], "")).trim().to_string())
        .collect();

    if titles.is_empty() {
        return Ok(format!("No results found for: \"{}\"", query));
    }

    let mut output = format!("Search results for: \"{}\"\n\n", query);
    for i in 0..titles.len().min(5) {
        output.push_str(&format!("{}. {}\n", i + 1, titles[i]));
        if let Some(snippet) = snippets.get(i) {
            if !snippet.is_empty() {
                output.push_str(&format!("   {}\n", snippet));
            }
        }
        output.push('\n');
    }
    Ok(output)
}

fn urlencoded(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            b' ' => out.push('+'),
            _ => {
                out.push_str(&format!("%{:02X}", b));
            }
        }
    }
    out
}

fn decode_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}
