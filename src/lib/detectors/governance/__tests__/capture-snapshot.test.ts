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

import { publicClient } from "@/lib/rpc-client";

import { detectGovernor } from "../detect-governor";
import { detectProxy } from "../detect-proxy";
import { detectSafe } from "../detect-safe";
import { detectTimelock } from "../detect-timelock";

import { captureGovernanceSnapshot } from "../capture-snapshot";

const getBlockNumberMock = vi.mocked(publicClient.getBlockNumber);
const detectGovernorMock = vi.mocked(detectGovernor);
const detectTimelockMock = vi.mocked(detectTimelock);
const detectSafeMock = vi.mocked(detectSafe);
const detectProxyMock = vi.mocked(detectProxy);

const PROTOCOL = "0x1111111111111111111111111111111111111111";

describe("captureGovernanceSnapshot (Plan 02 D.3c)", () => {
  beforeEach(() => {
    getBlockNumberMock.mockReset();
    detectGovernorMock.mockReset();
    detectTimelockMock.mockReset();
    detectSafeMock.mockReset();
    detectProxyMock.mockReset();
  });

  it("composes a full populated snapshot from all detector outputs", async () => {
    getBlockNumberMock.mockResolvedValue(BigInt(20_000_000));
    detectGovernorMock.mockResolvedValue({
      type: "OZ_GOVERNOR",
      address: "0xgov",
      version: "1",
      raw: { name: "TestGov" },
    });
    detectTimelockMock.mockResolvedValue({
      address: "0xtimelock",
      minDelay: 172_800,
      admin: "0xadmin",
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
      protocolAddress: PROTOCOL,
      declaredMultisigAddresses: ["0xsafe"],
    });

    expect(snapshot.blockNumber).toBe(BigInt(20_000_000));
    expect(snapshot.hasGovernor).toBe(true);
    expect(snapshot.governorType).toBe("OZ_GOVERNOR");
    expect(snapshot.hasTimelock).toBe(true);
    expect(snapshot.timelockMinDelay).toBe(172_800);
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
      protocolAddress: PROTOCOL,
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
      protocolAddress: PROTOCOL,
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
      protocolAddress: PROTOCOL,
      declaredMultisigAddresses: ["0xfake"],
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
      protocolAddress: PROTOCOL,
    });

    expect(snapshot.rawState.governor).toMatchObject({ name: "TestGov" });
    expect(snapshot.rawState.timelock).toBeNull();
    expect(snapshot.rawState.proxy).toMatchObject({ type: "NONE" });
  });
});
