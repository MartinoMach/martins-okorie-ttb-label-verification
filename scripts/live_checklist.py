from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from scripts.measure_live_verify import APPLICATION_DATA, generated_label_image


EXPECTED_FIELDS = {
    "brand_name",
    "class_type",
    "abv",
    "net_contents",
    "producer",
    "country_of_origin",
    "government_warning",
}
EXPECTED_SUMMARY_KEYS = {"passed", "needs_review", "total"}
EXPECTED_VERDICTS = {"APPROVED", "NEEDS_REVIEW"}


def assert_condition(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def post_verify(client: httpx.Client, base_url: str, image_path: Path) -> dict[str, Any]:
    with image_path.open("rb") as image_file:
        response = client.post(
            f"{base_url.rstrip('/')}/verify",
            data={"application_data": json.dumps(APPLICATION_DATA)},
            files={"image": (image_path.name, image_file, "image/jpeg")},
        )
    assert_condition(response.status_code == 200, f"/verify returned {response.status_code}: {response.text[:500]}")
    payload = response.json()
    assert_condition(payload.get("overall_verdict") in EXPECTED_VERDICTS, "/verify returned an invalid verdict")
    assert_condition(isinstance(payload.get("latency_ms"), int), "/verify missing integer latency_ms")
    assert_condition(len(payload.get("results", [])) == 7, "/verify results must include seven fields")
    fields = {item.get("field") for item in payload["results"]}
    assert_condition(fields == EXPECTED_FIELDS, f"/verify fields mismatch: {sorted(fields)}")
    return payload


def post_batch(client: httpx.Client, base_url: str, image_path: Path) -> dict[str, Any]:
    items = [
        {"id": "Smoke Label A", "application_data": APPLICATION_DATA},
        {"id": "Smoke Label B", "application_data": APPLICATION_DATA},
    ]
    with image_path.open("rb") as first_image, image_path.open("rb") as second_image:
        response = client.post(
            f"{base_url.rstrip('/')}/verify/batch",
            data={"items": json.dumps(items)},
            files=[
                ("images", (image_path.name, first_image, "image/jpeg")),
                ("images", (image_path.name, second_image, "image/jpeg")),
            ],
        )
    assert_condition(response.status_code == 200, f"/verify/batch returned {response.status_code}: {response.text[:500]}")
    payload = response.json()
    assert_condition(set(payload.get("summary", {}).keys()) == EXPECTED_SUMMARY_KEYS, "batch summary keys mismatch")
    assert_condition(payload["summary"]["total"] == 2, "batch total must be 2")
    assert_condition(len(payload.get("items", [])) == 2, "batch response must include two items")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Run live deployed backend smoke checks.")
    parser.add_argument("--url", default="https://ttb-label-verification-api-zgnb.onrender.com")
    parser.add_argument("--image", type=Path, default=None, help="Optional JPG sample label image path")
    args = parser.parse_args()

    image_path = args.image or generated_label_image()
    base_url = args.url.rstrip("/")

    with httpx.Client(timeout=60.0) as client:
        started = time.perf_counter()
        health = client.get(f"{base_url}/health")
        health_ms = (time.perf_counter() - started) * 1000
        assert_condition(health.status_code == 200, f"/health returned {health.status_code}: {health.text[:500]}")
        if health_ms > 5000:
            print(f"WARNING health_ms={health_ms:.0f}; possible cold start")
        else:
            print(f"health ok health_ms={health_ms:.0f}")

        verify_payload = post_verify(client, base_url, image_path)
        print(
            "verify ok "
            f"verdict={verify_payload['overall_verdict']} "
            f"latency_ms={verify_payload['latency_ms']} "
            f"fields={len(verify_payload['results'])}"
        )

        batch_payload = post_batch(client, base_url, image_path)
        print(f"batch ok summary={batch_payload['summary']}")

    print("live checklist passed")


if __name__ == "__main__":
    main()
