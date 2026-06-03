// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rpc-client", () => ({
  publicClient: {
    getBlockNumber: vi.fn(),
  },
}));

vi.mock("../detect-governor", () => ({
  detectGovernor: vi.fn(),
}));

vi.mock("../detect-timelock", () => ({
  detectTimelock: vi.fn(),
}));

vi.mock("../detect-safe", () => ({
  detectSafe: vi.fn(),
}));

vi.mock("../detect-proxy", () => ({
  detectProxy: vi.fn(),
}));

vi.mock("@/lib/etherscan-client", () => ({
  fetchContractAbi: vi.fn(),
}));

// H.8: captureGovernanceSnapshot now pre-flights the address via
// checkIsContract. Mock the helper so existing tests pass through
// unchanged (default: true → "is a contract") and the new H.8 gate
// tests can flip the return value to false to exercise the throw.
vi.mock("../contract-utils", () => ({
  checkIsContract: vi.fn(),
}));

import { fetchContractAbi } from "@/lib/etherscan-client";
import { publicClient } from "@/lib/rpc-client";

import { checkIsContract } from "../contract-utils";
import { detectGovernor } from "../detect-governor";
import { detectProxy } from "../detect-proxy";
import { detectSafe } from "../detect-safe";
import { detectTimelock } from "../detect-timelock";

import { captureGovernanceSnapshot } from "../capture-snapshot";

const getBlockNumberMock = vi.mocked(publicClient.getBlockNumber);
const checkIsContractMock = vi.mocked(checkIsContract);
const detectGovernorMock = vi.mocked(detectGovernor);
const detectTimelockMock = vi.mocked(detectTimelock);
const detectSafeMock = vi.mocked(detectSafe);
const detectProxyMock = vi.mocked(detectProxy);
const fetchContractAbiMock = vi.mocked(fetchContractAbi);

const PROTOCOL = "0x1111111111111111111111111111111111111111";

