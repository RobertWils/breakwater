# Deployment env-var checklist

Definitive list of environment variables Breakwater consumes at runtime, with required/optional status and recommended scope (Vercel Preview / Production).

Pre-merge audit instructions for the Plan 02 PR:

```bash
vercel env ls preview
vercel env ls production
```

Cross-reference against the matrix below. Any **REQUIRED** variable missing from either scope blocks the merge; **RECOMMENDED** missing yields a degraded user flow; **OPTIONAL** missing falls back to defaults.

---

## REQUIRED — deployment fails or core flow breaks without these

| Var | Scope | Notes |
|---|---|---|
| `DATABASE_URL` | Preview + Production | Prisma datasource. Each environment **must** point at its own DB (do not share Production DB with Preview). |
| `NEXTAUTH_URL` | Preview + Production | Must match the deployment's public origin exactly. Preview = the `*.vercel.app` URL; Production = the canonical domain. NextAuth rejects sign-in callbacks otherwise. |
| `NEXTAUTH_SECRET` | Preview + Production | 32-byte base64 (`openssl rand -base64 32`). Different per environment. |
| `SCAN_IP_SALT` | Preview + Production | `config.ts` `assertProductionHashSalts()` throws on missing in production. Rotate per environment. |
| `SCAN_EMAIL_SALT` | Preview + Production | Same contract as `SCAN_IP_SALT`. |
| `INNGEST_EVENT_KEY` | Preview + Production | From Inngest cloud dashboard → app settings. Different per Inngest env (Inngest "Branch Environment" matches Preview; "Production" matches Vercel Production). |
| `INNGEST_SIGNING_KEY` | Preview + Production | Same source. Validated by Inngest's request handshake on every event. |
| `INNGEST_APP_ID` | Preview + Production | Currently `"breakwater"` — keep explicit to avoid silent default drift. |

## RECOMMENDED — degraded user flow without these, but app still boots

| Var | Scope | Degradation if missing |
|---|---|---|
| `RESEND_API_KEY` | Preview + Production | Magic-link delivery fails. `UnlockCTA` shows "Check your email" but no email arrives. Sign-in flow broken end-to-end. |
| `EMAIL_FROM` | Preview + Production | Resend rejects sends. Same downstream effect as missing API key. |
| `NEXT_PUBLIC_SITE_URL` | Preview + Production | Defaults to `https://breakwater.vercel.app` in `app/layout.tsx:7`. Set explicitly to the actual deployment domain so OG / share links resolve correctly. |
| `ETHERSCAN_API_KEY` | Preview + Production | GOV-002 governance-bypass detector + proxy ABI fetching degrade silently (D.5 documented "skip with note" path). Without it, detector coverage drops below the spec §14 promise on real-world scans. |

## OPTIONAL — defaults are baked in; only override if you have a reason

| Var | Default | Reason to override |
|---|---|---|
| `SAFE_API_BASE_URL` | `https://api.safe.global/tx-service/eth` | Only if pointing at a non-Ethereum chain endpoint. `assertProductionExternalApis()` (wired in I.1 FIX 5) throws on empty string in production — leave unset to use the default, do NOT set to `""`. |
| `SAFE_API_KEY` | (unset → anonymous tier) | Anonymous = 2 RPS / 5K monthly requests. Plan 02 sustains ~150 scans/day on free tier. Override for production volume above that. |
| `PRIMARY_ETH_RPC_URL` | `https://rpc.ankr.com/eth` (public Ankr) | Plan 02 ships public RPC only. Override per-environment with a paid provider URL (Alchemy / Infura) for higher rate limits + better reliability — H.2 manual smoke configured Alchemy on production. |
| `FALLBACK_ETH_RPC_URL` | `https://cloudflare-eth.com` | Same pattern as primary. The viem `fallback` transport tries primary first, falls back on error. |
| `BREAKWATER_GOVERNANCE_MODULE_ENABLED` | `true` | Set to `false` to kill-switch the governance module without redeploying. The dispatcher will SKIP all GOVERNANCE ModuleRuns. |
| `BREAKWATER_DETECTOR_DISABLE` | (empty) | Comma-separated detector IDs (e.g., `GOV-003,GOV-005`). Per-detector kill-switch within the orchestrator. |
| `FORCE_RESEND_IN_DEV` | (unset → console.log) | Set to `"1"` in local dev to fire real Resend emails instead of dev-mode console.log fallback. Production ignores this. |

---

## Pre-merge audit procedure (Phase I.3)

For each scope (Preview, Production):

```bash
vercel env ls <scope>
```

1. Run through the REQUIRED table above. Every row must have a value in the listing. **Missing → block the merge until added.**
2. Run through the RECOMMENDED table. Note any missing vars in the PR description; consider whether to add now or accept the documented degradation.
3. Run through the OPTIONAL table. Verify any explicitly-set values match the deployed RPC/Safe configuration. **Empty-string `SAFE_API_BASE_URL` in production will throw at request entry — verify it's unset, not set to `""`.**

## Post-merge production deploy

`pnpm build` runs `prisma generate` first (see `package.json`). Migrations apply via `prisma migrate deploy` — verify the [8 migrations on disk](../prisma/migrations/) all land on the production DB after the first build:

```
20260420124707_init
20260420125421_system_org
20260505151419_plan_02_dispatcher_schema
20260505153034_plan_02_scan_attempt_reason_nullable
20260506160426_plan_02_c4_scan_inngest_event_id
20260508074356_plan_02_d6_timelock_admin_is_contract
20260508092605_plan_02_e2_protocol_abi
20260518151629_plan_02_i1_module_error_detector_count
```

All Plan 02 migrations are additive (or NOT NULL → nullable relaxations) — code rollback to a Plan 01 deployment is safe without DB rollback. See the Phase H status marker's rollback section for the playbook.

## Plan 03 rollback addendum

### Plan 03 PR 1 rollback (post-merge, pre-PR-2)

If a defect requires reverting PR 1 (the multi-Contract execution model + additive migration), follow this runbook:

1. Identify the production scope of the rollback: was the backfill script (`scripts/backfill-plan-03-contracts.ts`) run? If YES, the DB has Contract rows + populated `contractId` columns — these are safe (PR 2 hasn't tightened constraints yet), but consider whether to drop them as part of the rollback.

2. Code rollback: `git revert` of the PR 1 merge commit. This restores Plan 02 code paths.

3. **The `compositeScore` problem.** Plan 02 code reads/writes `Scan.compositeScore`, but the column is now named `averageContractScore` in the DB. Two options:

   - **Option (a) — Compat shim (preferred for speed):** Apply a code patch to the reverted Plan 02 code that aliases `compositeScore` reads/writes to `averageContractScore`. Example: a Prisma client extension or a `@map("averageContractScore")` on a temporary `compositeScore` field. Document the shim as temporary; remove when Plan 03 re-merges.
   - **Option (b) — Down-migration:** Create a Prisma migration that renames `averageContractScore` back to `compositeScore`. Run via `prisma migrate deploy`. Plan 02 then works against unchanged schema. Cleaner but slower (requires `migrate deploy` in production).

4. The additive Plan 03 schema (Contract table, `contractId` columns, `isPartialCoverage` column, `worstContractScore` column) can stay in place — Plan 02 code ignores it. No need to drop.

5. Verify rollback: production scan against Plan 02 baseline protocols (Aave V3 single-contract) returns a clean grade.
