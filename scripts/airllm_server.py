"""Local-only OpenAI-compatible bridge for AirLLM.

This server never installs packages or downloads a model until the user explicitly
starts it from the desktop app. AirLLM may reduce VRAM use, but model preparation
still needs large amounts of disk space and inference can be very slow.
"""

from __future__ import annotations

import argparse
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

MODEL: Any = None
TOKENIZER: Any = None
MODEL_ERROR: str | None = None
MODEL_STATUS = "loading"
MODEL_LOCK = threading.Lock()
MODEL_ID = ""


def load_model(args: argparse.Namespace) -> None:
    global MODEL, TOKENIZER, MODEL_ERROR, MODEL_STATUS
    try:
        from airllm import AutoModel

        options: dict[str, Any] = {}
        if args.compression:
            options["compression"] = args.compression
        if args.cache_dir:
            os.makedirs(args.cache_dir, exist_ok=True)
            options["layer_shards_saving_path"] = args.cache_dir
        token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
        if token:
            options["hf_token"] = token

        MODEL = AutoModel.from_pretrained(args.model, **options)
        TOKENIZER = MODEL.tokenizer
        MODEL_STATUS = "ready"
    except Exception as exc:  # reported through /health without a traceback or secret
        MODEL_ERROR = f"{type(exc).__name__}: {exc}"
        MODEL_STATUS = "error"


def build_prompt(messages: list[dict[str, Any]]) -> str:
    cleaned = [
        {"role": item.get("role", "user"), "content": str(item.get("content", ""))}
        for item in messages
        if item.get("role") in {"system", "user", "assistant"}
    ]
    if hasattr(TOKENIZER, "apply_chat_template"):
        try:
            return TOKENIZER.apply_chat_template(
                cleaned, tokenize=False, add_generation_prompt=True
            )
        except Exception:
            pass
    return "\n\n".join(
        f"{item['role'].upper()}: {item['content']}" for item in cleaned
    ) + "\n\nASSISTANT:"


def generate(payload: dict[str, Any]) -> str:
    import torch

    messages = payload.get("messages")
    if not isinstance(messages, list) or not messages:
        raise ValueError("messages must be a non-empty array")
    requested_tokens = int(payload.get("max_tokens", 256))
    max_new_tokens = max(1, min(requested_tokens, 2048))
    prompt = build_prompt(messages)
    encoded = TOKENIZER(
        prompt,
        return_tensors="pt",
        return_attention_mask=False,
        truncation=True,
        max_length=8192,
        padding=False,
    )
    input_ids = encoded["input_ids"]
    if torch.cuda.is_available():
        input_ids = input_ids.cuda()

    with MODEL_LOCK, torch.inference_mode():
        result = MODEL.generate(
            input_ids,
            max_new_tokens=max_new_tokens,
            use_cache=True,
            return_dict_in_generate=True,
        )
    generated = result.sequences[0][input_ids.shape[-1] :]
    return TOKENIZER.decode(generated, skip_special_tokens=True).strip()


class Handler(BaseHTTPRequestHandler):
    server_version = "IrohAirLLM/1.0"

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        if self.path == "/health":
            detail = (
                MODEL_ERROR
                if MODEL_STATUS == "error"
                else "Model is ready."
                if MODEL_STATUS == "ready"
                else "Model is loading or being split into layer shards."
            )
            self.send_json(200, {"status": MODEL_STATUS, "detail": detail})
            return
        if self.path == "/v1/models":
            self.send_json(
                200,
                {"object": "list", "data": [{"id": MODEL_ID, "object": "model"}]},
            )
            return
        self.send_json(404, {"error": {"message": "Not found"}})

    def do_POST(self) -> None:
        if self.path != "/v1/chat/completions":
            self.send_json(404, {"error": {"message": "Not found"}})
            return
        if MODEL_STATUS != "ready":
            self.send_json(
                503,
                {
                    "error": {
                        "message": MODEL_ERROR
                        or "AirLLM model is still loading. Check /health."
                    }
                },
            )
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 2 * 1024 * 1024:
                raise ValueError("request body must be between 1 byte and 2 MB")
            payload = json.loads(self.rfile.read(length))
            text = generate(payload)
            self.send_json(
                200,
                {
                    "id": f"airllm-{int(time.time())}",
                    "object": "chat.completion",
                    "model": MODEL_ID,
                    "choices": [
                        {
                            "index": 0,
                            "message": {"role": "assistant", "content": text},
                            "finish_reason": "stop",
                        }
                    ],
                },
            )
        except Exception as exc:
            self.send_json(
                400, {"error": {"message": f"{type(exc).__name__}: {exc}"}}
            )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--port", type=int, default=11435)
    parser.add_argument("--cache-dir")
    parser.add_argument("--compression", choices=["4bit", "8bit"])
    args = parser.parse_args()

    if not 1024 <= args.port <= 65535:
        raise SystemExit("port must be between 1024 and 65535")

    global MODEL_ID
    MODEL_ID = args.model
    threading.Thread(target=load_model, args=(args,), daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
