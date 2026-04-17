# sigil-llm — local inference sidecar

Runs as a child process of the Sigil Tauri app. Loads Phi-3 once and serves
inference requests over stdin/stdout JSON. Used by `@LeftHemisphere` when
the `local` provider is selected.

## Setup for development

Requires Python 3.11+ and Apple Silicon (`mlx-lm` needs Metal). Install uv if
you don't have it already, then:

```
cd sidecar
uv venv
uv pip install -e .
```

## Try it locally

```
echo '{"id":"1","prompt":"Hello, who are you?"}' | uv run python main.py
```

First run downloads the model (~2.5 GB) into `~/.cache/huggingface/hub/`.
Subsequent runs load from cache.

## Protocol

One JSON object per line, in both directions.

Startup:

```
{"ready": true, "model": "mlx-community/Phi-3.5-mini-instruct-4bit"}
```

Request:

```
{"id": "req-1", "prompt": "...", "max_tokens": 1024}
```

Response:

```
{"id": "req-1", "content": "..."}
```

Error:

```
{"id": "req-1", "error": "..."}
```

Stderr carries logs — stdout is protocol-only.

## Packaging (coming)

Will be bundled into the Tauri DMG via PyInstaller so users don't need a
Python toolchain.
