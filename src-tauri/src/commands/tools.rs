use std::fs;
use std::path::{Path, PathBuf};
use regex::Regex;
use tauri::Emitter;

/// Resolve a sigil-path argument from the model against the workspace root.
///
/// The model passes a spec-relative path like "Scratch" or "DesignPartner/
/// BicameralMind" — sometimes with a trailing /language.md it included by
/// accident. This normalizes the argument and resolves it to an absolute
/// PathBuf under the workspace root. Rejects absolute paths and ".."
/// traversal so a tool call can't escape the workspace.
/// Mutating tools require both the app handle (to emit the event) and
/// the dispatcher (to register the pending request). Unit tests pass
/// None; the chat flow always has both.
fn require_app_and_dispatcher<'a>(
    app: Option<&'a tauri::AppHandle>,
    dispatcher: Option<&'a crate::commands::tool_dispatcher::ToolDispatcher>,
) -> Result<(&'a tauri::AppHandle, &'a crate::commands::tool_dispatcher::ToolDispatcher), String> {
    match (app, dispatcher) {
        (Some(a), Some(d)) => Ok((a, d)),
        _ => Err("Tool dispatch requires app handle and dispatcher".into()),
    }
}

fn resolve_sigil_arg(
    raw: &str,
    editor_ctx: Option<&EditorContext>,
) -> Result<(String, PathBuf), String> {
    let cleaned = raw
        .trim_end_matches("/language.md")
        .trim_matches('/')
        .to_string();
    if cleaned.contains("..") {
        return Err(format!("Path traversal refused: {}", cleaned));
    }
    if cleaned.starts_with('/') {
        return Err(format!("Absolute path refused: {}", cleaned));
    }
    let root_path = editor_ctx
        .map(|c| c.root_path.as_str())
        .ok_or("No workspace root available")?;
    let abs = Path::new(root_path).join(&cleaned);
    Ok((cleaned, abs))
}
use crate::commands::sigil::read_sigil_with_libs;
use crate::commands::chat::render_context;

/// Context about the editor state, passed from the chat handler.
///
/// `current_path` is interior-mutable because the `navigate` tool can move
/// the active sigil mid-turn. Subsequent same-turn tools
/// (`browser_state_inspection`, `select_text`, etc.) must read the updated
/// path so they target the navigated sigil rather than the turn's starting
/// path. Holding the lock is cheap — it's only ever taken to clone the
/// short path vector or replace it.
pub struct EditorContext {
    pub root_path: String,
    current_path: std::sync::Mutex<Vec<String>>,
}

impl EditorContext {
    pub fn new(root_path: String, current_path: Vec<String>) -> Self {
        Self {
            root_path,
            current_path: std::sync::Mutex::new(current_path),
        }
    }

    pub fn current_path(&self) -> Vec<String> {
        self.current_path
            .lock()
            .expect("current_path lock poisoned")
            .clone()
    }

