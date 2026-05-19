/**
 * Shared test fixtures for governance detectors (Plan 02 spec §10.1).
 *
 * Two layers:
 *   - Builders: `baseSnapshot`, `withGovernor`, `withTimelock`,
 *     `withMultisig`, `withProxy` — compose snapshots field-by-field.
 *     Builders default to safe configurations so tests adjust only
 *     the fields the detector under test cares about.
 *   - Named protocol fixtures: `cleanUniswapV3Fixture`,
 *     `driftLikeFixture`, `beanstalkLikeFixture`, `audiusLikeFixture`
 *     — full snapshots representing real (or real-adjacent) protocol
 *     postures, used as end-to-end regression checks per spec §10.3.
 */

import type { GovernanceSnapshotData } from "../types";

export function baseSnapshot(
  overrides: Partial<GovernanceSnapshotData> = {},
): GovernanceSnapshotData {
  return {
    blockNumber: BigInt(20_000_000),
    capturedAt: new Date("2026-05-08T08:00:00Z"),

    hasGovernor: false,
    governorAddress: null,
    governorType: null,
    governorVersion: null,

    hasTimelock: false,
    timelockAddress: null,
    timelockMinDelay: null,
    timelockAdmin: null,
    timelockAdminIsContract: null,

    hasMultisig: false,
    multisigAddress: null,
    multisigThreshold: null,
    multisigOwnerCount: null,
    multisigOwners: [],

    proxyType: "NONE",
    proxyAdminAddress: null,
    proxyImplementation: null,
    proxyVerified: false,
    proxyAdminIsContract: null,
    implementationAbi: null,
    protocolAbi: null,

    votingTokenAddress: null,
    votingSnapshotType: null,

    rawState: {},

    ...overrides,
  };
}

export function withGovernor(
  snapshot: GovernanceSnapshotData,
  overrides: Partial<GovernanceSnapshotData> = {},
): GovernanceSnapshotData {
  return {
    ...snapshot,
    hasGovernor: true,
    governorAddress: "0x1111111111111111111111111111111111111111",
    governorType: "OZ_GOVERNOR",
    governorVersion: "1",
    // E.4 default: BLOCK_BASED is the safe baseline (checkpoint-based
    // voting). Tests for current-balance vulnerability override.
    votingSnapshotType: "BLOCK_BASED",
    ...overrides,
  };
}

/**
 * Default to a SAFE configuration: 48h delay + contract admin. Tests
 * that exercise unsafe paths override the relevant fields.
 */
export function withTimelock(
  snapshot: GovernanceSnapshotData,
  overrides: Partial<GovernanceSnapshotData> = {},
): GovernanceSnapshotData {
  return {
    ...snapshot,
    hasTimelock: true,
    timelockAddress: "0x2222222222222222222222222222222222222222",
    timelockMinDelay: 172_800, // 48 hours
    timelockAdmin: "0x3333333333333333333333333333333333333333",
    timelockAdminIsContract: true,
    ...overrides,
  };
}

/**
 * Default to a HEALTHY 3-of-7 Safe. Tests that exercise concentration
 * risk override threshold/owners.
 *
 * 3-of-7 chosen over 3-of-5 (E.3 update) so the default trips none of
 * GOV-003's three rules: threshold (3) >= 3, ownerCount (7) >= 4,
 * ratio (3/7 ≈ 0.43) <= 0.5. 3-of-5 hits Rule 3 because 3/5 = 0.6 > 0.5.
 */
export function withMultisig(
  snapshot: GovernanceSnapshotData,
  overrides: Partial<GovernanceSnapshotData> = {},
): GovernanceSnapshotData {
  return {
    ...snapshot,
    hasMultisig: true,
    multisigAddress: "0x4444444444444444444444444444444444444444",
    multisigThreshold: 3,
    multisigOwnerCount: 7,
    multisigOwners: [
      "0xa000000000000000000000000000000000000001",
      "0xa000000000000000000000000000000000000002",
      "0xa000000000000000000000000000000000000003",
      "0xa000000000000000000000000000000000000004",
      "0xa000000000000000000000000000000000000005",
      "0xa000000000000000000000000000000000000006",
      "0xa000000000000000000000000000000000000007",
    ],
    ...overrides,
  };
}

/**
 * Default to EIP-1967 transparent proxy with verified implementation
 * + contract admin. The default implementationAbi exposes
 * pause/unpause/paused (OZ Pausable canonical) so cleanUniswapV3Fixture
 * stays quiet on GOV-006 — E.7 I2 update. Other detectors don't
 * scan for these names (transfer/balanceOf are ordinary ERC20;
 * pause/unpause/paused don't match any GOV-002 bypass pattern).
 *
 * Unsafe variants (CUSTOM, EOA admin, unverified impl, missing pause)
 * override the relevant fields.
 */
const CLEAN_PROXY_ABI = JSON.stringify([
  {
    type: "function",
    name: "transfer",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [],
    outputs: [],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "pause",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "unpause",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "paused",
    inputs: [],
    outputs: [],
    stateMutability: "view",
  },
]);

