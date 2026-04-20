# Breakwater Plan 01 — Implementation status

## Phase A: Foundation — IN PROGRESS
- [x] A.1: create-next-app + pnpm + Node 22 pin — commit 6b60e4e
- [x] A.2: Prisma init + dev DB wiring — commits 5a81e4b (Prisma 5 init) + 5779002 (pinning policy)
- [ ] A.3: First Vercel deploy + PORTS.md

## Phase B: Data model
- [ ] B.1: Full Prisma schema
- [ ] B.2: System org migration + seed

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
