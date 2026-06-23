from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from app.vision import OpenAIVisionService


async def main() -> None:
    parser = argparse.ArgumentParser(description="Extract TTB label fields from one sample image.")
    parser.add_argument("image", type=Path)
    args = parser.parse_args()
    service = OpenAIVisionService()
    result = await service.extract_label(args.image.read_bytes(), "image/jpeg")
    print(result.model_dump_json(indent=2))


if __name__ == "__main__":
    asyncio.run(main())

