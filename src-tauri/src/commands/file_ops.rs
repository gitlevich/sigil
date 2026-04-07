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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn read_write_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("test.txt").to_string_lossy().to_string();
        write_file(path.clone(), "hello world".to_string()).unwrap();
        let content = read_file(path).unwrap();
        assert_eq!(content, "hello world");
    }

    #[test]
    fn write_file_creates_parent_dirs() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("deep/nested/dir/file.txt").to_string_lossy().to_string();
        write_file(path.clone(), "content".to_string()).unwrap();
        assert_eq!(read_file(path).unwrap(), "content");
    }

    #[test]
    fn read_file_missing_returns_error() {
        let result = read_file("/nonexistent/file.txt".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn delete_file_removes_existing() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("doomed.txt");
        fs::write(&path, "bye").unwrap();
        delete_file(path.to_string_lossy().to_string()).unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn delete_file_idempotent_on_missing() {
        let result = delete_file("/nonexistent/file.txt".to_string());
        assert!(result.is_ok());
    }

    #[test]
    fn copy_image_no_collision() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("photo.png");
        fs::write(&src, b"PNG data").unwrap();
        let dest_dir = tmp.path().join("images");
        let name = copy_image(
            src.to_string_lossy().to_string(),
            dest_dir.to_string_lossy().to_string(),
        ).unwrap();
        assert_eq!(name, "photo.png");
        assert!(dest_dir.join("photo.png").exists());
    }

    #[test]
    fn copy_image_collision_avoidance() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("photo.png");
        fs::write(&src, b"PNG data").unwrap();
        let dest_dir = tmp.path().join("images");
        fs::create_dir(&dest_dir).unwrap();
        fs::write(dest_dir.join("photo.png"), b"existing").unwrap();

        let name = copy_image(
            src.to_string_lossy().to_string(),
            dest_dir.to_string_lossy().to_string(),
        ).unwrap();
        assert_eq!(name, "photo-1.png");
    }

    #[test]
    fn copy_image_multiple_collisions() {
        let tmp = TempDir::new().unwrap();
        let src = tmp.path().join("photo.png");
        fs::write(&src, b"PNG data").unwrap();
        let dest_dir = tmp.path().join("images");
        fs::create_dir(&dest_dir).unwrap();
        fs::write(dest_dir.join("photo.png"), b"1").unwrap();
        fs::write(dest_dir.join("photo-1.png"), b"2").unwrap();

        let name = copy_image(
            src.to_string_lossy().to_string(),
            dest_dir.to_string_lossy().to_string(),
        ).unwrap();
        assert_eq!(name, "photo-2.png");
    }

    #[test]
    fn copy_image_source_not_file() {
        let tmp = TempDir::new().unwrap();
        let result = copy_image(
            tmp.path().to_string_lossy().to_string(),
            tmp.path().join("dest").to_string_lossy().to_string(),
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not a file"));
    }

    #[test]
    fn write_image_bytes_collision_avoidance() {
        let tmp = TempDir::new().unwrap();
        let dest = tmp.path().join("img.png");
        fs::write(&dest, b"existing").unwrap();

        let name = write_image_bytes(
            dest.to_string_lossy().to_string(),
            vec![0x89, 0x50, 0x4E, 0x47],
        ).unwrap();
        assert_eq!(name, "img-1.png");
    }

    #[test]
    fn read_image_base64_png() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("test.png");
        fs::write(&path, b"\x89PNG\r\n\x1a\n").unwrap();
        let result = read_image_base64(path.to_string_lossy().to_string()).unwrap();
        assert!(result.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn read_image_base64_jpeg() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("test.jpg");
        fs::write(&path, b"\xFF\xD8\xFF").unwrap();
        let result = read_image_base64(path.to_string_lossy().to_string()).unwrap();
        assert!(result.starts_with("data:image/jpeg;base64,"));
    }

    #[test]
    fn read_image_base64_svg() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("test.svg");
        fs::write(&path, "<svg></svg>").unwrap();
        let result = read_image_base64(path.to_string_lossy().to_string()).unwrap();
        assert!(result.starts_with("data:image/svg+xml;base64,"));
    }

    #[test]
    fn read_image_base64_unknown_ext() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("test.bmp");
        fs::write(&path, b"BM").unwrap();
        let result = read_image_base64(path.to_string_lossy().to_string()).unwrap();
        assert!(result.starts_with("data:application/octet-stream;base64,"));
    }
}

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
