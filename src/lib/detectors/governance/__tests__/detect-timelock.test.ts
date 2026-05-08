// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rpc-client", () => ({
  publicClient: {
    multicall: vi.fn(),
    readContract: vi.fn(),
    getCode: vi.fn(),
  },
}));

import { publicClient } from "@/lib/rpc-client";

import { detectTimelock } from "../detect-timelock";
import type { GovernorDetectionResult } from "../types";

type Entry =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: Error };

function ok(result: unknown): Entry {
  return { status: "success", result };
}
function fail(message = "reverted"): Entry {
  return { status: "failure", error: new Error(message) };
}

const multicallMock = vi.mocked(publicClient.multicall);
const readContractMock = vi.mocked(publicClient.readContract);
const getCodeMock = vi.mocked(publicClient.getCode);

const candidateAddress = "0x1111111111111111111111111111111111111111";
const adminAddr = "0xadminadminadminadminadminadminadminadmin";

const governorResult: NonNullable<GovernorDetectionResult> = {
  type: "COMPOUND_BRAVO",
  address: "0x2222222222222222222222222222222222222222",
  version: null,
  votingSnapshotType: null,
  raw: {},
};

describe("detectTimelock (Plan 02 D.3b)", () => {
  beforeEach(() => {
    multicallMock.mockReset();
    readContractMock.mockReset();
    getCodeMock.mockReset();
    // Default: admin probe returns "0x" (EOA) — most existing tests
    // don't assert on adminIsContract; D.6-specific cases override.
    getCodeMock.mockResolvedValue("0x" as `0x${string}`);
  });

  it("detects an OZ TimelockController via getMinDelay()", async () => {
    multicallMock.mockResolvedValue([
      ok(BigInt(172_800)), // 2 days
      fail(),
      ok(adminAddr),
    ] as never);

    const result = await detectTimelock({
      blockNumber: BigInt(20_000_000),
      governorResult: null,
      candidateAddress,
    });

    expect(result).not.toBeNull();
    expect(result?.minDelay).toBe(172_800);
    expect(result?.admin).toBe(adminAddr);
    expect(result?.address).toBe(candidateAddress);
  });

  it("detects a Compound Timelock via delay() when getMinDelay() reverts", async () => {
    multicallMock.mockResolvedValue([
      fail(),
      ok(BigInt(86_400)), // 1 day
      ok(adminAddr),
    ] as never);

    const result = await detectTimelock({
      blockNumber: BigInt(20_000_000),
      governorResult: null,
      candidateAddress,
    });

    expect(result).not.toBeNull();
    expect(result?.minDelay).toBe(86_400);
  });

  it("prefers OZ getMinDelay over Compound delay when both succeed", async () => {
    multicallMock.mockResolvedValue([
      ok(BigInt(172_800)), // OZ wins
      ok(BigInt(86_400)),
      ok(adminAddr),
    ] as never);

    const result = await detectTimelock({
      blockNumber: BigInt(20_000_000),
      governorResult: null,
      candidateAddress,
    });

    expect(result?.minDelay).toBe(172_800);
  });

  it("uses governor.timelock() when no candidateAddress is provided", async () => {
    const govTimelock = "0x3333333333333333333333333333333333333333";
    readContractMock.mockResolvedValue(govTimelock as `0x${string}` as never);
    multicallMock.mockResolvedValue([
      ok(BigInt(172_800)),
      fail(),
      ok(adminAddr),
    ] as never);

    const result = await detectTimelock({
      blockNumber: BigInt(20_000_000),
      governorResult,
    });

    expect(result?.address).toBe(govTimelock.toLowerCase());
    expect(readContractMock).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "timelock" }),
    );
  });

  it("returns null when no probe address is available", async () => {
    const result = await detectTimelock({
      blockNumber: BigInt(20_000_000),
      governorResult: null,
    });

    expect(result).toBeNull();
    expect(multicallMock).not.toHaveBeenCalled();
  });

  it("returns null when neither delay function succeeds", async () => {
    multicallMock.mockResolvedValue([fail(), fail(), fail()] as never);

    const result = await detectTimelock({
      blockNumber: BigInt(20_000_000),
      governorResult: null,
      candidateAddress,
    });

    expect(result).toBeNull();
  });

  it("falls through to null when governor.timelock() reverts and no candidate is provided", async () => {
    readContractMock.mockRejectedValue(new Error("execution reverted"));

    const result = await detectTimelock({
      blockNumber: BigInt(20_000_000),
      governorResult,
    });

    expect(result).toBeNull();
    expect(multicallMock).not.toHaveBeenCalled();
  });

  it("ignores governor.timelock() returning the zero address", async () => {
    readContractMock.mockResolvedValue(
      "0x0000000000000000000000000000000000000000" as `0x${string}` as never,
    );

    const result = await detectTimelock({
      blockNumber: BigInt(20_000_000),
      governorResult,
    });

    expect(result).toBeNull();
    expect(multicallMock).not.toHaveBeenCalled();
  });

  it("returns null when the multicall itself rejects (RPC outage)", async () => {
    multicallMock.mockRejectedValue(new Error("All transports failed"));

    const result = await detectTimelock({
      blockNumber: BigInt(20_000_000),
      governorResult: null,
      candidateAddress,
    });

    expect(result).toBeNull();
  });

  // D.6: timelockAdminIsContract probe — required by GOV-001 to fire
  // CRITICAL when the timelock admin is an EOA. Three states:
  //   true  → admin has bytecode (contract)
  //   false → admin has no bytecode (EOA)
  //   null  → getCode failed; detector skips the EOA branch defensively.

  it("D.6: captures adminIsContract=true when admin has bytecode (contract)", async () => {
    multicallMock.mockResolvedValue([
      ok(BigInt(172_800)),
      fail(),
      ok(adminAddr),
    ] as never);
    getCodeMock.mockResolvedValue("0x6080604052" as `0x${string}`);

    const result = await detectTimelock({
      blockNumber: BigInt(20_000_000),
      governorResult: null,
      candidateAddress,
    });

    expect(result?.adminIsContract).toBe(true);
  });

  it("D.6: captures adminIsContract=false when admin has empty bytecode (EOA)", async () => {
    multicallMock.mockResolvedValue([
      ok(BigInt(172_800)),
      fail(),
      ok(adminAddr),
    ] as never);
    getCodeMock.mockResolvedValue("0x" as `0x${string}`);

    const result = await detectTimelock({
      blockNumber: BigInt(20_000_000),
      governorResult: null,
      candidateAddress,
    });

    expect(result?.adminIsContract).toBe(false);
  });

  it("D.6: captures adminIsContract=null when getCode rejects (indeterminate)", async () => {
    multicallMock.mockResolvedValue([
      ok(BigInt(172_800)),
      fail(),
      ok(adminAddr),
    ] as never);
    getCodeMock.mockRejectedValue(new Error("RPC unavailable"));

    const result = await detectTimelock({
      blockNumber: BigInt(20_000_000),
      governorResult: null,
      candidateAddress,
    });

    expect(result?.adminIsContract).toBeNull();
  });
});
