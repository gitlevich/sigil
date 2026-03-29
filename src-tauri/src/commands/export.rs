use std::fs;
use crate::commands::sigil::read_sigil;
use crate::models::sigil::Context;

fn render_export(ctx: &Context, depth: usize, output: &mut String, is_root: bool) {
    let heading = "#".repeat(depth + 1);

    if is_root {
        output.push_str(&format!("{} {}\n\n", heading, ctx.name));
    }

    let sub_heading = "#".repeat(depth + 2);

    if is_root {
        output.push_str(&format!("{} Domain Language\n\n", sub_heading));
    } else {
        output.push_str(&format!("{} {}\n\n", heading, ctx.name));
        output.push_str(&format!("{} Domain Language\n\n", sub_heading));
    }

    output.push_str(&ctx.domain_language);
    output.push_str("\n\n");

    if let Some(ref tech) = ctx.technical_decisions {
        output.push_str(&format!("{} Technical Decisions\n\n", sub_heading));
        output.push_str(tech);
        output.push_str("\n\n");
    }

    for (i, child) in ctx.children.iter().enumerate() {
        if i > 0 {
            output.push_str("---\n\n");
        }
        render_export(child, depth + 1, output, false);
    }
}

#[tauri::command]
pub fn export_sigil(root_path: String, output_path: String) -> Result<(), String> {
    let sigil = read_sigil(root_path)?;
    let mut output = String::new();

    output.push_str(&format!("# {}\n\n", sigil.name));

    if !sigil.vision.is_empty() {
        output.push_str("## Vision\n\n");
        output.push_str(&sigil.vision);
        output.push_str("\n\n");
    }

    render_export(&sigil.root, 0, &mut output, true);

    fs::write(&output_path, output).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::fs;

    fn setup_sigil(tmp: &TempDir) -> String {
        let root = tmp.path().join("TestApp");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("vision.md"), "Make it great").unwrap();
        fs::write(root.join("language.md"), "Root domain language").unwrap();
        fs::write(root.join("technical.md"), "Use Tauri").unwrap();

        let auth = root.join("Auth");
        fs::create_dir(&auth).unwrap();
        fs::write(auth.join("language.md"), "Auth language").unwrap();

        root.to_string_lossy().to_string()
    }

    #[test]
    fn test_export_contains_vision() {
        let tmp = TempDir::new().unwrap();
        let root_path = setup_sigil(&tmp);
        let output_path = tmp.path().join("export.md").to_string_lossy().to_string();

        export_sigil(root_path, output_path.clone()).unwrap();

        let content = fs::read_to_string(&output_path).unwrap();
        assert!(content.contains("# TestApp"));
        assert!(content.contains("## Vision"));
        assert!(content.contains("Make it great"));
    }

    #[test]
    fn test_export_contains_language_and_technical() {
        let tmp = TempDir::new().unwrap();
        let root_path = setup_sigil(&tmp);
        let output_path = tmp.path().join("export.md").to_string_lossy().to_string();

        export_sigil(root_path, output_path.clone()).unwrap();

        let content = fs::read_to_string(&output_path).unwrap();
        assert!(content.contains("Root domain language"));
        assert!(content.contains("Use Tauri"));
        assert!(content.contains("Technical Decisions"));
        assert!(content.contains("Domain Language"));
    }

    #[test]
    fn test_export_contains_children() {
        let tmp = TempDir::new().unwrap();
        let root_path = setup_sigil(&tmp);
        let output_path = tmp.path().join("export.md").to_string_lossy().to_string();

        export_sigil(root_path, output_path.clone()).unwrap();

        let content = fs::read_to_string(&output_path).unwrap();
        assert!(content.contains("Auth"));
        assert!(content.contains("Auth language"));
    }
}
