"""
Sigil local inference sidecar.

Runs as a child process of the Tauri app. Downloads Qwen2.5-7B-Instruct
(GGUF, Q4_K_M) on first launch, then starts an OpenAI-compatible HTTP
server via llama-cpp-python. Tauri reads the readiness line from stdout
and then speaks the standard OpenAI chat-completions protocol against
the endpoint — including tool-calling, which Qwen2.5 handles natively.

Protocol (stdout, one JSON line on startup):

    {"ready": true, "endpoint": "http://127.0.0.1:PORT", "model": "..."}
  | {"ready": false, "error": "..."}

After the ready line, stdin is ignored. The process keeps the server
alive until the parent kills it.

Infrastructure — not part of the sigil tree. See architectural_invariants.md.
"""
from __future__ import annotations

import json
import logging
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stderr,
)
log = logging.getLogger("sigil-llm")

# Qwen2.5-7B-Instruct Q4_K_M — ~4.4 GB, strong tool-calling support, runs at
# 15-25 tok/s on Apple Silicon via llama.cpp's Metal backend.
MODEL_REPO = "bartowski/Qwen2.5-7B-Instruct-GGUF"
MODEL_FILE = "Qwen2.5-7B-Instruct-Q4_K_M.gguf"
HOST = "127.0.0.1"
PORT = int(os.environ.get("SIGIL_LLM_PORT", "8765"))
READY_TIMEOUT_S = 120.0


def _respond(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def _download_model() -> str:
    from huggingface_hub import hf_hub_download

    log.info("resolving model %s/%s (cache hit is instant)", MODEL_REPO, MODEL_FILE)
    path = hf_hub_download(repo_id=MODEL_REPO, filename=MODEL_FILE)
    log.info("model at %s", path)
    return path


def _wait_for_server(endpoint: str, timeout_s: float) -> bool:
    deadline = time.monotonic() + timeout_s
    url = endpoint + "/v1/models"
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if resp.status == 200:
                    return True
        except (urllib.error.URLError, ConnectionError, OSError):
            pass
        time.sleep(0.5)
    return False


def main() -> int:
    try:
        model_path = _download_model()
    except Exception as exc:
        log.exception("model download failed")
        _respond({"ready": False, "error": f"model download failed: {exc}"})
        return 1

    endpoint = f"http://{HOST}:{PORT}"
    # Qwen2.5 uses ChatML; chatml-function-calling adds proper tool-use
    # support on top. --n_gpu_layers -1 pushes every layer onto Metal on
    # Apple Silicon.
    cmd = [
        sys.executable,
        "-m",
        "llama_cpp.server",
        "--model", model_path,
        "--host", HOST,
        "--port", str(PORT),
        "--n_ctx", "8192",
        "--n_gpu_layers", "-1",
        "--chat_format", "chatml-function-calling",
    ]
    log.info("starting server: %s", " ".join(cmd))

    proc = subprocess.Popen(
        cmd,
        stdout=sys.stderr,
        stderr=sys.stderr,
        start_new_session=False,
    )

    try:
        if not _wait_for_server(endpoint, READY_TIMEOUT_S):
            proc.terminate()
            _respond({
                "ready": False,
                "error": f"server did not become ready within {READY_TIMEOUT_S:.0f}s",
            })
            return 1

        _respond({
            "ready": True,
            "endpoint": endpoint,
            "model": MODEL_REPO,
        })
        log.info("server ready at %s", endpoint)

        # Forward SIGTERM to the child so the server exits cleanly.
        def _terminate(signum, frame):
            log.info("received signal %s, terminating server", signum)
            proc.terminate()

        signal.signal(signal.SIGTERM, _terminate)
        signal.signal(signal.SIGINT, _terminate)

        proc.wait()
        return proc.returncode or 0
    except Exception as exc:
        log.exception("sidecar failed")
        _respond({"ready": False, "error": str(exc)})
        proc.terminate()
        return 1


if __name__ == "__main__":
    sys.exit(main())
