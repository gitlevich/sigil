//! Bootstrap and resolve the Python interpreter used by local inference.
//!
//! Distribution policy: Sigil does not rely on system Python. It ships a
//! prebuilt runtime kit inside the Tauri bundle. On first local-inference use,
//! this module extracts the interpreter, dependencies, and sidecar source into
//! app data, then writes a manifest so later launches reuse the cached runtime.
//!
//! Dev override: `SIGIL_DEV_PYTHON=/absolute/path/to/python` bypasses the
//! bootstrap. `up.sh` sets this to the local sidecar venv when present.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::process::Command;

const KIT_DIR: &str = "python-bootstrap";
const CACHE_DIR: &str = "python-env";
const MANIFEST_FILE: &str = "manifest.json";
const RUNTIME_TARBALL: &str = "runtime.tar.gz";
const PYTHON_DIR: &str = "python";
const APP_DIR: &str = "app";
const PYTHON_BIN: &[&str] = &["python", "bin", "python3.12"];

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq, Clone)]
pub struct Manifest {
    pub python_version: String,
    pub python_release: String,
    pub uv_version: String,
    pub lock_sha256: String,
    pub source_sha256: String,
    pub build_script_sha256: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(tag = "phase", rename_all = "kebab-case")]
pub enum Progress {
    ExtractingRuntime,
    Ready,
    Failed { error: String },
}

#[derive(Debug, Clone)]
pub struct Environment {
    pub python: PathBuf,
    pub sidecar_dir: PathBuf,
}

pub async fn ensure<R: Runtime>(app: &AppHandle<R>) -> Result<Environment, String> {
    if let Ok(dev_python) = std::env::var("SIGIL_DEV_PYTHON") {
        let path = PathBuf::from(&dev_python);
        if !path.exists() {
            return Err(format!(
                "SIGIL_DEV_PYTHON points to missing path: {dev_python}"
            ));
        }
        return Ok(Environment {
            python: path.clone(),
            sidecar_dir: dev_sidecar_dir(&path)?,
        });
    }

    let kit = locate_kit(app)?;
    let cache = cache_dir(app)?;
    let runtime_python = python_path(&cache);
    let sidecar_dir = cache.join(APP_DIR);

    let bundled = read_manifest(&kit.join(MANIFEST_FILE))?;
    let installed = read_manifest(&cache.join(MANIFEST_FILE)).ok();

    if installed.as_ref() == Some(&bundled)
        && runtime_python.exists()
        && sidecar_dir.join("main.py").exists()
    {
        return Ok(Environment {
            python: runtime_python,
            sidecar_dir,
        });
    }

    match bootstrap(app, &kit, &cache, &bundled).await {
        Ok(()) => Ok(Environment {
            python: runtime_python,
            sidecar_dir,
        }),
        Err(e) => {
            let _ = app.emit("python-bootstrap", Progress::Failed { error: e.clone() });
            Err(e)
        }
    }
}

fn dev_sidecar_dir(python: &Path) -> Result<PathBuf, String> {
    if let Ok(explicit) = std::env::var("SIGIL_SIDECAR_DIR") {
        let dir = PathBuf::from(explicit);
        if dir.join("main.py").exists() {
            return Ok(dir);
        }
    }

    if let Some(sidecar) = python
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .filter(|dir| dir.join("main.py").exists())
    {
        return Ok(sidecar.to_path_buf());
    }

    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let candidate = cwd.join("sidecar");
    if candidate.join("main.py").exists() {
        return Ok(candidate);
    }

    Err(format!(
        "could not find sidecar/main.py for dev Python at {}",
        python.display()
    ))
}

fn locate_kit<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .resolve(KIT_DIR, tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("locate bootstrap kit: {e}"))?;
    if !dir.join(MANIFEST_FILE).exists() || !dir.join(RUNTIME_TARBALL).exists() {
        return Err(format!(
            "bootstrap kit missing at {} -- did build-python-bootstrap.sh run?",
            dir.display()
        ));
    }
    Ok(dir)
}

fn python_path(cache: &Path) -> PathBuf {
    PYTHON_BIN
        .iter()
        .fold(cache.to_path_buf(), |path, segment| path.join(segment))
}

