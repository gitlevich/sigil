"""
Sigil local inference sidecar.

Runs as a child process of the Tauri app. Reads JSON requests from stdin,
writes JSON responses to stdout. Loads Phi-3 once at startup and keeps it
resident for the lifetime of the process.

Protocol (one JSON object per line, both directions):

  Request:  {"id": "...", "prompt": "...", "max_tokens": 1024}
  Response: {"id": "...", "content": "..."}
  Error:    {"id": "...", "error": "..."}

Readiness:  {"ready": true, "model": "..."}

Apple Silicon uses mlx-lm for Metal-accelerated inference. Other platforms
will need a different backend later; for now we target Apple Silicon only.

Infrastructure — not part of the sigil tree. See architectural_invariants.md.
"""
from __future__ import annotations

import json
import logging
import sys
from typing import Any

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stderr,
)
log = logging.getLogger("sigil-llm")

DEFAULT_MODEL = "mlx-community/Phi-3.5-mini-instruct-4bit"


def _respond(obj: dict[str, Any]) -> None:
    """Write one JSON object as a line to stdout and flush."""
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def _load_model(model_id: str):
    """Load the model. Imports are lazy so startup errors reach the caller."""
    log.info("loading model %s", model_id)
    from mlx_lm import load  # type: ignore

    model, tokenizer = load(model_id)
    log.info("model loaded")
    return model, tokenizer


def _generate(
    model,
    tokenizer,
    messages: list[dict[str, str]],
    max_tokens: int,
) -> str:
    from mlx_lm import generate  # type: ignore

    # Apply the model's chat template so the prompt is framed correctly —
    # Phi-3 stops cleanly at <|end|> only when the template owns the framing.
    formatted = tokenizer.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )
    raw = generate(
        model,
        tokenizer,
        prompt=formatted,
        max_tokens=max_tokens,
        verbose=False,
    )
    # Phi-3's raw generation includes end-of-turn control tokens; trim them
    # and anything that follows (model looping back into user/assistant turns).
    for stop in ("<|end|>", "<|user|>", "<|assistant|>", "<|system|>"):
        idx = raw.find(stop)
        if idx >= 0:
            raw = raw[:idx]
    return raw.strip()


def main() -> int:
    model_id = DEFAULT_MODEL

    try:
        model, tokenizer = _load_model(model_id)
    except Exception as exc:
        log.exception("model load failed")
        _respond({"ready": False, "error": f"model load failed: {exc}"})
        return 1

    _respond({"ready": True, "model": model_id})

    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            _respond({"id": None, "error": f"invalid json: {exc}"})
            continue

        request_id = request.get("id")
        max_tokens = int(request.get("max_tokens") or 512)

        # Accept either `messages` (preferred — real chat-template framing) or
        # a raw `prompt` (wrapped as a single user message).
        messages = request.get("messages")
        prompt = request.get("prompt")
        if isinstance(messages, list) and messages:
            turn_messages = messages
        elif isinstance(prompt, str) and prompt:
            turn_messages = [{"role": "user", "content": prompt}]
        else:
            _respond({"id": request_id, "error": "missing prompt or messages"})
            continue

        summary = ", ".join(
            f"{m.get('role','?')}={len(m.get('content',''))}ch"
            for m in turn_messages
        )
        log.info(
            "request id=%s messages=[%s] max_tokens=%d",
            request_id, summary, max_tokens,
        )

        try:
            import time as _t
            t0 = _t.monotonic()
            content = _generate(model, tokenizer, turn_messages, max_tokens)
            log.info(
                "generated id=%s in %.2fs, %d chars",
                request_id, _t.monotonic() - t0, len(content),
            )
            _respond({"id": request_id, "content": content})
        except Exception as exc:
            log.exception("generation failed")
            _respond({"id": request_id, "error": f"generation failed: {exc}"})

    return 0


if __name__ == "__main__":
    sys.exit(main())
