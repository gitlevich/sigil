use std::fs;
use std::path::Path;
use crate::models::sigil::{Context, Sigil};

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

fn read_context(dir: &Path) -> Result<Context, String> {
    let name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    let domain_language = fs::read_to_string(&language_file(dir))
        .unwrap_or_default();

    let mut children = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        let mut dirs: Vec<_> = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .filter(|e| {
                !e.file_name()
                    .to_str()
                    .map(|n| n.starts_with('.'))
                    .unwrap_or(true)
            })
            .collect();
        dirs.sort_by_key(|e| e.file_name());

        for entry in dirs {
            let child_path = entry.path();
            if is_context_dir(&child_path) {
                children.push(read_context(&child_path)?);
            }
        }
    }

    Ok(Context {
        name,
        path: dir.to_string_lossy().to_string(),
        domain_language,
        children,
    })
}

#[tauri::command]
pub fn read_sigil(root_path: String) -> Result<Sigil, String> {
    let root = Path::new(&root_path);
    if !root.exists() {
        return Err(format!("Path does not exist: {}", root_path));
    }

    let vision_path = root.join("vision.md");
    let vision = fs::read_to_string(&vision_path).unwrap_or_default();

    let context = read_context(root)?;

    Ok(Sigil {
        name: context.name.clone(),
        root_path: root_path.clone(),
        vision,
        root: context,
    })
}

#[tauri::command]
pub fn create_context(parent_path: String, name: String) -> Result<Context, String> {
    let parent = Path::new(&parent_path);

    let existing_dirs: Vec<_> = fs::read_dir(parent)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter(|e| is_context_dir(&e.path()))
        .collect();

    if existing_dirs.len() >= 5 {
        return Err("Maximum of 5 sub-contexts reached".to_string());
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
        children: Vec::new(),
    })
}

#[tauri::command]
pub fn rename_context(path: String, new_name: String) -> Result<String, String> {
    let old_path = Path::new(&path);
    let parent = old_path
        .parent()
        .ok_or_else(|| "Cannot rename root".to_string())?;
    let new_path = parent.join(&new_name);

    if new_path.exists() {
        return Err(format!("A context named '{}' already exists", new_name));
    }

    fs::rename(old_path, &new_path).map_err(|e| e.to_string())?;
    Ok(new_path.to_string_lossy().to_string())
}

/// Walk all text files under root and replace old_name with new_name everywhere.
/// Also renames any sub-directories that match old_name (except the root itself).
fn update_references(root: &Path, old_name: &str, new_name: &str) -> Result<usize, String> {
    let mut count = 0;

    // First pass: replace text in all readable files
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
        if content.contains(old_name) {
            let updated = content.replace(old_name, new_name);
            fs::write(path, updated).map_err(|e| e.to_string())?;
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
    dirs_to_rename.sort_by(|a, b| b.components().count().cmp(&a.components().count()));
    for dir in dirs_to_rename {
        let new_dir = dir.parent().unwrap().join(new_name);
        if !new_dir.exists() {
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

    if new_path.exists() {
        return Err(format!("A context named '{}' already exists", new_name));
    }

    fs::rename(old_path, &new_path).map_err(|e| e.to_string())?;

    let root = Path::new(&root_path);
    let files_updated = update_references(root, &old_name, &new_name)?;

    Ok(serde_json::json!({
        "new_path": new_path.to_string_lossy(),
        "files_updated": files_updated,
    }).to_string())
}

#[tauri::command]
pub fn move_sigil(_root_path: String, path: String, new_parent_path: String) -> Result<String, String> {
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

    // Check 5-sigil limit at destination
    let existing_dirs: Vec<_> = fs::read_dir(new_parent)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter(|e| is_context_dir(&e.path()))
        .collect();

    if existing_dirs.len() >= 5 {
        return Err("Target already has 5 sub-contexts".to_string());
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

        let sigil = read_sigil(root_path).unwrap();

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

        let new_path = rename_context(auth_path.clone(), "Authentication".to_string()).unwrap();
        assert!(new_path.ends_with("Authentication"));
        assert!(!Path::new(&auth_path).exists());
        assert!(Path::new(&new_path).exists());
        assert!(Path::new(&new_path).join("language.md").exists());
    }

    #[test]
    fn test_rename_context_conflict() {
        let tmp = TempDir::new().unwrap();
        let root_path = setup_sigil(&tmp);
        let auth_path = format!("{}/Auth", root_path);

        let result = rename_context(auth_path, "Billing".to_string());
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

        let sigil = read_sigil(root_path).unwrap();
        let names: Vec<&str> = sigil.root.children.iter().map(|c| c.name.as_str()).collect();
        assert!(!names.contains(&".git"));
    }

    #[test]
    fn test_read_sigil_ignores_dirs_without_language() {
        let tmp = TempDir::new().unwrap();
        let root_path = setup_sigil(&tmp);

        let random_dir = Path::new(&root_path).join("random");
        fs::create_dir(&random_dir).unwrap();

        let sigil = read_sigil(root_path).unwrap();
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
}
