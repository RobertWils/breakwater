# H.3 — End-to-end Vercel preview UI smoke (manual)

**Goal:** prove the full scan UX works on the preview deployment — submission, live polling, tier-gated rendering, and the new Phase G components (polling indicators, scope disclaimer, status-aware empty copy).

**Estimated wall time:** 60–90 min.

**Prerequisites:** H.2 walk completed at least once successfully (Inngest event chain proven). Reuse the same preview URL.

**Preview URL:** `_______________________________________` (from H.2 step 1.3)

---

## Setup

- [ ] **0.1 Open two browser windows side by side:**
  - Window A: preview URL with DevTools → Network tab visible. Useful for watching `/api/scan/[id]/status` polling fire every 3 s and for confirming the `Cache-Control` headers.
  - Window B: Inngest cloud dashboard, filtered to recent runs.
- [ ] **0.2 Open the same preview in incognito.** Required for the *unauth* tier walk — fresh session, no NextAuth cookie.

## Walk 1 — unauth tier, clean baseline (Aave V3)

- [ ] **1.1** In **incognito**, go to preview URL. Confirm landing page renders + ScanForm visible. Look for the `<ProtocolGraphDisclaimer>` — it shouldn't render on the landing page, only on `/scan/[id]`.
- [ ] **1.2** Submit Aave V3 Pool from `h-checklists/test-protocols.md`. Expected redirect to `/scan/[id]`.
- [ ] **1.3** Within ~3 s, DevTools Network should show first poll to `/api/scan/<id>/status` → `200`, `Cache-Control: no-store`, response body ≤ 500 bytes.
- [ ] **1.4** **ProtocolGraphDisclaimer visible.** Look for the left-border-accent banner above the composite panel, copy starts *"Breakwater scans the submitted core contract address…"*.
- [ ] **1.5** **CompositePanel — queued/running copy.** Should show "Queued" or "Running" (no grade letter — `scan.compositeGrade` is still null).
- [ ] **1.6** **ModuleCard — RUNNING pulse animates.** Once the module-side state transitions to RUNNING (visible as the polled status badge flipping from "Queued" to "Running"), a small accent-sky dot should pulse to the left of the status pill. Confirm via DevTools Elements:
  - Has `class` including `animate-pulse motion-reduce:animate-none`
  - Has `role="status"` + `aria-live="polite"`
  - `aria-label` mentions the module name + "running"
- [ ] **1.7** **`prefers-reduced-motion` toggle.** DevTools → Rendering → "Emulate CSS media feature `prefers-reduced-motion`" → set to **reduce**. The pulse animation should freeze (dot still visible, no animation). Toggle back when done.
- [ ] **1.8** **Polling cadence + backoff.** Watch the Network tab for ~30 s. Polls should arrive every ~3 s (3000 ms intervals). No 4xx/5xx responses. If you intentionally throttle the connection (DevTools → Network → Slow 3G) and watch a poll fail, the next poll should fire after a longer gap (1 s backoff after error 1). Restore connection.
- [ ] **1.9** **Terminal transition.** When the scan reaches `COMPLETE` (Inngest dashboard confirms `scan.completed` fired):
  - The polling stops within one cycle.
  - The page **does NOT manually reload** — `router.refresh()` re-fetches the server snapshot in-place.
  - The composite panel transitions from status copy to the **grade letter** (e.g., big "A" in `--grade-a` teal).
  - The composite shows `Score: <n>/100` underneath.
  - Each `ModuleCard` shows its module-level grade + score + findings count.
- [ ] **1.10** **FindingsList — empty state copy.** If Aave V3 scan produced zero findings (clean baseline target): the empty section reads **"No findings detected."** (the COMPLETE-state copy). If findings did fire (INFO/LOW), they render as cards with severity badges, public titles, and `remediationHint`. **No `description`, no `evidence` block** (unauth tier).
- [ ] **1.11** **UnlockCTA visible.** "Get notified when detection completes" card with email input. Submit your test email → should redirect to "Check your email" state via NextAuth magic link.
- [ ] **1.12** **Magic link arrives** (if `RESEND_API_KEY` set). Click the link. The browser should land back on the same `/scan/[id]` with NextAuth session set.

## Walk 2 — email tier, same scan

- [ ] **2.1** With the session set (after magic link), reload `/scan/[id]`. UnlockCTA should be **gone**.
- [ ] **2.2** **FindingsList full shape.** Findings now render with `description`, optional `evidence` JSON block (mono font), `remediationHint`. The "Showing top finding per module. Enter email below to unlock all" hint should be **gone** for email tier.
- [ ] **2.3** **No `remediationDetailed`.** Email tier doesn't expose it. Confirm none of the finding cards include a "Detailed remediation" section.
- [ ] **2.4** **`/api/scan/[id]` cache headers** (DevTools Network on a hard refresh):
  - Non-terminal (if scan still polling): `Cache-Control: no-store`
  - Terminal (`status = COMPLETE`): `Cache-Control: private, max-age=60`

