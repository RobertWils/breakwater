# H.2 — Inngest event chain verification (manual)

**Goal:** prove the dispatcher fires the full event chain end-to-end on a real preview deployment. Closes plan §F exit gate items *"Scan lifecycle on Vercel preview observable"* and *"Inngest dashboard shows the full event chain"*.

**Estimated wall time:** 45–60 min (mostly waiting on builds + watching dashboards).

**Branch under test:** `plan-02-dispatcher` @ commit `ca1d7e7` (H.1) or later.

---

## Pre-flight — preview deployment status

- [ ] **1.1 Confirm Vercel project linkage.** Local `.vercel/project.json` is bound to `breakwater` (org `team_yjcef2UwyHzTupqDvrgXPTnS`). Run:
  ```bash
  vercel projects ls 2>&1 | grep breakwater
  ```
  Expected: one row, status `Production`.
- [ ] **1.2 Push branch to remote and trigger preview build.** If the latest preview is not on `ca1d7e7` (or later), push and let Vercel auto-build:
  ```bash
  git -C /Users/robertwils/breakwater-plan-02 status
  git push                       # if anything is unpushed
  vercel deploy --prebuilt       # optional manual trigger
  ```
- [ ] **1.3 Locate preview URL.** From Vercel dashboard or:
  ```bash
  vercel ls breakwater | head -5
  ```
  Record the URL: `_______________________________________`
- [ ] **1.4 Confirm build succeeded.** Open the deployment in the dashboard. Look for "Ready" badge + green build logs. Spot-check the **Functions** tab and confirm `api/inngest` is listed.

## Pre-flight — env vars on the preview environment

Vercel inherits env vars per environment (Production / Preview / Development). Verify the preview environment has the variables set:

```bash
vercel env ls preview
```

### Required (build/runtime will break without these)

- [ ] `DATABASE_URL` — same Postgres the integration tests use (or a dedicated preview DB).
- [ ] `NEXTAUTH_URL` — must equal the preview URL (`https://breakwater-…vercel.app`). NextAuth rejects callbacks otherwise.
- [ ] `NEXTAUTH_SECRET` — 32-byte base64.
- [ ] `SCAN_IP_SALT` — production-guard throws on missing.
- [ ] `SCAN_EMAIL_SALT` — production-guard throws on missing.
- [ ] `INNGEST_EVENT_KEY` — from Inngest cloud dashboard → app settings.
- [ ] `INNGEST_SIGNING_KEY` — same source.
- [ ] `INNGEST_APP_ID` — defaults to `"breakwater"` if unset; explicit is safer.

### Recommended (degraded user flow without these)

- [ ] `RESEND_API_KEY` — magic-link delivery fails silently without it (UnlockCTA → check-email screen but no email arrives).
- [ ] `EMAIL_FROM` — Resend rejects sends with no `from` address.
- [ ] `NEXT_PUBLIC_SITE_URL` — share/OG links use this.
- [ ] `ETHERSCAN_API_KEY` — GOV-002 (governance bypass via ABI scan) and proxy ABI fetching degrade silently without it (per Phase D.5).

### Optional (defaults work)

- [ ] `SAFE_API_KEY` — anonymous tier handles up to ~150 scans/day.
- [ ] `SAFE_API_BASE_URL` — default points at `api.safe.global/tx-service/eth`.
- [ ] `PRIMARY_ETH_RPC_URL` / `FALLBACK_ETH_RPC_URL` — defaults to Ankr + Cloudflare (Plan 02 ships these baked in).
- [ ] `BREAKWATER_GOVERNANCE_MODULE_ENABLED` — default `true`; leave unset unless intentionally disabling.
- [ ] `BREAKWATER_DETECTOR_DISABLE` — leave empty.

## Pre-flight — Inngest cloud registration

- [ ] **3.1 Open Inngest cloud dashboard.** https://app.inngest.com
- [ ] **3.2 Confirm the app `breakwater` is registered** in the correct environment (Production or a Preview branch env). The app should auto-register when Vercel's `/api/inngest` serve route handler responds to Inngest's introspection ping after deploy.
- [ ] **3.3 Confirm two functions are registered** under the `breakwater` app:
  - `execute-scan` (Inngest function ID `execute-scan`)
  - `execute-governance-module` (Inngest function ID `execute-governance-module`)
- [ ] **3.4 Confirm event keys match.** Compare `INNGEST_EVENT_KEY` in Vercel env with the key shown on the Inngest dashboard. Mismatch ⇒ events from the app never reach Inngest.

If any of 3.1–3.4 fails, **stop and resolve before proceeding**. Inngest mis-registration looks like "scan stays QUEUED forever" from the UI — easy to misdiagnose as a code bug.

---

