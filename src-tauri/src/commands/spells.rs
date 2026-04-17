use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};

/// A Spell manifest stored as JSON in the workspace's .private/spells/ directory.
/// The Subconscious loads these at startup and consults them for each Disturbance.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellManifest {
    pub name: String,
    pub situation: String,
    #[serde(rename = "match")]
    pub match_rule: serde_json::Value,
    pub actions: Vec<serde_json::Value>,
}

/// List all Spell manifests found in the workspace's .private/spells/ directory.
/// Returns an empty list if the directory does not exist.
#[tauri::command]
pub fn list_spells(root_path: String) -> Result<Vec<SpellManifest>, String> {
    let spells_dir = Path::new(&root_path).join(".private").join("spells");
    if !spells_dir.exists() {
        return Ok(Vec::new());
    }

    let mut manifests: Vec<SpellManifest> = Vec::new();
    for entry in fs::read_dir(&spells_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        match serde_json::from_str::<SpellManifest>(&content) {
            Ok(manifest) => manifests.push(manifest),
            Err(e) => {
                // Skip malformed spells without blocking the rest.
                eprintln!("spell manifest {:?} failed to parse: {}", path, e);
            }
        }
    }
    // Stable order by name so spellbook iteration is deterministic.
    manifests.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(manifests)
}
