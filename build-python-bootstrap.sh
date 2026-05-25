#!/usr/bin/env bash
# Assemble the Python bootstrap kit that ships inside the Tauri bundle.
#
# Layout produced under src-tauri/python-bootstrap/:
#   manifest.json    versions of interpreter / uv / lockfile / source
#   runtime.tar.gz   signed Python runtime, dependencies, and sidecar source
#
# The runtime extracts runtime.tar.gz into the user's app-data dir on first
# local-inference use. There is no dependency install on the user's machine.
set -euo pipefail

PYTHON_VERSION="3.12.13"
PYTHON_RELEASE="20260414"
UV_VERSION="0.11.8"

cd "$(dirname "$0")"
REPO_DIR="$(pwd)"
KIT_DIR="$REPO_DIR/src-tauri/python-bootstrap"
CACHE_DIR="$REPO_DIR/.bootstrap-cache"

mkdir -p "$KIT_DIR" "$CACHE_DIR"

LOCK_HASH="$(shasum -a 256 "$REPO_DIR/sidecar/uv.lock" | awk '{print $1}')"
SOURCE_HASH="$(shasum -a 256 "$REPO_DIR/sidecar/pyproject.toml" "$REPO_DIR/sidecar/main.py" | shasum -a 256 | awk '{print $1}')"
SCRIPT_HASH="$(shasum -a 256 "$REPO_DIR/build-python-bootstrap.sh" | awk '{print $1}')"
MANIFEST_JSON=$(cat <<EOF
{
  "python_version": "$PYTHON_VERSION",
  "python_release": "$PYTHON_RELEASE",
  "uv_version": "$UV_VERSION",
  "lock_sha256": "$LOCK_HASH",
  "source_sha256": "$SOURCE_HASH",
  "build_script_sha256": "$SCRIPT_HASH"
}
EOF
)

if [ -f "$KIT_DIR/runtime.tar.gz" ] && [ -f "$KIT_DIR/manifest.json" ] && [ "$(cat "$KIT_DIR/manifest.json")" = "$MANIFEST_JSON" ]; then
  echo "[bootstrap] kit already current at $KIT_DIR" >&2
  du -sh "$KIT_DIR" >&2
  exit 0
fi

PY_TARBALL="cpython-${PYTHON_VERSION}+${PYTHON_RELEASE}-aarch64-apple-darwin-install_only_stripped.tar.gz"
PY_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_RELEASE}/${PY_TARBALL}"
PY_CACHED="$CACHE_DIR/$PY_TARBALL"

UV_TARBALL="uv-${UV_VERSION}-aarch64-apple-darwin.tar.gz"
UV_URL="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-aarch64-apple-darwin.tar.gz"
UV_CACHED="$CACHE_DIR/$UV_TARBALL"

if [ ! -f "$PY_CACHED" ]; then
  echo "[bootstrap] downloading $PY_TARBALL" >&2
  curl -fsSL "$PY_URL" -o "$PY_CACHED"
fi

if [ ! -f "$UV_CACHED" ]; then
  echo "[bootstrap] downloading $UV_TARBALL" >&2
  curl -fsSL "$UV_URL" -o "$UV_CACHED"
fi

ENTITLEMENTS="$REPO_DIR/src-tauri/Entitlements.plist"
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  IDENTITY="$APPLE_SIGNING_IDENTITY"
  TIMESTAMP_FLAG=(--timestamp)
  echo "[bootstrap] codesigning with identity: $IDENTITY" >&2
else
  IDENTITY="-"
  TIMESTAMP_FLAG=()
  echo "[bootstrap] codesigning ad-hoc (no APPLE_SIGNING_IDENTITY)" >&2
fi

sign_macho() {
  local target="$1"
  local entitlements="${2:-}"
  local args=(--force --sign "$IDENTITY" --options runtime ${TIMESTAMP_FLAG[@]+"${TIMESTAMP_FLAG[@]}"})
  if [ -n "$entitlements" ]; then
    args+=(--entitlements "$entitlements")
  fi
  codesign "${args[@]}" "$target"
}

PY_WORK="$(mktemp -d)"
UV_TMP="$(mktemp -d)"
REQS="$(mktemp)"
trap 'rm -rf "$PY_WORK" "$UV_TMP" "$REQS"' EXIT
tar -xzf "$PY_CACHED" -C "$PY_WORK"

tar -xzf "$UV_CACHED" -C "$UV_TMP"
UV_BIN="$(find "$UV_TMP" -type f -name uv -perm -u+x | head -n1)"
if [ -z "$UV_BIN" ]; then
  echo "[bootstrap] could not find uv binary in $UV_TARBALL" >&2
  exit 1
fi

if [ ! -f "$REPO_DIR/sidecar/uv.lock" ]; then
  echo "[bootstrap] missing sidecar/uv.lock -- run 'uv lock' inside sidecar/" >&2
  exit 1
fi

(
  cd "$REPO_DIR/sidecar"
  "$UV_BIN" export --frozen --no-emit-project --output-file "$REQS" >/dev/null
)

SITE_PACKAGES="$PY_WORK/python/lib/python3.12/site-packages"
CMAKE_ARGS="-DGGML_METAL=on" "$UV_BIN" pip install \
  --python "$PY_WORK/python/bin/python3.12" \
  --target "$SITE_PACKAGES" \
  --requirements "$REQS"

mkdir -p "$PY_WORK/app"
cp "$REPO_DIR/sidecar/pyproject.toml" "$PY_WORK/app/pyproject.toml"
cp "$REPO_DIR/sidecar/uv.lock" "$PY_WORK/app/uv.lock"
cp "$REPO_DIR/sidecar/main.py" "$PY_WORK/app/main.py"

find "$PY_WORK/python" -type f \( -name "*.dylib" -o -name "*.so" \) \
  -print0 | while IFS= read -r -d '' f; do
  sign_macho "$f"
done

sign_macho "$PY_WORK/python/bin/python3.12" "$ENTITLEMENTS"

rm -rf "$KIT_DIR"
mkdir -p "$KIT_DIR"
printf "%s\n" "$MANIFEST_JSON" >"$KIT_DIR/manifest.json"
( cd "$PY_WORK" && tar --no-mac-metadata -czf "$KIT_DIR/runtime.tar.gz" python app )

echo "[bootstrap] kit staged at $KIT_DIR" >&2
du -sh "$KIT_DIR" >&2
