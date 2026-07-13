from __future__ import annotations

import os


def _csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


class Settings:
    openai_api_key: str | None = os.getenv("OPENAI_API_KEY") or None
    vision_model: str = os.getenv("VISION_MODEL", "gpt-4o-mini")
    frontend_origins: list[str] = _csv(
        os.getenv("FRONTEND_ORIGINS", "http://localhost:5173,http://localhost:8000")
    )
    max_image_bytes: int = int(os.getenv("MAX_IMAGE_BYTES", str(8 * 1024 * 1024)))
    vision_timeout_seconds: float = float(os.getenv("VISION_TIMEOUT_SECONDS", "4.2"))
    batch_concurrency: int = int(os.getenv("BATCH_CONCURRENCY", "3"))
    batch_max_items: int = int(os.getenv("BATCH_MAX_ITEMS", "10"))


settings = Settings()
