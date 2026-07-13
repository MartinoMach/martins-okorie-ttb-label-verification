# TTB Label Verification

Proof-of-concept web app for checking alcohol label images against structured TTB application data. A plain JavaScript frontend sends an image plus application values to a FastAPI backend, the backend extracts label fields with an OpenAI vision model, compares each field, and returns per-field `PASS` / `FAIL` plus an overall verdict.

## Final Submission Links

Public repo: [https://github.com/MartinoMach/martins-okorie-ttb-label-verification](https://github.com/MartinoMach/martins-okorie-ttb-label-verification)

Live frontend: [https://ttb-label-verification-frontend-zgnb.vercel.app/](https://ttb-label-verification-frontend-zgnb.vercel.app/)

Backend API: [https://ttb-label-verification-api-zgnb.onrender.com](https://ttb-label-verification-api-zgnb.onrender.com)

Backend health: [https://ttb-label-verification-api-zgnb.onrender.com/health](https://ttb-label-verification-api-zgnb.onrender.com/health)

## What Is Implemented

- Unified upload flow with one label card by default; one card submits to `/verify`, and adding more cards submits to `/verify/batch`.
- Batch verification has bounded backend concurrency, an env-configurable item cap, per-item error isolation, summary counts, and drill-down field details.
- FastAPI backend with `GET /health`, `POST /verify`, and `POST /verify/batch`.
- OpenAI Responses API vision extraction with strict structured JSON output.
- Image preprocessing that downscales and re-encodes uploads before model calls.
- Stateless request handling with no database.
- Tests that use a fake vision service so automated checks do not call the OpenAI API.

## Architecture

- Frontend: plain HTML, CSS, and JavaScript hosted on Vercel.
- Backend: Python 3.12+ FastAPI hosted on Render, with Render pinned to Python 3.12.8.
- Vision service: OpenAI image input returning an `ExtractedLabel` schema.
- Comparison engine: pure Python functions over typed Pydantic models.
- Storage: none; each request is self-contained.
- Secrets: environment variables only.

## Environment Variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | Yes for real extraction | None | OpenAI API key for the Responses endpoint. |
| `VISION_MODEL` | No | `gpt-4o-mini` | OpenAI model used for label extraction. |
| `FRONTEND_ORIGINS` | No | `http://localhost:5173,http://localhost:8000` | CORS allow-list for browser origins. |
| `MAX_IMAGE_BYTES` | No | `8388608` | Per-image upload size cap in bytes. |
| `VISION_TIMEOUT_SECONDS` | No | `4.2` | `httpx` timeout for the OpenAI request. |
| `BATCH_CONCURRENCY` | No | `3` | Semaphore limit for concurrent batch items. |
| `BATCH_MAX_ITEMS` | No | `10` | Maximum labels accepted in one batch request. |

## Data And Comparison Rules

The application checks seven fields: `brand_name`, `class_type`, `abv`, `net_contents`, `producer`, `country_of_origin`, and `government_warning`.

- Brand name, class/type, producer: normalized fuzzy match at threshold `0.90`.
- Country of origin: normalized aliases such as `USA`, `U.S.A.`, `United States`, `UK`, and `United Kingdom`.
- Alcohol content: numeric ABV normalization with `+/- 0.1` tolerance.
- Net contents: unit normalization to milliliters with `+/- 1.0 mL` tolerance.
- Government warning: exact case-sensitive match after whitespace collapse only.
- Verdict: any failed field returns `NEEDS_REVIEW`; all fields passing returns `APPROVED`.

Fuzzy text comparison uses Python `SequenceMatcher`, which avoids broad token-set false positives such as `ACME` passing against `ACME RESERVE`. The tradeoff is that reordered words like `ACME Reserve` vs `Reserve ACME` may still need reviewer attention.

## Local Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt
cp .env.example .env
```

For real local vision extraction, add a fresh OpenAI API key to `.env`:

```text
OPENAI_API_KEY=your_new_key_here
```

The previously exposed key should be revoked and replaced.

## Run Locally

Backend:

```bash
cd backend
../.venv/bin/uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
API_BASE_URL=http://localhost:8000 npm run build
python3 -m http.server 5173
```

Open [http://localhost:5173](http://localhost:5173).

## API

`GET /health`

- Returns backend status.

`POST /verify`

- Multipart field `image`: JPG, PNG, or WebP.
- Multipart field `application_data`: JSON matching the seven application fields.
- Returns field results, expected/found values, overall verdict, and `latency_ms`.

Example:

```bash
curl -s https://ttb-label-verification-api-zgnb.onrender.com/verify \
  -F 'image=@path/to/label.jpg;type=image/jpeg' \
  -F 'application_data={
    "brand_name":"Old Harbor",
    "class_type":"Straight Bourbon Whiskey",
    "abv":"45%",
    "net_contents":"750 mL",
    "producer":"Okorie Spirits Co.",
    "country_of_origin":"United States",
    "government_warning":"GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems."
  }'
```

`POST /verify/batch`

- Multipart field `images`: repeated image files.
- Multipart field `items`: JSON array matching image order. Each item has `id` and `application_data`.
- Returns per-item result or error plus summary counts: `passed`, `needs_review`, and `total`.

Example:

```bash
curl -s https://ttb-label-verification-api-zgnb.onrender.com/verify/batch \
  -F 'images=@path/to/label-a.jpg;type=image/jpeg' \
  -F 'images=@path/to/label-b.jpg;type=image/jpeg' \
  -F 'items=[
    {
      "id":"Label A",
      "application_data":{
        "brand_name":"Old Harbor",
        "class_type":"Straight Bourbon Whiskey",
        "abv":"45%",
        "net_contents":"750 mL",
        "producer":"Okorie Spirits Co.",
        "country_of_origin":"United States",
        "government_warning":"GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems."
      }
    },
    {
      "id":"Label B",
      "application_data":{
        "brand_name":"Old Harbor",
        "class_type":"Straight Bourbon Whiskey",
        "abv":"45%",
        "net_contents":"750 mL",
        "producer":"Okorie Spirits Co.",
        "country_of_origin":"United States",
        "government_warning":"GOVERNMENT WARNING: (1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems."
      }
    }
  ]'
```

Successful single-label response shape:

```json
{
  "results": [
    {
      "field": "brand_name",
      "match_type": "fuzzy",
      "expected": "Old Harbor",
      "found": "Old Harbor",
      "status": "PASS",
      "detail": "normalized fuzzy ratio 1.00; threshold 0.90"
    }
  ],
  "overall_verdict": "APPROVED",
  "latency_ms": 2100
}
```

Successful batch response shape:

```json
{
  "items": [
    {
      "item_id": "Label A",
      "result": {
        "results": [],
        "overall_verdict": "NEEDS_REVIEW",
        "latency_ms": 2100
      },
      "error": null
    }
  ],
  "summary": {
    "passed": 0,
    "needs_review": 1,
    "total": 1
  }
}
```

Error response shape:

```json
{
  "detail": "Use a JPG, PNG, or WebP image file."
}
```

## Performance

Single-label performance is measured with the live smoke script:

```bash
cd backend
../.venv/bin/python scripts/measure_live_verify.py \
  --url https://ttb-label-verification-api-zgnb.onrender.com \
  --warmup 1 \
  --runs 5
```

The script posts to `POST /verify`, uses the seven-field application payload shown above, runs one warm-up request outside the p50/p95 sample, and generates `/tmp/ttb-live-smoke-label.jpg` when no image is supplied.

Latest measurement on July 13, 2026:

| Metric | Result |
| --- | --- |
| Successful samples | `5 / 5` |
| Warm-up request | `5741 ms` API latency |
| p50 single-label latency | `4331 ms` API latency |
| p95 single-label latency | `4358 ms` API latency |
| Verdicts | All `NEEDS_REVIEW` for the generated smoke image |

Render cold starts can push the first request past 10 seconds. In this measured run, steady-state single-label responses stayed under the 5-second target.

## Live Smoke Check

Run the live checklist against the deployed Render API:

```bash
python3 scripts/live_checklist.py
```

The script:

- calls deployed `GET /health` and warns if it takes more than 5 seconds, which makes cold starts visible
- posts a generated sample JPG plus a filled seven-field `application_data` payload to deployed `POST /verify`
- asserts the response is HTTP 200, has `overall_verdict` of `APPROVED` or `NEEDS_REVIEW`, includes `latency_ms`, and returns seven field results
- posts two generated sample JPGs to deployed `POST /verify/batch`
- asserts the batch summary keys are exactly `passed`, `needs_review`, and `total`

Expected output:

```text
health ok health_ms=123
verify ok verdict=NEEDS_REVIEW latency_ms=4321 fields=7
batch ok summary={'passed': 0, 'needs_review': 2, 'total': 2}
live checklist passed
```

This check requires a valid `OPENAI_API_KEY` on the backend host. It does not require a local OpenAI key because it exercises the deployed service end to end.

## Deployment

Render backend:

- Uses `render.yaml`.
- Keeps `PYTHON_VERSION=3.12.8` to match the Python 3.12+ project requirement.
- Stores `OPENAI_API_KEY` as a secret environment variable in Render only.
- Runs `pip install -r requirements.txt`.
- Starts with `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.

Vercel frontend:

- Deploys the `frontend` directory.
- Build command: `npm run build`.
- Output directory: `.`.
- Build-time env var: `API_BASE_URL=https://ttb-label-verification-api-zgnb.onrender.com`.
- Production deployment protection must allow public access without Vercel SSO.

## Secret Handling

- Render gets `OPENAI_API_KEY`.
- Vercel gets `API_BASE_URL`.
- Local development can use `.env`.
- `.env.example` contains placeholders only.
- Never put an OpenAI API key in README, GitHub, Vercel, `render.yaml`, `.env.example`, or chat.

## Tests And Submission Audit

Run backend tests:

```bash
cd backend
../.venv/bin/pytest
```

Run frontend smoke test:

```bash
cd frontend
npm test
```

Run the final audit:

```bash
git status --short
git grep -n -E 'sk-[A-Za-z0-9_-]{20,}' -- ':!.venv'
git grep -n -E 'AIza[0-9A-Za-z_-]{20,}' -- ':!.venv'
git log --all -p -G 'sk-[A-Za-z0-9_-]{20,}'
git log --all -p -G 'AIza[0-9A-Za-z_-]{20,}'
git check-ignore .env
curl -sIL https://ttb-label-verification-frontend-zgnb.vercel.app/
curl https://ttb-label-verification-api-zgnb.onrender.com/health
```

Expected results:

- `.env` is ignored.
- No OpenAI or Google-style API key pattern appears in committed source or git history.
- Frontend URL returns a public page, not a Vercel SSO redirect.
- Backend tests pass.
- Backend health returns `{"status":"ok","service":"ttb-label-verification-api"}`.

## Approach And Tools

The project used Codex with the Plan / Review / Execute cadence described in `AGENTS.md`. Planning turns identified the smallest safe scope, review turns checked the plan against the hard requirements, and execute turns made code changes with tests.

- AI-assisted implementation: FastAPI endpoints, comparison helpers, vision-service structure, frontend wiring, deployment documentation, and regression tests were drafted with Codex and then reviewed in context.
- Human-directed requirements: exact case-sensitive government warning behavior, required batch upload, under-five-second target, no database, and environment-variable-only secrets came from the project brief and were treated as hard constraints.
- Human overrides: comparison stayed conservative with Python `SequenceMatcher` instead of broader token-set matching; Vercel deployment protection was disabled only after the live URL was proven to redirect to SSO; malformed model output was made reviewable instead of hiding partial extraction behind a 422.
- Hand-reviewed areas: secret handling, deployment URLs, README audit steps, and the issue documents were checked manually against reviewer-facing requirements.

## Assumptions And Limitations

- Real extraction requires a valid `OPENAI_API_KEY` on the backend host.
- `VISION_MODEL` defaults to `gpt-4o-mini` and can be changed with an environment variable.
- Government-warning OCR/model mistakes intentionally return `NEEDS_REVIEW` and surface extracted text for manual inspection.
- Batch concurrency is bounded with `BATCH_CONCURRENCY` to reduce rate and cost pressure.
