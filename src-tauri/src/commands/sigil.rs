use std::fs;
use std::path::{Path, PathBuf};
use regex::Regex;
use tauri::{AppHandle, Manager};
use tauri::path::BaseDirectory;
use crate::commands::narrative;
use crate::commands::workspace_lock::WorkspaceLocks;
use serde::Serialize;
use crate::models::sigil::{SigilFolder, Invariant, Idea};

/// Extract a value from YAML frontmatter (---...\n---) by key.
fn extract_frontmatter_field(content: &str, key: &str) -> Option<String> {
    if !content.starts_with("---") { return None; }
    let end = content.find("\n---").filter(|&pos| pos > 0)?;
    let fm = &content[3..end];
    for line in fm.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix(key) {
            if let Some(value) = rest.strip_prefix(':') {
                let v = value.trim();
                if !v.is_empty() { return Some(v.to_string()); }
            }
        }
    }
    None
}

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

fn sigil_name_from_dir(dir: &Path, is_root: bool) -> String {
    let name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown");

    if is_root && name.to_ascii_lowercase().ends_with(".sigil") {
        name[..name.len() - ".sigil".len()].to_string()
    } else {
        name.to_string()
    }
}

fn read_context(dir: &Path, is_imported: bool, is_root: bool) -> Result<SigilFolder, String> {
    use crate::models::sigil::Affordance;

    let name = sigil_name_from_dir(dir, is_root);

    let language = fs::read_to_string(&language_file(dir))
        .unwrap_or_default();

    // Parse frontmatter `type:` field
    let sigil_type = extract_frontmatter_field(&language, "type");

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
                let dir_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if dir_name.starts_with('.') || dir_name == "Libs" {
                    continue;
                }
                if is_context_dir(&path) {
                    children.push(read_context(&path, is_imported, false)?);
                }
            }
        }
    }

    Ok(SigilFolder {
        name,
        path: dir.to_string_lossy().to_string(),
        language,
        affordances,
        invariants,
        children,
        images,
        is_imported,
        sigil_type,
    })
}

