import type {
  GovernorType,
  ProxyType,
  Severity,
  VotingSnapshotType,
} from "@prisma/client";

/**
 * Full snapshot the governance module produces for a single scan.
 *
 * All fields are declared up front (per Plan 02 self-review). Phase D.3a
 * populates the Governor section; D.3b populates Timelock + Multisig;
 * D.3c populates Proxy. The shape never narrows or widens between
 * phases — undefined-of-not-yet-populated stays expressed as `null` /
 * `false` / `[]` so consumers don't need conditional unwrapping.
 */
export interface GovernanceSnapshotData {
  blockNumber: bigint;
  capturedAt: Date;

  // Governor (D.3a)
  hasGovernor: boolean;
  governorAddress: string | null;
  governorType: GovernorType | null;
  governorVersion: string | null;

  // Timelock (D.3b + D.6)
  hasTimelock: boolean;
  timelockAddress: string | null;
  timelockMinDelay: number | null;
  timelockAdmin: string | null;
  timelockAdminIsContract: boolean | null;

  // Multisig (D.3b)
  hasMultisig: boolean;
  multisigAddress: string | null;
  multisigThreshold: number | null;
  multisigOwnerCount: number | null;
  multisigOwners: string[];

  // Proxy (D.3c) + non-proxy ABI (E.2)
  proxyType: ProxyType | null;
  proxyAdminAddress: string | null;
  proxyImplementation: string | null;
  proxyVerified: boolean;
  proxyAdminIsContract: boolean | null;
  /** ABI of the proxy implementation contract (when proxyType !== NONE). */
  implementationAbi: string | null;
  /** ABI of the protocol contract itself (E.2 — populated when proxyType === NONE). */
  protocolAbi: string | null;

  // Voting (filled across D.3a/c as detector needs grow)
  votingTokenAddress: string | null;
  votingSnapshotType: VotingSnapshotType | null;

  // Raw multicall results — keyed by probe section for debugging.
  rawState: Record<string, unknown>;
}

/**
 * Result of `detectGovernor`. `null` means the address is not a Governor;
 * a populated value carries the type discriminator and the raw probe
 * results so D.3b/c (Timelock owner check, etc.) can chain off it
 * without re-querying.
 */
export type GovernorDetectionResult = {
  type: GovernorType;
  address: string;
  version: string | null;
  /**
   * Voting weight source (E.4 — populated by detect-governor's snapshot
   * probe). `null` when the probe couldn't determine; `BLOCK_BASED` is
   * the canonical safe value (covers both OZ block-number checkpoints
   * and OZ 4.9+ timestamp clocks — the granularity is captured in
   * `raw.clockMode` for forensics, see Plan 02 NOTES.md backlog).
   */
  votingSnapshotType: VotingSnapshotType | null;
  raw: Record<string, unknown>;
} | null;

export interface GovernorDetectionContext {
  protocolAddress: string;
  blockNumber: bigint;
}

/**
 * Input shape for creating a Finding from a detector (Plan 02 E.1).
 *
 * Detectors return `GovernanceFindingInput[]` — empty array means
 * clean. Phase F orchestrator translates these into Finding rows with
 * scanId, moduleRunId, and snapshotBlockNumber injected at persistence
 * time so detectors stay pure functions of snapshot input.
 *
 * `detectorVersion` is `number` per Plan 02 decision (Q1 in E recon):
 * String semver (`"1.0.0"`) deferred to Plan 03+ — see NOTES.md
 * backlog. All Plan 02 detectors ship with `detectorVersion: 1`;
 * bump on heuristic changes once we ship.
 */
export interface GovernanceFindingInput {
  detectorId: string;
  detectorVersion: number;
  severity: Severity;
  publicTitle: string;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  affectedComponent: string | null;
  references: string[];
  remediationHint: string;
  remediationDetailed: string;
  publicRank: number;
}

/**
 * Detector function signature shared by GOV-001..GOV-006.
 *
 * Pure synchronous function over snapshot data. The orchestrator
 * (Phase F) iterates over the registry and aggregates findings.
 *
 * Note: GOV-002 reads `protocolAbi` (added in E.2) which is already
 * in the snapshot — still pure, no I/O at detector layer.
 */
export type GovernanceDetector = (
  snapshot: GovernanceSnapshotData,
) => GovernanceFindingInput[];
