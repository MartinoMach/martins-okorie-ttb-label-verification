# README Demonstration Requirements

## Summary

The README is missing reviewer-facing sections required by the demonstrable requirements: a complete environment-variable table, copy-pasteable API examples, measured performance against the five-second target, and an approach/tools section describing the Codex workflow.

## Broken Requirements

- Environment variables: every variable read by the backend must be documented with required status, default, and purpose.
- API examples: reviewers need curl examples for single-label and batch verification, plus success and error response shapes.
- Performance: the README must show measured p50 and p95 single-label latency, how it was measured, and the Render cold-start caveat.
- Approach and tools: the README must describe the Codex Plan/Review/Execute cadence and which work was AI-assisted versus human-directed.

## Root Cause

- The README currently describes setup and deployment, but not all reviewer checklist sections by name.
- `backend/app/settings.py` reads runtime variables beyond `OPENAI_API_KEY`, and most are not documented in a table.
- No live performance measurement helper existed in the repo, so the under-five-second requirement had no repeatable measurement trail.

## Planned Fix

- Add a complete environment-variable table to the README.
- Add curl examples for `POST /verify` and `POST /verify/batch` with realistic application data.
- Add a live measurement script under `backend/scripts/measure_live_verify.py`.
- Run the script against the deployed API and document p50/p95 latency plus cold-start behavior.
- Add an Approach / Tools section describing the Codex workflow and human overrides.

## Current Verification Notes

- Backend tests pass locally.
- The live smoke script is repeatable and now returns HTTP 200 samples against the deployed backend.
- Latest live smoke run used one warm-up request and five measured samples: p50 `4331 ms`, p95 `4358 ms`, all `NEEDS_REVIEW` for the generated smoke image.
- README now documents the measurement command, p50/p95 values, and Render cold-start caveat.

## Verification Checklist

- README lists all variables read by `backend/app/settings.py`.
- README includes single and batch curl examples.
- README includes success and error response shapes.
- README includes measurement method and p50/p95 values.
- README includes Approach / Tools.
- Backend tests pass.
