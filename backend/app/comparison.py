from __future__ import annotations

import re
import string
from difflib import SequenceMatcher

from .models import ApplicationData, ExtractedLabel, FieldResult, VerificationResult

FUZZY_THRESHOLD = 0.90
ABV_TOLERANCE = 0.1
ML_TOLERANCE = 1.0

COUNTRY_ALIASES = {
    "america": "united states",
    "u s": "united states",
    "u s a": "united states",
    "u.s.": "united states",
    "u.s.a": "united states",
    "u.s.a.": "united states",
    "united states": "united states",
    "united states of america": "united states",
    "us": "united states",
    "usa": "united states",
    "great britain": "united kingdom",
    "u k": "united kingdom",
    "uk": "united kingdom",
    "united kingdom": "united kingdom",
}


def compare_label(
    expected: ApplicationData,
    found: ExtractedLabel,
    latency_ms: int = 0,
) -> VerificationResult:
    results = [
        _compare_fuzzy("brand_name", expected.brand_name, found.brand_name),
        _compare_fuzzy("class_type", expected.class_type, found.class_type),
        _compare_abv(expected.abv, found.abv),
        _compare_net_contents(expected.net_contents, found.net_contents),
        _compare_fuzzy("producer", expected.producer, found.producer),
        _compare_country(expected.country_of_origin, found.country_of_origin),
        _compare_government_warning(expected.government_warning, found.government_warning),
    ]
    verdict = "APPROVED" if all(item.status == "PASS" for item in results) else "NEEDS_REVIEW"
    return VerificationResult(results=results, overall_verdict=verdict, latency_ms=latency_ms)


def _result(
    field: str,
    match_type: str,
    expected: str,
    found: str | None,
    passed: bool,
    detail: str,
) -> FieldResult:
    return FieldResult(
        field=field,
        match_type=match_type,
        expected=expected,
        found=found,
        status="PASS" if passed else "FAIL",
        detail=detail,
    )


def _normalize_text(value: str | None) -> str:
    if not value:
        return ""
    lowered = value.casefold()
    without_punctuation = lowered.translate(str.maketrans("", "", string.punctuation))
    return re.sub(r"\s+", " ", without_punctuation).strip()


def _collapse_whitespace(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", value).strip()


def _compare_fuzzy(field: str, expected: str, found: str | None) -> FieldResult:
    expected_norm = _normalize_text(expected)
    found_norm = _normalize_text(found)
    ratio = SequenceMatcher(None, expected_norm, found_norm).ratio() if found_norm else 0.0
    return _result(
        field,
        "fuzzy",
        expected,
        found,
        ratio >= FUZZY_THRESHOLD,
        f"normalized fuzzy ratio {ratio:.2f}; threshold {FUZZY_THRESHOLD:.2f}",
    )


def _canonical_country(value: str | None) -> str:
    normalized = _normalize_text(value)
    return COUNTRY_ALIASES.get(normalized, normalized)


def _compare_country(expected: str, found: str | None) -> FieldResult:
    expected_country = _canonical_country(expected)
    found_country = _canonical_country(found)
    return _result(
        "country_of_origin",
        "country_synonym",
        expected,
        found,
        bool(found_country) and expected_country == found_country,
        f"canonical expected '{expected_country}' vs found '{found_country or 'missing'}'",
    )


def _extract_abv(value: str | None) -> float | None:
    if not value:
        return None
    text = value.casefold()
    percent = re.search(r"(\d+(?:\.\d+)?)\s*%", text)
    if percent:
        return float(percent.group(1))
    proof = re.search(r"(\d+(?:\.\d+)?)\s*proof", text)
    if proof:
        return float(proof.group(1)) / 2
    alcohol = re.search(r"(\d+(?:\.\d+)?)\s*(?:abv|alc\.?/vol\.?|alcohol)", text)
    if alcohol:
        return float(alcohol.group(1))
    number = re.search(r"(\d+(?:\.\d+)?)", text)
    return float(number.group(1)) if number else None


def _compare_abv(expected: str, found: str | None) -> FieldResult:
    expected_abv = _extract_abv(expected)
    found_abv = _extract_abv(found)
    passed = (
        expected_abv is not None
        and found_abv is not None
        and abs(expected_abv - found_abv) <= ABV_TOLERANCE
    )
    return _result(
        "abv",
        "numeric",
        expected,
        found,
        passed,
        f"expected {expected_abv if expected_abv is not None else 'missing'}% vs "
        f"found {found_abv if found_abv is not None else 'missing'}%; tolerance +/- {ABV_TOLERANCE}",
    )


def _extract_ml(value: str | None) -> float | None:
    if not value:
        return None
    text = value.casefold()
    text = text.replace("milliliters", "ml").replace("milliliter", "ml")
    text = text.replace("liters", "l").replace("liter", "l")
    match = re.search(r"(\d+(?:\.\d+)?)\s*(fl\s*oz|fluid\s*ounces?|ml|l)\b", text)
    if not match:
        return None
    amount = float(match.group(1))
    unit = match.group(2).replace(" ", "")
    if unit == "l":
        return amount * 1000
    if unit in {"floz", "fluidounce", "fluidounces"}:
        return amount * 29.5735
    return amount


def _compare_net_contents(expected: str, found: str | None) -> FieldResult:
    expected_ml = _extract_ml(expected)
    found_ml = _extract_ml(found)
    passed = (
        expected_ml is not None
        and found_ml is not None
        and abs(expected_ml - found_ml) <= ML_TOLERANCE
    )
    return _result(
        "net_contents",
        "unit",
        expected,
        found,
        passed,
        f"expected {expected_ml if expected_ml is not None else 'missing'} mL vs "
        f"found {found_ml if found_ml is not None else 'missing'} mL; tolerance +/- {ML_TOLERANCE} mL",
    )


def _compare_government_warning(expected: str, found: str | None) -> FieldResult:
    expected_warning = _collapse_whitespace(expected)
    found_warning = _collapse_whitespace(found)
    passed = bool(found_warning) and expected_warning == found_warning
    detail = "exact case-sensitive match after whitespace collapse"
    if not passed:
        detail = "warning differs; review the extracted text exactly as shown"
    return _result(
        "government_warning",
        "exact_case_sensitive",
        expected,
        found,
        passed,
        detail,
    )

