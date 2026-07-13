# Live Smoke Test Coverage

## Summary

The project had unit tests and a sample vision script, but it did not have one checklist script that exercised the deployed backend end to end. A direct OpenAI sample can pass while Render is misconfigured, using the wrong model, missing an environment variable, timing out after cold start, or drifting from the frontend URL.

## Broken Requirements

- Live testing: at least one smoke test must call the deployed URL with a sample label image.
- README live smoke check: reviewers need the command and expected output.
- Frontend smoke coverage: the submit path must prove it posts the image plus all seven application fields, not only the image.

## Root Cause

- `backend/scripts/run_sample_vision.py` tests the vision client directly, bypassing the deployed FastAPI service.
- The performance smoke script measured `/verify`, but it did not assert the full response shape or exercise `/verify/batch`.
- The frontend had no test runner or DOM test around the submit `FormData`.

## Planned Fix

- Add `scripts/live_checklist.py` to call the deployed `/health`, `/verify`, and `/verify/batch` endpoints.
- Use a generated sample JPG so the script is repeatable without committing a binary fixture.
- Assert `/verify` returns HTTP 200, a valid verdict, integer latency, and seven field results.
- Assert `/verify/batch` returns HTTP 200 and the exact summary keys `passed`, `needs_review`, and `total`.
- Add a frontend jsdom smoke test that submits the single-label form and verifies outgoing `FormData` contains `image` and the seven application fields inside `application_data`.
- Document the live smoke command and expected output in README.

## Current Verification Notes

- Live checklist passes against the deployed backend:
  - `health ok health_ms=335`
  - `verify ok verdict=NEEDS_REVIEW latency_ms=4364 fields=7`
  - `batch ok summary={'passed': 0, 'needs_review': 2, 'total': 2}`
  - `live checklist passed`
- Frontend smoke test passes with `npm test`.
- Backend tests pass with `33 passed`.

## Verification Checklist

- `python scripts/live_checklist.py` passes against the deployed API.
- `cd frontend && npm test` passes.
- `cd backend && ../.venv/bin/python -m pytest` passes.
- README includes the live smoke check section.
