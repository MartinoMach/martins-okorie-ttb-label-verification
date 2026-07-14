from __future__ import annotations

import logging
import asyncio
import json
import time
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from .comparison import compare_label
from .models import ApplicationData, BatchItemResult, BatchResult, ExtractedLabel, VerificationResult
from .settings import settings
from .vision import (
    MALFORMED_OUTPUT_NOTE,
    NO_OUTPUT_NOTE,
    OpenAIVisionService,
    TIMEOUT_OUTPUT_NOTE,
    VisionError,
    VisionTimeoutError,
)

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
APPLICATION_FIELD_LABELS = {
    "brand_name": "Brand name",
    "class_type": "Class / type",
    "abv": "Alcohol by volume",
    "net_contents": "Net contents",
    "producer": "Producer",
    "country_of_origin": "Country of origin",
    "government_warning": "Government warning",
}
logger = logging.getLogger("ttb_label_verification")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if getattr(app.state, "vision_service", None) is None:
        app.state.vision_service = OpenAIVisionService()
    yield


app = FastAPI(title="TTB Label Verification API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.frontend_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "ttb-label-verification-api"}


@app.post("/verify", response_model=VerificationResult)
async def verify(
    request: Request,
    image: Annotated[UploadFile, File(...)],
    application_data: Annotated[str, Form(...)],
) -> VerificationResult:
    expected = _parse_application_data(application_data)
    image_bytes = await _read_image(image)
    return await _verify_one(request, image_bytes, image.content_type or "", expected)


@app.post("/verify/batch", response_model=BatchResult)
async def verify_batch(
    request: Request,
    images: Annotated[list[UploadFile], File(...)],
    items: Annotated[str, Form(...)],
) -> BatchResult:
    parsed_items = _parse_batch_items(items)
    if len(parsed_items) != len(images):
        raise HTTPException(
            status_code=400,
            detail=f"Batch has {len(parsed_items)} data item(s) but {len(images)} image file(s).",
        )

    semaphore = asyncio.Semaphore(settings.batch_concurrency)

    async def run_one(index: int) -> BatchItemResult:
        item_id = str(parsed_items[index].get("id") or f"Label {index + 1}")
        try:
            expected = ApplicationData.model_validate(parsed_items[index]["application_data"])
            image_bytes = await _read_image(images[index])
            async with semaphore:
                result = await _verify_one(request, image_bytes, images[index].content_type or "", expected)
            return BatchItemResult(item_id=item_id, result=result)
        except HTTPException as exc:
            return BatchItemResult(item_id=item_id, error=str(exc.detail))
        except (KeyError, ValidationError) as exc:
            return BatchItemResult(item_id=item_id, error=_application_data_error(exc, item_id))

    batch_items = await asyncio.gather(*(run_one(index) for index in range(len(images))))
    passed = sum(1 for item in batch_items if item.result and item.result.overall_verdict == "APPROVED")
    needs_review = len(batch_items) - passed
    return BatchResult(
        items=batch_items,
        summary={"passed": passed, "needs_review": needs_review, "total": len(batch_items)},
    )


async def _verify_one(
    request: Request,
    image_bytes: bytes,
    content_type: str,
    expected: ApplicationData,
) -> VerificationResult:
    started = time.perf_counter()
    try:
        if getattr(request.app.state, "vision_service", None) is None:
            request.app.state.vision_service = OpenAIVisionService()
        extracted = await request.app.state.vision_service.extract_label(image_bytes, content_type)
    except VisionTimeoutError:
        latency_ms = int((time.perf_counter() - started) * 1000)
        extracted = ExtractedLabel(raw_text=TIMEOUT_OUTPUT_NOTE, extraction_confidence=0.0)
        result = compare_label(expected, extracted, latency_ms=latency_ms)
        _attach_extraction_metadata(result, extracted, _extraction_note(extracted))
        logger.info("verify timed out verdict=%s latency_ms=%s", result.overall_verdict, latency_ms)
        return result
    except VisionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    latency_ms = int((time.perf_counter() - started) * 1000)
    result = compare_label(expected, extracted, latency_ms=latency_ms)
    _attach_extraction_metadata(result, extracted, _extraction_note(extracted))
    logger.info("verify completed verdict=%s latency_ms=%s", result.overall_verdict, latency_ms)
    return result


def _attach_extraction_metadata(
    result: VerificationResult,
    extracted: ExtractedLabel,
    extraction_note: str | None,
) -> None:
    result.extraction_note = extraction_note
    result.raw_text = extracted.raw_text
    result.extraction_confidence = extracted.extraction_confidence


def _extraction_note(extracted: ExtractedLabel) -> str | None:
    if extracted.raw_text == TIMEOUT_OUTPUT_NOTE:
        return "The label could not be read before the time limit. Try a clearer, closer photo."
    if extracted.raw_text == MALFORMED_OUTPUT_NOTE:
        return "The label response could not be read reliably. Review the label photo manually."
    if extracted.raw_text == NO_OUTPUT_NOTE:
        return "The label text could not be read. Try a closer, sharper photo."
    if not _has_extracted_fields(extracted):
        if extracted.extraction_confidence is not None and extracted.extraction_confidence <= 0.2:
            return "The label could not be read clearly. Try a closer, sharper photo."
        if extracted.raw_text:
            return "No required label fields were found. Review the image and application details."
        return "The label text could not be read. Try a closer, sharper photo."
    return None


def _has_extracted_fields(extracted: ExtractedLabel) -> bool:
    return any(
        getattr(extracted, field)
        for field in (
            "brand_name",
            "class_type",
            "abv",
            "net_contents",
            "producer",
            "country_of_origin",
            "government_warning",
        )
    )


def _parse_application_data(value: str) -> ApplicationData:
    try:
        return ApplicationData.model_validate_json(value)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=_application_data_error(exc)) from exc


