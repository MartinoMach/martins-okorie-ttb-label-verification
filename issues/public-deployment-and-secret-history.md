# Public Deployment And Secret History Readiness

## Summary

The submitted frontend URL was reported as blocked by Vercel deploy protection. A reviewer who opens `https://ttb-label-verification-frontend-zgnb.vercel.app/` should reach the application directly, not a Vercel SSO page. This is a live-review blocker because the brief requires a public, usable deployment.

The repository also needs a strict secret-history audit. Revoking or rotating a previously exposed key is necessary, but it is not enough if the key remains searchable in git history.

## Broken Requirements

- Deployment: the README must contain a public live URL that actually loads without Vercel SSO or an auth wall.
- Secrets and configuration: no `sk-...`, `AIza...`, or other real secret values may appear in any commit in git history.
- Runtime consistency: the stated stack is Python 3.12+, so the hosted runtime should not contradict the project requirements.

## Root Cause

- Vercel deploy protection is a project dashboard setting, not a frontend code issue.
- README documented a previously exposed OpenAI key rotation need, so history must be audited before the issue can close.
- Render was pinned to Python 3.13.5 while project instructions call for Python 3.12.

## Fix Plan

- Disable Vercel deploy protection for the production frontend project in the Vercel dashboard.
- Keep the frontend build as-is unless public access reveals a separate runtime problem.
- Run strict git-history and current-source audits for likely OpenAI and Google-style key patterns.
- If a real key appears, revoke it, purge git history with `git filter-repo` or BFG, force-push, and rerun the audit.
- Pin Render to Python 3.12.x and update deployment documentation to match.

## Current Verification Notes

- Frontend is public after disabling Vercel SSO deployment protection with `vercel project protection disable --sso`: `curl -sIL https://ttb-label-verification-frontend-zgnb.vercel.app/` returns `HTTP/2 200`.
- Backend is public: `curl -s https://ttb-label-verification-api-zgnb.onrender.com/health` returns `{"status":"ok","service":"ttb-label-verification-api"}`.
- Strict local audits found no likely `sk-...` or `AIza...` secret values in current source or git history.

## Verification Checklist

- `curl -sIL https://ttb-label-verification-frontend-zgnb.vercel.app/` returns a public page response, not a redirect to `vercel.com/sso-api`.
- `curl -s https://ttb-label-verification-api-zgnb.onrender.com/health` returns `{"status":"ok","service":"ttb-label-verification-api"}`.
- Public frontend loads without login and can reach the backend.
- Single-label and batch verification flows remain usable.
- Strict secret audit commands return no real secret values.
- Backend tests pass.