## Walk 3 — failed / expired / partial-complete empty copy

These are status-edge cases for `FindingsList` empty state.

- [ ] **3.1 FAILED empty copy.** Easiest way: submit a scan with an obviously-invalid contract (e.g., an EOA address like `0x0000000000000000000000000000000000000001`). The dispatcher should still emit `scan.queued`, but the module-side execution should fail somewhere in snapshot capture. After failure, the page should show:
  - Composite panel: "Failed" status copy (or grade letter if scan persisted a partial — Plan 02 sends null grade on FAILED per F.3 Option 1, so expect status copy)
  - FindingsList empty copy: **"Scan failed. Findings unavailable."**
  - ModuleCard for GOVERNANCE: red FAILED status pill + `errorMessage` rendered as `role="alert"`
- [ ] **3.2 EXPIRED empty copy** (only relevant if a 30+ day-old scan exists in the DB). Skip if none available.

## Walk 4 — connection-issues indicator

- [ ] **4.1** Start a new scan submission, then immediately throttle DevTools Network to "Offline" before the first poll fires.
- [ ] **4.2** After ~3 s, polls start failing. After 1 failure, the page should show the small ambient indicator near the bottom:
  > "Connection issues detected. Retrying…"
- [ ] **4.3** The text uses `text-sev-medium` (amber). It has `role="status"` + `aria-live="polite"`.
- [ ] **4.4** Restore network. Next successful poll resets `errorCount` to 0 and the indicator disappears.
- [ ] **4.5** **Bailout.** If you keep the offline state through 5 consecutive errors (≈ 3 s + 1 s + 2 s + 4 s + 8 s ≈ 18 s of failed polling), polling stops. No more requests in Network tab. The indicator stays on screen at "errorCount = 5".

## Walk 5 — second clean-baseline + an edge-case contract

- [ ] **5.1** Submit Uniswap V3 SwapRouter (test-protocols.md #2). Repeat 1.4–1.10 abbreviated. Expected: similar clean A-grade outcome (this matches the `cleanUniswapV3Fixture` in unit tests).
- [ ] **5.2** Submit a non-proxy ERC-20 (test-protocols.md #4 — Curve 3pool or similar). Expected: detectors still run; some may surface INFO/LOW findings around non-standard governance shape; `GOV-005` (proxy admin) should produce no findings (proxyType = NONE).
- [ ] **5.3** Confirm FindingsList shows the populated finding cards with severity-coded badges (Critical → red, High → orange, Medium → amber, Low → blue, Info → grey).

## Visual / accessibility quick-checks

- [ ] **6.1 Tab through the page.** Focus indicators (teal outline per `globals.css`) visible on every interactive element (links, buttons, email input).
- [ ] **6.2 Screen-reader spot-check** (Mac: VoiceOver, Win: NVDA). Confirm `role="status"` regions on RUNNING pulses + connection indicator announce their state changes.
- [ ] **6.3 Mobile-width view.** Resize to ≤ 640 px. ScanShell modules grid collapses from 2-col to 1-col. UnlockCTA form stacks vertically (email input above button). No horizontal overflow.

## Pass / fail summary

Mark **PASS** when:

- All four polling behaviors observed (cadence, backoff, terminal transition, unmount).
- Tier-gating verified in both directions (unauth teaser → email full shape).
- Status-aware empty copy verified for at least COMPLETE and FAILED.
- ProtocolGraphDisclaimer renders on `/scan/[id]`.
- RUNNING pulse animates and honors `prefers-reduced-motion`.

Mark **FAIL** + escalate when:

- `/scan/[id]` requires manual reload to transition states (polling broken).
- UnlockCTA fails to send magic link (Resend env or signin route).
- Cache-Control headers wrong on terminal vs non-terminal.
- Any pulsing animation does NOT freeze under reduced-motion emulation (a11y gate).

Capture:
1. Screenshot of `/scan/[id]` mid-RUNNING with the pulse visible.
2. Screenshot of `/scan/[id]` post-COMPLETE with grade letter.
3. Screenshot of the FAILED state with the new copy.
4. Network panel screenshot showing the 3 s poll cadence + `Cache-Control` headers on both `/api/scan/[id]` and `/api/scan/[id]/status`.

## Out-of-scope reminders (do NOT fix during H.3)

- New code or features
- Visual polish (separate session later)
- Plan 03 Protocol Graph expansion
- Subscription / PAID tier exercise

Any UI issues that are genuinely wrong (broken text, misaligned layouts) → file in NOTES.md under a new *"Phase H smoke findings"* section for the H.5 status marker to triage.
