# sigil-llm - local inference sidecar

Runs as a child process of the Sigil Tauri app. Loads Phi-3 once and serves
Qwen2.5-7B-Instruct through `llama-cpp-python`'s OpenAI-compatible HTTP
server. Used by `@LeftHemisphere` when the `local` provider is selected.

## Setup for development

Requires Python 3.11+; the repo pins Python 3.13 for local development through
`.python-version`. Install `uv` if you don't have it already, then:

```
cd sidecar
uv sync --frozen
```

The Tauri dev app expects the interpreter at `sidecar/.venv/bin/python3`.

## Try it locally

```
uv run python main.py
```

First run downloads the model (~2.5 GB) into `~/.cache/huggingface/hub/`.
Subsequent runs load from cache. Startup prints one readiness JSON object to
stdout, then the process keeps the HTTP server alive until it is terminated.

## Protocol

One JSON object on stdout at startup.

Startup:

```
{"ready": true, "endpoint": "http://127.0.0.1:8765", "model": "..."}
```

After startup, the Tauri app sends OpenAI-compatible chat completion requests
to the advertised endpoint.

Error:

```
{"ready": false, "error": "..."}
```

Stderr carries logs; stdout is protocol-only.

## Packaging (coming)

Will be bundled into the Tauri DMG via PyInstaller so users don't need a
Python toolchain.