fn bundled_libs(app: &AppHandle) -> Option<PathBuf> {
    app.path().resolve("Libs", BaseDirectory::Resource).ok().filter(|p| p.exists())
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

fn scaffold_sigil_at(root: &Path, libs_src: Option<&Path>) -> Result<(), String> {
    if root.exists() {
        return Err(format!("Sigil already exists: {}", root.display()));
    }

    fs::create_dir_all(root).map_err(|e| format!("Failed to create sigil directory: {e}"))?;
    fs::write(root.join("vision.md"), "").map_err(|e| e.to_string())?;
    fs::write(root.join("language.md"), "").map_err(|e| e.to_string())?;

    if let Some(libs_src) = libs_src {
        let libs_dst = root.join("Libs");
        copy_dir_recursive(&libs_src, &libs_dst)?;
    }

    Ok(())
}

/// Create a new sigil directory with vision.md, language.md, and a copy of Libs.
#[tauri::command]
pub fn scaffold_sigil(app: AppHandle, root_path: String) -> Result<(), String> {
    let root = Path::new(&root_path);
    let libs_src = bundled_libs(&app);
    scaffold_sigil_at(root, libs_src.as_deref())?;
    narrative::ensure_workspace_baseline(&root_path)
}

/// Check which bundled ontologies need installing/updating.
#[tauri::command]
pub fn check_imported_ontologies(app: AppHandle, root_path: String) -> Result<Vec<OntologyStatus>, String> {
    let root = Path::new(&root_path);
    let libs_dst = root.join("Libs");
    let libs_src = bundled_libs(&app)
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
    let libs_src = bundled_libs(&app)
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
pub fn read_sigil(app: AppHandle, root_path: String) -> Result<Idea, String> {
    let locks = app.state::<WorkspaceLocks>();
    super::workspace_lock::acquire(&locks, &root_path)?;
    narrative::ensure_workspace_baseline(&root_path)?;

    read_sigil_with_libs(root_path)
}

pub fn read_sigil_with_libs(root_path: String) -> Result<Idea, String> {
    let root = Path::new(&root_path);
    if !root.exists() {
        return Err(format!("Path does not exist: {}", root_path));
    }

    let vision_path = root.join("vision.md");
    let vision = fs::read_to_string(&vision_path).unwrap_or_default();

    let context = read_context(root, false, true)?;

    // Mount imported ontologies from Libs inside the sigil root, or sibling Libs
    let imported_ontologies = Some(root.join("Libs"))
        .filter(|p| p.exists())
        .or_else(|| root.parent().map(|p| p.join("Libs")))
        .and_then(|libs_dir| {
            if libs_dir.exists() && libs_dir.is_dir() {
                let mut imported = read_context(&libs_dir, true, false).ok()?;
                imported.name = "Imported Ontologies".to_string();
                Some(imported)
            } else {
                None
            }
        });

    Ok(Idea {
        name: context.name.clone(),
        root_path: root_path.clone(),
        vision,
        root: context,
        imported_ontologies,
    })
}

#[tauri::command]
pub fn create_sigil(parent_path: String, name: String) -> Result<SigilFolder, String> {
    let parent = Path::new(&parent_path);

    let context_path = parent.join(&name);
    if context_path.exists() {
        return Err(format!("Context '{}' already exists", name));
    }

    fs::create_dir(&context_path).map_err(|e| e.to_string())?;
    fs::write(context_path.join("language.md"), "").map_err(|e| e.to_string())?;
    narrative::record_created_sigil(&context_path)?;

    Ok(SigilFolder {
        name,
        path: context_path.to_string_lossy().to_string(),
        language: String::new(),
        affordances: Vec::new(),
        invariants: Vec::new(),
        children: Vec::new(),
        images: Vec::new(),
        is_imported: false,
        sigil_type: None,
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
    if !old_path.exists() {
        return Err(format!("Context no longer exists: {}", old_path.display()));
    }

    let parent = old_path
        .parent()
        .ok_or_else(|| "Cannot rename root".to_string())?;
    let new_path = parent.join(&new_name);

    let case_only = old_name.to_lowercase() == new_name.to_lowercase();
    if !case_only && new_path.exists() {
        return Err(format!("A context named '{}' already exists", new_name));
    }

    let root = Path::new(&root_path);
    let before = narrative::snapshot_sigil_tree(root, old_path)?;
    let reference_updates = collect_rename_reference_updates(root, old_path, &old_name, &new_name)?;

    if case_only {
        let tmp_path = parent.join(format!("__rename_tmp_{}", old_name));
        fs::rename(old_path, &tmp_path).map_err(|e| e.to_string())?;
        fs::rename(&tmp_path, &new_path).map_err(|e| e.to_string())?;
    } else {
        fs::rename(old_path, &new_path).map_err(|e| e.to_string())?;
    }

    write_scoped_reference_updates(reference_updates, old_path, &new_path)?;
    narrative::record_renamed_sigil(root, before, &new_path)?;

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
#[cfg(test)]
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

fn flatten_name(s: &str) -> String {
    s.to_lowercase().chars().filter(|c| !matches!(c, ' ' | '-' | '_')).collect()
}

fn inflections_of(canonical: &str) -> Vec<String> {
    let lower = canonical.to_lowercase();
    let mut forms = std::collections::BTreeSet::new();
    let mut add = |s: String| { forms.insert(flatten_name(&s)); };

    add(lower.clone());
    add(format!("{}s", lower));
    if lower.ends_with('y') && lower.len() > 2 {
        let stem = &lower[..lower.len() - 1];
        add(format!("{}ies", stem));
        add(format!("{}iful", stem));
    }
    if lower.ends_with("iful") && lower.len() > 5 {
        add(format!("{}y", &lower[..lower.len() - 4]));
    }
    if lower.ends_with('e') {
        add(format!("{}d", lower));
        add(format!("{}ing", &lower[..lower.len() - 1]));
    } else {
        add(format!("{}ed", lower));
        add(format!("{}ing", lower));
    }

    forms.into_iter().collect()
}

fn name_matches_ref(ref_name: &str, canonical: &str) -> bool {
    let written = flatten_name(ref_name);
    inflections_of(canonical).into_iter().any(|form| form == written)
}

fn replacement_for_written_name(written: &str, old_name: &str, new_name: &str) -> String {
    for (old_variant, new_variant) in name_variants(old_name, new_name) {
        if written == old_variant {
            return new_variant;
        }
    }
    new_name.to_string()
}

fn child_matches<'a>(parent: &'a SigilFolder, name: &str) -> Vec<&'a SigilFolder> {
    parent.children.iter().filter(|child| name_matches_ref(name, &child.name)).collect()
}

fn context_at_path<'a>(root: &'a SigilFolder, path: &[String]) -> Option<&'a SigilFolder> {
    let mut current = root;
    for segment in path {
        let child = current.children.iter().find(|child| child.name == *segment)?;
        current = child;
    }
    Some(current)
}

fn collect_descendants_by_name<'a>(
    node: &'a SigilFolder,
    name: &str,
    base_path: &[String],
    excluded: &std::collections::BTreeSet<String>,
    out: &mut Vec<(&'a SigilFolder, Vec<String>)>,
) {
    for child in &node.children {
        let mut path = base_path.to_vec();
        path.push(child.name.clone());
        if name_matches_ref(name, &child.name) && !excluded.contains(&path.join("/")) {
            out.push((child, path.clone()));
        }
        collect_descendants_by_name(child, name, &path, excluded, out);
    }
}

enum FirstResolution<'a> {
    Found(&'a SigilFolder, Vec<String>),
    Ambiguous,
    Missing,
}

fn resolve_first_local<'a>(
    root: &'a SigilFolder,
    current_path: &[String],
    name: &str,
) -> FirstResolution<'a> {
    let Some(current) = context_at_path(root, current_path) else {
        return FirstResolution::Missing;
    };

    let direct_child_matches = child_matches(current, name);
    if direct_child_matches.len() == 1 {
        let child = direct_child_matches[0];
        let mut path = current_path.to_vec();
        path.push(child.name.clone());
        return FirstResolution::Found(child, path);
    }
    if direct_child_matches.len() > 1 {
        return FirstResolution::Ambiguous;
    }

    if !current_path.is_empty() {
        let parent_path = &current_path[..current_path.len() - 1];
        let Some(parent) = context_at_path(root, parent_path) else {
            return FirstResolution::Missing;
        };
        let sibling_matches: Vec<&SigilFolder> = child_matches(parent, name)
            .into_iter()
            .filter(|child| child.name != current.name)
            .collect();
        if sibling_matches.len() == 1 {
            let sibling = sibling_matches[0];
            let mut path = parent_path.to_vec();
            path.push(sibling.name.clone());
            return FirstResolution::Found(sibling, path);
        }
        if sibling_matches.len() > 1 {
            return FirstResolution::Ambiguous;
        }
    }

    for idx in (0..current_path.len()).rev() {
        if name_matches_ref(name, &current_path[idx]) {
            let path = current_path[..=idx].to_vec();
            return match context_at_path(root, &path) {
                Some(target) => FirstResolution::Found(target, path),
                None => FirstResolution::Missing,
            };
        }
    }
    if name_matches_ref(name, &root.name) {
        return FirstResolution::Found(root, Vec::new());
    }

    let mut excluded = std::collections::BTreeSet::new();
    for child in &current.children {
        let mut path = current_path.to_vec();
        path.push(child.name.clone());
        excluded.insert(path.join("/"));
    }
    if !current_path.is_empty() {
        let parent_path = &current_path[..current_path.len() - 1];
        if let Some(parent) = context_at_path(root, parent_path) {
            for child in &parent.children {
                let mut path = parent_path.to_vec();
                path.push(child.name.clone());
                excluded.insert(path.join("/"));
            }
        }
    }
    for idx in 0..=current_path.len() {
        excluded.insert(current_path[..idx].join("/"));
    }

    for depth in (0..=current_path.len()).rev() {
        let subtree_path = current_path[..depth].to_vec();
        let Some(subtree_root) = context_at_path(root, &subtree_path) else {
            return FirstResolution::Missing;
        };
        let mut matches = Vec::new();
        collect_descendants_by_name(subtree_root, name, &subtree_path, &excluded, &mut matches);
        if matches.len() == 1 {
            let (target, path) = matches.into_iter().next().unwrap();
            return FirstResolution::Found(target, path);
        }
        if matches.len() > 1 {
            return FirstResolution::Ambiguous;
        }
    }

    FirstResolution::Missing
}