def _application_data_error(exc: ValidationError | KeyError, item_id: str | None = None) -> str:
    prefix = "Invalid application data"
    if item_id:
        prefix = f"{prefix} for {item_id}"
    if isinstance(exc, KeyError):
        return f"{prefix}: Enter the application details for this label."

    missing_fields = []
    for error in exc.errors():
        error_type = error.get("type")
        if error_type == "json_invalid":
            return f"{prefix}: Application data must be valid JSON."
        loc = error.get("loc") or ["application details"]
        field = str(loc[0])
        if error_type in {"missing", "string_too_short"}:
            missing_fields.append(APPLICATION_FIELD_LABELS.get(field, field.replace("_", " ").title()))

    if missing_fields:
        fields = _join_human_list(missing_fields)
        return f"{prefix}: Enter {fields}."
    return f"{prefix}: Check the application details and try again."


def _join_human_list(values: list[str]) -> str:
    unique_values = list(dict.fromkeys(values))
    if len(unique_values) == 1:
        return unique_values[0]
    if len(unique_values) == 2:
        return f"{unique_values[0]} and {unique_values[1]}"
    return f"{', '.join(unique_values[:-1])}, and {unique_values[-1]}"


def _parse_batch_items(value: str) -> list[dict]:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Batch items must be valid JSON.") from exc
    if not isinstance(parsed, list) or not parsed:
        raise HTTPException(status_code=400, detail="Batch must include at least one label item.")
    if len(parsed) > settings.batch_max_items:
        raise HTTPException(
            status_code=413,
            detail=f"Batch is too large. Submit {settings.batch_max_items} labels or fewer at a time.",
        )
    if not all(isinstance(item, dict) for item in parsed):
        raise HTTPException(status_code=400, detail="Each batch item must be an object.")
    return parsed


async def _read_image(image: UploadFile) -> bytes:
    if not image.filename:
        raise HTTPException(status_code=400, detail="Choose an image file before submitting.")
    if image.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Use a JPG, PNG, or WebP image file.")
    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="The uploaded image is empty.")
    if len(image_bytes) > settings.max_image_bytes:
        limit_mb = settings.max_image_bytes // (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"Image is too large. Use a file under {limit_mb} MB.")
    return image_bytes
