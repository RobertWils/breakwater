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
- [x] C.1: NextAuth v4 setup + Prisma adapter (config skeleton only; dev console-log magic link) — commit bfc007b; `pnpm build` green, `/api/auth/[...nextauth]` registered as dynamic route, `/auth/verify-request` as static. Dev-server E2E (browser) pending user validation.
- [ ] C.2: Resend magic link provider (real send path)
- [ ] C.3: Dual email templates (signin vs signup-unlock)
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
