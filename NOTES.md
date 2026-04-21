# Breakwater engineering notes

Short-form rationale for non-obvious project decisions. Add an entry when a future reader might ask "why is this set this way?" and the answer is not visible from the code alone.

## Node engine `>=22.12`

Vitest 4.x pulls in Vite 8.x, which requires Node `>=22.12`. Engine constraint was tightened from `22.x` to `>=22.12` in Codex round 2 of Phase B review to match that transitive requirement. Do not relax without verifying Vite's current Node floor.

Local `.nvmrc` mirrors the same floor (`22.12`). Vercel project is pinned at `22.x` which resolves to the latest 22 LTS and satisfies this constraint automatically.

## Dependency version notes

### nodemailer v6.10.1 (vs next-auth's peer dep v7)

next-auth@4.24 declares nodemailer@^7 as peer. We use v6.10.1 because:

- Our `sendVerificationRequest` uses Resend directly, not nodemailer
- nodemailer is only needed at module resolution time (`require` statement in `next-auth/providers/email`)
- v6 resolves the require and satisfies runtime requirements
- Upgrading to v7 would be cosmetic-only (silences warning) without functional benefit

Accepted peer warning: `unmet peer nodemailer@^7.0.7: found 6.10.1`

## Plan 02 backlog

- Schema: `ScanAttempt.reason` should be nullable (currently NOT NULL forces `"accepted"` sentinel for ACCEPTED status rows). Fix in Plan 02 migration: make `reason` nullable.
- Slug collision: current implementation can fail on addresses sharing first 8 hex chars. Plan 02 should add incremental suffix strategy or longer hash input.
- FindingResponse discriminated union: currently structural union without true discriminator. Add tier-discriminator to enforce tier-specific shapes at type level. Low runtime risk (tests verify shapes correct), medium refactor touching 3 shaper functions.
- config.ts production-guard tests: add production-mode coverage for `assertProductionHashSalts()` with missing `SCAN_IP_SALT` / `SCAN_EMAIL_SALT` (Codex NICE_TO_HAVE).

## Spec factual corrections (implementation deviations)

### §8.3 font loader (E.1)

Spec zegt "Geist Sans + Geist Mono via next/font/google". Geist wordt niet via Google Fonts gehost. Canonical loader is Vercel's geist npm package (wraps next/font/local). Identieke resulterende --font-geist-sans / --font-geist-mono CSS variables.

Applied: `import { GeistSans } from "geist/font/sans"` + `import { GeistMono } from "geist/font/mono"`

Future spec updates: replace "via next/font/google" with "via geist npm package" in §8.3.

### §8.1 gradient range (F.1 refinement)

Spec gradient `#0C1C3A → #17306B` was visually imperceptible on large screens. Expanded to 3-stop gradient `#0A1530 → #0C1C3A → #1E3D85` while preserving `--bg-base` and `--bg-elevated` values for other uses.