    pub fn set_current_path(&self, path: Vec<String>) {
        *self
            .current_path
            .lock()
            .expect("current_path lock poisoned") = path;
    }
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
                        "description": "Sigil path relative to the workspace root, using the sigil's name hierarchy. Example: 'Scratch' for the top-level Scratch sigil, or 'DesignPartner/BicameralMind/Memory' for a nested one. Do not invent paths; use names that actually exist in the tree."
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
                        "description": "Sigil path relative to the workspace root (e.g. 'Scratch', 'DesignPartner/BicameralMind/Memory'). Use names from the actual tree, not invented paths."
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
                        "description": "Sigil path relative to the workspace root (e.g. 'Scratch', 'DesignPartner/BicameralMind/Memory'). Use names from the actual tree, not invented paths."
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
                        "description": "Optional — omit to use the current workspace root."
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
                        "description": "Optional — omit to use the current workspace root."
                    },
                    "sigil_path": {
                        "type": "string",
                        "description": "Sigil path relative to the workspace root (e.g. 'Scratch')"
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
                        "description": "Optional — omit to use the current workspace root."
                    },
                    "sigil_path": {
                        "type": "string",
                        "description": "Sigil path relative to the workspace root (e.g. 'Scratch')"
                    },
                    "new_parent_path": {
                        "type": "string",
                        "description": "Sigil path of the new parent, relative to workspace root. Omit to move to root."
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
                        "description": "Sigil path relative to the workspace root (e.g. 'Scratch'). This sigil must exist."
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
                        "description": "Optional — omit to use the current workspace root."
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
                        "description": "Sigil path relative to the workspace root (e.g. 'Scratch', 'DesignPartner/BicameralMind/Memory'). Use names from the actual tree, not invented paths."
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
                        "description": "Sigil path relative to the workspace root (e.g. 'Scratch', 'DesignPartner/BicameralMind/Memory'). Use names from the actual tree, not invented paths."
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
                        "description": "Sigil path relative to the workspace root (e.g. 'Scratch', 'DesignPartner/BicameralMind/Memory'). Use names from the actual tree, not invented paths."
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
                        "description": "Sigil path relative to the workspace root (e.g. 'Scratch', 'DesignPartner/BicameralMind/Memory'). Use names from the actual tree, not invented paths."
                    },
                    "name": {
                        "type": "string",
                        "description": "Invariant name in dash-form"
                    }
                },
                "required": ["sigil_path", "name"]
            }
        }),
        // ── Placement category ──
        // Marks a sigil's placement within its parent with a category that
        // names the kind of truth the placement carries. Persists as a
        // `placement` field in the sigil's language.md frontmatter so
        // reorganization can preserve the right thing per branch.
        serde_json::json!({
            "name": "mark_placement",
            "description": "Mark a sigil's placement within its parent with the kind of truth it carries. Three categories: 'ontological' (placement reflects how things really relate — this sigil belongs HERE structurally), 'narrative-historical' (placement is where it landed because of how things came to be, not where it most naturally belongs), 'provisional' (placement is a working guess, expected to move). Use when you notice a placement and want to mark which kind of truth it carries — so later reorganization can preserve ontological structure, respect narrative-historical placements as artifacts, and freely move provisional ones. Persisted in the sigil's language.md frontmatter.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "sigil_path": {
                        "type": "string",
                        "description": "Sigil path relative to the workspace root (e.g. 'Scratch', 'DesignPartner/BicameralMind/Memory'). Use names from the actual tree, not invented paths."
                    },
                    "category": {
                        "type": "string",
                        "enum": ["ontological", "narrative-historical", "provisional"],
                        "description": "The kind of truth this placement carries."
                    }
                },
                "required": ["sigil_path", "category"]
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

/// Execute a tool call and return the result as a string.
///
/// Wraps execute_tool_inner with unconditional logging of entry, exit,
/// and any error. Every tool invocation now leaves a trace in the dev
/// terminal — if "nothing happens," either the tool was never dispatched
/// (no [tool>] line) or the tool completed successfully (look for [tool<]).
pub async fn execute_tool(
    name: &str,
    input: &serde_json::Value,
    app: Option<&tauri::AppHandle>,
    editor_ctx: Option<&EditorContext>,
    dispatcher: Option<&crate::commands::tool_dispatcher::ToolDispatcher>,
) -> Result<String, String> {
    eprintln!("[tool>] {} input={}", name, input);
    let result = execute_tool_inner(name, input, app, editor_ctx, dispatcher).await;
    match &result {
        Ok(s) => {
            let preview: String = s.chars().take(160).collect();
            eprintln!("[tool<] {} ok: {}", name, preview);
        }
        Err(e) => {
            eprintln!("[tool✗] {} failed: {}", name, e);
        }
    }
    result
}

