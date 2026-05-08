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
 * + contract admin. Unsafe variants (CUSTOM, EOA admin, unverified
 * impl) override the relevant fields.
 */
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
    implementationAbi: "[]",
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

/**
 * Drift-like: governor present but no timelock at all. Triggers
 * GOV-001 Rule 1 (governance executes without timelock delay).
 */
export const driftLikeFixture: GovernanceSnapshotData = withGovernor(
  baseSnapshot(),
);

/**
 * Beanstalk-like: thin multisig (1-of-2) is the dominant governance
 * surface. Triggers GOV-003 (multisig concentration); other detectors
 * stay quiet.
 */
export const beanstalkLikeFixture: GovernanceSnapshotData = withMultisig(
  baseSnapshot(),
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
 * Audius-like: non-standard proxy pattern. proxyType = CUSTOM
 * (downgraded from EIP_1822_UUPS in D.5 I2). Triggers GOV-005 with
 * "couldn't classify" semantics; other detectors stay quiet.
 */
export const audiusLikeFixture: GovernanceSnapshotData = baseSnapshot({
  proxyType: "CUSTOM",
  proxyAdminAddress: null,
  proxyImplementation: "0x7777777777777777777777777777777777777777",
  proxyVerified: false,
  proxyAdminIsContract: null,
  implementationAbi: null,
});
