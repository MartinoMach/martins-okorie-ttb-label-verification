from __future__ import annotations

import base64
import io
from typing import Any, Protocol

import httpx
from PIL import Image, UnidentifiedImageError

from .models import ExtractedLabel
from .settings import Settings, settings

MALFORMED_OUTPUT_NOTE = "The model output could not be parsed. Review the label photo manually."
NO_OUTPUT_NOTE = "The vision model returned no readable label text. Review the label photo manually."
TIMEOUT_OUTPUT_NOTE = "The vision model timed out. Review the label photo manually."


class VisionError(RuntimeError):
    """Raised when label extraction cannot produce usable structured data."""


class VisionTimeoutError(VisionError):
    """Raised when the vision model exceeds the configured request timeout."""


class VisionService(Protocol):
    async def extract_label(self, image_bytes: bytes, content_type: str) -> ExtractedLabel:
        ...


class OpenAIVisionService:
    def __init__(self, config: Settings = settings) -> None:
        self.config = config

    async def extract_label(self, image_bytes: bytes, content_type: str) -> ExtractedLabel:
        if not self.config.openai_api_key:
            raise VisionError("Vision extraction is not configured. Set OPENAI_API_KEY on the backend.")

        processed, mime_type = preprocess_image(image_bytes, content_type)
        payload = build_responses_payload(processed, mime_type, self.config.vision_model)
        headers = {
            "Authorization": f"Bearer {self.config.openai_api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=self.config.vision_timeout_seconds) as client:
                response = await client.post("https://api.openai.com/v1/responses", json=payload, headers=headers)
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise VisionTimeoutError("Vision model timed out. Try a clearer or smaller image.") from exc
        except httpx.HTTPStatusError as exc:
            body = exc.response.text[:240] if exc.response is not None else "unknown API error"
            raise VisionError(f"Vision model request failed: {body}") from exc
        except httpx.HTTPError as exc:
            raise VisionError("Vision model request failed before a response was received.") from exc

        return parse_extracted_label(response.json())


class FakeVisionService:
    def __init__(self, extracted: ExtractedLabel | None = None, error: Exception | None = None) -> None:
        self.extracted = extracted or ExtractedLabel()
        self.error = error

    async def extract_label(self, image_bytes: bytes, content_type: str) -> ExtractedLabel:
        if self.error:
            raise self.error
        return self.extracted


def preprocess_image(image_bytes: bytes, content_type: str) -> tuple[bytes, str]:
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            image = image.convert("RGB")
            image.thumbnail((1280, 1280))
            output = io.BytesIO()
            image.save(output, format="JPEG", quality=80, optimize=True)
            return output.getvalue(), "image/jpeg"
    except UnidentifiedImageError as exc:
        raise VisionError("The uploaded file could not be read as an image.") from exc


def build_responses_payload(processed_image: bytes, mime_type: str, model: str) -> dict[str, Any]:
    encoded = base64.b64encode(processed_image).decode("ascii")
    return {
        "model": model,
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": extraction_prompt()},
                    {
                        "type": "input_image",
                        "image_url": f"data:{mime_type};base64,{encoded}",
                        "detail": "high",
                    },
                ],
            }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "extracted_ttb_label",
                "strict": True,
                "schema": extracted_label_schema(),
            }
        },
        "max_output_tokens": 650,
    }


def extraction_prompt() -> str:
    return (
        "Extract TTB alcohol-label data. Return only JSON matching the schema. "
        "Fields: brand_name, class_type, abv, net_contents, producer, country_of_origin, "
        "government_warning, raw_text, extraction_confidence. Use null for unknown, missing, "
        "blurry, angled, glared, or uncertain fields; return partial data when possible. "
        "Copy government_warning verbatim exactly as printed, preserving case, punctuation, "
        "colon, parentheses, and wording. raw_text should be concise visible label text only. "
        "If the image is not a label, return null fields, concise raw_text, and low confidence."
    )


def extracted_label_schema() -> dict[str, Any]:
    nullable_string = {"type": ["string", "null"]}
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "brand_name": nullable_string,
            "class_type": nullable_string,
            "abv": nullable_string,
            "net_contents": nullable_string,
            "producer": nullable_string,
            "country_of_origin": nullable_string,
            "government_warning": nullable_string,
            "raw_text": nullable_string,
            "extraction_confidence": {"type": ["number", "null"], "minimum": 0, "maximum": 1},
        },
        "required": [
            "brand_name",
            "class_type",
            "abv",
            "net_contents",
            "producer",
            "country_of_origin",
            "government_warning",
            "raw_text",
            "extraction_confidence",
        ],
    }


def parse_extracted_label(payload: dict[str, Any]) -> ExtractedLabel:
    text = payload.get("output_text")
    if not text:
        text = _find_output_text(payload)
    if not text:
        return ExtractedLabel(raw_text=NO_OUTPUT_NOTE, extraction_confidence=0.0)
    try:
        return ExtractedLabel.model_validate_json(text)
    except Exception:
        return ExtractedLabel(raw_text=MALFORMED_OUTPUT_NOTE, extraction_confidence=0.0)


def _find_output_text(value: Any) -> str | None:
    if isinstance(value, dict):
        if value.get("type") in {"output_text", "text"} and isinstance(value.get("text"), str):
            return value["text"]
        for child in value.values():
            found = _find_output_text(child)
            if found:
                return found
    if isinstance(value, list):
        for child in value:
            found = _find_output_text(child)
            if found:
                return found
    return None