describe("captureGovernanceSnapshot (Plan 02 D.3c)", () => {
  beforeEach(() => {
    getBlockNumberMock.mockReset();
    checkIsContractMock.mockReset();
    detectGovernorMock.mockReset();
    detectTimelockMock.mockReset();
    detectSafeMock.mockReset();
    detectProxyMock.mockReset();
    fetchContractAbiMock.mockReset();
    // Default: protocol ABI fetch fails gracefully (matches the
    // "no Etherscan key configured" code path most existing tests
    // expect). Test cases that exercise the success path override.
    fetchContractAbiMock.mockResolvedValue({
      ok: false,
      reason: "missing_api_key",
      message: "ETHERSCAN_API_KEY env var not set",
    });
    // H.8 default: protocolAddress is a contract. Tests that exercise
    // the EOA gate override this explicitly. Returning `null` (the
    // "RPC failed" state) also passes the gate per H.8 semantics —
    // only a definitive `false` triggers the throw.
    checkIsContractMock.mockResolvedValue(true);
  });

  it("composes a full populated snapshot from all detector outputs", async () => {
    getBlockNumberMock.mockResolvedValue(BigInt(20_000_000));
    detectGovernorMock.mockResolvedValue({
      type: "OZ_GOVERNOR",
      address: "0xgov",
      version: "1",
      votingSnapshotType: "BLOCK_BASED",
      raw: { name: "TestGov" },
    });
    detectTimelockMock.mockResolvedValue({
      address: "0xtimelock",
      minDelay: 172_800,
      admin: "0xadmin",
      adminIsContract: true,
      raw: { getMinDelay: "172800", delay: null, admin: "0xadmin" },
    });
    detectSafeMock.mockResolvedValue({
      address: "0xsafe",
      threshold: 3,
      ownerCount: 5,
      owners: ["0x1", "0x2", "0x3", "0x4", "0x5"],
      isSafe: true,
    });
    detectProxyMock.mockResolvedValue({
      proxyType: "EIP_1967_TRANSPARENT",
      proxyAdminAddress: "0xadmin",
      proxyImplementation: "0ximpl",
      proxyAdminIsContract: true,
      implementationAbi: "[]",
    });

    const snapshot = await captureGovernanceSnapshot({
      contractAddress: PROTOCOL, role: "PRIMARY" as const,
      declaredMultisigCandidate: "0xsafe",
    });

    expect(snapshot.blockNumber).toBe(BigInt(20_000_000));
    expect(snapshot.hasGovernor).toBe(true);
    expect(snapshot.governorType).toBe("OZ_GOVERNOR");
    expect(snapshot.hasTimelock).toBe(true);
    expect(snapshot.timelockMinDelay).toBe(172_800);
    expect(snapshot.timelockAdminIsContract).toBe(true);
    expect(snapshot.hasMultisig).toBe(true);
    expect(snapshot.multisigOwnerCount).toBe(5);
    expect(snapshot.proxyType).toBe("EIP_1967_TRANSPARENT");
    expect(snapshot.proxyVerified).toBe(true);
    expect(snapshot.capturedAt).toBeInstanceOf(Date);
  });

  it("normalises absent detectors to null/false/[] (no conditional unwrapping needed downstream)", async () => {
    getBlockNumberMock.mockResolvedValue(BigInt(20_000_000));
    detectGovernorMock.mockResolvedValue(null);
    detectTimelockMock.mockResolvedValue(null);
    detectProxyMock.mockResolvedValue({
      proxyType: "NONE",
      proxyAdminAddress: null,
      proxyImplementation: null,
      proxyAdminIsContract: null,
      implementationAbi: null,
    });

    const snapshot = await captureGovernanceSnapshot({
      contractAddress: PROTOCOL, role: "PRIMARY" as const,
    });

    expect(snapshot.hasGovernor).toBe(false);
    expect(snapshot.governorAddress).toBeNull();
    expect(snapshot.hasTimelock).toBe(false);
    expect(snapshot.timelockAddress).toBeNull();
    expect(snapshot.hasMultisig).toBe(false);
    expect(snapshot.multisigOwners).toEqual([]);
    expect(snapshot.proxyType).toBe("NONE");
    expect(snapshot.proxyVerified).toBe(false);
  });

  it("skips Safe detection entirely when no declaredMultisigAddresses are provided", async () => {
    getBlockNumberMock.mockResolvedValue(BigInt(20_000_000));
    detectGovernorMock.mockResolvedValue(null);
    detectTimelockMock.mockResolvedValue(null);
    detectProxyMock.mockResolvedValue({
      proxyType: "NONE",
      proxyAdminAddress: null,
      proxyImplementation: null,
      proxyAdminIsContract: null,
      implementationAbi: null,
    });

    const snapshot = await captureGovernanceSnapshot({
      contractAddress: PROTOCOL, role: "PRIMARY" as const,
    });

    expect(detectSafeMock).not.toHaveBeenCalled();
    expect(snapshot.hasMultisig).toBe(false);
    expect(snapshot.multisigOwners).toEqual([]);
  });

  it("treats Safe detection returning not_a_safe as hasMultisig:false (declared address is not a Safe)", async () => {
    getBlockNumberMock.mockResolvedValue(BigInt(20_000_000));
    detectGovernorMock.mockResolvedValue(null);
    detectTimelockMock.mockResolvedValue(null);
    detectSafeMock.mockResolvedValue({
      address: "0xfake",
      isSafe: false,
      reason: "not_a_safe",
    });
    detectProxyMock.mockResolvedValue({
      proxyType: "NONE",
      proxyAdminAddress: null,
      proxyImplementation: null,
      proxyAdminIsContract: null,
      implementationAbi: null,
    });

    const snapshot = await captureGovernanceSnapshot({
      contractAddress: PROTOCOL, role: "PRIMARY" as const,
      declaredMultisigCandidate: "0xfake",
    });

    expect(snapshot.hasMultisig).toBe(false);
    expect(snapshot.multisigAddress).toBeNull();
    // The not_a_safe payload is preserved in rawState for GOV-003 inspection.
    expect(snapshot.rawState.safe).toMatchObject({
      isSafe: false,
      reason: "not_a_safe",
    });
  });

  it("captures rawState entries for downstream debugging (per detector)", async () => {
    getBlockNumberMock.mockResolvedValue(BigInt(20_000_000));
    detectGovernorMock.mockResolvedValue({
      type: "OZ_GOVERNOR",
      address: "0xgov",
      version: null,
      votingSnapshotType: null,
      raw: { name: "TestGov" },
    });
    detectTimelockMock.mockResolvedValue(null);
    detectProxyMock.mockResolvedValue({
      proxyType: "NONE",
      proxyAdminAddress: null,
      proxyImplementation: null,
      proxyAdminIsContract: null,
      implementationAbi: null,
    });

    const snapshot = await captureGovernanceSnapshot({
      contractAddress: PROTOCOL, role: "PRIMARY" as const,
    });

    expect(snapshot.rawState.governor).toMatchObject({ name: "TestGov" });
    expect(snapshot.rawState.timelock).toBeNull();
    expect(snapshot.rawState.proxy).toMatchObject({ type: "NONE" });
  });

  // ── Plan 02 E.2: protocolAbi population ────────────────────────────────
  // Behavior:
  //   proxyType === "NONE" → fetch protocolAbi from Etherscan
  //   proxyType !== "NONE" → skip the fetch (implementationAbi covers it)
  //   Etherscan failure   → protocolAbi stays null (graceful degrade)

  it("E.2: fetches protocolAbi from Etherscan when proxyType is NONE", async () => {
    getBlockNumberMock.mockResolvedValue(BigInt(20_000_000));
    detectGovernorMock.mockResolvedValue(null);
    detectTimelockMock.mockResolvedValue(null);
    detectProxyMock.mockResolvedValue({
      proxyType: "NONE",
      proxyAdminAddress: null,
      proxyImplementation: null,
      proxyAdminIsContract: null,
      implementationAbi: null,
    });
    fetchContractAbiMock.mockResolvedValue({
      ok: true,
      data: '[{"type":"function","name":"emergencyWithdraw"}]',
    });

    const snapshot = await captureGovernanceSnapshot({
      contractAddress: PROTOCOL, role: "PRIMARY" as const,
    });

    expect(fetchContractAbiMock).toHaveBeenCalledWith(PROTOCOL);
    expect(snapshot.protocolAbi).toContain("emergencyWithdraw");
  });

  it("E.2: leaves protocolAbi null when Etherscan fetch fails", async () => {
    getBlockNumberMock.mockResolvedValue(BigInt(20_000_000));
    detectGovernorMock.mockResolvedValue(null);
    detectTimelockMock.mockResolvedValue(null);
    detectProxyMock.mockResolvedValue({
      proxyType: "NONE",
      proxyAdminAddress: null,
      proxyImplementation: null,
      proxyAdminIsContract: null,
      implementationAbi: null,
    });
    // beforeEach already sets the missing_api_key default; just call.

    const snapshot = await captureGovernanceSnapshot({
      contractAddress: PROTOCOL, role: "PRIMARY" as const,
    });

    expect(snapshot.protocolAbi).toBeNull();
  });

  it("E.2: skips protocolAbi fetch entirely for proxy contracts", async () => {
    getBlockNumberMock.mockResolvedValue(BigInt(20_000_000));
    detectGovernorMock.mockResolvedValue(null);
    detectTimelockMock.mockResolvedValue(null);
    detectProxyMock.mockResolvedValue({
      proxyType: "EIP_1967_TRANSPARENT",
      proxyAdminAddress: "0xadmin",
      proxyImplementation: "0ximpl",
      proxyAdminIsContract: true,
      implementationAbi: "[]",
    });

    const snapshot = await captureGovernanceSnapshot({
      contractAddress: PROTOCOL, role: "PRIMARY" as const,
    });

    expect(fetchContractAbiMock).not.toHaveBeenCalled();
    expect(snapshot.protocolAbi).toBeNull();
    expect(snapshot.implementationAbi).toBe("[]");
  });

  // ── H.8: address_is_not_contract gate ──────────────────────────────────
  //
  // Without this gate, an EOA submission yielded a fully-null snapshot
  // (no governor / timelock / multisig / proxy / ABI). Every detector
  // returns [] on null input → composite score 100 → misleading grade A.
  // The gate throws before any detector runs; executeGovernanceModule's
  // catch block (F.1) marks the ModuleRun FAILED with the message.
  describe("H.8 — address bytecode validation", () => {
    it("throws address_is_not_contract when checkIsContract returns false (EOA)", async () => {
      getBlockNumberMock.mockResolvedValue(BigInt(20_000_000));
      checkIsContractMock.mockResolvedValue(false);

      await expect(
        captureGovernanceSnapshot({ contractAddress: PROTOCOL, role: "PRIMARY" as const }),
      ).rejects.toThrow(/address_is_not_contract/);
    });

    it("includes the address in the error message for actionability", async () => {
      getBlockNumberMock.mockResolvedValue(BigInt(20_000_000));
      checkIsContractMock.mockResolvedValue(false);

      await expect(
        captureGovernanceSnapshot({ contractAddress: PROTOCOL, role: "PRIMARY" as const }),
      ).rejects.toThrow(new RegExp(PROTOCOL));
    });

    it("does NOT invoke detectors when the address is not a contract", async () => {
      getBlockNumberMock.mockResolvedValue(BigInt(20_000_000));
      checkIsContractMock.mockResolvedValue(false);

      await expect(
        captureGovernanceSnapshot({ contractAddress: PROTOCOL, role: "PRIMARY" as const }),
      ).rejects.toThrow();

      expect(detectGovernorMock).not.toHaveBeenCalled();
      expect(detectTimelockMock).not.toHaveBeenCalled();
      expect(detectSafeMock).not.toHaveBeenCalled();
      expect(detectProxyMock).not.toHaveBeenCalled();
    });

    it("passes the pinned blockNumber to checkIsContract (consistent snapshot)", async () => {
      const pinned = BigInt(20_000_001);
      getBlockNumberMock.mockResolvedValue(pinned);
      // Re-throw via the gate so we don't have to mock the full happy path.
      checkIsContractMock.mockResolvedValue(false);

      await expect(
        captureGovernanceSnapshot({ contractAddress: PROTOCOL, role: "PRIMARY" as const }),
      ).rejects.toThrow();

      expect(checkIsContractMock).toHaveBeenCalledWith(PROTOCOL, pinned);
    });

    it("does NOT throw when checkIsContract returns null (RPC failure is not a definitive EOA signal)", async () => {
      getBlockNumberMock.mockResolvedValue(BigInt(20_000_000));
      checkIsContractMock.mockResolvedValue(null);

      // Fail downstream detection so we don't have to set up the full
      // happy path — the point is the gate itself didn't throw on null.
      detectGovernorMock.mockResolvedValue(null);
      detectTimelockMock.mockResolvedValue(null);
      detectProxyMock.mockResolvedValue({
        proxyType: "NONE",
        proxyAdminAddress: null,
        proxyImplementation: null,
        proxyAdminIsContract: null,
        implementationAbi: null,
      });

      const snapshot = await captureGovernanceSnapshot({
        contractAddress: PROTOCOL, role: "PRIMARY" as const,
      });
      // Reached the downstream code path = gate passed null through.
      expect(snapshot).toBeDefined();
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Plan 03 §5.1.1 — role-aware probe routing
// ────────────────────────────────────────────────────────────────────────────

describe("captureGovernanceSnapshot — Plan 03 §5.1.1 role branches", () => {
  beforeEach(() => {
    getBlockNumberMock.mockReset();
    checkIsContractMock.mockReset();
    detectGovernorMock.mockReset();
    detectTimelockMock.mockReset();
    detectSafeMock.mockReset();
    detectProxyMock.mockReset();
    fetchContractAbiMock.mockReset();

    // Defaults: contract is deployed; ABI fetch fails gracefully.
    getBlockNumberMock.mockResolvedValue(BigInt(20_000_000));
    checkIsContractMock.mockResolvedValue(true);
    fetchContractAbiMock.mockResolvedValue({
      ok: false,
      reason: "missing_api_key",
      message: "ETHERSCAN_API_KEY env var not set",
    });
  });

  // ── DECLARED_MULTISIG: the BLOCKER 2 load-bearing case ────────────────

  it("DECLARED_MULTISIG role: detectSafe fires on contractAddress, governor/timelock/proxy not invoked (spec §5.1.1 BLOCKER 2 fix)", async () => {
    const MULTISIG = "0xaaaa000000000000000000000000000000000001";
    detectSafeMock.mockResolvedValue({
      address: MULTISIG,
      threshold: 1,
      ownerCount: 2,
      owners: ["0xowner1", "0xowner2"],
      isSafe: true,
    });

    const snapshot = await captureGovernanceSnapshot({
      contractAddress: MULTISIG,
      role: "DECLARED_MULTISIG",
    });

    // Load-bearing assertion: detectSafe invoked DIRECTLY on the scan
    // target address (the contractAddress itself becomes the
    // candidateAddress passed to detectSafe).
    expect(detectSafeMock).toHaveBeenCalledWith({ candidateAddress: MULTISIG });

    // Other probes not invoked — multisigs aren't governors / don't
    // sit behind proxies in the typical Safe deployment model.
    expect(detectGovernorMock).not.toHaveBeenCalled();
    expect(detectTimelockMock).not.toHaveBeenCalled();
    expect(detectProxyMock).not.toHaveBeenCalled();

    // The resulting snapshot carries the multisig metadata GOV-003
    // needs to fire on this target (multisigAddress + threshold +
    // ownerCount populated — Plan 02's GOV-003 fires when threshold==1
    // OR ownerCount < 3 against a hasMultisig:true snapshot).
    expect(snapshot.hasMultisig).toBe(true);
    expect(snapshot.multisigAddress).toBe(MULTISIG);
    expect(snapshot.multisigThreshold).toBe(1);
    expect(snapshot.multisigOwnerCount).toBe(2);
    expect(snapshot.multisigOwners).toEqual(["0xowner1", "0xowner2"]);

    // Skipped-probe outputs normalise to the same null/false shape Plan
    // 02 already produces for absent detections (no conditional
    // unwrapping needed downstream).
    expect(snapshot.hasGovernor).toBe(false);
    expect(snapshot.hasTimelock).toBe(false);
    expect(snapshot.proxyType).toBe("NONE");

    // rawState.role records the branch the capture took (spec §5.1.1
    // forensic readability).
    expect((snapshot.rawState as { role: string }).role).toBe(
      "DECLARED_MULTISIG",
    );
  });

  // ── TIMELOCK: direct timelock scan ────────────────────────────────────

  it("TIMELOCK role: detectTimelock fires on contractAddress directly (governor cascade skipped)", async () => {
    const TIMELOCK = "0xbbbb000000000000000000000000000000000002";
    detectTimelockMock.mockResolvedValue({
      address: TIMELOCK,
      minDelay: 0, // GOV-001 would fire on insufficient delay
      admin: "0xadmin",
      adminIsContract: false,
      raw: { getMinDelay: "0", delay: null, admin: "0xadmin" },
    });
    detectProxyMock.mockResolvedValue({
      proxyType: "NONE",
      proxyAdminAddress: null,
      proxyImplementation: null,
      proxyAdminIsContract: null,
      implementationAbi: null,
    });

    const snapshot = await captureGovernanceSnapshot({
      contractAddress: TIMELOCK,
      role: "TIMELOCK",
    });

    // Load-bearing: detectTimelock invoked with candidateAddress ==
    // contractAddress (not via governor cascade).
    expect(detectTimelockMock).toHaveBeenCalledWith({
      blockNumber: BigInt(20_000_000),
      governorResult: null,
      candidateAddress: TIMELOCK,
    });
    expect(detectGovernorMock).not.toHaveBeenCalled();
    expect(detectSafeMock).not.toHaveBeenCalled();
    // Proxy DOES run — timelocks can be deployed behind proxies.
    expect(detectProxyMock).toHaveBeenCalled();

    expect(snapshot.hasTimelock).toBe(true);
    expect(snapshot.timelockAddress).toBe(TIMELOCK);
    expect(snapshot.timelockMinDelay).toBe(0);
    expect((snapshot.rawState as { role: string }).role).toBe("TIMELOCK");
  });

  // ── PROXY_IMPLEMENTATION: default cascade still runs ──────────────────

  it("PROXY_IMPLEMENTATION role: default cascade (governor + timelock + proxy) runs on the implementation address", async () => {
    detectGovernorMock.mockResolvedValue(null);
    detectTimelockMock.mockResolvedValue(null);
    detectProxyMock.mockResolvedValue({
      proxyType: "NONE",
      proxyAdminAddress: null,
      proxyImplementation: null,
      proxyAdminIsContract: null,
      implementationAbi: null,
    });

    const snapshot = await captureGovernanceSnapshot({
      contractAddress: PROTOCOL,
      role: "PROXY_IMPLEMENTATION",
    });

    // Cascade matches PRIMARY default: governor + timelock + proxy
    // probes invoked against the impl address. Implementations can
    // themselves be governors or have their own admin surface, so
    // skipping these would lose signal.
    expect(detectGovernorMock).toHaveBeenCalledWith({
      protocolAddress: PROTOCOL,
      blockNumber: BigInt(20_000_000),
    });
    expect(detectTimelockMock).toHaveBeenCalled();
    expect(detectProxyMock).toHaveBeenCalledWith({
      protocolAddress: PROTOCOL,
      blockNumber: BigInt(20_000_000),
    });
    // No multisig candidate supplied → detectSafe NOT invoked (matches
    // Plan 02 default).
    expect(detectSafeMock).not.toHaveBeenCalled();
    expect((snapshot.rawState as { role: string }).role).toBe(
      "PROXY_IMPLEMENTATION",
    );
  });

  // ── PRIMARY with sibling multisig hint: existing Plan 02 behavior ─────

  it("PRIMARY role with declaredMultisigCandidate: detectSafe invoked with the candidate, NOT with contractAddress (Plan 02 backward compat)", async () => {
    const SIBLING_MULTISIG = "0xcccc000000000000000000000000000000000003";
    detectGovernorMock.mockResolvedValue(null);
    detectTimelockMock.mockResolvedValue(null);
    detectSafeMock.mockResolvedValue({
      address: SIBLING_MULTISIG,
      threshold: 3,
      ownerCount: 5,
      owners: ["0x1", "0x2", "0x3", "0x4", "0x5"],
      isSafe: true,
    });
    detectProxyMock.mockResolvedValue({
      proxyType: "NONE",
      proxyAdminAddress: null,
      proxyImplementation: null,
      proxyAdminIsContract: null,
      implementationAbi: null,
    });

    const snapshot = await captureGovernanceSnapshot({
      contractAddress: PROTOCOL,
      role: "PRIMARY",
      declaredMultisigCandidate: SIBLING_MULTISIG,
    });

    // detectSafe invoked with the SIBLING address, not with PROTOCOL.
    // This is the Plan 02 surface: PRIMARY scans pass a separate
    // multisig hint when one is supplied by a sibling Contract.
    expect(detectSafeMock).toHaveBeenCalledWith({
      candidateAddress: SIBLING_MULTISIG,
    });
    expect(detectSafeMock).not.toHaveBeenCalledWith({
      candidateAddress: PROTOCOL,
    });
    expect(snapshot.hasMultisig).toBe(true);
    expect(snapshot.multisigAddress).toBe(SIBLING_MULTISIG);
  });

  // ── PRIMARY with timelock candidate hint ──────────────────────────────

  it("PRIMARY role with timelockCandidate: detectTimelock receives the candidate (sibling-hint pathway)", async () => {
    const SIBLING_TIMELOCK = "0xdddd000000000000000000000000000000000004";
    detectGovernorMock.mockResolvedValue(null);
    detectTimelockMock.mockResolvedValue(null);
    detectProxyMock.mockResolvedValue({
      proxyType: "NONE",
      proxyAdminAddress: null,
      proxyImplementation: null,
      proxyAdminIsContract: null,
      implementationAbi: null,
    });

    await captureGovernanceSnapshot({
      contractAddress: PROTOCOL,
      role: "PRIMARY",
      timelockCandidate: SIBLING_TIMELOCK,
    });

    expect(detectTimelockMock).toHaveBeenCalledWith({
      blockNumber: BigInt(20_000_000),
      governorResult: null,
      candidateAddress: SIBLING_TIMELOCK,
    });
  });

  // ── RELATED: identical to PRIMARY default ─────────────────────────────

  it("RELATED role: default Plan 02 capture path (same as PRIMARY)", async () => {
    detectGovernorMock.mockResolvedValue(null);
    detectTimelockMock.mockResolvedValue(null);
    detectProxyMock.mockResolvedValue({
      proxyType: "NONE",
      proxyAdminAddress: null,
      proxyImplementation: null,
      proxyAdminIsContract: null,
      implementationAbi: null,
    });

    const snapshot = await captureGovernanceSnapshot({
      contractAddress: PROTOCOL,
      role: "RELATED",
    });

    expect(detectGovernorMock).toHaveBeenCalledWith({
      protocolAddress: PROTOCOL,
      blockNumber: BigInt(20_000_000),
    });
    expect(detectTimelockMock).toHaveBeenCalled();
    expect(detectProxyMock).toHaveBeenCalled();
    // No multisig candidate → detectSafe skipped (Plan 02 behavior).
    expect(detectSafeMock).not.toHaveBeenCalled();
    expect((snapshot.rawState as { role: string }).role).toBe("RELATED");
  });

  // ── TOKEN_CONTRACT + DECLARED_BRIDGE: defensive throws ────────────────

  it("TOKEN_CONTRACT role throws BEFORE any RPC — short-circuits getBlockNumber + checkIsContract + all detector probes", async () => {
    await expect(
      captureGovernanceSnapshot({
        contractAddress: "0xeeee000000000000000000000000000000000005",
        role: "TOKEN_CONTRACT",
      }),
    ).rejects.toThrow(/should be SKIPPED at submission/);
    // Defensive throw fires before any RPC call. The submission
    // filter (§4.2) should have already SKIPPED these roles at
    // ModuleRun creation; this is defense-in-depth in case the
    // filter is bypassed.
    expect(getBlockNumberMock).not.toHaveBeenCalled();
    expect(checkIsContractMock).not.toHaveBeenCalled();
    expect(detectGovernorMock).not.toHaveBeenCalled();
    expect(detectTimelockMock).not.toHaveBeenCalled();
    expect(detectSafeMock).not.toHaveBeenCalled();
    expect(detectProxyMock).not.toHaveBeenCalled();
  });

  it("DECLARED_BRIDGE role throws BEFORE any RPC — short-circuits getBlockNumber + checkIsContract + all detector probes", async () => {
    await expect(
      captureGovernanceSnapshot({
        contractAddress: "0xffff000000000000000000000000000000000006",
        role: "DECLARED_BRIDGE",
      }),
    ).rejects.toThrow(/should be SKIPPED at submission/);
    // Same defense-in-depth contract as TOKEN_CONTRACT above.
    expect(getBlockNumberMock).not.toHaveBeenCalled();
    expect(checkIsContractMock).not.toHaveBeenCalled();
    expect(detectGovernorMock).not.toHaveBeenCalled();
    expect(detectTimelockMock).not.toHaveBeenCalled();
    expect(detectSafeMock).not.toHaveBeenCalled();
    expect(detectProxyMock).not.toHaveBeenCalled();
  });

  // ── blockNumber pin (spec §5.1.2) ─────────────────────────────────────

  it("honors the optional blockNumber pin when provided (spec §5.1.2 — Plan 04 graph-wide coordination seam)", async () => {
    const PINNED = BigInt(21_000_000);
    detectGovernorMock.mockResolvedValue(null);
    detectTimelockMock.mockResolvedValue(null);
    detectProxyMock.mockResolvedValue({
      proxyType: "NONE",
      proxyAdminAddress: null,
      proxyImplementation: null,
      proxyAdminIsContract: null,
      implementationAbi: null,
    });

    const snapshot = await captureGovernanceSnapshot({
      contractAddress: PROTOCOL,
      role: "PRIMARY",
      blockNumber: PINNED,
    });

    expect(snapshot.blockNumber).toBe(PINNED);
    // publicClient.getBlockNumber NOT consulted when a pin is provided.
    expect(getBlockNumberMock).not.toHaveBeenCalled();
  });
});
