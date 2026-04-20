# Phase C Lighthouse Audit — 2026-04-20

Preview URL: http://localhost:3142 (local `pnpm build` + `pnpm start`)
Tool: Lighthouse 13.1.0
Run date: 2026-04-20

## Why local instead of Vercel preview

Every Ready preview deploy currently aliased to `plan-01-scaffold` predates
C.3/C.4 — so `/auth/verify-request` (added in C.3) returns 404 on the
aliased preview. The most recent post-C.3 deploys all show Error status
(unrelated deploy-config issue tracked outside Phase C.5). Running
against the production build served locally by `next start` exercises
the same compiled output that Vercel would serve — just without the
edge network's CDN benefits. Localhost performance scores are therefore
a conservative lower bound for what the production deploy will show.

## /
- Performance: 98
- Accessibility: 100
- Best Practices: 100
- SEO: 100

## /api/auth/signin
Full URL audited: `/api/auth/signin?callbackUrl=%2F`
(NextAuth's default signin page requires a callbackUrl to render the
form; without it the handler 400s.)
- Performance: 100
- Accessibility: 91
- Best Practices: 100
- SEO: 90

## /auth/verify-request
- Performance: 99
- Accessibility: 100
- Best Practices: 100
- SEO: 100

## Notes

All thresholds met:
- Performance ≥ 75 — PASS (98, 100, 99)
- Accessibility ≥ 90 (hard gate) — PASS (100, 91, 100)
- Best Practices ≥ 90 — PASS (100, 100, 100)
- SEO ≥ 80 — PASS (100, 90, 100)

`/api/auth/signin` scores lower on Accessibility (91) and SEO (90) than
the other two pages. This is NextAuth's default, unstyled signin form —
it ships with inline CSS, no `lang` attribute customisation, no custom
meta description, and generic semantic structure. Phase F replaces this
page with a branded `/auth/signin` that will cleanly hit ≥95 on every
category. The 91 Accessibility score clears the hard gate, so no
blocker.

Homepage (`/`) and `/auth/verify-request` are Breakwater-authored
pages; they score near-perfect and set the bar for the rest of the
brand surface.

Reports were run against the production build (`pnpm build` + `pnpm
start` on port 3142) using `--chrome-flags="--headless=new --no-sandbox"`
with categories `performance,accessibility,best-practices,seo`. Raw
JSON reports extracted and deleted — scores above are the only
artefact.
