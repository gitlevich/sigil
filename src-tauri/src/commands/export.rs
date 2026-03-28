use std::fs;
use crate::commands::spec_tree::read_spec_tree;
use crate::models::spec_tree::Context;

fn render_export(ctx: &Context, depth: usize, output: &mut String, is_root: bool) {
    let heading = "#".repeat(depth + 1);

    if is_root {
        output.push_str(&format!("{} {}\n\n", heading, ctx.name));
    }

    let sub_heading = "#".repeat(depth + 2);

    if is_root {
        output.push_str(&format!("{} Specification\n\n", sub_heading));
    } else {
        output.push_str(&format!("{} {}\n\n", heading, ctx.name));
        output.push_str(&format!("{} Specification\n\n", sub_heading));
    }

    output.push_str(&ctx.spec_body);
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
pub fn export_spec(root_path: String, output_path: String) -> Result<(), String> {
    let tree = read_spec_tree(root_path)?;
    let mut output = String::new();

    output.push_str(&format!("# {}\n\n", tree.name));

    if !tree.vision.is_empty() {
        output.push_str("## Vision\n\n");
        output.push_str(&tree.vision);
        output.push_str("\n\n");
    }

    render_export(&tree.root, 0, &mut output, true);

    fs::write(&output_path, output).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::fs;

    fn setup_tree(tmp: &TempDir) -> String {
        let root = tmp.path().join("TestApp");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("vision.md"), "Make it great").unwrap();
        fs::write(root.join("spec.md"), "Root spec body").unwrap();
        fs::write(root.join("technical.md"), "Use Tauri").unwrap();

        let auth = root.join("Auth");
        fs::create_dir(&auth).unwrap();
        fs::write(auth.join("spec.md"), "Auth spec").unwrap();

        root.to_string_lossy().to_string()
    }

    #[test]
    fn test_export_contains_vision() {
        let tmp = TempDir::new().unwrap();
        let root_path = setup_tree(&tmp);
        let output_path = tmp.path().join("export.md").to_string_lossy().to_string();

        export_spec(root_path, output_path.clone()).unwrap();

        let content = fs::read_to_string(&output_path).unwrap();
        assert!(content.contains("# TestApp"));
        assert!(content.contains("## Vision"));
        assert!(content.contains("Make it great"));
    }

    #[test]
    fn test_export_contains_spec_and_technical() {
        let tmp = TempDir::new().unwrap();
        let root_path = setup_tree(&tmp);
        let output_path = tmp.path().join("export.md").to_string_lossy().to_string();

        export_spec(root_path, output_path.clone()).unwrap();

        let content = fs::read_to_string(&output_path).unwrap();
        assert!(content.contains("Root spec body"));
        assert!(content.contains("Use Tauri"));
        assert!(content.contains("Technical Decisions"));
    }

    #[test]
    fn test_export_contains_children() {
        let tmp = TempDir::new().unwrap();
        let root_path = setup_tree(&tmp);
        let output_path = tmp.path().join("export.md").to_string_lossy().to_string();

        export_spec(root_path, output_path.clone()).unwrap();

        let content = fs::read_to_string(&output_path).unwrap();
        assert!(content.contains("Auth"));
        assert!(content.contains("Auth spec"));
    }
}