fn resolve_first_imported<'a>(imported_root: &'a SigilFolder, name: &str) -> FirstResolution<'a> {
    let excluded = std::collections::BTreeSet::new();
    let mut matches = Vec::new();
    collect_descendants_by_name(imported_root, name, &[], &excluded, &mut matches);
    if matches.len() == 1 {
        let (target, path) = matches.into_iter().next().unwrap();
        FirstResolution::Found(target, path)
    } else if matches.len() > 1 {
        FirstResolution::Ambiguous
    } else {
        FirstResolution::Missing
    }
}

fn path_for_sigil(sigil: &SigilFolder) -> PathBuf {
    PathBuf::from(&sigil.path)
}

fn resolve_ref_segments<'a>(
    root: &'a SigilFolder,
    imported_root: Option<&'a SigilFolder>,
    current_path: &[String],
    segments: &[&str],
) -> Vec<(&'a SigilFolder, Vec<String>, usize)> {
    let mut resolved = Vec::new();
    let (mut target, mut path) = match resolve_first_local(root, current_path, segments[0]) {
        FirstResolution::Found(target, path) => (target, path),
        FirstResolution::Ambiguous => return resolved,
        FirstResolution::Missing => {
            let Some(imported_root) = imported_root else {
                return resolved;
            };
            match resolve_first_imported(imported_root, segments[0]) {
                FirstResolution::Found(target, path) => (target, path),
                FirstResolution::Ambiguous | FirstResolution::Missing => return resolved,
            }
        }
    };
    resolved.push((target, path.clone(), 0));

    for (idx, segment) in segments.iter().enumerate().skip(1) {
        let matches = child_matches(target, segment);
        if matches.len() != 1 {
            break;
        }
        target = matches[0];
        path.push(target.name.clone());
        resolved.push((target, path.clone(), idx));
    }

    resolved
}

fn rewrite_ref_token(
    token: &str,
    root_tree: &SigilFolder,
    imported_tree: Option<&SigilFolder>,
    current_path: &[String],
    target_old_path: &Path,
    old_name: &str,
    new_name: &str,
) -> String {
    let segments: Vec<&str> = token.trim_start_matches('@').split('@').collect();
    if segments.is_empty() {
        return token.to_string();
    }

    let resolved = resolve_ref_segments(root_tree, imported_tree, current_path, &segments);
    let Some((_, _, segment_idx)) = resolved
        .into_iter()
        .find(|(sigil, _, _)| path_for_sigil(sigil) == target_old_path)
    else {
        return token.to_string();
    };

    let mut rewritten: Vec<String> = segments.iter().map(|segment| (*segment).to_string()).collect();
    rewritten[segment_idx] = replacement_for_written_name(segments[segment_idx], old_name, new_name);
    format!("@{}", rewritten.join("@"))
}

fn replace_scoped_references(
    content: &str,
    root_tree: &SigilFolder,
    imported_tree: Option<&SigilFolder>,
    current_path: &[String],
    target_old_path: &Path,
    old_name: &str,
    new_name: &str,
) -> String {
    let re = Regex::new(r"@(?:[a-zA-Z_][\w-]*)(?:@[a-zA-Z_][\w-]*)*").unwrap();
    re.replace_all(content, |caps: &regex::Captures| {
        rewrite_ref_token(&caps[0], root_tree, imported_tree, current_path, target_old_path, old_name, new_name)
    }).to_string()
}

fn replace_target_headings(content: &str, old_name: &str, new_name: &str) -> String {
    let variants = name_variants(old_name, new_name);
    let lines: Vec<String> = content.lines().map(|line| {
        for depth in 1usize..=6 {
            let hashes = "#".repeat(depth);
            for (old_var, new_var) in &variants {
                if line.trim_end() == format!("{} {}", hashes, old_var) {
                    return format!("{} {}", hashes, new_var);
                }
            }
        }
        line.to_string()
    }).collect();

    let mut result = lines.join("\n");
    if content.ends_with('\n') {
        result.push('\n');
    }
    result
}

fn path_is_inside_workspace_private_or_libs(root: &Path, path: &Path) -> bool {
    let rel = match path.strip_prefix(root) {
        Ok(rel) => rel,
        Err(_) => return false,
    };

    rel.components().any(|component| {
        let text = component.as_os_str().to_string_lossy();
        text == "Libs" || text.starts_with('.')
    })
}

fn imported_ontologies_dir_for_target(root: &Path, target: &Path) -> Option<PathBuf> {
    let local_libs = root.join("Libs");
    if local_libs.exists() && target.starts_with(&local_libs) {
        return Some(local_libs);
    }

    let sibling_libs = root.parent().map(|parent| parent.join("Libs"))?;
    if sibling_libs.exists() && target.starts_with(&sibling_libs) {
        return Some(sibling_libs);
    }

    None
}

fn context_path_for_file(root: &SigilFolder, path: &Path) -> Option<Vec<String>> {
    fn walk(node: &SigilFolder, path: &Path, prefix: &[String], best: &mut Option<Vec<String>>) {
        let node_path = Path::new(&node.path);
        if path.starts_with(node_path) {
            *best = Some(prefix.to_vec());
            for child in &node.children {
                let mut child_prefix = prefix.to_vec();
                child_prefix.push(child.name.clone());
                walk(child, path, &child_prefix, best);
            }
        }
    }

    let mut best = None;
    walk(root, path, &[], &mut best);
    best
}

fn collect_scoped_reference_updates(
    root: &Path,
    root_tree: &SigilFolder,
    imported_tree: Option<&SigilFolder>,
    target_old_path: &Path,
    old_name: &str,
    new_name: &str,
) -> Result<Vec<(PathBuf, String)>, String> {
    let mut updates = Vec::new();

    for entry in walkdir::WalkDir::new(root)
        .into_iter()
        .filter_entry(|entry| !path_is_inside_workspace_private_or_libs(root, entry.path()))
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
    {
        let path = entry.path();
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if !matches!(ext, "md" | "json" | "txt" | "") {
            continue;
        }
        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let Some(current_path) = context_path_for_file(root_tree, path) else {
            continue;
        };
        let mut updated = replace_scoped_references(
            &content,
            root_tree,
            imported_tree,
            &current_path,
            target_old_path,
            old_name,
            new_name,
        );
        if path.starts_with(target_old_path) {
            updated = replace_target_headings(&updated, old_name, new_name);
        }
        if updated != content {
            updates.push((path.to_path_buf(), updated));
        }
    }

    Ok(updates)
}

