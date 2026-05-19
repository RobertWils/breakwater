# H.2 / H.3 — Test protocol list

Ethereum mainnet addresses for the manual preview smoke. Each entry notes what detector paths the input is **likely** to exercise — but **the scan is the ground truth**; treat these as expectations to verify, not predictions to bake into the marker doc.

The Plan 02 anchored research (`docs/research/2026-04-22-governance-incidents.md`) is the canonical source for "what real-world failure modes look like". These protocols are picked to **exercise code paths**, not to predict pass/fail grades on living entities.

---

## #1 — Aave V3 Pool (clean baseline)

| Field | Value |
|---|---|
| Address | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` |
| Chain | ETHEREUM |
| Role | Clean baseline #1 |
| Why | Aave is well-documented as having strong governance (timelock + multisig + cross-chain governance). Used to confirm the "happy path" surfaces few/no findings and that the composite grade lands cleanly. |

**Detector paths exercised:** GOV-001 (timelock check), GOV-003 (multisig threshold), GOV-005 (proxy admin shape), GOV-006 (pause function presence).

**What to watch for:** scan should reach `COMPLETE` with a high-letter grade. If GOV-001/003/005 fire CRITICAL/HIGH findings against Aave, that's a finding *about the detector*, not about Aave — file it in the H.5 status marker for triage.

---

## #2 — Uniswap V3 SwapRouter (clean baseline — matches test fixture)

| Field | Value |
|---|---|
| Address | `0xE592427A0AEce92De3Edee1F18E0157C05861564` |
| Chain | ETHEREUM |
| Role | Clean baseline #2 — matches `cleanUniswapV3Fixture` in detector unit tests |
| Why | The SwapRouter is the contract we use as the synthetic-clean fixture across all 6 GOV-* detector unit tests. Running it live verifies that real-world Uniswap V3 still matches the fixture profile (or surfaces real drift between Plan 02 ship and now). |

**Detector paths exercised:** all six.

**What to watch for:** outcome should align with the `cleanUniswapV3Fixture` snapshot. Major delta ⇒ fixture is stale; file for Plan 03+ fixture refresh.

---

## #3 — Compound v3 USDC market (governance with timelock)

| Field | Value |
|---|---|
| Address | `0xc3d688B66703497DAA19211EEdff47f25384cdc3` |
| Chain | ETHEREUM |
| Role | Production governance protocol with documented timelock + multisig |
| Why | Different governance shape than Aave (Compound Bravo vs Aave Governance V3). Exercises `detect-governor` against the Bravo type discriminator. |

**Detector paths exercised:** GOV-001 (timelock min-delay), GOV-002 (governance bypass via ABI scan — `ETHERSCAN_API_KEY` needed), GOV-004 (voting snapshot type — Compound uses block-number checkpoints).

**What to watch for:** scan should reach `COMPLETE`. If GOV-004 reports `VotingSnapshotType.NONE` instead of `BLOCK_BASED`, the governor detection is misclassifying — flag.

---

## #4 — Curve 3pool (older non-proxy contract — protocolAbi path)

| Field | Value |
|---|---|
| Address | `0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7` |
| Chain | ETHEREUM |
| Role | Edge case: non-proxy contract |
| Why | Most modern protocols are proxies. Curve 3pool is a directly-deployed Vyper contract — exercises the **non-proxy ABI fetch path** (`protocolAbi` field on the snapshot, populated by E.2 when `proxyType === NONE`). |

**Detector paths exercised:** `detectProxy` returns `proxyType: NONE`; GOV-005 (proxy admin) emits no findings; GOV-006 (emergency pause) scans `protocolAbi` directly for pause-pattern matches.

**What to watch for:**
- `GovernanceSnapshot.proxyType === "NONE"` in the persisted snapshot (DB query).
- `GovernanceSnapshot.protocolAbi` populated (non-null).
- `GovernanceSnapshot.implementationAbi` null (no proxy → no impl ABI).
- GOV-005 produces zero findings.

---

## #5 — Pick one "dirty" target organically

For a finding-heavy walk, **submit a small / recent DeFi deployment** that you suspect has thin governance — a freshly-deployed yield protocol, an experimental DEX fork, etc. — and use whichever scan produces multiple findings.

**Why I'm not naming a specific address:** predicting "this real protocol will get F" before running the scan risks publishing fabricated assessments against a living entity. The Plan 02 detectors are conservative; let them surface what they find against an input you pick, then verify the UI renders multiple findings, severities, and the connection between FindingsList + ModuleCard + CompositePanel.

**What to watch for:**
- Multiple severity badges (Critical / High / Medium / Low / Info) render with their colored backgrounds.
- `findingsCount` on the ModuleCard matches the number of finding cards in the list.
- `hiddenFindingsCount` appears on the ModuleCard for unauth tier when the unauth shaper hides non-top-rank findings.
- Composite grade letter color matches the severity (`--grade-f` red for F, etc.).

---

## #6 — Optional: invalid input for FAILED path

| Field | Value |
|---|---|
| Address | `0x0000000000000000000000000000000000000001` (or any EOA) |
| Chain | ETHEREUM |
| Role | Trigger FAILED end-state intentionally |
| Why | Confirms the FAILED path of the dispatcher: ModuleRun ends FAILED, scan-level composite stays null, FindingsList renders the F.5 N2 "Scan failed. Findings unavailable." copy. |

**Detector paths exercised:** snapshot capture fails before any detector runs (or runs against an empty/undeployed-contract response, depending on viem behavior).

**What to watch for:**
- `scan.completed` event with `finalStatus: "FAILED"`, null composite fields.
- ModuleCard shows red FAILED pill + `errorMessage` rendered in `role="alert"`.
- FindingsList shows the FAILED empty copy (not the COMPLETE copy).

---

## Recommended order

1. **#1 Aave** — first happy-path walk through H.2 + H.3. Establishes baseline.
2. **#6 invalid address** — second walk. Verifies FAILED end-to-end fast.
3. **#2 Uniswap** — third walk. Verifies fixture-vs-reality drift.
4. **#3 Compound** — fourth walk. Verifies Bravo detector path.
5. **#4 Curve 3pool** — fifth walk. Verifies non-proxy code path.
6. **#5 organic dirty target** — last. By now you'll know the system is healthy and findings rendering should be the only variable.

Each walk should take ~5–10 min once the preview is warm.
