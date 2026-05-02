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
use crate::models::sigil::SigilFolder;

/// Recursively enumerate everything under `root` and append a relative
/// path string per file/dir to `entries`. Used by delete_sigil dry-run
/// so the agent can see exactly what bytes would be removed before
/// running the destructive op.
fn walk_for_preview(
    root: &Path,
    current: &Path,
    entries: &mut Vec<String>,
    total_bytes: &mut u64,
) {
    let read = match fs::read_dir(current) {
        Ok(rd) => rd,
        Err(_) => return,
    };
    for entry in read.flatten() {
        let path = entry.path();
        let rel = path
            .strip_prefix(root)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| path.to_string_lossy().to_string());
        if path.is_dir() {
            entries.push(format!("  {}/", rel));
            walk_for_preview(root, &path, entries, total_bytes);
        } else {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            *total_bytes += size;
            entries.push(format!("  {} ({} bytes)", rel, size));
        }
    }
}

/// Resolve a relative segment path against a sigil tree by walking
/// children whose `name` matches each segment in turn.
fn find_subtree<'a>(root: &'a SigilFolder, segments: &[&str]) -> Option<&'a SigilFolder> {
    let mut current = root;
    for seg in segments {
        let next = current.children.iter().find(|c| c.name == *seg)?;
        current = next;
    }
    Some(current)
}

