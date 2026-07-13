# Unified Upload Flow And Batch Safety

## Summary

The app asked reviewers to choose between Single and Batch modes before entering label data, which added avoidable friction for non-technical users. The batch API also bounded concurrency but not total submitted items, so large requests could queue unbounded work. The frontend file picker was narrower than common phone image formats, numeric fields allowed arbitrary text, and loading copy did not acknowledge Render cold starts.

## Broken Requirements

- Batch safety: batch requests need an env-configurable item cap enforced before image bytes are read.
- Frontend cold-start affordance: loading text should change if the first request takes more than a few seconds.
- Frontend input constraints: numeric fields should use numeric constraints or explicit validation.
- Usability: the UI should be simple for non-technical users and should not force a mode choice before upload.

## Root Cause

- The original frontend had separate `Single label` and `Batch review` tabs.
- `/verify/batch` used `BATCH_CONCURRENCY` but did not have `BATCH_MAX_ITEMS`.
- File inputs advertised only JPG, PNG, and WebP instead of letting users choose phone camera images and letting the backend validate support.
- ABV and net contents were text inputs.

## Implemented Fix

- Replaced mode tabs with one add-label form. One card submits to `/verify`; two or more cards submit to `/verify/batch`.
- Added `BATCH_MAX_ITEMS`, default `10`, and reject oversized batch JSON before reading images.
- Changed file inputs to `accept="image/*"` while preserving backend MIME enforcement.
- Changed ABV and net-content inputs to numeric controls and serialize them as `45%` and `750 mL`.
- Added a 3-second loading timeout that shows a Render cold-start message.

## Verification Checklist

- Backend oversized batch test returns HTTP 413 before vision runs.
- Frontend one-card smoke test posts `/verify` with image and seven fields.
- Frontend two-card smoke test posts `/verify/batch` with two images and items JSON.
- Frontend cold-start copy appears after three seconds during a delayed request.
- Backend tests, frontend tests, and live checklist pass.

## Current Verification Notes

- Backend tests pass: `34 passed`.
- Frontend smoke tests pass: `3 passed`.
- Live checklist passed and showed the cold-start warning path:
  - `WARNING health_ms=32523; possible cold start`
  - `verify ok verdict=NEEDS_REVIEW latency_ms=5624 fields=7`
  - `batch ok summary={'passed': 0, 'needs_review': 2, 'total': 2}`
  - `live checklist passed`
