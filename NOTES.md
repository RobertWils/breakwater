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
