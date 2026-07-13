# Vision OCR Fidelity And Comparison Robustness

## Summary

The exact-match government warning was being read from a low-detail image, which compromised OCR fidelity on the clause that must match verbatim. Comparison also lacked producer role-prefix stripping and only handled US/UK country aliases, so labels using real-world wording such as "Produced and bottled by Acme", "France", or "Italy" were more likely to fail despite the brief requiring normalization. When the model returned malformed structured output, the request failed with HTTP 422 instead of surfacing a reviewable result.

## Broken Requirements

- Comparison strategy: fuzzy fields normalize case, punctuation, and whitespace before comparing.
- Country of origin: uses a synonym map.
- Producer: fuzzy comparison should handle routine label role prefixes.
- Vision robustness: vision failures raise typed exceptions and API responses should distinguish unreadable photos from reviewable extraction problems.
- Government warning: exact, case-sensitive matching makes OCR fidelity load-bearing.
- Vision service lifetime: instantiate once at startup, not at module import.

## Root Cause

- `backend/app/vision.py` used `"detail": "low"` for image input, which can downsample small-print warning text.
- `backend/app/comparison.py` compared producer strings after generic text normalization only, leaving leading role phrases in the fuzzy input.
- `COUNTRY_ALIASES` covered US/UK variants but not common producing countries and synonyms.
- `parse_extracted_label` raised `VisionError` for malformed model JSON, causing `backend/app/main.py` to return HTTP 422.
- `backend/app/main.py` created `OpenAIVisionService()` at import time, making startup behavior and test overrides easier to leak.

## Planned Fix

- Use high-detail vision input for extraction.
- Return a blank, low-confidence `ExtractedLabel` with a parse-failure note when structured model output is malformed.
- Preserve typed `VisionError` for configuration, transport, timeout, and image-read failures.
- Initialize the vision service during FastAPI startup if a test or caller has not already installed one.
- Strip producer role prefixes including produced, bottled, distilled, imported, vinted, and compound forms before fuzzy matching.
- Expand country aliases for France, Italy, Spain, Germany, Portugal, Mexico, Australia, Canada, Japan, Ireland, and Scotland.
- Document the current `SequenceMatcher` tradeoff in the README.

## Risks

- High-detail images may increase model latency or cost; the under-5-second requirement should be checked after deployment with real images.
- Producer prefix stripping should only remove leading role phrases ending in `by`; mid-name words should remain untouched.
- Returning blank extracted fields for malformed JSON keeps the API stable but may hide partial unparsed text unless the model response text is logged separately later.

## Verification Checklist

- Backend tests pass with no live OpenAI call.
- Malformed structured output returns HTTP 200 with `NEEDS_REVIEW`.
- True vision errors still return readable HTTP 422 responses.
- Producer role-prefix cases pass comparison.
- Representative country synonyms pass comparison.
- The government warning remains exact and case-sensitive.
