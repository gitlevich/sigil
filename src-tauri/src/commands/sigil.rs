use std::fs;
use std::path::Path;
use regex::Regex;
use tauri::{AppHandle, Manager};
use crate::commands::workspace_lock::WorkspaceLock;
use serde::Serialize;
use crate::models::sigil::{Context, Invariant, Sigil};

#[derive(Serialize)]
pub struct OntologyStatus {
    pub name: String,
    pub status: String, // "new", "modified", "current"
}

/// Returns the path to the domain language file in a context directory.
/// Prefers language.md but falls back to spec.md for backward compatibility.
fn language_file(dir: &Path) -> std::path::PathBuf {
    let lang = dir.join("language.md");
    if lang.exists() {
        return lang;
    }
    let spec = dir.join("spec.md");
    if spec.exists() {
        return spec;
    }
    lang // default to language.md for new contexts
}

/// Returns true if the directory is a valid context (has language.md or spec.md).
fn is_context_dir(dir: &Path) -> bool {
    dir.join("language.md").exists() || dir.join("spec.md").exists()
}


fn read_context(dir: &Path, is_imported: bool) -> Result<Context, String> {
    use crate::models::sigil::Affordance;

    let name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    let domain_language = fs::read_to_string(&language_file(dir))
        .unwrap_or_default();

    // Detect image files: image.ext, image-1.ext, image-2.ext, ...
    let image_extensions = ["jpg", "jpeg", "png", "gif", "svg", "webp"];
    let mut images = Vec::new();
    for ext in &image_extensions {
        let base = dir.join(format!("image.{}", ext));
        if base.is_file() {
            images.push(base.to_string_lossy().to_string());
        }
        for n in 1..=20 {
            let numbered = dir.join(format!("image-{}.{}", n, ext));
            if numbered.is_file() {
                images.push(numbered.to_string_lossy().to_string());
            }
        }
    }
    images.sort();

    let mut affordances = Vec::new();
    let mut invariants = Vec::new();
    let mut children = Vec::new();

    if let Ok(entries) = fs::read_dir(dir) {
        let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
        entries.sort_by_key(|e| e.file_name());

        for entry in entries {
            let path = entry.path();
            if path.is_file() {
                if let Some(fname) = path.file_name().and_then(|n| n.to_str()) {
                    if let Some(aff_name) = fname.strip_prefix("affordance-").and_then(|s| s.strip_suffix(".md")) {
                        let content = fs::read_to_string(&path).unwrap_or_default();
                        affordances.push(Affordance { name: aff_name.to_string(), content });
                    } else if let Some(sig_name) = fname.strip_prefix("invariant-").and_then(|s| s.strip_suffix(".md")) {
                        let content = fs::read_to_string(&path).unwrap_or_default();
                        invariants.push(Invariant { name: sig_name.to_string(), content });
                    }
                }
            } else if path.is_dir() {
                if path.file_name().and_then(|n| n.to_str()).map(|n| n.starts_with('.')).unwrap_or(true) {
                    continue;
                }
                if is_context_dir(&path) {
                    children.push(read_context(&path, is_imported)?);
                }
            }
        }
    }

    Ok(Context {
        name,
        path: dir.to_string_lossy().to_string(),
        domain_language,
        affordances,
        invariants,
        children,
        images,
        is_imported,
    })
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("Failed to create {}: {e}", dst.display()))?;
    for entry in fs::read_dir(src).map_err(|e| format!("Failed to read {}: {e}", src.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("Failed to copy {}: {e}", src_path.display()))?;
        }
    }
    Ok(())
}

/// Create a new sigil directory with vision.md, language.md, and a copy of Libs.
#[tauri::command]
pub fn scaffold_sigil(app: AppHandle, root_path: String) -> Result<(), String> {
    let root = Path::new(&root_path);
    fs::create_dir_all(root).map_err(|e| format!("Failed to create sigil directory: {e}"))?;
    fs::write(root.join("vision.md"), "").map_err(|e| e.to_string())?;
    fs::write(root.join("language.md"), "").map_err(|e| e.to_string())?;

    // Copy bundled Libs as a template
    if let Some(libs_src) = app.path().resource_dir().ok().map(|r| r.join("Libs")).filter(|p| p.exists()) {
        let libs_dst = root.join("Libs");
        copy_dir_recursive(&libs_src, &libs_dst)?;
    }

    Ok(())
}