## Event-chain walk

Submit a scan from the preview UI, then watch the Inngest dashboard. The chain should fire in this exact order:

```
POST /api/scan
  └─ inngest.send({ name: "scan.queued", data: { scanId, … } })
       └─ executeScan handler picks up
            ├─ step "mark-running"
            ├─ step.sendEvent("scan.module.requested")     ← fanout
            │    └─ executeGovernanceModule handler picks up
            │         ├─ step "mark-running" (per-module)
            │         ├─ step "load-scan-context"
            │         ├─ step "capture-detect-persist"
            │         ├─ step "mark-complete" (per-module)
            │         └─ step.sendEvent("scan.module.completed")
            ├─ step.waitForEvent resolves ←─────────────────┘
            ├─ step "mark-complete" (scan-level)
            └─ step.sendEvent("scan.completed")
```

### Walk

- [ ] **4.1 Submit a scan.** Pick the first test protocol from `h-checklists/test-protocols.md` (Aave V3 Pool, the clean baseline). Submit via the preview's `/` landing form.
- [ ] **4.2 Record the scanId.** Browser will redirect to `/scan/[id]`. Copy the UUID from the URL: `_______________________________________`
- [ ] **4.3 Inngest dashboard → Events.** Filter by scan-data (often the dashboard supports filtering on `data.scanId`).
- [ ] **4.4 Verify the 4 events fire, in order:**

  | # | Event name              | Timing window               | PASS criteria |
  |---|-------------------------|-----------------------------|---------------|
  | 1 | `scan.queued`           | within seconds of submit    | Payload contains correct `scanId`, `chain="ETHEREUM"`, `primaryContractAddress` (lowercased), `modulesEnabled=["GOVERNANCE",...]` |
  | 2 | `scan.module.requested` | seconds after `scan.queued` | `data.module === "GOVERNANCE"`, `data.scanId` matches |
  | 3 | `scan.module.completed` | 30–120 s after #2 (depends on snapshot capture + detector runtime) | `data.status` is `"COMPLETE"`, `data.findingsCount` ≥ 0, `data.grade` is a letter A–F |
  | 4 | `scan.completed`        | seconds after #3            | `data.finalStatus === "COMPLETE"`, `data.compositeGrade` letter, `data.compositeScore` 0–100, `data.executionMs` non-negative |

  If any event is missing or in the wrong order, **flag with timing screenshot** before continuing.

- [ ] **4.5 Inngest dashboard → Runs.** Open the `execute-scan` run for this scanId. Expand the step list. Verify every step ran exactly once + completed (no retries, no errors). Same for `execute-governance-module`.

- [ ] **4.6 DB verification.** After step 4.4 #4, query the Scan row:
  ```bash
  # If you can hit the DB directly:
  psql $DATABASE_URL -c "select id, status, compositeGrade, compositeScore, completedAt from \"Scan\" where id='<scanId>';"
  ```
  Expected: `status = COMPLETE`, `compositeGrade` letter, `compositeScore` populated, `completedAt` non-null.

- [ ] **4.7 Repeat for 2 more test protocols** from the test-protocols list (preferably one expected-clean and one expected to surface findings) to confirm the chain isn't fixture-specific.

## Failure-mode walk (optional but valuable)

- [ ] **5.1 Submit a scan with `modulesEnabled = []`** (curl or temp UI bypass — Plan 02 might not allow empty in the form). Expected: `scan.queued` fires; `executeScan` `mark-running` runs; no `scan.module.requested` is sent; `scan.completed` emits with no modules. UI shows "Complete" with no findings.
- [ ] **5.2 Submit a scan and intentionally kill the Inngest dev workflow** (or wait through a long detector failure). Expected: `wait-governance` step times out at 5 min; `mark-governance-timeout` step writes the ModuleRun row to FAILED with `errorMessage="module_timeout"`; `scan.completed` emits with `finalStatus = FAILED`.

## Pass / fail summary

Mark the run as **PASS** when:

- All four events fire in order for at least one happy-path scan.
- DB shows terminal `Scan.status = COMPLETE` and `Scan.compositeGrade` populated.
- Inngest dashboard shows no retries (or only successful retries that converge to one terminal event).

Mark **FAIL** and **escalate** when:

- Any of `scan.queued` / `scan.module.requested` / `scan.module.completed` / `scan.completed` is missing.
- A duplicate `scan.module.completed` fires (would indicate the F.5 I1 emit-gate regressed).
- `Scan.status` stays `RUNNING` indefinitely.

Capture screenshots of:
1. Inngest events panel showing the 4-event sequence with timestamps.
2. Inngest run panel showing all steps succeeded.
3. Browser address bar `/scan/[id]` after polling resolves to COMPLETE.
