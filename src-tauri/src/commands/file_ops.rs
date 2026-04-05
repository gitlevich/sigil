use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", path, e))
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    let file_path = Path::new(&path);
    if let Some(parent) = file_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    fs::write(&path, content).map_err(|e| format!("Failed to write {}: {}", path, e))
}

#[tauri::command]
pub fn delete_file(path: String) -> Result<(), String> {
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Ok(()); // idempotent
    }
    fs::remove_file(&path).map_err(|e| format!("Failed to delete {}: {}", path, e))
}

#[tauri::command]
pub fn copy_image(source_path: String, dest_dir: String) -> Result<String, String> {
    let src = Path::new(&source_path);
    if !src.is_file() {
        return Err(format!("Source is not a file: {}", source_path));
    }
    let dest = Path::new(&dest_dir);
    if !dest.exists() {
        fs::create_dir_all(dest).map_err(|e| format!("Failed to create {}: {}", dest_dir, e))?;
    }
    let stem = src.file_stem().unwrap_or_default().to_string_lossy().to_string();
    let ext = src.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
    let mut target: PathBuf = dest.join(src.file_name().unwrap());
    let mut counter = 1u32;
    while target.exists() {
        let name = if ext.is_empty() {
            format!("{}-{}", stem, counter)
        } else {
            format!("{}-{}.{}", stem, counter, ext)
        };
        target = dest.join(&name);
        counter += 1;
    }
    fs::copy(src, &target).map_err(|e| format!("Failed to copy image: {}", e))?;
    Ok(target.file_name().unwrap().to_string_lossy().to_string())
}

#[tauri::command]
pub fn write_image_bytes(dest_path: String, data: Vec<u8>) -> Result<String, String> {
    let path = Path::new(&dest_path);
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {}", e))?;
        }
    }
    // Handle collision
    let stem = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
    let ext = path.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
    let parent = path.parent().unwrap();
    let mut target = path.to_path_buf();
    let mut counter = 1u32;
    while target.exists() {
        let name = if ext.is_empty() {
            format!("{}-{}", stem, counter)
        } else {
            format!("{}-{}.{}", stem, counter, ext)
        };
        target = parent.join(&name);
        counter += 1;
    }
    fs::write(&target, &data).map_err(|e| format!("Failed to write image: {}", e))?;
    Ok(target.file_name().unwrap().to_string_lossy().to_string())
}

use base64::Engine as _;

#[tauri::command]
pub fn read_image_base64(path: String) -> Result<String, String> {
    let data = fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path, e))?;
    let ext = Path::new(&path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
    Ok(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open Finder: {}", e))?;
    Ok(())
}
