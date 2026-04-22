# Breakwater

Continuous security monitoring for DeFi protocols. Governance, oracle, signer, and frontend patterns — detected before they reach shore.

A [Singularity Venture Hub](https://singularityventurehub.ai) venture.

## Status

Pre-prototype. This repository currently contains only the design spec for Plan 01. Implementation begins after Codex review of the spec.

- Spec: [`docs/superpowers/specs/2026-04-20-breakwater-plan-01-scaffold-design.md`](docs/superpowers/specs/2026-04-20-breakwater-plan-01-scaffold-design.md)
- Privacy policy (Plan 01): [`PRIVACY.md`](PRIVACY.md)

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