async fn execute_tool_inner(
    name: &str,
    input: &serde_json::Value,
    app: Option<&tauri::AppHandle>,
    editor_ctx: Option<&EditorContext>,
    dispatcher: Option<&crate::commands::tool_dispatcher::ToolDispatcher>,
) -> Result<String, String> {
    match name {
        "navigate" => {
            let raw = input["sigil_path"].as_str().ok_or("Missing sigil_path")?;
            let (sigil_path, abs) = resolve_sigil_arg(raw, editor_ctx)?;
            if !abs.exists() {
                return Err(format!("Sigil not found at path: {}", sigil_path));
            }
            let (app_h, dispatcher_h) = require_app_and_dispatcher(app, dispatcher)?;
            // Round-trip through the frontend so navigate only returns once
            // the new sigil is actually mounted in the active editor. This
            // is what makes navigate safe as a setup step for select_text /
            // replace_selected_text — they operate on the active editor and
            // would otherwise race the not-yet-mounted target.
            let result = crate::commands::tool_dispatcher::dispatch(
                dispatcher_h,
                app_h,
                "tool:navigate",
                serde_json::json!({ "sigil_path": sigil_path.clone() }),
                10,
            )
            .await?;
            // Confirmed mounted — propagate to shared editor state so any
            // subsequent same-turn tool that reads current_path
            // (browser_state_inspection, select_text validation) targets the
            // navigated sigil rather than the turn's starting path.
            if let Some(ctx) = editor_ctx {
                let segments: Vec<String> = sigil_path
                    .split('/')
                    .filter(|s| !s.is_empty())
                    .map(String::from)
                    .collect();
                ctx.set_current_path(segments);
            }
            Ok(result)
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
                let cp = ctx.current_path();
                for seg in &cp {
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
            let (app_h, dispatcher_h) = require_app_and_dispatcher(app, dispatcher)?;
            // Round-trip so the tool returns only after the change has been
            // applied to the active editor AND persisted to disk. The old
            // fire-and-forget emit returned success while the autosave
            // debounce was still pending — subsequent tools that read
            // language.md (browser_state_inspection, select_text) saw the
            // pre-replace content and the replacement looked silently
            // ignored.
            crate::commands::tool_dispatcher::dispatch(
                dispatcher_h,
                app_h,
                "tool:replace_selected_text",
                serde_json::json!({ "text": text }),
                10,
            )
            .await
        }
        "write_sigil" | "create_context" | "write_language" | "create_sigil" => {
            let raw = input.get("sigil_path")
                .or(input.get("parent_path"))
                .or(input.get("context_path"))
                .and_then(|v| v.as_str())
                .ok_or("Missing sigil_path")?;
            let (sigil_path, abs) = resolve_sigil_arg(raw, editor_ctx)?;
            let content = input["content"].as_str().unwrap_or("").to_string();
            let (app, dispatcher) = require_app_and_dispatcher(app, dispatcher)?;

            if (name == "create_sigil" || name == "create_context") && input.get("name").is_some() {
                let ctx_name = input["name"].as_str().ok_or("Missing name")?.to_string();
                return crate::commands::tool_dispatcher::dispatch(
                    dispatcher, app, "tool:create_sigil",
                    serde_json::json!({
                        "parent_sigil_path": sigil_path,
                        "parent_abs_path": abs.to_string_lossy(),
                        "name": ctx_name,
                        "content": content,
                    }),
                    30,
                ).await;
            }

            crate::commands::tool_dispatcher::dispatch(
                dispatcher, app, "tool:write_sigil",
                serde_json::json!({
                    "sigil_path": sigil_path,
                    "abs_path": abs.to_string_lossy(),
                    "content": content,
                }),
                30,
            ).await
        }
        "read_sigil" | "read_context" => {
            let abs = match input.get("sigil_path").or(input.get("context_path")).and_then(|v| v.as_str()) {
                Some(raw) => resolve_sigil_arg(raw, editor_ctx)?.1,
                None => {
                    let root = editor_ctx.map(|c| c.root_path.as_str()).ok_or("Missing sigil_path")?;
                    PathBuf::from(root)
                }
            };
            let sigil = read_sigil_with_libs(abs.to_string_lossy().to_string())?;
            let mut output = String::new();
            render_context(&sigil.root, 0, &mut output);
            Ok(output)
        }
        "read_tree" => {
            let root_path = input["root_path"].as_str()
                .or_else(|| editor_ctx.map(|c| c.root_path.as_str()))
                .ok_or("Missing root_path")?;
            let sigil = read_sigil_with_libs(root_path.to_string())?;
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
            let raw = input.get("sigil_path")
                .or(input.get("context_path"))
                .and_then(|v| v.as_str())
                .ok_or("Missing sigil_path")?;
            let (sigil_path, abs) = resolve_sigil_arg(raw, editor_ctx)?;
            if !abs.exists() {
                return Err(format!("Sigil not found at path: {}", sigil_path));
            }
            let new_name = input["new_name"].as_str().ok_or("Missing new_name")?.to_string();
            let (app, dispatcher) = require_app_and_dispatcher(app, dispatcher)?;
            crate::commands::tool_dispatcher::dispatch(
                dispatcher, app, "tool:rename_sigil",
                serde_json::json!({
                    "sigil_path": sigil_path,
                    "abs_path": abs.to_string_lossy(),
                    "new_name": new_name,
                }),
                30,
            ).await
        }
        "move_sigil" => {
            let raw = input.get("sigil_path")
                .or(input.get("context_path"))
                .and_then(|v| v.as_str())
                .ok_or("Missing sigil_path")?;
            let (sigil_path, abs) = resolve_sigil_arg(raw, editor_ctx)?;
            if !abs.exists() {
                return Err(format!("Sigil not found at path: {}", sigil_path));
            }
            let new_parent_raw = input["new_parent_path"].as_str().ok_or("Missing new_parent_path")?;
            let (new_parent_path, new_parent_abs) = resolve_sigil_arg(new_parent_raw, editor_ctx)?;
            let (app, dispatcher) = require_app_and_dispatcher(app, dispatcher)?;
            crate::commands::tool_dispatcher::dispatch(
                dispatcher, app, "tool:move_sigil",
                serde_json::json!({
                    "sigil_path": sigil_path,
                    "abs_path": abs.to_string_lossy(),
                    "new_parent_sigil_path": new_parent_path,
                    "new_parent_abs_path": new_parent_abs.to_string_lossy(),
                }),
                30,
            ).await
        }
        "delete_sigil" | "delete_context" => {
            let raw = input.get("sigil_path")
                .or(input.get("context_path"))
                .and_then(|v| v.as_str())
                .ok_or("Missing sigil_path")?;
            let (sigil_path, abs) = resolve_sigil_arg(raw, editor_ctx)?;
            eprintln!("[delete_sigil] raw={:?} cleaned={:?} abs={:?} exists={}", raw, sigil_path, abs, abs.exists());
            if sigil_path.is_empty() {
                return Err("Refusing to delete workspace root".into());
            }
            if !abs.exists() {
                return Err(format!("Sigil not found at path: {}", sigil_path));
            }

            // Route through the frontend's deleteSigil action — same path
            // a user click takes. See ToolDispatcher for the protocol.
            let (app, dispatcher) = require_app_and_dispatcher(app, dispatcher)?;
            crate::commands::tool_dispatcher::dispatch(
                dispatcher,
                app,
                "tool:delete_sigil",
                serde_json::json!({
                    "sigil_path": sigil_path,
                    "abs_path": abs.to_string_lossy(),
                }),
                30,
            ).await
        }
        "write_vision" => {
            let content = input["content"].as_str().ok_or("Missing content")?.to_string();
            let (app, dispatcher) = require_app_and_dispatcher(app, dispatcher)?;
            crate::commands::tool_dispatcher::dispatch(
                dispatcher, app, "tool:write_vision",
                serde_json::json!({ "content": content }),
                30,
            ).await
        }
        "write_affordance" | "create_affordance" => {
            let raw = input["sigil_path"].as_str().ok_or("Missing sigil_path")?;
            let (sigil_path, abs) = resolve_sigil_arg(raw, editor_ctx)?;
            let prop_name = input["name"].as_str().ok_or("Missing name")?.to_string();
            let content = input["content"].as_str().unwrap_or("").to_string();
            let (app, dispatcher) = require_app_and_dispatcher(app, dispatcher)?;
            crate::commands::tool_dispatcher::dispatch(
                dispatcher, app, "tool:write_affordance",
                serde_json::json!({
                    "sigil_path": sigil_path,
                    "abs_path": abs.to_string_lossy(),
                    "name": prop_name,
                    "content": content,
                }),
                30,
            ).await
        }
        "delete_affordance" => {
            let raw = input["sigil_path"].as_str().ok_or("Missing sigil_path")?;
            let (sigil_path, abs) = resolve_sigil_arg(raw, editor_ctx)?;
            let prop_name = input["name"].as_str().ok_or("Missing name")?.to_string();
            let (app, dispatcher) = require_app_and_dispatcher(app, dispatcher)?;
            crate::commands::tool_dispatcher::dispatch(
                dispatcher, app, "tool:delete_affordance",
                serde_json::json!({
                    "sigil_path": sigil_path,
                    "abs_path": abs.to_string_lossy(),
                    "name": prop_name,
                }),
                30,
            ).await
        }
        "write_invariant" | "create_invariant" => {
            let raw = input["sigil_path"].as_str().ok_or("Missing sigil_path")?;
            let (sigil_path, abs) = resolve_sigil_arg(raw, editor_ctx)?;
            let prop_name = input["name"].as_str().ok_or("Missing name")?.to_string();
            let content = input["content"].as_str().unwrap_or("").to_string();
            let (app, dispatcher) = require_app_and_dispatcher(app, dispatcher)?;
            crate::commands::tool_dispatcher::dispatch(
                dispatcher, app, "tool:write_invariant",
                serde_json::json!({
                    "sigil_path": sigil_path,
                    "abs_path": abs.to_string_lossy(),
                    "name": prop_name,
                    "content": content,
                }),
                30,
            ).await
        }
        "delete_invariant" => {
            let raw = input["sigil_path"].as_str().ok_or("Missing sigil_path")?;
            let (sigil_path, abs) = resolve_sigil_arg(raw, editor_ctx)?;
            let prop_name = input["name"].as_str().ok_or("Missing name")?.to_string();
            let (app, dispatcher) = require_app_and_dispatcher(app, dispatcher)?;
            crate::commands::tool_dispatcher::dispatch(
                dispatcher, app, "tool:delete_invariant",
                serde_json::json!({
                    "sigil_path": sigil_path,
                    "abs_path": abs.to_string_lossy(),
                    "name": prop_name,
                }),
                30,
            ).await
        }
        "mark_placement" => {
            let raw = input["sigil_path"].as_str().ok_or("Missing sigil_path")?;
            let (sigil_path, abs) = resolve_sigil_arg(raw, editor_ctx)?;
            let category = input["category"].as_str().ok_or("Missing category")?.to_string();
            if !matches!(
                category.as_str(),
                "ontological" | "narrative-historical" | "provisional"
            ) {
                return Err(format!(
                    "Invalid category '{}'. Must be ontological, narrative-historical, or provisional.",
                    category
                ));
            }
            let (app, dispatcher) = require_app_and_dispatcher(app, dispatcher)?;
            crate::commands::tool_dispatcher::dispatch(
                dispatcher, app, "tool:mark_placement",
                serde_json::json!({
                    "sigil_path": sigil_path,
                    "abs_path": abs.to_string_lossy(),
                    "category": category,
                }),
                30,
            ).await
        }
        "browser_state_inspection" => {
            if let Some(ctx) = editor_ctx {
                let cp = ctx.current_path();
                let mut sigil_dir = Path::new(&ctx.root_path).to_path_buf();
                for seg in &cp {
                    sigil_dir = sigil_dir.join(seg);
                }
                let current_location = if cp.is_empty() {
                    "Root".to_string()
                } else {
                    cp.join(" > ")
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Build a workspace with one Scratch child sigil and return (tmp, ctx).
    fn workspace_with_scratch() -> (TempDir, EditorContext) {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::create_dir(root.join("Scratch")).unwrap();
        fs::write(root.join("Scratch/language.md"), "# Scratch\n\nA throwaway.\n").unwrap();
        let ctx = EditorContext::new(root.to_string_lossy().to_string(), Vec::new());
        (tmp, ctx)
    }

    // Happy-path deletion is now a frontend integration test — the tool
    // dispatches to the frontend's deleteSigil action instead of calling
    // the filesystem directly. These unit tests cover only the validation
    // that happens before dispatch.

    #[tokio::test]
    async fn delete_sigil_refuses_workspace_root() {
        let (tmp, ctx) = workspace_with_scratch();
        let input = serde_json::json!({ "sigil_path": "" });
        let result = execute_tool("delete_sigil", &input, None, Some(&ctx), None).await;
        assert!(result.is_err(), "empty path should be refused");
        assert!(tmp.path().exists(), "workspace root must remain");
    }

    #[tokio::test]
    async fn delete_sigil_refuses_parent_traversal() {
        let (tmp, ctx) = workspace_with_scratch();
        let input = serde_json::json!({ "sigil_path": "../escape" });
        let result = execute_tool("delete_sigil", &input, None, Some(&ctx), None).await;
        assert!(result.is_err(), "../ traversal should be refused");
        let _ = tmp;
    }

    #[tokio::test]
    async fn delete_sigil_returns_error_for_missing_sigil() {
        let (tmp, ctx) = workspace_with_scratch();
        let input = serde_json::json!({ "sigil_path": "DoesNotExist" });
        let result = execute_tool("delete_sigil", &input, None, Some(&ctx), None).await;
        assert!(result.is_err(), "missing sigil should be Err");
        let _ = tmp;
    }

    #[tokio::test]
    async fn delete_sigil_refuses_without_dispatcher() {
        let (tmp, ctx) = workspace_with_scratch();
        let input = serde_json::json!({ "sigil_path": "Scratch" });
        let result = execute_tool("delete_sigil", &input, None, Some(&ctx), None).await;
        assert!(result.is_err(), "no dispatcher means dispatch cannot route");
        let _ = tmp;
    }

    /// Build a workspace with two sigils whose `language.md` content is
    /// distinct, so any tool that targets the wrong one is immediately
    /// detectable from its output.
    fn workspace_with_two_sigils() -> (TempDir, EditorContext) {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::create_dir(root.join("Origin")).unwrap();
        fs::write(
            root.join("Origin/language.md"),
            "# Origin\n\nThe starting sigil.\n",
        )
        .unwrap();
        fs::create_dir(root.join("ToolAudit")).unwrap();
        fs::write(
            root.join("ToolAudit/language.md"),
            "# ToolAudit\n\nA disposable sigil for tool tests.\n",
        )
        .unwrap();
        let ctx = EditorContext::new(
            root.to_string_lossy().to_string(),
            vec!["Origin".to_string()],
        );
        (tmp, ctx)
    }

    /// replace_selected_text must NOT silently succeed. Before, it fired
    /// the event-and-forget path and returned "Text replaced" regardless
    /// of whether the frontend received the event, found a selection,
    /// applied the change, or persisted to disk. The model would call
    /// browser_state_inspection next and see the unchanged document.
    ///
    /// The dispatcher round-trip removed the silent path: the tool now
    /// refuses to run without an app handle and dispatcher, because
    /// without them the frontend cannot reply with a real outcome.
    #[tokio::test]
    async fn replace_selected_text_refuses_without_dispatcher() {
        let (tmp, ctx) = workspace_with_two_sigils();
        let result = execute_tool(
            "replace_selected_text",
            &serde_json::json!({ "text": "new" }),
            None,
            Some(&ctx),
            None,
        )
        .await;
        assert!(
            result.is_err(),
            "no dispatcher means the frontend cannot confirm — must Err, never silent Ok",
        );
        let _ = tmp;
    }

    #[tokio::test]
    async fn replace_selected_text_refuses_missing_text() {
        let (tmp, ctx) = workspace_with_two_sigils();
        let result = execute_tool(
            "replace_selected_text",
            &serde_json::json!({}),
            None,
            Some(&ctx),
            None,
        )
        .await;
        assert!(result.is_err(), "missing text param should be rejected");
        let _ = tmp;
    }

    /// Full SpaceLike→ToolAudit→replace flow. Pins the protocol invariant
    /// that ChatGPT reported as broken: after the navigate tool returns
    /// success, browser_state_inspection sees ToolAudit, select_text
    /// validates ToolAudit-only text, the persisted replacement is
    /// readable through browser_state_inspection, and the prior sigil
    /// (SpaceLike) is byte-for-byte untouched.
    ///
    /// This test simulates the contract the frontend handler upholds in
    /// production: it set_current_path's the navigated sigil (the
    /// confirmation step navigate runs after the dispatcher reply) and
    /// writes the new content to disk (the step the replace handler in
    /// LanguageEditor runs before its tool_result reply). What's tested
    /// here is exactly what those handlers must guarantee.
    #[tokio::test]
    async fn navigate_then_replace_isolates_to_target_sigil() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::create_dir(root.join("SpaceLike")).unwrap();
        let space_like_original = "# SpaceLike\n\nSpaceLike anchor sentence — must not be touched.\n";
        fs::write(root.join("SpaceLike/language.md"), space_like_original).unwrap();
        fs::create_dir(root.join("ToolAudit")).unwrap();
        let tool_audit_original =
            "# ToolAudit\n\nThis sentence will be replaced by the selection tool test.\n";
        fs::write(root.join("ToolAudit/language.md"), tool_audit_original).unwrap();

        // Open at SpaceLike — the prior-editor sigil in the bug report.
        let ctx = EditorContext::new(
            root.to_string_lossy().to_string(),
            vec!["SpaceLike".to_string()],
        );

        // Pre-condition: SpaceLike is what the active inspection reports.
        let pre = execute_tool(
            "browser_state_inspection",
            &serde_json::json!({}),
            None,
            Some(&ctx),
            None,
        )
        .await
        .unwrap();
        assert!(
            pre.contains("SpaceLike anchor sentence"),
            "pre-navigate inspection should target SpaceLike, got: {}",
            pre
        );

        // Confirmation step navigate runs after the frontend acks.
        ctx.set_current_path(vec!["ToolAudit".to_string()]);

        // browser_state_inspection now reports ToolAudit.
        let post_nav = execute_tool(
            "browser_state_inspection",
            &serde_json::json!({}),
            None,
            Some(&ctx),
            None,
        )
        .await
        .unwrap();
        assert!(
            post_nav.contains("This sentence will be replaced"),
            "after navigate, inspection should target ToolAudit, got: {}",
            post_nav
        );
        assert!(
            !post_nav.contains("SpaceLike anchor sentence"),
            "after navigate, inspection must not leak SpaceLike content, got: {}",
            post_nav
        );

        // select_text excerpt validation operates on the navigated sigil.
        let select_in_target = execute_tool(
            "select_text",
            &serde_json::json!({ "excerpt": "This sentence will be replaced by the selection tool test." }),
            None,
            Some(&ctx),
            None,
        )
        .await;
        assert!(
            select_in_target.is_ok(),
            "select_text excerpt from ToolAudit must validate, got: {:?}",
            select_in_target
        );
        let select_in_other = execute_tool(
            "select_text",
            &serde_json::json!({ "excerpt": "SpaceLike anchor sentence" }),
            None,
            Some(&ctx),
            None,
        )
        .await;
        assert!(
            select_in_other.is_err(),
            "SpaceLike-only excerpt must not validate after navigating away, got: {:?}",
            select_in_other
        );

        // Persistence step that the LanguageEditor frontend handler
        // runs before its tool_result reply: write the post-replace
        // content to the active sigil's language.md.
        let replacement = "Replaced by the selection tool test.";
        let new_target_content = tool_audit_original
            .replace(
                "This sentence will be replaced by the selection tool test.",
                replacement,
            );
        fs::write(root.join("ToolAudit/language.md"), &new_target_content).unwrap();

        // Readback through browser_state_inspection sees the replacement
        // and no longer sees the original sentence.
        let post_replace = execute_tool(
            "browser_state_inspection",
            &serde_json::json!({}),
            None,
            Some(&ctx),
            None,
        )
        .await
        .unwrap();
        assert!(
            post_replace.contains(replacement),
            "after replace, inspection must reflect the new sentence, got: {}",
            post_replace
        );
        assert!(
            !post_replace.contains("This sentence will be replaced by the selection tool test."),
            "after replace, the original sentence must be gone, got: {}",
            post_replace
        );

        // SpaceLike must be byte-for-byte untouched.
        let space_like_after =
            fs::read_to_string(root.join("SpaceLike/language.md")).unwrap();
        assert_eq!(
            space_like_after, space_like_original,
            "SpaceLike was modified by a tool flow targeting ToolAudit"
        );

        // Restore ToolAudit's original text per the acceptance brief so
        // the workspace is left in its starting state.
        fs::write(root.join("ToolAudit/language.md"), tool_audit_original).unwrap();
        let restored =
            fs::read_to_string(root.join("ToolAudit/language.md")).unwrap();
        assert_eq!(restored, tool_audit_original, "ToolAudit failed to restore");

        let _ = tmp;
    }

    /// Editor state must follow `set_current_path`. After the navigate tool
    /// confirms, it calls `ctx.set_current_path(target)`. Subsequent tools
    /// that read `ctx.current_path()` (browser_state_inspection,
    /// select_text excerpt validation) must observe the new path, not the
    /// prior one. Regression for the desync where these tools kept
    /// targeting the previously-open sigil after navigate succeeded.
    #[tokio::test]
    async fn navigated_path_is_visible_to_subsequent_tools() {
        let (tmp, ctx) = workspace_with_two_sigils();

        // Pre-condition: we are on Origin, browser inspection sees Origin.
        let pre = execute_tool(
            "browser_state_inspection",
            &serde_json::json!({}),
            None,
            Some(&ctx),
            None,
        )
        .await
        .expect("browser_state_inspection should succeed on Origin");
        assert!(
            pre.contains("Origin") && pre.contains("starting sigil"),
            "pre-navigate state should describe Origin, got: {}",
            pre
        );

        // Simulate the post-confirmation step the navigate tool performs.
        ctx.set_current_path(vec!["ToolAudit".to_string()]);

        // browser_state_inspection now sees ToolAudit, not Origin.
        let post = execute_tool(
            "browser_state_inspection",
            &serde_json::json!({}),
            None,
            Some(&ctx),
            None,
        )
        .await
        .expect("browser_state_inspection should succeed on ToolAudit");
        assert!(
            post.contains("ToolAudit") && post.contains("disposable sigil"),
            "post-navigate state should describe ToolAudit, got: {}",
            post
        );
        assert!(
            !post.contains("starting sigil"),
            "post-navigate state must not leak Origin's content, got: {}",
            post
        );

        // select_text excerpt validation reads from the navigated sigil.
        // An excerpt unique to ToolAudit must validate; one unique to
        // Origin must fail because the active sigil is no longer Origin.
        let select_audit = execute_tool(
            "select_text",
            &serde_json::json!({ "excerpt": "disposable sigil for tool tests" }),
            None,
            Some(&ctx),
            None,
        )
        .await;
        assert!(
            select_audit.is_ok(),
            "excerpt from ToolAudit should validate after navigate, got: {:?}",
            select_audit
        );

        let select_origin = execute_tool(
            "select_text",
            &serde_json::json!({ "excerpt": "The starting sigil." }),
            None,
            Some(&ctx),
            None,
        )
        .await;
        assert!(
            select_origin.is_err(),
            "excerpt from Origin must NOT validate after navigating away, got: {:?}",
            select_origin
        );

        let _ = tmp;
    }
}