fn collect_rename_reference_updates(
    root: &Path,
    target_old_path: &Path,
    old_name: &str,
    new_name: &str,
) -> Result<Vec<(PathBuf, String)>, String> {
    let app_tree = read_context(root, false, true)?;
    let libs_root = imported_ontologies_dir_for_target(root, target_old_path);
    let libs_tree = match &libs_root {
        Some(path) => Some(read_context(path, true, false)?),
        None => None,
    };

    let mut updates = collect_scoped_reference_updates(
        root,
        &app_tree,
        libs_tree.as_ref(),
        target_old_path,
        old_name,
        new_name,
    )?;

    if let (Some(libs_root), Some(libs_tree)) = (libs_root.as_ref(), libs_tree.as_ref()) {
        updates.extend(collect_scoped_reference_updates(
            libs_root,
            libs_tree,
            None,
            target_old_path,
            old_name,
            new_name,
        )?);
    }

    Ok(updates)
}

fn write_scoped_reference_updates(
    updates: Vec<(PathBuf, String)>,
    target_old_path: &Path,
    target_new_path: &Path,
) -> Result<usize, String> {
    let mut count = 0;
    for (old_file_path, updated) in updates {
        let file_path = if old_file_path.starts_with(target_old_path) {
            let rel = old_file_path.strip_prefix(target_old_path).map_err(|e| e.to_string())?;
            target_new_path.join(rel)
        } else {
            old_file_path
        };
        narrative::write_text_file(&file_path, &updated, "update-reference")?;
        count += 1;
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
    if !old_path.exists() {
        return Err(format!("Context no longer exists: {}", old_path.display()));
    }

    let parent = old_path
        .parent()
        .ok_or_else(|| "Cannot rename root".to_string())?;
    let new_path = parent.join(&new_name);

    let case_only = old_name.to_lowercase() == new_name.to_lowercase();
    if !case_only && new_path.exists() {
        return Err(format!("A context named '{}' already exists", new_name));
    }

    let root = Path::new(&root_path);
    let before = narrative::snapshot_sigil_tree(root, old_path)?;
    let reference_updates = collect_rename_reference_updates(root, old_path, &old_name, &new_name)?;

    if case_only {
        let tmp_path = parent.join(format!("__rename_tmp_{}", old_name));
        fs::rename(old_path, &tmp_path).map_err(|e| e.to_string())?;
        fs::rename(&tmp_path, &new_path).map_err(|e| e.to_string())?;
    } else {
        fs::rename(old_path, &new_path).map_err(|e| e.to_string())?;
    }

    let files_updated = write_scoped_reference_updates(reference_updates, old_path, &new_path)?;
    narrative::record_renamed_sigil(root, before, &new_path)?;

    Ok(serde_json::json!({
        "old_name": old_name,
        "new_name": new_name,
        "old_path": old_path.to_string_lossy(),
        "new_path": new_path.to_string_lossy(),
        "files_updated": files_updated,
    }).to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceChangeLine {
    pub line_number: usize,
    pub before: String,
    pub after: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReferenceChange {
    /// Path relative to the workspace root, using forward slashes.
    pub path: String,
    /// Total lines in this file that would change.
    pub match_count: usize,
    /// Up to N sampled before/after lines for rendering the preview.
    pub sample_lines: Vec<ReferenceChangeLine>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryRename {
    pub from_path: String,
    pub to_path: String,
}

/// The full blast radius of a proposed reshape, computed without mutating the filesystem.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReshapePreview {
    pub operation: String,
    pub old_name: String,
    pub new_name: String,
    pub target_old_path: String,
    pub target_new_path: String,
    pub file_changes: Vec<FileReferenceChange>,
    pub directory_renames: Vec<DirectoryRename>,
    pub total_match_count: usize,
}

/// Compute the blast radius of a rename-sigil without touching the filesystem.
///
/// Spec affordance: Workspace/#propose-reshape.
/// Spec invariant: Workspace/!reshapes-are-atomic — the preview is honest about
/// what the reshape would do; the commit is performed separately (via rename_sigil)
/// and applies in full or not at all.
#[tauri::command]
pub fn preview_rename_sigil(
    root_path: String,
    path: String,
    new_name: String,
) -> Result<ReshapePreview, String> {
    const MAX_SAMPLE_LINES: usize = 5;

    let old_path = Path::new(&path);
    let old_name = old_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Cannot determine current name".to_string())?
        .to_string();
    if !old_path.exists() {
        return Err(format!("Context no longer exists: {}", old_path.display()));
    }

    let parent = old_path
        .parent()
        .ok_or_else(|| "Cannot rename root".to_string())?;
    let new_path = parent.join(&new_name);

    let case_only = old_name.to_lowercase() == new_name.to_lowercase();
    if !case_only && new_path.exists() {
        return Err(format!("A context named '{}' already exists", new_name));
    }

    let root = Path::new(&root_path);
    let app_tree = read_context(root, false, true)?;
    let libs_root = imported_ontologies_dir_for_target(root, old_path);
    let libs_tree = match &libs_root {
        Some(path) => Some(read_context(path, true, false)?),
        None => None,
    };
    let mut file_changes: Vec<FileReferenceChange> = Vec::new();
    let mut total_match_count = 0usize;

    let mut scan_roots: Vec<(&Path, &SigilFolder, Option<&SigilFolder>)> = vec![
        (root, &app_tree, libs_tree.as_ref()),
    ];
    if let (Some(libs_root), Some(libs_tree)) = (libs_root.as_ref(), libs_tree.as_ref()) {
        scan_roots.push((libs_root.as_path(), libs_tree, None));
    }

    for (scan_root, root_tree, imported_tree) in scan_roots {
        for entry in walkdir::WalkDir::new(scan_root)
            .into_iter()
            .filter_entry(|entry| !path_is_inside_workspace_private_or_libs(scan_root, entry.path()))
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_file())
        {
            let file_path = entry.path();
            let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if !matches!(ext, "md" | "json" | "txt" | "") {
                continue;
            }
            let content = match fs::read_to_string(file_path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let Some(current_path) = context_path_for_file(&root_tree, file_path) else {
                continue;
            };
            let mut updated = replace_scoped_references(
                &content,
                root_tree,
                imported_tree,
                &current_path,
                old_path,
                &old_name,
                &new_name,
            );
            if file_path.starts_with(old_path) {
                updated = replace_target_headings(&updated, &old_name, &new_name);
            }
            if updated == content {
                continue;
            }

            let old_lines: Vec<&str> = content.lines().collect();
            let new_lines: Vec<&str> = updated.lines().collect();
            let mut sample_lines: Vec<ReferenceChangeLine> = Vec::new();
            let mut match_count = 0usize;

            let limit = old_lines.len().max(new_lines.len());
            for i in 0..limit {
                let old_line = old_lines.get(i).copied().unwrap_or("");
                let new_line = new_lines.get(i).copied().unwrap_or("");
                if old_line != new_line {
                    match_count += 1;
                    if sample_lines.len() < MAX_SAMPLE_LINES {
                        sample_lines.push(ReferenceChangeLine {
                            line_number: i + 1,
                            before: old_line.to_string(),
                            after: new_line.to_string(),
                        });
                    }
                }
            }

            let rel_path = file_path
                .strip_prefix(root)
                .unwrap_or(file_path)
                .to_string_lossy()
                .replace('\\', "/");
            file_changes.push(FileReferenceChange {
                path: rel_path,
                match_count,
                sample_lines,
            });
            total_match_count += match_count;
        }
    }

    let directory_renames = vec![
        DirectoryRename {
            from_path: old_path.to_string_lossy().to_string(),
            to_path: new_path.to_string_lossy().to_string(),
        },
    ];

    Ok(ReshapePreview {
        operation: "rename-sigil".to_string(),
        old_name,
        new_name,
        target_old_path: old_path.to_string_lossy().to_string(),
        target_new_path: new_path.to_string_lossy().to_string(),
        file_changes,
        directory_renames,
        total_match_count,
    })
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

    let new_path = new_parent.join(&name);
    if new_path.exists() {
        return Err(format!("A context named '{}' already exists at the target", name));
    }

    let root = Path::new(&root_path);
    let before = narrative::snapshot_sigil_tree(root, old_path)?;
    fs::rename(old_path, &new_path).map_err(|e| e.to_string())?;
    narrative::record_moved_sigil(root, before, &new_path)?;

    Ok(new_path.to_string_lossy().to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DanglingReference {
    /// Path relative to the workspace root, forward slashes.
    pub file_path: String,
    pub line_number: usize,
    pub line_text: String,
    pub ref_token: String,
}

/// The blast radius of a proposed delete: references that would be left dangling.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletePreview {
    pub target_path: String,
    pub target_name: String,
    /// Descendant sigil names (directories under target) that would also be removed.
    pub descendants: Vec<String>,
    /// References to target or any descendant that would be left dangling after delete.
    pub dangling_references: Vec<DanglingReference>,
}

/// Compute which references would be left dangling if the given sigil (and its
/// descendants) were deleted. Pure read — does not touch the filesystem.
///
/// Spec: Workspace/#propose-reshape for the delete case. Delete is destructive;
/// the preview exists so the user sees what would orphan before approving.
#[tauri::command]
pub fn preview_delete_sigil(root_path: String, path: String) -> Result<DeletePreview, String> {
    let target_path = Path::new(&path);
    let target_name = target_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Cannot determine target name".to_string())?
        .to_string();
    let root = Path::new(&root_path);

    // Collect descendant sigil names (directories under target).
    let mut descendants: Vec<String> = Vec::new();
    if target_path.exists() {
        for entry in walkdir::WalkDir::new(target_path)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir() && e.path() != target_path)
        {
            if let Some(name) = entry.file_name().to_str() {
                // Treat any directory name that starts with a capital letter as a sigil.
                if name.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) {
                    descendants.push(name.to_string());
                }
            }
        }
    }
    descendants.sort();
    descendants.dedup();

    // Build the set of names that would disappear: the target plus its descendants.
    let mut disappearing_names: std::collections::HashSet<String> = std::collections::HashSet::new();
    disappearing_names.insert(target_name.clone());
    for d in &descendants {
        disappearing_names.insert(d.clone());
    }

    let ref_re = Regex::new(r"@[a-zA-Z_][\w-]*(?:@[a-zA-Z_][\w-]*)*(?:[#!][a-zA-Z_][\w-]*)?").unwrap();

    let mut dangling_references: Vec<DanglingReference> = Vec::new();

    for entry in walkdir::WalkDir::new(root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
    {
        let file_path = entry.path();
        if file_path.starts_with(target_path) {
            continue;
        }
        let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if !matches!(ext, "md" | "json" | "txt" | "") {
            continue;
        }
        let content = match fs::read_to_string(file_path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        for (line_idx, line) in content.lines().enumerate() {
            for m in ref_re.find_iter(line) {
                let token = m.as_str();
                let without_at = &token[1..];
                let sigil_part = match without_at.find(|c: char| c == '#' || c == '!') {
                    Some(i) => &without_at[..i],
                    None => without_at,
                };
                let mentions_disappearing = sigil_part
                    .split('@')
                    .any(|seg| disappearing_names.contains(seg));
                if !mentions_disappearing {
                    continue;
                }
                let rel = file_path
                    .strip_prefix(root)
                    .unwrap_or(file_path)
                    .to_string_lossy()
                    .replace('\\', "/");
                dangling_references.push(DanglingReference {
                    file_path: rel,
                    line_number: line_idx + 1,
                    line_text: line.to_string(),
                    ref_token: token.to_string(),
                });
            }
        }
    }

    Ok(DeletePreview {
        target_path: target_path.to_string_lossy().to_string(),
        target_name,
        descendants,
        dangling_references,
    })
}

#[tauri::command]
pub fn delete_context(path: String) -> Result<(), String> {
    let context_path = Path::new(&path);
    if !context_path.exists() {
        return Err("Context does not exist".to_string());
    }
    narrative::record_deleted_sigil(context_path)?;
    fs::remove_dir_all(context_path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_extract_frontmatter_field_status() {
        let content = "---\nstatus: done\n---\nBody text";
        assert_eq!(extract_frontmatter_field(content, "status"), Some("done".to_string()));
    }

    #[test]
    fn test_extract_frontmatter_field_type() {
        let content = "---\nstatus: idea\ntype: implementation\n---\nBody";
        assert_eq!(extract_frontmatter_field(content, "type"), Some("implementation".to_string()));
    }

    #[test]
    fn test_extract_frontmatter_field_missing() {
        let content = "---\nstatus: idea\n---\nBody";
        assert_eq!(extract_frontmatter_field(content, "type"), None);
    }

    #[test]
    fn test_extract_frontmatter_field_no_frontmatter() {
        let content = "Just plain text";
        assert_eq!(extract_frontmatter_field(content, "status"), None);
    }

    #[test]
    fn test_read_sigil_parses_type() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("TypeTest");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("vision.md"), "").unwrap();
        fs::write(root.join("language.md"), "---\ntype: implementation\n---\nImpl details").unwrap();

        let child = root.join("Conceptual");
        fs::create_dir(&child).unwrap();
        fs::write(child.join("language.md"), "---\ntype: conceptual\n---\nDomain stuff").unwrap();

        let sigil = read_sigil_with_libs(root.to_string_lossy().to_string()).unwrap();
        assert_eq!(sigil.root.sigil_type, Some("implementation".to_string()));
        assert_eq!(sigil.root.children[0].sigil_type, Some("conceptual".to_string()));
    }

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
        assert_eq!(sigil.root.language, "# MyApp\nRoot domain language");
        assert_eq!(sigil.root.children.len(), 2);

        let names: Vec<&str> = sigil.root.children.iter().map(|c| c.name.as_str()).collect();
        assert!(names.contains(&"Auth"));
        assert!(names.contains(&"Billing"));
    }

    #[test]
    fn test_read_sigil_uses_directory_stem_as_root_name() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("SigilAtlas.SIGIL");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("vision.md"), "").unwrap();
        fs::write(root.join("language.md"), "# Sigil Atlas").unwrap();

        let child = root.join("Nested.sigil");
        fs::create_dir(&child).unwrap();
        fs::write(child.join("language.md"), "# Nested").unwrap();

        let sigil = read_sigil_with_libs(root.to_string_lossy().to_string()).unwrap();

        assert_eq!(sigil.name, "SigilAtlas");
        assert_eq!(sigil.root.name, "SigilAtlas");
        assert_eq!(sigil.root.path, root.to_string_lossy().to_string());
        assert_eq!(sigil.root.children[0].name, "Nested.sigil");
    }

    #[test]
    fn test_read_sigil_nonexistent() {
        let result = read_sigil_with_libs("/nonexistent/path".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn test_scaffold_sigil_creates_required_files() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("NewSpec.sigil");

        scaffold_sigil_at(&root, None).unwrap();

        assert!(root.is_dir());
        assert!(root.join("vision.md").exists());
        assert!(root.join("language.md").exists());
    }

    #[test]
    fn test_scaffold_sigil_does_not_overwrite_existing_directory() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("Existing.sigil");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("language.md"), "# Existing").unwrap();

        let result = scaffold_sigil_at(&root, None);

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
        assert_eq!(fs::read_to_string(root.join("language.md")).unwrap(), "# Existing");
    }

    #[test]
    fn test_create_sigil() {
        let tmp = TempDir::new().unwrap();
        let root_path = setup_sigil(&tmp);

        let ctx = create_sigil(root_path.clone(), "Notifications".to_string()).unwrap();
        assert_eq!(ctx.name, "Notifications");
        assert!(ctx.language.is_empty());
        assert!(ctx.children.is_empty());

        let lang_path = Path::new(&root_path).join("Notifications/language.md");
        assert!(lang_path.exists());
    }

    #[test]
    fn test_create_sigil_duplicate() {
        let tmp = TempDir::new().unwrap();
        let root_path = setup_sigil(&tmp);

        let result = create_sigil(root_path, "Auth".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
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
    fn test_rename_sigil_missing_source_reports_stale_before_collision() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("Scoped");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("vision.md"), "").unwrap();
        fs::write(root.join("language.md"), "").unwrap();

        let attention = root.join("Libs").join("AttentionLanguage");
        let existing = attention.join("Entanglement");
        let stale = attention.join("EntanglementTTTT");
        fs::create_dir_all(&existing).unwrap();
        fs::write(root.join("Libs").join("language.md"), "").unwrap();
        fs::write(attention.join("language.md"), "").unwrap();
        fs::write(existing.join("language.md"), "# Entanglement\n").unwrap();

        let result = rename_sigil(
            root.to_string_lossy().to_string(),
            stale.to_string_lossy().to_string(),
            "Entanglement".to_string(),
        );

        assert!(result.is_err());
        let message = result.unwrap_err();
        assert!(message.contains("Context no longer exists"));
        assert!(!message.contains("already exists"));
    }

    #[test]
    fn test_preview_rename_sigil_missing_source_reports_stale_before_collision() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("Scoped");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("vision.md"), "").unwrap();
        fs::write(root.join("language.md"), "").unwrap();

        let attention = root.join("Libs").join("AttentionLanguage");
        let existing = attention.join("Entanglement");
        let stale = attention.join("EntanglementTTTT");
        fs::create_dir_all(&existing).unwrap();
        fs::write(root.join("Libs").join("language.md"), "").unwrap();
        fs::write(attention.join("language.md"), "").unwrap();
        fs::write(existing.join("language.md"), "# Entanglement\n").unwrap();

        let result = preview_rename_sigil(
            root.to_string_lossy().to_string(),
            stale.to_string_lossy().to_string(),
            "Entanglement".to_string(),
        );

        assert!(result.is_err());
        let message = result.unwrap_err();
        assert!(message.contains("Context no longer exists"));
        assert!(!message.contains("already exists"));
    }

    #[test]
    fn test_rename_sigil_local_scope_eclipses_imported_ontology() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("Scoped");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("vision.md"), "").unwrap();
        fs::write(root.join("language.md"), "See @AttentionLanguage@Narrative.\n").unwrap();

        let app = root.join("Application");
        fs::create_dir(&app).unwrap();
        fs::write(app.join("language.md"), "").unwrap();

        let chapter = app.join("Chapter");
        fs::create_dir(&chapter).unwrap();
        fs::write(chapter.join("language.md"), "").unwrap();

        let editing = chapter.join("Editing");
        fs::create_dir(&editing).unwrap();
        fs::write(editing.join("language.md"), "Local ref @Narrative.\n").unwrap();

        let vocabulary = app.join("Vocabulary");
        fs::create_dir(&vocabulary).unwrap();
        fs::write(vocabulary.join("language.md"), "").unwrap();

        let narrative = vocabulary.join("Narrative");
        fs::create_dir(&narrative).unwrap();
        fs::write(narrative.join("language.md"), "# Narrative\n").unwrap();

        let imported_narrative = root.join("Libs").join("AttentionLanguage").join("Narrative");
        fs::create_dir_all(&imported_narrative).unwrap();
        fs::write(root.join("Libs").join("language.md"), "").unwrap();
        fs::write(root.join("Libs").join("AttentionLanguage").join("language.md"), "").unwrap();
        fs::write(imported_narrative.join("language.md"), "Imported @Narrative.\n").unwrap();

        rename_sigil(
            root.to_string_lossy().to_string(),
            narrative.to_string_lossy().to_string(),
            "Collage".to_string(),
        ).unwrap();

        assert!(vocabulary.join("Collage").exists());
        assert!(imported_narrative.exists());
        assert!(!root.join("Libs").join("AttentionLanguage").join("Collage").exists());
        assert_eq!(fs::read_to_string(editing.join("language.md")).unwrap(), "Local ref @Collage.\n");
        assert_eq!(fs::read_to_string(root.join("language.md")).unwrap(), "See @AttentionLanguage@Narrative.\n");
        assert_eq!(fs::read_to_string(imported_narrative.join("language.md")).unwrap(), "Imported @Narrative.\n");
    }

    #[test]
    fn test_rename_sigil_allows_imported_ontology_scope() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("Scoped");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("vision.md"), "").unwrap();
        fs::write(root.join("language.md"), "Local @Narrative. Imported @AttentionLanguage@Narrative.\n").unwrap();

        let vocabulary = root.join("Vocabulary");
        fs::create_dir(&vocabulary).unwrap();
        fs::write(vocabulary.join("language.md"), "").unwrap();
        let local_narrative = vocabulary.join("Narrative");
        fs::create_dir(&local_narrative).unwrap();
        fs::write(local_narrative.join("language.md"), "# Narrative\n").unwrap();

        let imported_narrative = root.join("Libs").join("AttentionLanguage").join("Narrative");
        fs::create_dir_all(&imported_narrative).unwrap();
        fs::write(root.join("Libs").join("language.md"), "").unwrap();
        fs::write(root.join("Libs").join("AttentionLanguage").join("language.md"), "").unwrap();
        fs::write(imported_narrative.join("language.md"), "Imported @Narrative.\n").unwrap();

        rename_sigil(
            root.to_string_lossy().to_string(),
            imported_narrative.to_string_lossy().to_string(),
            "Story".to_string(),
        ).unwrap();

        let imported_story = root.join("Libs").join("AttentionLanguage").join("Story");
        assert!(imported_story.exists());
        assert!(!imported_narrative.exists());
        assert!(local_narrative.exists());
        assert_eq!(
            fs::read_to_string(root.join("language.md")).unwrap(),
            "Local @Narrative. Imported @AttentionLanguage@Story.\n"
        );
        assert_eq!(fs::read_to_string(imported_story.join("language.md")).unwrap(), "Imported @Story.\n");
    }

    #[test]
    fn test_rename_sigil_imported_bare_refs_update_when_unshadowed() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("Scoped");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("vision.md"), "").unwrap();
        fs::write(
            root.join("language.md"),
            "Bare @Narrative. Qualified @AttentionLanguage@Narrative.\n",
        )
        .unwrap();

        let imported_narrative = root.join("Libs").join("AttentionLanguage").join("Narrative");
        fs::create_dir_all(&imported_narrative).unwrap();
        fs::write(root.join("Libs").join("language.md"), "").unwrap();
        fs::write(root.join("Libs").join("AttentionLanguage").join("language.md"), "").unwrap();
        fs::write(imported_narrative.join("language.md"), "Self @Narrative.\n").unwrap();

        rename_sigil(
            root.to_string_lossy().to_string(),
            imported_narrative.to_string_lossy().to_string(),
            "Story".to_string(),
        )
        .unwrap();

        let imported_story = root.join("Libs").join("AttentionLanguage").join("Story");
        assert!(imported_story.exists());
        assert_eq!(
            fs::read_to_string(root.join("language.md")).unwrap(),
            "Bare @Story. Qualified @AttentionLanguage@Story.\n"
        );
        assert_eq!(fs::read_to_string(imported_story.join("language.md")).unwrap(), "Self @Story.\n");
    }

    #[test]
    fn test_rename_sigil_imported_bare_refs_stay_when_local_scope_is_ambiguous() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("Scoped");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("vision.md"), "").unwrap();
        fs::write(
            root.join("language.md"),
            "Ambiguous @Narrative. Qualified @AttentionLanguage@Narrative.\n",
        )
        .unwrap();

        for vocabulary in ["VocabularyA", "VocabularyB"] {
            let local_narrative = root.join(vocabulary).join("Narrative");
            fs::create_dir_all(&local_narrative).unwrap();
            fs::write(root.join(vocabulary).join("language.md"), "").unwrap();
            fs::write(local_narrative.join("language.md"), "# Narrative\n").unwrap();
        }

        let imported_narrative = root.join("Libs").join("AttentionLanguage").join("Narrative");
        fs::create_dir_all(&imported_narrative).unwrap();
        fs::write(root.join("Libs").join("language.md"), "").unwrap();
        fs::write(root.join("Libs").join("AttentionLanguage").join("language.md"), "").unwrap();
        fs::write(imported_narrative.join("language.md"), "Self @Narrative.\n").unwrap();

        rename_sigil(
            root.to_string_lossy().to_string(),
            imported_narrative.to_string_lossy().to_string(),
            "Story".to_string(),
        )
        .unwrap();

        let imported_story = root.join("Libs").join("AttentionLanguage").join("Story");
        assert!(imported_story.exists());
        assert!(root.join("VocabularyA").join("Narrative").exists());
        assert!(root.join("VocabularyB").join("Narrative").exists());
        assert_eq!(
            fs::read_to_string(root.join("language.md")).unwrap(),
            "Ambiguous @Narrative. Qualified @AttentionLanguage@Story.\n"
        );
        assert_eq!(fs::read_to_string(imported_story.join("language.md")).unwrap(), "Self @Story.\n");
    }

    #[test]
    fn test_rename_sigil_imported_entanglement_fixture_updates_workspace_and_undoes() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("Sigil");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("vision.md"), "").unwrap();
        fs::write(
            root.join("language.md"),
            "Local @Entanglement. Qualified @AttentionLanguage@Entanglement. Lower @entanglement.\n",
        )
        .unwrap();

        let outside = root.join("Idea").join("Workspace").join("Outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("language.md"), "@Entanglement is proximity.\n").unwrap();

        let attention = root.join("Libs").join("AttentionLanguage");
        let imported_entanglement = attention.join("Entanglement");
        let contrast_space = attention.join("ContrastSpace");
        fs::create_dir_all(&imported_entanglement).unwrap();
        fs::create_dir_all(&contrast_space).unwrap();
        fs::write(root.join("Libs").join("language.md"), "").unwrap();
        fs::write(attention.join("language.md"), "").unwrap();
        fs::write(imported_entanglement.join("language.md"), "# Entanglement\n").unwrap();
        fs::write(contrast_space.join("language.md"), "Structure @Entanglement.\n").unwrap();

        let first = rename_sigil(
            root.to_string_lossy().to_string(),
            imported_entanglement.to_string_lossy().to_string(),
            "EntanglementTTTT".to_string(),
        )
        .unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&first).unwrap();
        let renamed_path = parsed["new_path"].as_str().unwrap().to_string();
        assert_eq!(parsed["files_updated"].as_u64(), Some(4));

        let renamed_entanglement = attention.join("EntanglementTTTT");
        assert!(renamed_entanglement.exists());
        assert!(!imported_entanglement.exists());
        assert_eq!(
            fs::read_to_string(root.join("language.md")).unwrap(),
            "Local @EntanglementTTTT. Qualified @AttentionLanguage@EntanglementTTTT. Lower @entanglementtttt.\n"
        );
        assert_eq!(
            fs::read_to_string(outside.join("language.md")).unwrap(),
            "@EntanglementTTTT is proximity.\n"
        );
        assert_eq!(
            fs::read_to_string(contrast_space.join("language.md")).unwrap(),
            "Structure @EntanglementTTTT.\n"
        );
        assert_eq!(
            fs::read_to_string(renamed_entanglement.join("language.md")).unwrap(),
            "# EntanglementTTTT\n"
        );

        rename_sigil(
            root.to_string_lossy().to_string(),
            renamed_path,
            "Entanglement".to_string(),
        )
        .unwrap();

        assert!(imported_entanglement.exists());
        assert!(!renamed_entanglement.exists());
        assert_eq!(
            fs::read_to_string(root.join("language.md")).unwrap(),
            "Local @Entanglement. Qualified @AttentionLanguage@Entanglement. Lower @entanglement.\n"
        );
        assert_eq!(
            fs::read_to_string(outside.join("language.md")).unwrap(),
            "@Entanglement is proximity.\n"
        );
        assert_eq!(
            fs::read_to_string(contrast_space.join("language.md")).unwrap(),
            "Structure @Entanglement.\n"
        );
        assert_eq!(
            fs::read_to_string(imported_entanglement.join("language.md")).unwrap(),
            "# Entanglement\n"
        );
    }

    #[test]
    fn test_preview_rename_sigil_matches_imported_ontology_scope() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("Scoped");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("vision.md"), "").unwrap();
        fs::write(root.join("language.md"), "Local @Narrative. Imported @AttentionLanguage@Narrative.\n")
            .unwrap();

        let vocabulary = root.join("Vocabulary");
        fs::create_dir(&vocabulary).unwrap();
        fs::write(vocabulary.join("language.md"), "").unwrap();
        let local_narrative = vocabulary.join("Narrative");
        fs::create_dir(&local_narrative).unwrap();
        fs::write(local_narrative.join("language.md"), "# Narrative\n").unwrap();

        let imported_narrative = root.join("Libs").join("AttentionLanguage").join("Narrative");
        fs::create_dir_all(&imported_narrative).unwrap();
        fs::write(root.join("Libs").join("language.md"), "").unwrap();
        fs::write(root.join("Libs").join("AttentionLanguage").join("language.md"), "").unwrap();
        fs::write(imported_narrative.join("language.md"), "Imported @Narrative.\n").unwrap();

        let preview = preview_rename_sigil(
            root.to_string_lossy().to_string(),
            imported_narrative.to_string_lossy().to_string(),
            "Story".to_string(),
        )
        .unwrap();

        assert_eq!(preview.directory_renames.len(), 1);
        assert_eq!(
            preview.directory_renames[0].from_path,
            imported_narrative.to_string_lossy().to_string()
        );
        assert_eq!(
            preview.directory_renames[0].to_path,
            root.join("Libs")
                .join("AttentionLanguage")
                .join("Story")
                .to_string_lossy()
                .to_string()
        );

        let root_change = preview
            .file_changes
            .iter()
            .find(|change| change.path == "language.md")
            .expect("root language should preview qualified imported reference update");
        assert_eq!(root_change.match_count, 1);
        assert_eq!(
            root_change.sample_lines[0].before,
            "Local @Narrative. Imported @AttentionLanguage@Narrative."
        );
        assert_eq!(
            root_change.sample_lines[0].after,
            "Local @Narrative. Imported @AttentionLanguage@Story."
        );

        let imported_change = preview
            .file_changes
            .iter()
            .find(|change| change.path == "Libs/AttentionLanguage/Narrative/language.md")
            .expect("imported language should preview bare imported reference update");
        assert_eq!(imported_change.match_count, 1);
        assert_eq!(imported_change.sample_lines[0].before, "Imported @Narrative.");
        assert_eq!(imported_change.sample_lines[0].after, "Imported @Story.");

        assert!(!preview
            .file_changes
            .iter()
            .any(|change| change.path == "Vocabulary/Narrative/language.md"));
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

        let sigil = read_sigil_with_libs(root.to_string_lossy().to_string()).unwrap();
        assert_eq!(sigil.root.language, "Legacy root content");
        assert_eq!(sigil.root.children.len(), 1);
        assert_eq!(sigil.root.children[0].language, "Old child content");
    }

    #[test]
    fn test_language_md_takes_precedence_over_spec_md() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().join("Both");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("vision.md"), "").unwrap();
        fs::write(root.join("spec.md"), "old content").unwrap();
        fs::write(root.join("language.md"), "new content").unwrap();

        let sigil = read_sigil_with_libs(root.to_string_lossy().to_string()).unwrap();
        assert_eq!(sigil.root.language, "new content");
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
