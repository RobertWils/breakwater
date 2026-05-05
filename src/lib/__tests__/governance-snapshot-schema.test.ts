// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  GovernorType,
  ProxyType,
  VotingSnapshotType,
  type GovernanceSnapshot,
  type Prisma,
} from "@prisma/client";

describe("GovernanceSnapshot schema (Plan 02 B.1)", () => {
  it("exports GovernorType enum with 3 variants", () => {
    expect(GovernorType.OZ_GOVERNOR).toBe("OZ_GOVERNOR");
    expect(GovernorType.COMPOUND_BRAVO).toBe("COMPOUND_BRAVO");
    expect(GovernorType.CUSTOM).toBe("CUSTOM");
  });

  it("exports ProxyType enum with 4 variants", () => {
    expect(ProxyType.EIP_1967_TRANSPARENT).toBe("EIP_1967_TRANSPARENT");
    expect(ProxyType.EIP_1822_UUPS).toBe("EIP_1822_UUPS");
    expect(ProxyType.CUSTOM).toBe("CUSTOM");
    expect(ProxyType.NONE).toBe("NONE");
  });

  it("exports VotingSnapshotType enum with 3 variants", () => {
    expect(VotingSnapshotType.BLOCK_BASED).toBe("BLOCK_BASED");
    expect(VotingSnapshotType.CURRENT_BALANCE).toBe("CURRENT_BALANCE");
    expect(VotingSnapshotType.NONE).toBe("NONE");
  });

  it("GovernanceSnapshot type carries every Plan 02 B.1 field", () => {
    // Type-level proof: Pick<T, K> errors at compile time if any K is
    // not present on T. Listing every field keeps the schema honest:
    // dropping or renaming a column without updating B.2/D.3c/E.2 will
    // surface here as a tsc failure rather than silently downstream.
    type _Proof = Pick<
      GovernanceSnapshot,
      | "id"
      | "scanId"
      | "blockNumber"
      | "capturedAt"
      | "hasGovernor"
      | "governorAddress"
      | "governorType"
      | "governorVersion"
      | "hasTimelock"
      | "timelockAddress"
      | "timelockMinDelay"
      | "timelockAdmin"
      | "hasMultisig"
      | "multisigAddress"
      | "multisigThreshold"
      | "multisigOwnerCount"
      | "multisigOwners"
      | "proxyType"
      | "proxyAdminAddress"
      | "proxyImplementation"
      | "proxyVerified"
      | "proxyAdminIsContract"
      | "implementationAbi"
      | "votingTokenAddress"
      | "votingSnapshotType"
      | "rawState"
    >;
    const _check: _Proof | null = null;
    expect(_check).toBeNull();
  });

  it("Scan model has governanceSnapshot relation (nullable 1:1)", () => {
    type ScanWithSnapshot = Prisma.ScanGetPayload<{
      include: { governanceSnapshot: true };
    }>;
    // The include narrows governanceSnapshot to GovernanceSnapshot | null.
    // If the relation is missing or shaped wrong, this Pick errors.
    type _RelationProof = Pick<ScanWithSnapshot, "governanceSnapshot">;
    const _check: _RelationProof | null = null;
    expect(_check).toBeNull();
  });

  it("blockNumber typed as bigint, multisigOwners as string[]", () => {
    type _BlockNumber = GovernanceSnapshot["blockNumber"];
    type _Owners = GovernanceSnapshot["multisigOwners"];
    const blockNumber: _BlockNumber = BigInt(20_000_000);
    const owners: _Owners = [
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
    ];
    expect(typeof blockNumber).toBe("bigint");
    expect(Array.isArray(owners)).toBe(true);
  });
});