/// Check which bundled ontologies need installing/updating.
#[tauri::command]
pub fn check_imported_ontologies(app: AppHandle, root_path: String) -> Result<Vec<OntologyStatus>, String> {
    let root = Path::new(&root_path);
    let libs_dst = root.join("Libs");
    let libs_src = app.path().resource_dir()
        .ok()
        .map(|r| r.join("Libs"))
        .filter(|p| p.exists())
        .ok_or("Bundled ontology library not found.")?;

    let mut statuses = Vec::new();
    for entry in fs::read_dir(&libs_src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.path().is_dir() { continue; }
        let name = entry.file_name().to_string_lossy().to_string();
        let local = libs_dst.join(&name);
        let status = if !local.exists() {
            "new"
        } else if dir_contents_differ(&entry.path(), &local) {
            "modified"
        } else {
            "current"
        };
        statuses.push(OntologyStatus { name, status: status.to_string() });
    }
    Ok(statuses)
}

fn dir_contents_differ(a: &Path, b: &Path) -> bool {
    let read_files = |dir: &Path| -> Vec<(String, Vec<u8>)> {
        let mut files = Vec::new();
        for e in walkdir::WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
            if e.file_type().is_file() {
                let rel = e.path().strip_prefix(dir).unwrap_or(e.path()).to_string_lossy().to_string();
                if let Ok(content) = fs::read(e.path()) {
                    files.push((rel, content));
                }
            }
        }
        files.sort_by(|a, b| a.0.cmp(&b.0));
        files
    };
    read_files(a) != read_files(b)
}

