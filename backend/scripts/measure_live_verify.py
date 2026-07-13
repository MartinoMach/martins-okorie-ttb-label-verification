from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
from PIL import Image, ImageDraw

from app.models import CANONICAL_GOVERNMENT_WARNING


APPLICATION_DATA = {
    "brand_name": "Old Harbor",
    "class_type": "Straight Bourbon Whiskey",
    "abv": "45%",
    "net_contents": "750 mL",
    "producer": "Okorie Spirits Co.",
    "country_of_origin": "United States",
    "government_warning": CANONICAL_GOVERNMENT_WARNING,
}


def generated_label_image() -> Path:
    output = Path(tempfile.gettempdir()) / "ttb-live-smoke-label.jpg"
    image = Image.new("RGB", (420, 420), "white")
    draw = ImageDraw.Draw(image)
    lines = [
        "OLD HARBOR",
        "Bourbon Whiskey",
        "45% Alc./Vol. (90 Proof)",
        "750 mL",
        "Okorie Spirits Co.",
        "United States",
    ]
    y = 45
    for line in lines:
        draw.text((40, y), line, fill="black")
        y += 55
    image.save(output, format="JPEG", quality=92)
    return output


def percentile(values: list[float], percentile_value: int) -> float:
    ordered = sorted(values)
    index = max(0, math.ceil((percentile_value / 100) * len(ordered)) - 1)
    return ordered[index]


def summarize(values: list[float]) -> dict[str, float]:
    return {
        "p50": statistics.median(values),
        "p95": percentile(values, 95),
        "min": min(values),
        "max": max(values),
    }


def verify_once(client: httpx.Client, url: str, image_path: Path) -> tuple[float, dict[str, Any]]:
    started = time.perf_counter()
    with image_path.open("rb") as image_file:
        response = client.post(
            f"{url.rstrip('/')}/verify",
            data={"application_data": json.dumps(APPLICATION_DATA)},
            files={"image": (image_path.name, image_file, "image/jpeg")},
        )
    wall_ms = (time.perf_counter() - started) * 1000
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise SystemExit(f"{exc}; response={response.text[:500]}") from exc
    return wall_ms, response.json()


def main() -> None:
    parser = argparse.ArgumentParser(description="Measure live POST /verify latency.")
    parser.add_argument("--url", required=True, help="Backend base URL, for example https://example.onrender.com")
    parser.add_argument("--runs", type=int, default=5, help="Number of measured POST /verify calls")
    parser.add_argument("--warmup", type=int, default=1, help="Warm-up calls excluded from p50/p95")
    parser.add_argument("--image", type=Path, default=None, help="Optional JPG label image path")
    args = parser.parse_args()

    if args.runs < 1:
        raise SystemExit("--runs must be at least 1")
    if args.warmup < 0:
        raise SystemExit("--warmup must be at least 0")

    image_path = args.image or generated_label_image()
    wall_latencies: list[float] = []
    api_latencies: list[float] = []
    verdicts: list[str] = []

    with httpx.Client(timeout=45.0) as client:
        for warmup in range(1, args.warmup + 1):
            wall_ms, payload = verify_once(client, args.url, image_path)
            print(
                f"warmup={warmup} wall_ms={wall_ms:.0f} "
                f"api_latency_ms={payload['latency_ms']} verdict={payload['overall_verdict']}"
            )
        for run in range(1, args.runs + 1):
            wall_ms, payload = verify_once(client, args.url, image_path)
            wall_latencies.append(wall_ms)
            api_latencies.append(float(payload["latency_ms"]))
            verdicts.append(payload["overall_verdict"])
            print(
                f"run={run} wall_ms={wall_ms:.0f} "
                f"api_latency_ms={payload['latency_ms']} verdict={payload['overall_verdict']}"
            )

    wall = summarize(wall_latencies)
    api = summarize(api_latencies)
    print()
    print(f"image={image_path}")
    print(f"warmup={args.warmup}")
    print(f"runs={args.runs}")
    print(f"wall_p50_ms={wall['p50']:.0f}")
    print(f"wall_p95_ms={wall['p95']:.0f}")
    print(f"api_p50_ms={api['p50']:.0f}")
    print(f"api_p95_ms={api['p95']:.0f}")
    print(f"verdicts={','.join(verdicts)}")


if __name__ == "__main__":
    main()
