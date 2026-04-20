# Breakwater Plan 01 — Implementation status

## Phase A: Foundation — COMPLETE
- [x] A.1: create-next-app + pnpm + Node 22 pin — commit 6b60e4e
- [x] A.2: Prisma init + dev DB wiring — commits 5a81e4b (Prisma 5 init) + 5779002 (pinning policy)
- [x] A.3: First Vercel deploy + PORTS.md — commit 2d511e9; preview Ready on `breakwater-robertwils-robertwils-projects.vercel.app`

## Phase B: Data model — COMPLETE
- [x] B.1: Full Prisma schema — commits e93a722 (schema + migration 20260420124707_init) + cfd3053 (remove duplicate-invariant comment)
- [x] B.2: System org migration + seed — commits 11350e8 (migration 20260420125421_system_org + seed.ts) + e7d7dbe (calibration-hint comment)

## Phase C: Auth pipeline
- [ ] C.1: NextAuth + Prisma adapter + Resend provider
- [ ] C.2: Scan-linking test + sign-in E2E

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
