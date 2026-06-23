from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


CANONICAL_GOVERNMENT_WARNING = (
    "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink "
    "alcoholic beverages during pregnancy because of the risk of birth defects. "
    "(2) Consumption of alcoholic beverages impairs your ability to drive a car or "
    "operate machinery, and may cause health problems."
)


class ApplicationData(BaseModel):
    brand_name: str = Field(..., min_length=1)
    class_type: str = Field(..., min_length=1)
    abv: str = Field(..., min_length=1)
    net_contents: str = Field(..., min_length=1)
    producer: str = Field(..., min_length=1)
    country_of_origin: str = Field(..., min_length=1)
    government_warning: str = Field(default=CANONICAL_GOVERNMENT_WARNING, min_length=1)


class ExtractedLabel(BaseModel):
    brand_name: str | None = None
    class_type: str | None = None
    abv: str | None = None
    net_contents: str | None = None
    producer: str | None = None
    country_of_origin: str | None = None
    government_warning: str | None = None
    raw_text: str | None = None
    extraction_confidence: float | None = Field(default=None, ge=0, le=1)


class FieldResult(BaseModel):
    field: str
    match_type: str
    expected: str
    found: str | None
    status: Literal["PASS", "FAIL"]
    detail: str


class VerificationResult(BaseModel):
    results: list[FieldResult]
    overall_verdict: Literal["APPROVED", "NEEDS_REVIEW"]
    latency_ms: int = Field(default=0, ge=0)


class BatchItemResult(BaseModel):
    item_id: str
    result: VerificationResult | None = None
    error: str | None = None


class BatchResult(BaseModel):
    items: list[BatchItemResult]
    summary: dict[str, int]

