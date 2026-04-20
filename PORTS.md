# Patterns ported from SVH Hub

Breakwater and SVH Hub are sibling ventures under Singularity Venture Hub. To stay visually and operationally coherent, Breakwater reads specific pattern files from `~/svh-hub` during Plan 01. This document lists every pattern port, the source file, the Breakwater target, and the reason.

**Rule:** Patterns are re-written for Breakwater context. No copy-paste. No business logic. No branding. No rate limits. No email templates. No seed data.

## Phase A ports

| SVH Hub source | Breakwater target | Rationale |
| --- | --- | --- |
| `src/lib/prisma.ts` | `src/lib/prisma.ts` | Same singleton + HMR pattern; Breakwater re-writes with its own log-level defaults. |

## Phase C ports

(Filled in at end of Phase C.)

## Phase E ports

(Filled in at end of Phase E.)

## Never-port list

- `src/lib/{activity,email,anthropic,drive,fireflies,googleDrive,matchingUtils}.ts` — SVH business logic.
- `src/components/{ActivityFeed,actions,admin,assistant,capture,clients,dashboard,digest,inbox,layout,meeting-notes,profile,projects,providers}/*` — SVH features.
- `prisma/schema.prisma` — Breakwater has its own schema per §4 of the spec.
- `src/app/layout.tsx` — Breakwater has its own nav, brand, typography.
- Any SVH email templates — Breakwater templates per §6.2.
- Rate-limit profiles — Breakwater uses its own 3/hr unauth, 10/hr auth per §5.1.
- Seed data — Breakwater seeds 3 CURATED protocols per §4.3; SVH seeds ventures/clients.

## SVH Hub reference commit

`a21485bbb467c31f2ed38b13b6c89a7dfb83ef64` (branch `main`, captured 2026-04-20 at A.3 port moment)
