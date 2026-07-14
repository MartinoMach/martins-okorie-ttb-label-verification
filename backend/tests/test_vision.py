from __future__ import annotations

import io

import pytest
from PIL import Image

from app.models import CANONICAL_GOVERNMENT_WARNING, ExtractedLabel
from app.vision import (
    FakeVisionService,
    MALFORMED_OUTPUT_NOTE,
    NO_OUTPUT_NOTE,
    VisionError,
    build_responses_payload,
    parse_extracted_label,
    preprocess_image,
)


def png_bytes() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (2400, 1800), color="white").save(output, format="PNG")
    return output.getvalue()


@pytest.mark.anyio
async def test_fake_vision_service_returns_valid_extracted_label():
    extracted = ExtractedLabel(
        brand_name="Old Harbor",
        class_type="Whiskey",
        abv="45%",
        net_contents="750 mL",
        producer="Okorie Spirits Co.",
        country_of_origin="USA",
        government_warning=CANONICAL_GOVERNMENT_WARNING,
        raw_text="Old Harbor Whiskey",
        extraction_confidence=0.91,
    )
    service = FakeVisionService(extracted)
    result = await service.extract_label(b"image", "image/png")
    assert result == extracted


def test_parse_extracted_label_accepts_output_text():
    expected = ExtractedLabel(brand_name="Old Harbor", raw_text="Old Harbor", extraction_confidence=0.8)
    payload = {"output_text": expected.model_dump_json()}
    assert parse_extracted_label(payload) == expected


def test_parse_extracted_label_accepts_nested_text_shape():
    expected = ExtractedLabel(brand_name="Old Harbor", raw_text="Old Harbor", extraction_confidence=0.8)
    payload = {"output": [{"content": [{"type": "output_text", "text": expected.model_dump_json()}]}]}
    assert parse_extracted_label(payload) == expected


def test_parse_extracted_label_degrades_malformed_json_to_reviewable_blank_extraction():
    result = parse_extracted_label({"output_text": "{not-json"})
    assert result.brand_name is None
    assert result.class_type is None
    assert result.abv is None
    assert result.net_contents is None
    assert result.producer is None
    assert result.country_of_origin is None
    assert result.government_warning is None
    assert result.raw_text == MALFORMED_OUTPUT_NOTE
    assert result.extraction_confidence == 0.0


def test_parse_extracted_label_degrades_missing_text_to_reviewable_blank_extraction():
    result = parse_extracted_label({"output": []})
    assert result.brand_name is None
    assert result.raw_text == NO_OUTPUT_NOTE
    assert result.extraction_confidence == 0.0


def test_preprocess_downscales_and_reencodes_image():
    processed, mime_type = preprocess_image(png_bytes(), "image/png")
    assert mime_type == "image/jpeg"
    assert len(processed) > 0
    with Image.open(io.BytesIO(processed)) as image:
        assert max(image.size) <= 1280


def test_openai_payload_uses_high_detail_and_bounded_output_for_warning_fidelity():
    payload = build_responses_payload(b"fake-jpeg", "image/jpeg", "gpt-4.1-mini")
    assert payload["model"] == "gpt-4.1-mini"
    image_part = payload["input"][0]["content"][1]
    assert image_part["type"] == "input_image"
    assert image_part["detail"] == "high"
    assert payload["max_output_tokens"] == 650


def test_preprocess_rejects_non_image_readably():
    with pytest.raises(VisionError, match="could not be read as an image"):
        preprocess_image(b"not an image", "text/plain")