/// Install specific ontologies from the bundled Libs.
#[tauri::command]
pub fn install_ontologies(app: AppHandle, root_path: String, names: Vec<String>, overwrite: bool) -> Result<(), String> {
    let root = Path::new(&root_path);
    let libs_dst = root.join("Libs");
    let libs_src = app.path().resource_dir()
        .ok()
        .map(|r| r.join("Libs"))
        .filter(|p| p.exists())
        .ok_or("Bundled ontology library not found.")?;

    // Ensure Libs dir exists and has the scaffolding files
    if !libs_dst.exists() {
        fs::create_dir_all(&libs_dst).map_err(|e| e.to_string())?;
        // Copy top-level files from bundled Libs (language.md, affordances, invariants)
        for entry in fs::read_dir(&libs_src).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.path().is_file() {
                fs::copy(entry.path(), libs_dst.join(entry.file_name())).map_err(|e| e.to_string())?;
            }
        }
    }

    for name in &names {
        let src = libs_src.join(name);
        let dst = libs_dst.join(name);
        if !src.exists() { continue; }
        if dst.exists() && overwrite {
            fs::remove_dir_all(&dst).map_err(|e| e.to_string())?;
        }
        if !dst.exists() {
            copy_dir_recursive(&src, &dst)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn read_sigil(app: AppHandle, root_path: String) -> Result<Sigil, String> {
    let lock_state = app.state::<WorkspaceLock>();
    // Release any previous workspace lock before acquiring a new one
    super::workspace_lock::release(&lock_state);
    let lock_file = super::workspace_lock::acquire(&root_path)?;
    lock_state.0.lock().expect("WorkspaceLock mutex poisoned").replace(lock_file);

    read_sigil_with_libs(root_path)
}

pub fn read_sigil_with_libs(root_path: String) -> Result<Sigil, String> {
    let root = Path::new(&root_path);
    if !root.exists() {
        return Err(format!("Path does not exist: {}", root_path));
    }

    let vision_path = root.join("vision.md");
    let vision = fs::read_to_string(&vision_path).unwrap_or_default();

    let context = read_context(root, false)?;

    // Mount imported ontologies from Libs inside the sigil root, or sibling Libs
    let imported_ontologies = Some(root.join("Libs"))
        .filter(|p| p.exists())
        .or_else(|| root.parent().map(|p| p.join("Libs")))
        .and_then(|libs_dir| {
            if libs_dir.exists() && libs_dir.is_dir() {
                let mut imported = read_context(&libs_dir, true).ok()?;
                imported.name = "Imported Ontologies".to_string();
                Some(imported)
            } else {
                None
            }
        });

    Ok(Sigil {
        name: context.name.clone(),
        root_path: root_path.clone(),
        vision,
        root: context,
        imported_ontologies,
    })
}

#[tauri::command]
pub fn create_context(parent_path: String, name: String) -> Result<Context, String> {
    let parent = Path::new(&parent_path);

    // 5-child limit applies to all user-created contexts.
    {
        let existing_dirs: Vec<_> = fs::read_dir(parent)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .filter(|e| is_context_dir(&e.path()))
            .collect();

        if existing_dirs.len() >= 5 {
            return Err("Maximum of 5 sub-contexts reached".to_string());
        }
    }

    let context_path = parent.join(&name);
    if context_path.exists() {
        return Err(format!("Context '{}' already exists", name));
    }

    fs::create_dir(&context_path).map_err(|e| e.to_string())?;
    fs::write(context_path.join("language.md"), "").map_err(|e| e.to_string())?;

    Ok(Context {
        name,
        path: context_path.to_string_lossy().to_string(),
        domain_language: String::new(),
        affordances: Vec::new(),
        invariants: Vec::new(),
        children: Vec::new(),
        images: Vec::new(),
        is_imported: false,
    })
}

#[tauri::command]
pub fn rename_context(root_path: String, path: String, new_name: String) -> Result<String, String> {
    let old_path = Path::new(&path);
    let old_name = old_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Cannot determine current name".to_string())?
        .to_string();
    let parent = old_path
        .parent()
        .ok_or_else(|| "Cannot rename root".to_string())?;
    let new_path = parent.join(&new_name);

    let case_only = old_name.to_lowercase() == new_name.to_lowercase();
    if !case_only && new_path.exists() {
        return Err(format!("A context named '{}' already exists", new_name));
    }

    if case_only {
        let tmp_path = parent.join(format!("__rename_tmp_{}", old_name));
        fs::rename(old_path, &tmp_path).map_err(|e| e.to_string())?;
        fs::rename(&tmp_path, &new_path).map_err(|e| e.to_string())?;
    } else {
        fs::rename(old_path, &new_path).map_err(|e| e.to_string())?;
    }

    let root = Path::new(&root_path);
    update_references(root, &old_name, &new_name)?;

    Ok(new_path.to_string_lossy().to_string())
}

/// Build all grammatical variants of a name for matching/replacement.
/// Returns pairs of (variant, replacement) preserving the grammatical form.
fn name_variants(old_name: &str, new_name: &str) -> Vec<(String, String)> {
    let mut pairs = Vec::new();

    // Exact form
    pairs.push((old_name.to_string(), new_name.to_string()));

    // Lowercase form
    let old_lower = old_name.to_lowercase();
    let new_lower = new_name.to_lowercase();
    if old_lower != old_name {
        pairs.push((old_lower.clone(), new_lower.clone()));
    }

    // Simple plural: add "s"
    pairs.push((format!("{}s", old_name), format!("{}s", new_name)));
    if old_lower != old_name {
        pairs.push((format!("{}s", old_lower), format!("{}s", new_lower)));
    }

    // -y → -ies plural (e.g. Strategy → Strategies)
    if old_name.ends_with('y') || old_name.ends_with('Y') {
        let old_stem = &old_name[..old_name.len() - 1];
        let old_suffix = if old_name.ends_with('Y') { "IES" } else { "ies" };
        let old_ies = format!("{}{}", old_stem, old_suffix);

        // New form depends on whether new_name also ends in y
        let new_ies = if new_name.ends_with('y') || new_name.ends_with('Y') {
            let new_stem = &new_name[..new_name.len() - 1];
            let new_suffix = if new_name.ends_with('Y') { "IES" } else { "ies" };
            format!("{}{}", new_stem, new_suffix)
        } else {
            // New name doesn't end in y, so plural is just +s
            format!("{}s", new_name)
        };
        pairs.push((old_ies, new_ies));

        // Lowercase variant
        let old_lower_stem = &old_lower[..old_lower.len() - 1];
        let old_lower_ies = format!("{}ies", old_lower_stem);
        let new_lower_ies = if new_lower.ends_with('y') {
            let new_lower_stem = &new_lower[..new_lower.len() - 1];
            format!("{}ies", new_lower_stem)
        } else {
            format!("{}s", new_lower)
        };
        pairs.push((old_lower_ies, new_lower_ies));
    }

    // Deduplicate while preserving order
    let mut seen = std::collections::HashSet::new();
    pairs.retain(|(old, _)| seen.insert(old.clone()));

    // Sort longest first so longer matches are tried before shorter ones
    pairs.sort_by(|a, b| b.0.len().cmp(&a.0.len()));

    pairs
}

/// Replace sigil name references within file content.
/// Handles:
///   - `@OldName` → `@NewName` and plural/case variants
///   - Multi-segment refs like `@Lib@OldName` → `@Lib@NewName`
///   - Exact heading lines: `## OldName` → `## NewName`
fn replace_references(content: &str, old_name: &str, new_name: &str) -> String {
    let variants = name_variants(old_name, new_name);

    // Build a regex that matches @-references containing any variant.
    // Pattern: @(Segment@)*Variant followed by word boundary or @/# continuation.
    // We capture the trailing char to check it's not a continuation of the name.
    let variant_alts: Vec<String> = variants.iter().map(|(old, _)| regex::escape(old)).collect();
    let pattern_str = format!(
        r"(@(?:[a-zA-Z_][\w-]*@)*(?:{}))([^a-zA-Z0-9_]|$)",
        variant_alts.join("|")
    );
    let re = Regex::new(&pattern_str).unwrap();

    let lines: Vec<String> = content.lines().map(|line| {
        // Replace @-references
        let line = re.replace_all(line, |caps: &regex::Captures| {
            let matched = caps[1].to_string();
            let trail = &caps[2];
            // Find which variant matched at the end of the ref
            for (old_var, new_var) in &variants {
                if matched.ends_with(old_var.as_str()) {
                    let prefix = &matched[..matched.len() - old_var.len()];
                    return format!("{}{}{}", prefix, new_var, trail);
                }
            }
            format!("{}{}", matched, trail)
        }).to_string();

        // Replace heading lines
        for depth in 1usize..=6 {
            let hashes = "#".repeat(depth);
            for (old_var, new_var) in &variants {
                if line.trim_end() == format!("{} {}", hashes, old_var) {
                    return format!("{} {}", hashes, new_var);
                }
            }
        }
        line
    }).collect();

    let mut result = lines.join("\n");
    if content.ends_with('\n') {
        result.push('\n');
    }
    result
}

/// Walk all text files under root and replace old_name with new_name everywhere.
/// Also renames any sub-directories that match old_name (except the root itself).
fn update_references(root: &Path, old_name: &str, new_name: &str) -> Result<usize, String> {
    let mut count = 0;

    // First pass: replace references in all readable files
    for entry in walkdir::WalkDir::new(root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
    {
        let path = entry.path();
        // Skip binary files and hidden files
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if !matches!(ext, "md" | "json" | "txt" | "") {
            continue;
        }
        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let updated = replace_references(&content, old_name, new_name);
        if updated != content {
            fs::write(path, &updated).map_err(|e| e.to_string())?;
            count += 1;
        }
    }

    // Second pass: rename sub-directories matching old_name (bottom-up to avoid path issues)
    let mut dirs_to_rename: Vec<std::path::PathBuf> = Vec::new();
    for entry in walkdir::WalkDir::new(root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir() && e.path() != root)
    {
        if entry.file_name().to_str() == Some(old_name) {
            dirs_to_rename.push(entry.path().to_path_buf());
        }
    }
    // Rename deepest first
    let case_only = old_name.to_lowercase() == new_name.to_lowercase();
    dirs_to_rename.sort_by(|a, b| b.components().count().cmp(&a.components().count()));
    for dir in dirs_to_rename {
        let parent = dir.parent().unwrap();
        let new_dir = parent.join(new_name);
        if case_only {
            let tmp = parent.join(format!("__rename_tmp_{}", old_name));
            fs::rename(&dir, &tmp).map_err(|e| e.to_string())?;
            fs::rename(&tmp, &new_dir).map_err(|e| e.to_string())?;
        } else if !new_dir.exists() {
            fs::rename(&dir, &new_dir).map_err(|e| e.to_string())?;
        }
    }

    Ok(count)
}

#[tauri::command]
pub fn rename_sigil(root_path: String, path: String, new_name: String) -> Result<String, String> {
    let old_path = Path::new(&path);
    let old_name = old_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Cannot determine current name".to_string())?
        .to_string();

    let parent = old_path
        .parent()
        .ok_or_else(|| "Cannot rename root".to_string())?;
    let new_path = parent.join(&new_name);

    let case_only = old_name.to_lowercase() == new_name.to_lowercase();
    if !case_only && new_path.exists() {
        return Err(format!("A context named '{}' already exists", new_name));
    }

    if case_only {
        let tmp_path = parent.join(format!("__rename_tmp_{}", old_name));
        fs::rename(old_path, &tmp_path).map_err(|e| e.to_string())?;
        fs::rename(&tmp_path, &new_path).map_err(|e| e.to_string())?;
    } else {
        fs::rename(old_path, &new_path).map_err(|e| e.to_string())?;
    }

    let root = Path::new(&root_path);
    let files_updated = update_references(root, &old_name, &new_name)?;

    Ok(serde_json::json!({
        "new_path": new_path.to_string_lossy(),
        "files_updated": files_updated,
    }).to_string())
}

#[tauri::command]
pub fn move_sigil(root_path: String, path: String, new_parent_path: String) -> Result<String, String> {
    let old_path = Path::new(&path);
    let name = old_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Cannot determine name".to_string())?
        .to_string();

    let new_parent = Path::new(&new_parent_path);
    if !new_parent.exists() {
        return Err("Target parent does not exist".to_string());
    }

    // Imported ontologies (outside root_path) are exempt from the 5-child limit.
    let root = Path::new(&root_path);
    let under_imported = !new_parent.starts_with(root);

    // Check 5-sigil limit at destination
    if !under_imported {
        let existing_dirs: Vec<_> = fs::read_dir(new_parent)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .filter(|e| is_context_dir(&e.path()))
            .collect();

        if existing_dirs.len() >= 5 {
            return Err("Target already has 5 sub-contexts".to_string());
        }
    }

    let new_path = new_parent.join(&name);
    if new_path.exists() {
        return Err(format!("A context named '{}' already exists at the target", name));
    }

    fs::rename(old_path, &new_path).map_err(|e| e.to_string())?;

    Ok(new_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn delete_context(path: String) -> Result<(), String> {
    let context_path = Path::new(&path);
    if !context_path.exists() {
        return Err("Context does not exist".to_string());
    }
    fs::remove_dir_all(context_path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup_sigil(tmp: &TempDir) -> String {
        let root = tmp.path().join("MyApp");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("vision.md"), "Build the best app").unwrap();
        fs::write(root.join("language.md"), "# MyApp\nRoot domain language").unwrap();

        let auth = root.join("Auth");
        fs::create_dir(&auth).unwrap();
        fs::write(auth.join("language.md"), "Auth handles login").unwrap();

        let billing = root.join("Billing");
        fs::create_dir(&billing).unwrap();
        fs::write(billing.join("language.md"), "Billing handles payments").unwrap();

        root.to_string_lossy().to_string()
    }

    #[test]
    fn test_read_sigil() {
        let tmp = TempDir::new().unwrap();
        let root_path = setup_sigil(&tmp);

        let sigil = read_sigil_with_libs(root_path).unwrap();

        assert_eq!(sigil.name, "MyApp");
        assert_eq!(sigil.vision, "Build the best app");
        assert_eq!(sigil.root.domain_language, "# MyApp\nRoot domain language");
        assert_eq!(sigil.root.children.len(), 2);

        let names: Vec<&str> = sigil.root.children.iter().map(|c| c.name.as_str()).collect();
        assert!(names.contains(&"Auth"));
        assert!(names.contains(&"Billing"));
    }

    #[test]
    fn test_read_sigil_nonexistent() {
        let result = read_sigil("/nonexistent/path".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn test_create_context() {
        let tmp = TempDir::new().unwrap();
        let root_path = setup_sigil(&tmp);

        let ctx = create_context(root_path.clone(), "Notifications".to_string()).unwrap();
        assert_eq!(ctx.name, "Notifications");
        assert!(ctx.domain_language.is_empty());
        assert!(ctx.children.is_empty());

        let lang_path = Path::new(&root_path).join("Notifications/language.md");
        assert!(lang_path.exists());
    }

    #[test]
    fn test_create_context_duplicate() {
        let tmp = TempDir::new().unwrap();
        let root_path = setup_sigil(&tmp);

        let result = create_context(root_path, "Auth".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
    }

    #[test]
    fn test_create_context_max_five() {
        let tmp = TempDir::new().unwrap();
        let root_path = setup_sigil(&tmp);

        create_context(root_path.clone(), "C".to_string()).unwrap();
        create_context(root_path.clone(), "D".to_string()).unwrap();
        create_context(root_path.clone(), "E".to_string()).unwrap();

        let result = create_context(root_path, "F".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Maximum of 5"));
    }

    #[test]
    fn test_rename_context() {
        let tmp = TempDir::new().unwrap();
        let root_path = setup_sigil(&tmp);
        let auth_path = format!("{}/Auth", root_path);

        let new_path = rename_context(root_path.clone(), auth_path.clone(), "Authentication".to_string()).unwrap();
        assert!(new_path.ends_with("Authentication"));
        assert!(!Path::new(&auth_path).exists());
        assert!(Path::new(&new_path).exists());
        assert!(Path::new(&new_path).join("language.md").exists());
    }

    #[test]
    fn test_replace_references_at_ref() {
        let content = "Use @Coherence to model this.\nAlso see @Coherence#track.\n";
        let result = replace_references(content, "Coherence", "Alignment");
        assert_eq!(result, "Use @Alignment to model this.\nAlso see @Alignment#track.\n");
    }

    #[test]
    fn test_replace_references_exact_heading() {
        let content = "## Coherence\n\nSome text.\n";
        let result = replace_references(content, "Coherence", "Alignment");
        assert_eq!(result, "## Alignment\n\nSome text.\n");
    }

    #[test]
    fn test_replace_references_no_substring_match() {
        // "Coherence" inside "Semantic Coherence" heading must not be replaced
        let content = "## Semantic Coherence\n\nSee @Coherence for basics.\n";
        let result = replace_references(content, "Coherence", "Alignment");
        assert_eq!(result, "## Semantic Coherence\n\nSee @Alignment for basics.\n");
    }

    #[test]
    fn test_replace_references_free_text_unchanged() {
        // Plain text mentions without @ are not replaced
        let content = "Coherence is important here.\n";
        let result = replace_references(content, "Coherence", "Alignment");
        assert_eq!(result, "Coherence is important here.\n");
    }

    #[test]
    fn test_rename_context_conflict() {
        let tmp = TempDir::new().unwrap();
        let root_path = setup_sigil(&tmp);
        let auth_path = format!("{}/Auth", root_path);

        let result = rename_context(root_path.clone(), auth_path, "Billing".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
    }

    #[test]
    fn test_delete_context() {
        let tmp = TempDir::new().unwrap();
        let root_path = setup_sigil(&tmp);
        let auth_path = format!("{}/Auth", root_path);

        delete_context(auth_path.clone()).unwrap();
        assert!(!Path::new(&auth_path).exists());
    }

    #[test]
    fn test_delete_context_nonexistent() {
        let result = delete_context("/nonexistent/path".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn test_read_sigil_ignores_hidden_dirs() {
        let tmp = TempDir::new().unwrap();
        let root_path = setup_sigil(&tmp);

        let hidden = Path::new(&root_path).join(".git");
        fs::create_dir(&hidden).unwrap();
        fs::write(hidden.join("language.md"), "should be ignored").unwrap();

        let sigil = read_sigil_with_libs(root_path).unwrap();
        let names: Vec<&str> = sigil.root.children.iter().map(|c| c.name.as_str()).collect();
        assert!(!names.contains(&".git"));
    }

    #[test]
    fn test_read_sigil_ignores_dirs_without_language() {
        let tmp = TempDir::new().unwrap();
        let root_path = setup_sigil(&tmp);

        let random_dir = Path::new(&root_path).join("random");
        fs::create_dir(&random_dir).unwrap();

        let sigil = read_sigil_with_libs(root_path).unwrap();
        let names: Vec<&str> = sigil.root.children.iter().map(|c| c.name.as_str()).collect();
        assert!(!names.contains(&"random"));
    }

    #[test]
    fn test_read_sigil_with_legacy_spec_md() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("Legacy");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("vision.md"), "Legacy vision").unwrap();
        fs::write(root.join("spec.md"), "Legacy root content").unwrap();

        let child = root.join("OldChild");
        fs::create_dir(&child).unwrap();
        fs::write(child.join("spec.md"), "Old child content").unwrap();

        let sigil = read_sigil(root.to_string_lossy().to_string()).unwrap();
        assert_eq!(sigil.root.domain_language, "Legacy root content");
        assert_eq!(sigil.root.children.len(), 1);
        assert_eq!(sigil.root.children[0].domain_language, "Old child content");
    }

    #[test]
    fn test_language_md_takes_precedence_over_spec_md() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("Both");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("vision.md"), "").unwrap();
        fs::write(root.join("spec.md"), "old content").unwrap();
        fs::write(root.join("language.md"), "new content").unwrap();

        let sigil = read_sigil(root.to_string_lossy().to_string()).unwrap();
        assert_eq!(sigil.root.domain_language, "new content");
    }

    #[test]
    fn test_replace_references_exact() {
        let content = "The @Observer watches the @Frame.";
        let result = replace_references(content, "Observer", "Watcher");
        assert_eq!(result, "The @Watcher watches the @Frame.");
    }

    #[test]
    fn test_replace_references_plural_s() {
        let content = "Multiple @Observers track @Frames.";
        let result = replace_references(content, "Observer", "Watcher");
        assert_eq!(result, "Multiple @Watchers track @Frames.");
    }

    #[test]
    fn test_replace_references_plural_ies() {
        let content = "The @Strategies define @Strategy behavior.";
        let result = replace_references(content, "Strategy", "Tactic");
        assert_eq!(result, "The @Tactics define @Tactic behavior.");
    }

    #[test]
    fn test_replace_references_lowercase() {
        let content = "An @observer and @Observer are the same.";
        let result = replace_references(content, "Observer", "Watcher");
        assert_eq!(result, "An @watcher and @Watcher are the same.");
    }

    #[test]
    fn test_replace_references_multi_segment() {
        let content = "See @AttentionLanguage@Observer for details.";
        let result = replace_references(content, "Observer", "Watcher");
        assert_eq!(result, "See @AttentionLanguage@Watcher for details.");
    }

    #[test]
    fn test_replace_references_with_affordance() {
        let content = "Use @Observer#track-state to track.";
        let result = replace_references(content, "Observer", "Watcher");
        assert_eq!(result, "Use @Watcher#track-state to track.");
    }

    #[test]
    fn test_replace_references_heading() {
        let content = "## Observer\nSome text.";
        let result = replace_references(content, "Observer", "Watcher");
        assert_eq!(result, "## Watcher\nSome text.");
    }

    #[test]
    fn test_replace_references_preserves_trailing_newline() {
        let content = "Text with @Observer.\n";
        let result = replace_references(content, "Observer", "Watcher");
        assert_eq!(result, "Text with @Watcher.\n");
    }

    #[test]
    fn test_name_variants_basic() {
        let variants = name_variants("Observer", "Watcher");
        let old_names: Vec<&str> = variants.iter().map(|(o, _)| o.as_str()).collect();
        assert!(old_names.contains(&"Observer"));
        assert!(old_names.contains(&"observer"));
        assert!(old_names.contains(&"Observers"));
        assert!(old_names.contains(&"observers"));
    }

    #[test]
    fn test_name_variants_y_plural() {
        let variants = name_variants("Strategy", "Tactic");
        let old_names: Vec<&str> = variants.iter().map(|(o, _)| o.as_str()).collect();
        assert!(old_names.contains(&"Strategy"));
        assert!(old_names.contains(&"Strategies"));
        // Check replacement mapping
        let tactics_pair = variants.iter().find(|(o, _)| o == "Strategies");
        assert_eq!(tactics_pair.unwrap().1, "Tactics");
    }
}