/// Render a sigil subtree with optional depth and summary bounds.
///
/// `max_depth`: when Some(n), recursion stops at depth n — children at
/// depth n are listed by name only and their interiors are not expanded.
/// None recurses unconditionally.
///
/// `summary_only`: when true, omits the full language/invariant/affordance
/// text and emits only the structural skeleton — name, path, child
/// names, and counts. Useful for getting the shape without the volume.
fn render_context_bounded(
    ctx: &SigilFolder,
    depth: usize,
    max_depth: Option<usize>,
    summary_only: bool,
    output: &mut String,
) {
    let prefix = "#".repeat(depth + 2);
    output.push_str(&format!("{} {} (path: {})\n\n", prefix, ctx.name, ctx.path));
    if summary_only {
        output.push_str(&format!(
            "- {} affordances, {} invariants, {} children\n\n",
            ctx.affordances.len(),
            ctx.invariants.len(),
            ctx.children.iter().filter(|c| c.sigil_type.as_deref() != Some("implementation")).count(),
        ));
    } else {
        let detail_prefix = "#".repeat(depth + 3);
        output.push_str(&format!("{} Domain Language\n\n", detail_prefix));
        if ctx.language.trim().is_empty() {
            output.push_str("_empty_\n\n");
        } else {
            output.push_str(&ctx.language);
            output.push_str("\n\n");
        }
        output.push_str(&format!("{} Invariants\n\n", detail_prefix));
        if ctx.invariants.is_empty() {
            output.push_str("- none\n\n");
        } else {
            for inv in &ctx.invariants {
                output.push_str(&format!("- !{}: {}\n", inv.name, inv.content.trim()));
            }
            output.push('\n');
        }
        output.push_str(&format!("{} Affordances\n\n", detail_prefix));
        if ctx.affordances.is_empty() {
            output.push_str("- none\n\n");
        } else {
            for aff in &ctx.affordances {
                output.push_str(&format!("- #{}: {}\n", aff.name, aff.content.trim()));
            }
            output.push('\n');
        }
    }
    let visible_children: Vec<&SigilFolder> = ctx
        .children
        .iter()
        .filter(|c| c.sigil_type.as_deref() != Some("implementation"))
        .collect();
    let at_depth_limit = matches!(max_depth, Some(limit) if depth >= limit);
    if at_depth_limit {
        if !visible_children.is_empty() {
            let names: Vec<&str> = visible_children.iter().map(|c| c.name.as_str()).collect();
            output.push_str(&format!("Children (not expanded): {}\n\n", names.join(", ")));
        }
        return;
    }
    for child in &visible_children {
        render_context_bounded(child, depth + 1, max_depth, summary_only, output);
    }
}

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
            "name": "assert_active_editor",
            "description": "Assert that the active editor is at the expected sigil path. Use after navigate, or before any editor-local mutation, to fail loudly when the active editor has drifted from where you think you are. Returns success when the path matches; returns an error naming the actual path otherwise. This bypasses the noise of browser_state_inspection when all you need is a hard check.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "sigil_path": {
                        "type": "string",
                        "description": "Expected sigil path of the active editor. Use the empty string to assert the editor is at the workspace root."
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
            "description": "Read the sigil tree — vision, sigils, affordances, invariants, children. Defaults to the full tree from the workspace root, which can be noisy. Use `path` to scope to a subtree, `depth` to bound recursion, and `summary_only` to get just the structural skeleton (names and child names) without full content. These three combine: e.g. depth=1 + summary_only=true returns a one-page topographic overview.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "root_path": {
                        "type": "string",
                        "description": "Optional — omit to use the current workspace root."
                    },
                    "path": {
                        "type": "string",
                        "description": "Optional sigil path to scope the read to a subtree (e.g. 'DesignPartner/BicameralMind'). Omit or pass empty string to read from the workspace root."
                    },
                    "depth": {
                        "type": "integer",
                        "description": "Optional max recursion depth. 0 returns only the root sigil itself with no children expanded. 1 includes immediate children, and so on. Omit for unlimited."
                    },
                    "summary_only": {
                        "type": "boolean",
                        "description": "Optional. When true, returns only structural information: each sigil's name, path, child names, and counts of affordances/invariants — without the full language/affordance/invariant text. Useful for understanding shape before pulling content. Defaults to false."
                    }
                },
                "required": []
            }
        }),
        serde_json::json!({
            "name": "rename_sigil",
            "description": "Rename a sigil and update all @references across the entire sigil tree. Pass dry_run=true to preview the rename — confirms preconditions and reports source/target paths without mutating. Note: the preview cannot enumerate every @reference that would update because that scan happens frontend-side; use dry_run primarily to validate paths and the new_name before letting the rename run.",
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
                    },
                    "dry_run": {
                        "type": "boolean",
                        "description": "When true, validate preconditions (source exists, no sibling collision) and report the planned source/target paths without performing the rename."
                    }
                },
                "required": ["root_path", "sigil_path", "new_name"]
            }
        }),
        serde_json::json!({
            "name": "move_sigil",
            "description": "Move a sigil to a different parent. Interior stays intact. Pass dry_run=true to preview — confirms preconditions and reports the source and resulting paths without mutating.",
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
                    },
                    "dry_run": {
                        "type": "boolean",
                        "description": "When true, validate preconditions (source exists, parent exists, no name collision under new parent) and report the planned source/target paths without performing the move."
                    }
                },
                "required": ["root_path", "sigil_path", "new_parent_path"]
            }
        }),
        serde_json::json!({
            "name": "delete_sigil",
            "description": "Delete a sigil and all its children. Destructive. Pass dry_run=true to preview the files and directories that would be removed without mutating anything.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "sigil_path": {
                        "type": "string",
                        "description": "Sigil path relative to the workspace root (e.g. 'Scratch'). This sigil must exist."
                    },
                    "dry_run": {
                        "type": "boolean",
                        "description": "When true, validate target and list everything that would be deleted (files, child directories) without performing the delete. Use to confirm a destructive operation before letting it run."
                    }
                },
                "required": ["sigil_path"]
            }
        }),
        serde_json::json!({
            "name": "write_vision",
            "description": "Write or replace the vision statement (vision.md) at the sigil root. The vision is global and easy to clobber — pass dry_run=true to preview byte counts and the first lines of current and proposed content before letting the write run. Pass no_op_if_unchanged=true to skip the write entirely (and report so) if the proposed content equals what's already on disk.",
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
                    },
                    "dry_run": {
                        "type": "boolean",
                        "description": "When true, do not write — return a preview comparing current vision.md to the proposed content (byte counts, first line of each, change kind)."
                    },
                    "no_op_if_unchanged": {
                        "type": "boolean",
                        "description": "When true, the tool refuses to write if the proposed content is byte-identical to what's already on disk. Returns a no-op message instead. Defaults to false to preserve existing call shape."
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
        "assert_active_editor" => {
            let expected_raw = input["sigil_path"].as_str().ok_or("Missing sigil_path")?;
            let expected: Vec<String> = expected_raw
                .split('/')
                .filter(|s| !s.is_empty())
                .map(String::from)
                .collect();
            let ctx = editor_ctx.ok_or(
                "Editor context not available — cannot assert active editor",
            )?;
            let actual = ctx.current_path();
            if actual == expected {
                let label = if expected.is_empty() {
                    "workspace root".to_string()
                } else {
                    expected.join("/")
                };
                Ok(format!("Active editor is at {}.", label))
            } else {
                let actual_label = if actual.is_empty() {
                    "workspace root".to_string()
                } else {
                    actual.join("/")
                };
                let expected_label = if expected.is_empty() {
                    "workspace root".to_string()
                } else {
                    expected.join("/")
                };
                Err(format!(
                    "Active editor mismatch: expected {}, actual {}",
                    expected_label, actual_label
                ))
            }
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
            let scope_path = input
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim_matches('/');
            let max_depth = input
                .get("depth")
                .and_then(|v| v.as_u64())
                .map(|n| n as usize);
            let summary_only = input
                .get("summary_only")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let mut output = String::new();
            if scope_path.is_empty() {
                output.push_str(&format!("Sigil root: {}\n\n", root_path));
                if !summary_only {
                    output.push_str("# Vision\n\n");
                    output.push_str(&sigil.vision);
                    output.push_str("\n\n");
                }
                render_context_bounded(&sigil.root, 0, max_depth, summary_only, &mut output);
                // Imported ontologies are only included when the read is
                // unscoped, so a subtree request stays focused.
                if let Some(ref imported) = sigil.imported_ontologies {
                    output.push_str("\n\n");
                    render_context_bounded(imported, 0, max_depth, summary_only, &mut output);
                }
            } else {
                let segments: Vec<&str> = scope_path.split('/').filter(|s| !s.is_empty()).collect();
                let subtree = find_subtree(&sigil.root, &segments).ok_or_else(|| {
                    format!("Subtree path '{}' does not resolve in the sigil tree", scope_path)
                })?;
                output.push_str(&format!("Subtree: {}\n\n", scope_path));
                render_context_bounded(subtree, 0, max_depth, summary_only, &mut output);
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
            if input.get("dry_run").and_then(|v| v.as_bool()).unwrap_or(false) {
                let parent = abs.parent().ok_or("Source has no parent directory")?;
                let target = parent.join(&new_name);
                if target.exists() {
                    return Err(format!(
                        "DRY RUN: target name '{}' already exists at {} — rename would collide",
                        new_name, target.to_string_lossy()
                    ));
                }
                let target_sigil_path = if let Some(slash_idx) = sigil_path.rfind('/') {
                    format!("{}/{}", &sigil_path[..slash_idx], new_name)
                } else {
                    new_name.clone()
                };
                return Ok(format!(
                    "DRY RUN: would rename {} -> {}\n  source dir: {}\n  target dir: {}\n  Note: @reference updates across the tree fire frontend-side and are not enumerated here.",
                    sigil_path,
                    target_sigil_path,
                    abs.to_string_lossy(),
                    target.to_string_lossy()
                ));
            }
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
            if input.get("dry_run").and_then(|v| v.as_bool()).unwrap_or(false) {
                if !new_parent_abs.exists() && !new_parent_path.is_empty() {
                    return Err(format!(
                        "DRY RUN: new parent '{}' does not exist", new_parent_path
                    ));
                }
                let leaf = abs
                    .file_name()
                    .ok_or("Source has no leaf name")?
                    .to_string_lossy()
                    .to_string();
                let target_abs = new_parent_abs.join(&leaf);
                if target_abs.exists() {
                    return Err(format!(
                        "DRY RUN: target '{}' already exists at the new parent — move would collide",
                        target_abs.to_string_lossy()
                    ));
                }
                let target_sigil_path = if new_parent_path.is_empty() {
                    leaf.clone()
                } else {
                    format!("{}/{}", new_parent_path, leaf)
                };
                return Ok(format!(
                    "DRY RUN: would move {} -> {}\n  source dir: {}\n  target dir: {}\n  Note: @reference updates fire frontend-side and are not enumerated here.",
                    sigil_path,
                    target_sigil_path,
                    abs.to_string_lossy(),
                    target_abs.to_string_lossy()
                ));
            }
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
            if input.get("dry_run").and_then(|v| v.as_bool()).unwrap_or(false) {
                let mut entries: Vec<String> = Vec::new();
                let mut total_bytes: u64 = 0;
                walk_for_preview(&abs, &abs, &mut entries, &mut total_bytes);
                let preview = if entries.is_empty() {
                    "(empty directory)".to_string()
                } else {
                    entries.join("\n")
                };
                return Ok(format!(
                    "DRY RUN: would delete @{} ({} entries, {} bytes total)\n{}",
                    sigil_path,
                    entries.len(),
                    total_bytes,
                    preview
                ));
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
            let dry_run = input.get("dry_run").and_then(|v| v.as_bool()).unwrap_or(false);
            let no_op_if_unchanged = input
                .get("no_op_if_unchanged")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            // Read the current vision so dry_run can describe the diff
            // and no_op_if_unchanged can skip identical writes. Locating
            // vision.md uses the editor_ctx root since write_vision is
            // root-scoped.
            let root = editor_ctx
                .map(|c| c.root_path.as_str())
                .ok_or("No workspace root available for write_vision")?;
            let vision_path = Path::new(root).join("vision.md");
            let current = fs::read_to_string(&vision_path).unwrap_or_default();
            if no_op_if_unchanged && current == content && !dry_run {
                return Ok(format!(
                    "no-op: proposed vision.md is byte-identical to the existing one ({} bytes)",
                    content.len()
                ));
            }
            if dry_run {
                let first_line = |s: &str| s.lines().next().unwrap_or("(empty)").to_string();
                let kind = if current.is_empty() {
                    "create"
                } else if current == content {
                    "unchanged"
                } else {
                    "replace"
                };
                return Ok(format!(
                    "DRY RUN: would {} vision.md\n  current: {} bytes — first line: {}\n  proposed: {} bytes — first line: {}",
                    kind,
                    current.len(),
                    first_line(&current),
                    content.len(),
                    first_line(&content)
                ));
            }
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
                // Stale: the open buffer's path no longer resolves to a
                // real sigil. Typically caused by a previous tool —
                // rename_sigil, move_sigil, delete_sigil — mutating the
                // tree under the active editor. Surface this loudly so
                // the agent re-navigates instead of editing into a void.
                let dir_missing = !sigil_dir.exists();
                let lang_missing = !lang_file.exists();
                if dir_missing || lang_missing {
                    let reason = if dir_missing {
                        "the sigil directory no longer exists"
                    } else {
                        "the language.md file no longer exists"
                    };
                    return Ok(format!(
                        "Currently viewing: {} [BUFFER STALE — {}. The active editor's path was probably renamed, moved, or deleted by a prior tool. Re-navigate before further edits.]\n",
                        current_location, reason
                    ));
                }
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

    /// delete_sigil dry-run must enumerate the contents that would be
    /// removed, must NOT touch the filesystem, and must use the same
    /// validation chain as a real delete (so an invalid target — empty
    /// path, missing — fails the same way before any I/O).
    #[tokio::test]
    async fn delete_sigil_dry_run_enumerates_without_mutating() {
        let (tmp, ctx) = workspace_with_two_sigils();
        let root = tmp.path();
        // Add a child so the preview is non-trivial.
        fs::create_dir(root.join("ToolAudit/Inner")).unwrap();
        fs::write(root.join("ToolAudit/Inner/language.md"), "child\n").unwrap();
        let result = execute_tool(
            "delete_sigil",
            &serde_json::json!({ "sigil_path": "ToolAudit", "dry_run": true }),
            None,
            Some(&ctx),
            None,
        )
        .await
        .expect("dry_run should not need a dispatcher");
        assert!(result.contains("DRY RUN"));
        assert!(result.contains("ToolAudit"));
        assert!(result.contains("Inner"));
        assert!(result.contains("language.md"));
        // Disk untouched.
        assert!(root.join("ToolAudit").exists());
        assert!(root.join("ToolAudit/Inner/language.md").exists());
    }

    #[tokio::test]
    async fn rename_sigil_dry_run_reports_collision() {
        let (tmp, ctx) = workspace_with_two_sigils();
        // Try to rename Origin -> ToolAudit; ToolAudit already exists.
        let result = execute_tool(
            "rename_sigil",
            &serde_json::json!({
                "root_path": tmp.path().to_string_lossy().to_string(),
                "sigil_path": "Origin",
                "new_name": "ToolAudit",
                "dry_run": true,
            }),
            None,
            Some(&ctx),
            None,
        )
        .await;
        let err = result.expect_err("collision should fail dry-run");
        assert!(err.contains("DRY RUN"));
        assert!(err.contains("collide") || err.contains("already exists"));
    }

    #[tokio::test]
    async fn rename_sigil_dry_run_describes_clean_rename() {
        let (tmp, ctx) = workspace_with_two_sigils();
        let result = execute_tool(
            "rename_sigil",
            &serde_json::json!({
                "root_path": tmp.path().to_string_lossy().to_string(),
                "sigil_path": "Origin",
                "new_name": "OriginPrime",
                "dry_run": true,
            }),
            None,
            Some(&ctx),
            None,
        )
        .await
        .expect("clean rename dry-run should pass");
        assert!(result.contains("DRY RUN"));
        assert!(result.contains("Origin"));
        assert!(result.contains("OriginPrime"));
        // Disk untouched.
        assert!(tmp.path().join("Origin").exists());
        assert!(!tmp.path().join("OriginPrime").exists());
    }

    #[tokio::test]
    async fn move_sigil_dry_run_reports_planned_target() {
        let (tmp, ctx) = workspace_with_two_sigils();
        let result = execute_tool(
            "move_sigil",
            &serde_json::json!({
                "root_path": tmp.path().to_string_lossy().to_string(),
                "sigil_path": "Origin",
                "new_parent_path": "ToolAudit",
                "dry_run": true,
            }),
            None,
            Some(&ctx),
            None,
        )
        .await
        .expect("clean move dry-run should pass");
        assert!(result.contains("DRY RUN"));
        assert!(result.contains("ToolAudit/Origin"));
        // Disk untouched.
        assert!(tmp.path().join("Origin").exists());
        assert!(!tmp.path().join("ToolAudit/Origin").exists());
    }

    /// write_vision dry-run reports a diff summary; no_op_if_unchanged
    /// makes the tool refuse identical-content writes loudly. The
    /// vision.md path is global, so silent over-writes are particularly
    /// dangerous — these flags exist so the agent never clobbers the
    /// vision by accident during a write_vision audit.
    #[tokio::test]
    async fn write_vision_dry_run_reports_change_summary() {
        let (tmp, ctx) = workspace_with_two_sigils();
        fs::write(tmp.path().join("vision.md"), "# Vision\n\nOld vision.\n").unwrap();
        let result = execute_tool(
            "write_vision",
            &serde_json::json!({
                "root_path": tmp.path().to_string_lossy().to_string(),
                "content": "# Vision\n\nNew vision text.\n",
                "dry_run": true,
            }),
            None,
            Some(&ctx),
            None,
        )
        .await
        .expect("dry-run should not require a dispatcher");
        assert!(result.contains("DRY RUN"));
        assert!(result.contains("replace"));
        // Disk untouched.
        let on_disk = fs::read_to_string(tmp.path().join("vision.md")).unwrap();
        assert!(on_disk.contains("Old vision"));
    }

    #[tokio::test]
    async fn write_vision_no_op_skips_identical_content() {
        let (tmp, ctx) = workspace_with_two_sigils();
        let identical = "# Vision\n\nSame.\n";
        fs::write(tmp.path().join("vision.md"), identical).unwrap();
        let result = execute_tool(
            "write_vision",
            &serde_json::json!({
                "root_path": tmp.path().to_string_lossy().to_string(),
                "content": identical,
                "no_op_if_unchanged": true,
            }),
            None,
            Some(&ctx),
            None,
        )
        .await
        .expect("no-op path must not require a dispatcher");
        assert!(result.contains("no-op"));
        assert!(result.contains("byte-identical"));
    }

    /// read_tree's scoped/depth/summary modes give the audit agent a
    /// sharp tool: scope to a subtree, bound recursion, optionally
    /// drop content. Without these the agent has to fetch the whole
    /// spec to look at one branch.
    #[tokio::test]
    async fn read_tree_scopes_to_subtree() {
        let (_tmp, ctx) = workspace_with_two_sigils();
        let result = execute_tool(
            "read_tree",
            &serde_json::json!({ "path": "ToolAudit" }),
            None,
            Some(&ctx),
            None,
        )
        .await
        .expect("subtree read should succeed");
        assert!(result.contains("Subtree: ToolAudit"));
        assert!(result.contains("ToolAudit"));
        assert!(
            !result.contains("Origin"),
            "subtree read must not include sibling Origin's content, got: {}",
            result
        );
    }

    #[tokio::test]
    async fn read_tree_summary_only_omits_content() {
        let (tmp, ctx) = workspace_with_two_sigils();
        // Origin has a unique sentence that must be absent from summary.
        let result = execute_tool(
            "read_tree",
            &serde_json::json!({ "path": "Origin", "summary_only": true }),
            None,
            Some(&ctx),
            None,
        )
        .await
        .expect("summary read should succeed");
        assert!(result.contains("Origin"));
        assert!(result.contains("affordances"));
        assert!(
            !result.contains("The starting sigil"),
            "summary_only must omit language content, got: {}",
            result
        );
        let _ = tmp;
    }

    #[tokio::test]
    async fn read_tree_unknown_subtree_path_fails() {
        let (tmp, ctx) = workspace_with_two_sigils();
        let result = execute_tool(
            "read_tree",
            &serde_json::json!({ "path": "DoesNotExist" }),
            None,
            Some(&ctx),
            None,
        )
        .await;
        assert!(result.is_err(), "unknown path should fail loudly");
        let _ = tmp;
    }

    #[tokio::test]
    async fn assert_active_editor_passes_when_path_matches() {
        let (tmp, ctx) = workspace_with_two_sigils();
        let result = execute_tool(
            "assert_active_editor",
            &serde_json::json!({ "sigil_path": "Origin" }),
            None,
            Some(&ctx),
            None,
        )
        .await
        .expect("matching path should pass");
        assert!(result.contains("Origin"), "got: {}", result);
        let _ = tmp;
    }

    #[tokio::test]
    async fn assert_active_editor_fails_when_path_drifted() {
        let (tmp, ctx) = workspace_with_two_sigils();
        // ctx starts at Origin per workspace_with_two_sigils — assert
        // that asking for ToolAudit fails loudly, with both expected and
        // actual surfaced.
        let result = execute_tool(
            "assert_active_editor",
            &serde_json::json!({ "sigil_path": "ToolAudit" }),
            None,
            Some(&ctx),
            None,
        )
        .await;
        let err = result.expect_err("drifted path should fail");
        assert!(err.contains("ToolAudit") && err.contains("Origin"), "expected/actual must both appear, got: {}", err);
        let _ = tmp;
    }

    #[tokio::test]
    async fn assert_active_editor_workspace_root_uses_empty_path() {
        let (tmp, _) = workspace_with_two_sigils();
        let ctx = EditorContext::new(tmp.path().to_string_lossy().to_string(), Vec::new());
        let result = execute_tool(
            "assert_active_editor",
            &serde_json::json!({ "sigil_path": "" }),
            None,
            Some(&ctx),
            None,
        )
        .await
        .expect("empty path against root should pass");
        assert!(result.contains("workspace root"), "got: {}", result);
        let _ = tmp;
    }

    /// browser_state_inspection must announce stale state when the open
    /// sigil's path no longer resolves on disk. Typical cause: a prior
    /// tool (rename_sigil, move_sigil, delete_sigil) mutated the tree
    /// under the active editor. Without this signal the agent reads
    /// "(empty document)" and silently writes into a void.
    #[tokio::test]
    async fn browser_state_inspection_flags_stale_buffer_after_rename() {
        let (tmp, ctx) = workspace_with_two_sigils();
        // ctx is at Origin. Rename the directory underneath.
        fs::rename(tmp.path().join("Origin"), tmp.path().join("OriginRenamed")).unwrap();
        let out = execute_tool(
            "browser_state_inspection",
            &serde_json::json!({}),
            None,
            Some(&ctx),
            None,
        )
        .await
        .expect("inspection should still return a result, just a stale one");
        assert!(
            out.contains("BUFFER STALE"),
            "stale buffer must be flagged, got: {}",
            out
        );
        assert!(
            out.contains("Re-navigate"),
            "stale message should tell the agent how to recover, got: {}",
            out
        );
        let _ = tmp;
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
