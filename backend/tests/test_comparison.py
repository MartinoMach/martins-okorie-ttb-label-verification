from __future__ import annotations

from app.comparison import compare_label
from app.models import ApplicationData, CANONICAL_GOVERNMENT_WARNING, ExtractedLabel


def expected(**overrides: str) -> ApplicationData:
    data = {
        "brand_name": "Old Harbor",
        "class_type": "Straight Bourbon Whiskey",
        "abv": "45%",
        "net_contents": "750 mL",
        "producer": "Okorie Spirits Co.",
        "country_of_origin": "United States",
        "government_warning": CANONICAL_GOVERNMENT_WARNING,
    }
    data.update(overrides)
    return ApplicationData(**data)


def found(**overrides: str) -> ExtractedLabel:
    data = {
        "brand_name": "Old Harbor",
        "class_type": "Straight Bourbon Whiskey",
        "abv": "45% Alc./Vol. (90 Proof)",
        "net_contents": "750ml",
        "producer": "Okorie Spirits Co.",
        "country_of_origin": "USA",
        "government_warning": CANONICAL_GOVERNMENT_WARNING,
        "raw_text": "sample label text",
        "extraction_confidence": 0.96,
    }
    data.update(overrides)
    return ExtractedLabel(**data)


def field(result, name):
    return next(item for item in result.results if item.field == name)


def test_case_only_brand_diff_passes():
    result = compare_label(expected(), found(brand_name="OLD HARBOR"))
    assert field(result, "brand_name").status == "PASS"


def test_abv_with_alc_vol_and_proof_passes():
    result = compare_label(expected(abv="45%"), found(abv="45% Alc./Vol. (90 Proof)"))
    assert field(result, "abv").status == "PASS"


def test_net_contents_spacing_passes():
    result = compare_label(expected(net_contents="750 mL"), found(net_contents="750ml"))
    assert field(result, "net_contents").status == "PASS"


def test_country_alias_passes():
    result = compare_label(expected(country_of_origin="United States"), found(country_of_origin="USA"))
    assert field(result, "country_of_origin").status == "PASS"


def test_government_warning_title_case_fails():
    title_case_warning = CANONICAL_GOVERNMENT_WARNING.title()
    result = compare_label(expected(), found(government_warning=title_case_warning))
    assert field(result, "government_warning").status == "FAIL"
    assert result.overall_verdict == "NEEDS_REVIEW"


def test_government_warning_missing_colon_fails():
    missing_colon = CANONICAL_GOVERNMENT_WARNING.replace("WARNING:", "WARNING", 1)
    result = compare_label(expected(), found(government_warning=missing_colon))
    assert field(result, "government_warning").status == "FAIL"


def test_government_warning_correct_all_caps_phrase_passes():
    result = compare_label(expected(), found(government_warning=CANONICAL_GOVERNMENT_WARNING))
    assert field(result, "government_warning").status == "PASS"


def test_misread_warning_returns_extracted_text():
    misread = CANONICAL_GOVERNMENT_WARNING.replace("Surgeon", "Sargeon")
    result = compare_label(expected(), found(government_warning=misread))
    warning = field(result, "government_warning")
    assert warning.status == "FAIL"
    assert warning.found == misread


def test_any_failed_field_sets_needs_review():
    result = compare_label(expected(), found(producer="Another Producer"))
    assert field(result, "producer").status == "FAIL"
    assert result.overall_verdict == "NEEDS_REVIEW"

