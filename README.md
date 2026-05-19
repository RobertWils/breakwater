# Breakwater

Continuous security monitoring for DeFi protocols. Governance, oracle, signer, and frontend patterns — detected before they reach shore.

A [Singularity Venture Hub](https://singularityventurehub.ai) venture.

## Status

Plan 01 (scaffold + landing + auth) and Plan 02 (dispatcher + governance module) shipped. The codebase runs end-to-end on Vercel preview: submit an Ethereum contract address, the Inngest dispatcher fans out to the GOVERNANCE module, six detectors (GOV-001 through GOV-006) score governance posture, and the results page polls live until a terminal composite grade lands.

- Plan 01 spec: [`docs/superpowers/specs/2026-04-20-breakwater-plan-01-scaffold-design.md`](docs/superpowers/specs/2026-04-20-breakwater-plan-01-scaffold-design.md)
- Plan 02 spec: [`docs/superpowers/specs/2026-04-22-breakwater-plan-02-design.md`](docs/superpowers/specs/2026-04-22-breakwater-plan-02-design.md)
- Phase status markers: [`docs/superpowers/plans/`](docs/superpowers/plans/)
- Privacy policy: [`PRIVACY.md`](PRIVACY.md)

## Local development

```bash
# 1. Install deps (Node 22 LTS + pnpm 9)
pnpm install

# 2. Copy env template and fill in the required vars
cp .env.example .env.local
# See docs/deployment-env.md for the full required / optional matrix.

# 3. Apply migrations against the local DB
pnpm db:migrate

# 4. Start the Next.js dev server
pnpm dev
# → http://localhost:3000

# 5. (In a second terminal) start the Inngest dev server so events fire
pnpm dlx inngest-cli@latest dev
# → http://localhost:8288 (Inngest dashboard)

# 6. Submit a scan from the landing form. Watch the polling updates on
#    /scan/[id] and the event chain on the Inngest dashboard.
```

### Tests

```bash
pnpm test              # full vitest suite (689 tests; DB-backed tests
                       # gate on DATABASE_URL — set it to run them)
pnpm test:coverage     # detector subtree threshold (≥85% per spec §14;
                       # current: 96.75% statements)
pnpm tsc --noEmit      # type-check
pnpm lint              # next lint
pnpm build             # production build (runs prisma generate first)
```

## Stack (target)

- Next.js 14 (App Router) · TypeScript
- Tailwind CSS · Framer Motion
- Prisma · PostgreSQL (Railway)
- NextAuth (magic link via Resend)
- pnpm · Node.js 22 LTS
- Deployed on Vercel

## Plan structure

The prototype is delivered in seven plans, each on its own worktree branch, each reviewed by Codex before merge.

| Plan | Scope |
| --- | --- |
| 01 | Project scaffold, design system, auth, Prisma schema, landing page |
| 02 | Scan orchestrator, background job dispatch (Inngest), results page shell |
| 03 | Governance & Ops Hygiene scanner (real) |
| 04 | Oracle & Bridge Dependency Graph scanner (real) |
| 05 | Signer Transaction Simulation + historical admin-tx grader (real) |
| 06 | Frontend & Domain Monitor (real) |
| 07 | Freemium gating, email signup, polish, shareable grade badges |

## License

Proprietary. All rights reserved.
