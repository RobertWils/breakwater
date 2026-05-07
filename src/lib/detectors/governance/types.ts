import type {
  GovernorType,
  ProxyType,
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

  // Timelock (D.3b)
  hasTimelock: boolean;
  timelockAddress: string | null;
  timelockMinDelay: number | null;
  timelockAdmin: string | null;

  // Multisig (D.3b)
  hasMultisig: boolean;
  multisigAddress: string | null;
  multisigThreshold: number | null;
  multisigOwnerCount: number | null;
  multisigOwners: string[];

  // Proxy (D.3c)
  proxyType: ProxyType | null;
  proxyAdminAddress: string | null;
  proxyImplementation: string | null;
  proxyVerified: boolean;
  proxyAdminIsContract: boolean | null;
  implementationAbi: string | null;

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
  raw: Record<string, unknown>;
} | null;

export interface GovernorDetectionContext {
  protocolAddress: string;
  blockNumber: bigint;
}
