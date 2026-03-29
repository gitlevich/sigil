use std::fs;
use std::path::Path;
use crate::commands::sigil::{create_context, rename_context};

/// Define the tools available to the AI agent
pub fn tool_definitions() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "name": "create_context",
            "description": "Create a new sub-context within a parent context. Creates the directory and an empty language.md file.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "parent_path": {
                        "type": "string",
                        "description": "Absolute path to the parent context directory"
                    },
                    "name": {
                        "type": "string",
                        "description": "Name for the new context (will become the directory name)"
                    }
                },
                "required": ["parent_path", "name"]
            }
        }),
        serde_json::json!({
            "name": "write_language",
            "description": "Write or replace the domain language (language.md) for a context.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "context_path": {
                        "type": "string",
                        "description": "Absolute path to the context directory"
                    },
                    "content": {
                        "type": "string",
                        "description": "The domain language content in markdown"
                    }
                },
                "required": ["context_path", "content"]
            }
        }),
        serde_json::json!({
            "name": "write_machinery",
            "description": "Write or replace the machinery (technical.md) for a context. Describes architectural choices, technology stack, design patterns.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "context_path": {
                        "type": "string",
                        "description": "Absolute path to the context directory"
                    },
                    "content": {
                        "type": "string",
                        "description": "The machinery content in markdown"
                    }
                },
                "required": ["context_path", "content"]
            }
        }),
        serde_json::json!({
            "name": "rename_context",
            "description": "Rename a context (renames its directory on disk).",
            "input_schema": {
                "type": "object",
                "properties": {
                    "context_path": {
                        "type": "string",
                        "description": "Absolute path to the context directory to rename"
                    },
                    "new_name": {
                        "type": "string",
                        "description": "The new name for the context"
                    }
                },
                "required": ["context_path", "new_name"]
            }
        }),
        serde_json::json!({
            "name": "read_context",
            "description": "Read the domain language and machinery of a specific context.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "context_path": {
                        "type": "string",
                        "description": "Absolute path to the context directory"
                    }
                },
                "required": ["context_path"]
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
                        "description": "The vision statement content in markdown"
                    }
                },
                "required": ["root_path", "content"]
            }
        }),
    ]
}

/// Execute a tool call and return the result as a string
pub fn execute_tool(name: &str, input: &serde_json::Value) -> Result<String, String> {
    match name {
        "create_context" => {
            let parent_path = input["parent_path"].as_str().ok_or("Missing parent_path")?;
            let ctx_name = input["name"].as_str().ok_or("Missing name")?;
            let ctx = create_context(parent_path.to_string(), ctx_name.to_string())?;
            Ok(format!("Created context '{}' at {}", ctx.name, ctx.path))
        }
        "write_language" => {
            let ctx_path = input["context_path"].as_str().ok_or("Missing context_path")?;
            let content = input["content"].as_str().ok_or("Missing content")?;
            let file_path = Path::new(ctx_path).join("language.md");
            fs::write(&file_path, content).map_err(|e| e.to_string())?;
            Ok(format!("Wrote language.md at {}", ctx_path))
        }
        "write_machinery" => {
            let ctx_path = input["context_path"].as_str().ok_or("Missing context_path")?;
            let content = input["content"].as_str().ok_or("Missing content")?;
            let file_path = Path::new(ctx_path).join("technical.md");
            fs::write(&file_path, content).map_err(|e| e.to_string())?;
            Ok(format!("Wrote technical.md at {}", ctx_path))
        }
        "rename_context" => {
            let ctx_path = input["context_path"].as_str().ok_or("Missing context_path")?;
            let new_name = input["new_name"].as_str().ok_or("Missing new_name")?;
            let new_path = rename_context(ctx_path.to_string(), new_name.to_string())?;
            Ok(format!("Renamed to '{}' at {}", new_name, new_path))
        }
        "read_context" => {
            let ctx_path = input["context_path"].as_str().ok_or("Missing context_path")?;
            let lang_path = Path::new(ctx_path).join("language.md");
            let tech_path = Path::new(ctx_path).join("technical.md");
            let language = fs::read_to_string(&lang_path).unwrap_or_default();
            let machinery = if tech_path.exists() {
                fs::read_to_string(&tech_path).unwrap_or_default()
            } else {
                String::from("(none)")
            };
            Ok(format!("## Language\n\n{}\n\n## Machinery\n\n{}", language, machinery))
        }
        "write_vision" => {
            let root_path = input["root_path"].as_str().ok_or("Missing root_path")?;
            let content = input["content"].as_str().ok_or("Missing content")?;
            let file_path = Path::new(root_path).join("vision.md");
            fs::write(&file_path, content).map_err(|e| e.to_string())?;
            Ok(format!("Wrote vision.md at {}", root_path))
        }
        _ => Err(format!("Unknown tool: {}", name)),
    }
}
