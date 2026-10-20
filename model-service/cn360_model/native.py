"""Small checked ABI over the upstream ggml pipeline; owns one resident context."""

import ctypes
import json
from pathlib import Path
from typing import Any


class NativeModel:
    def __init__(self, library: str, model: str, threads: int = 0) -> None:
        if not Path(library).is_file() or not Path(model).is_file():
            raise RuntimeError("model_or_library_missing")
        self.library = ctypes.CDLL(str(Path(library).resolve()))
        self.library.cn_load.argtypes = [ctypes.c_char_p, ctypes.c_int]
        self.library.cn_load.restype = ctypes.c_void_p
        self.library.cn_predict.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_char_p, ctypes.c_int]
        self.library.cn_predict.restype = ctypes.c_void_p
        self.library.cn_backend.argtypes = [ctypes.c_void_p]
        self.library.cn_backend.restype = ctypes.c_char_p
        self.library.cn_error.argtypes = []
        self.library.cn_error.restype = ctypes.c_char_p
        self.library.cn_free_string.argtypes = [ctypes.c_void_p]
        self.library.cn_free_string.restype = None
        self.library.cn_close.argtypes = [ctypes.c_void_p]
        self.library.cn_close.restype = None
        self.context = self.library.cn_load(str(Path(model).resolve()).encode("utf-8"), threads)
        if not self.context:
            raise RuntimeError(self.library.cn_error().decode("utf-8", errors="replace"))
        self.backend: str = self.library.cn_backend(self.context).decode("utf-8")

    def predict(self, data: bytes, prompt: str, mode: str) -> dict[str, Any]:
        buffer = ctypes.create_string_buffer(data)
        result = self.library.cn_predict(self.context, buffer, len(data), prompt.encode("utf-8"), {"hybrid": 0, "slow": 1, "fast": 2}[mode])
        if not result:
            raise RuntimeError(self.library.cn_error().decode("utf-8", errors="replace"))
        try:
            decoded: dict[str, Any] = json.loads(ctypes.string_at(result))
            return decoded
        finally:
            self.library.cn_free_string(result)

    def close(self) -> None:
        if self.context:
            self.library.cn_close(self.context)
            self.context = None
