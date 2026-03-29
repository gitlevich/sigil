use std::fs;
use std::path::Path;
use crate::models::sigil::{Context, Sigil};

fn read_context(dir: &Path) -> Result<Context, String> {
    let name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();

    let lang_path = dir.join("language.md");
    let domain_language = fs::read_to_string(&lang_path)
        .unwrap_or_default();

    let tech_path = dir.join("technical.md");
    let technical_decisions = if tech_path.exists() {
        Some(fs::read_to_string(&tech_path).map_err(|e| e.to_string())?)
    } else {
        None
    };

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
            if child_path.join("language.md").exists() {
                children.push(read_context(&child_path)?);
            }
        }
    }

    Ok(Context {
        name,
        path: dir.to_string_lossy().to_string(),
        domain_language,
        technical_decisions,
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
        .filter(|e| e.path().join("language.md").exists())
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
        technical_decisions: None,
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
        fs::write(root.join("technical.md"), "Use Rust").unwrap();

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
        assert_eq!(sigil.root.technical_decisions, Some("Use Rust".to_string()));
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
}