fn cache_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    let dir = base.join(CACHE_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir cache dir: {e}"))?;
    Ok(dir)
}

fn read_manifest(path: &Path) -> Result<Manifest, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| format!("read manifest {}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("parse manifest {}: {e}", path.display()))
}

async fn bootstrap<R: Runtime>(
    app: &AppHandle<R>,
    kit: &Path,
    cache: &Path,
    bundled: &Manifest,
) -> Result<(), String> {
    let _ = std::fs::remove_file(cache.join(MANIFEST_FILE));
    remove_if_exists(&cache.join(PYTHON_DIR))?;
    remove_if_exists(&cache.join(APP_DIR))?;

    let _ = app.emit("python-bootstrap", Progress::ExtractingRuntime);
    extract_runtime(kit, cache).await?;

    write_manifest(cache, bundled)?;
    let _ = app.emit("python-bootstrap", Progress::Ready);
    Ok(())
}

fn remove_if_exists(path: &Path) -> Result<(), String> {
    if path.exists() {
        std::fs::remove_dir_all(path).map_err(|e| format!("remove {}: {e}", path.display()))?;
    }
    Ok(())
}

async fn extract_runtime(kit: &Path, cache: &Path) -> Result<(), String> {
    let tarball = kit.join(RUNTIME_TARBALL);
    let status = Command::new("tar")
        .args(["-xzf"])
        .arg(&tarball)
        .arg("-C")
        .arg(cache)
        .status()
        .await
        .map_err(|e| format!("spawn tar: {e}"))?;
    if !status.success() {
        return Err(format!("tar exited with status {status}"));
    }
    let interpreter = python_path(cache);
    if !interpreter.exists() {
        return Err(format!(
            "interpreter not found after extraction at {}",
            interpreter.display()
        ));
    }
    let main = cache.join(APP_DIR).join("main.py");
    if !main.exists() {
        return Err(format!(
            "sidecar main.py not found after extraction at {}",
            main.display()
        ));
    }
    Ok(())
}

fn write_manifest(cache: &Path, manifest: &Manifest) -> Result<(), String> {
    let json =
        serde_json::to_string_pretty(manifest).map_err(|e| format!("serialize manifest: {e}"))?;
    std::fs::write(cache.join(MANIFEST_FILE), json).map_err(|e| format!("write manifest: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(lock: &str, source: &str) -> Manifest {
        Manifest {
            python_version: "3.12.13".into(),
            python_release: "20260414".into(),
            uv_version: "0.11.8".into(),
            lock_sha256: lock.into(),
            source_sha256: source.into(),
            build_script_sha256: "script-hash".into(),
        }
    }

    #[test]
    fn identical_manifests_match() {
        assert_eq!(manifest("a", "b"), manifest("a", "b"));
    }

    #[test]
    fn lock_drift_invalidates() {
        assert_ne!(manifest("a", "b"), manifest("c", "b"));
    }

    #[test]
    fn source_drift_invalidates() {
        assert_ne!(manifest("a", "b"), manifest("a", "c"));
    }

    #[test]
    fn build_script_drift_invalidates() {
        let current = manifest("a", "b");
        let mut changed = current.clone();
        changed.build_script_sha256 = "other-script-hash".into();
        assert_ne!(current, changed);
    }

    #[test]
    fn manifest_roundtrips_via_json() {
        let m = manifest("lock-hash", "source-hash");
        let json = serde_json::to_string(&m).unwrap();
        let parsed: Manifest = serde_json::from_str(&json).unwrap();
        assert_eq!(m, parsed);
    }

    #[test]
    fn progress_serializes_with_kebab_case_phase() {
        let json = serde_json::to_value(Progress::ExtractingRuntime).unwrap();
        assert_eq!(json["phase"], "extracting-runtime");

        let json = serde_json::to_value(Progress::Ready).unwrap();
        assert_eq!(json["phase"], "ready");
    }

    #[test]
    fn progress_failed_carries_error_text() {
        let json = serde_json::to_value(Progress::Failed {
            error: "bootstrap failed".into(),
        })
        .unwrap();
        assert_eq!(json["phase"], "failed");
        assert_eq!(json["error"], "bootstrap failed");
    }
}