export function withProxy(
  snapshot: GovernanceSnapshotData,
  overrides: Partial<GovernanceSnapshotData> = {},
): GovernanceSnapshotData {
  return {
    ...snapshot,
    proxyType: "EIP_1967_TRANSPARENT",
    proxyAdminAddress: "0x5555555555555555555555555555555555555555",
    proxyImplementation: "0x6666666666666666666666666666666666666666",
    proxyVerified: true,
    proxyAdminIsContract: true,
    implementationAbi: CLEAN_PROXY_ABI,
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Named protocol fixtures (per spec §10.1)
// ────────────────────────────────────────────────────────────────────────

/**
 * Healthy Uniswap V3-like posture: governor + timelock + verified
 * proxy + 3-of-5 multisig. No detector should fire.
 */
export const cleanUniswapV3Fixture: GovernanceSnapshotData = withProxy(
  withMultisig(
    withTimelock(withGovernor(baseSnapshot()), { timelockMinDelay: 172_800 }),
  ),
);

// I.1 FIX 4: incident-anchor fixtures rebuilt as genuine multi-detector
// snapshots so each fires exactly the spec §14 detector set listed in
// `Drift-like fixture triggers GOV-001, GOV-002, GOV-003 (grade F)` etc.
// Previously each fixture was a single-surface stub (drift = governor
// only; beanstalk = thin multisig only; audius = CUSTOM proxy with null
// ABI) and only triggered ONE detector apiece — that broke the
// multi-detector regression contract spec §10.3 ("Breakwater would
// detect Drift") relies on.

/**
 * ABI fragment containing a bypass-pattern function. Matches GOV-002's
 * `/^emergency[A-Z]/` regex. Re-used across the drift fixture (as
 * protocolAbi for non-proxy contracts) and the beanstalk fixture below
 * with a different bypass-pattern function name for variety.
 */
const DRIFT_BYPASS_ABI = JSON.stringify([
  {
    type: "function",
    name: "emergencyWithdraw",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
]);

const BEANSTALK_BYPASS_ABI = JSON.stringify([
  {
    type: "function",
    name: "forceUpgrade",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
]);

/**
 * ABI fragment without any pause-pattern function. Pairs with the
 * audius fixture's `proxyType: "CUSTOM"` to fire GOV-006 (upgradeable
 * contract lacks emergency pause).
 */
const AUDIUS_NO_PAUSE_ABI = JSON.stringify([
  {
    type: "function",
    name: "transfer",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [],
    outputs: [],
    stateMutability: "view",
  },
]);

/**
 * Drift-like (spec §14 — fires GOV-001, GOV-002, GOV-003; grade F).
 *
 * Composition:
 *   - GOV-001 Rule 1: hasGovernor + !hasTimelock — governor exists,
 *     no timelock delay.
 *   - GOV-002:        protocolAbi exposes `emergencyWithdraw` (matches
 *     the `/^emergency[A-Z]/` bypass-pattern regex).
 *   - GOV-003 Rules 1+2: thin 1-of-2 multisig fires both the
 *     "threshold below 3" and "owners below 4" rules.
 *
 * Other detectors stay quiet by design:
 *   - GOV-004: votingSnapshotType is BLOCK_BASED (inherited from
 *     withGovernor — the safe baseline).
 *   - GOV-005 / GOV-006: proxyType stays NONE.
 *
 * Score math (per spec §5.3): 1 CRITICAL (GOV-001) + 1 CRITICAL
 * (GOV-002) + 2 HIGH (GOV-003) = 35 + 35 + 20 + 20 = 110 penalty →
 * clamped score 0 → grade F naturally.
 */
export const driftLikeFixture: GovernanceSnapshotData = withMultisig(
  withGovernor(baseSnapshot({ protocolAbi: DRIFT_BYPASS_ABI })),
  {
    multisigThreshold: 1,
    multisigOwnerCount: 2,
    multisigOwners: [
      "0xa000000000000000000000000000000000000001",
      "0xa000000000000000000000000000000000000002",
    ],
  },
);

/**
 * Beanstalk-like (spec §14 — fires GOV-001, GOV-002, GOV-004).
 *
 * Composition:
 *   - GOV-001 Rule 1: hasGovernor + !hasTimelock.
 *   - GOV-002:        protocolAbi exposes `forceUpgrade` (matches
 *     the `/^force[A-Z]/` bypass-pattern regex).
 *   - GOV-004:        hasGovernor + votingSnapshotType=CURRENT_BALANCE
 *     (flash-loan-vulnerable voting weight source) — the canonical
 *     governance pattern the Beanstalk exploit weaponised.
 *
 * Other detectors stay quiet: no multisig (GOV-003); proxyType NONE
 * (GOV-005 / GOV-006).
 */
export const beanstalkLikeFixture: GovernanceSnapshotData = withGovernor(
  baseSnapshot({ protocolAbi: BEANSTALK_BYPASS_ABI }),
  { votingSnapshotType: "CURRENT_BALANCE" },
);

/**
 * Audius-like (spec §14 — fires GOV-005, GOV-006).
 *
 * Composition:
 *   - GOV-005 Rule 2: proxyType=CUSTOM (non-standard proxy pattern,
 *     MEDIUM) — Audius's non-standard upgrade pattern is the anchor.
 *     proxyAdminAddress stays null so Rule 1 (EOA admin CRITICAL)
 *     does NOT also fire — keeps the fixture scoped to the spec set.
 *   - GOV-006:        proxyType != NONE + implementationAbi present
 *     + functions present + no pause-pattern function in the ABI →
 *     MEDIUM "upgradeable contract lacks emergency pause".
 *
 * Other detectors stay quiet: no governor (GOV-001 / GOV-004); no
 * bypass-pattern functions in the ABI (GOV-002); no multisig (GOV-003).
 */
export const audiusLikeFixture: GovernanceSnapshotData = baseSnapshot({
  proxyType: "CUSTOM",
  proxyAdminAddress: null,
  proxyImplementation: "0x7777777777777777777777777777777777777777",
  proxyVerified: true,
  proxyAdminIsContract: null,
  implementationAbi: AUDIUS_NO_PAUSE_ABI,
});
