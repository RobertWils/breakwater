# Breakwater Plan 01 — Implementation status

## Phase A: Foundation — COMPLETE
- [x] A.1: create-next-app + pnpm + Node 22 pin — commit 6b60e4e
- [x] A.2: Prisma init + dev DB wiring — commits 5a81e4b (Prisma 5 init) + 5779002 (pinning policy)
- [x] A.3: First Vercel deploy + PORTS.md — commit 2d511e9; preview Ready on `breakwater-robertwils-robertwils-projects.vercel.app`

## Phase B: Data model — COMPLETE
- [x] B.1: Full Prisma schema — commits e93a722 (schema + migration 20260420124707_init) + cfd3053 (remove duplicate-invariant comment)
- [x] B.2: System org migration + seed — commits 11350e8 (migration 20260420125421_system_org + seed.ts) + e7d7dbe (calibration-hint comment) + 0604a19 (production guard)

### Codex review journey (Phase A+B, 4 rounds total)
- [x] Round 1: Seed production guard (dev/prod separation) — commit 0604a19
- [x] Round 2a: Homepage remote-image fix — commit 55dabc4
- [x] Round 2b: Vitest test infrastructure (close pnpm test gate) — commit 767356d
- [x] Round 3: Node engine tightened to >=22.12 for Vite 8 compat — commit f2fd665
- [x] Round 4: `RAILWAY_ENVIRONMENT_NAME` fix in seed guard — commit 3918c4e
- [x] Round 5: Clean — no findings, Phase B closed

## Phase C: Auth pipeline (re-scoped from frozen plan into 5 sub-tasks)
Plan file aligned with this re-scope in commit e9cad07 (Revision log at bottom of the plan doc).
- [x] C.1: NextAuth v4 setup + Prisma adapter (config skeleton only; dev console-log magic link) — commit bfc007b; verified E2E by Robert (magic link flow, session cookie, `/api/auth/session`, Prisma Studio rows).
- [x] C.2: Resend magic link provider (real send path) — commit 18ae68b; resend@4.8.0 + @react-email/components@0.0.42 pinned; single template at `src/emails/magic-link.tsx`; `@vitejs/plugin-react@6.0.1` added so Vitest transforms TSX. Build + 4 tests green. Dev fallback: console.log when `RESEND_API_KEY` unset OR (`NODE_ENV=development` and `FORCE_RESEND_IN_DEV != "1"`). Real-delivery E2E pending user validation with `FORCE_RESEND_IN_DEV=1`.
  - Post-implementation env var fix: renamed `RESEND_FROM_EMAIL` → `EMAIL_FROM` in `src/lib/auth.ts`, `.env.example`, and the plan file (A.2/A.3/C.2/Phase H) to match spec §9 (source of truth). Plan drift corrected; revision log entry added.
  - Post-implementation safety rail: `sendVerificationRequest` now throws when `NODE_ENV=production && !resend` instead of silently falling back to console.log (plan §C.2 Step 2 specified this throw; C.2 as shipped had the check only on the dev-fallback branch). Unit test skipped — module-level `resend` init + Prisma import make isolated re-import impractical; integration coverage lands in C.5.
  - Deferred to C.3: Plan §C.2 Step 2 specified creating `src/lib/resend.ts` (Resend client + `fromEmail` export). C.2 ships with these inline in `src/lib/auth.ts` instead. C.3 rewrites `sendVerificationRequest` for dual templates and is the natural moment to split Resend client + `fromEmail` into a dedicated module.
- [x] C.3: Dual email templates (signin vs signup-unlock) — commits 396cadf + 2ba65d4.
  - Part 1 (396cadf): `src/lib/resend.ts` created with `resend` client, `fromEmail`, `isDevMode()`, `assertProductionConfig()`, `shouldUseSignupUnlockTemplate()`. All re-read `process.env` at call time (Strategy B) for testability. `src/lib/auth.ts` updated to import from `@/lib/resend`; all inline Resend code removed.
  - Part 2 (2ba65d4): `src/emails/_layout.tsx` shared layout (Storm Cyan palette, single `colors` const). `src/emails/magic-link-signin.tsx` and `src/emails/magic-link-signup-unlock.tsx` created. `src/lib/email.ts` replaced with `renderSigninEmail` + `renderSignupUnlockEmail`. Template selection in `sendVerificationRequest` parses `callbackUrl` from magic-link URL; uses signup-unlock template when `/scan/` + `unlock=true` present, signin otherwise. Plan 02 comment marks protocol personalization hook. Old `magic-link.tsx` + test deleted.
  - 23 tests total (4 signin template, 5 signup-unlock template, 7 resend module, 6 template-selection, 1 pre-existing). All green. `pnpm build` clean.
  - Manual E2E pending Robert: (1) normal signin → signin template; (2) `http://localhost:3000/api/auth/signin?callbackUrl=%2Fscan%2Ftest-id%3Funlock%3Dtrue` → signup-unlock template.
- [ ] C.4: Post-auth callback + anonymous scan linking
- [ ] C.5: End-to-end auth test + Lighthouse check

## Phase D: Scan API
- [ ] D.1: Pure helpers (normalize, hash, dedupe, scoring, errors)
- [ ] D.2: POST /api/scan with atomic cooldown
- [ ] D.3: GET /api/scan/[id] with visibility gating

## Phase E: Brand system
- [ ] E.1: Design tokens + logo + favicons
- [ ] E.2: UI primitives
- [ ] E.3: OG image

## Phase F: Landing page
- [ ] F.1: Landing sections + /demo/[slug] placeholder
- [ ] F.2: Responsive polish + Lighthouse audit

## Phase G: Scan results shell
- [ ] G.1: Scan page layout + polling
- [ ] G.2: Gating UI + not-found handling

## Phase H: Polish + deploy
- [ ] H.1: Docs + robots.txt + env audit
- [ ] H.2: PR opened for Codex review
