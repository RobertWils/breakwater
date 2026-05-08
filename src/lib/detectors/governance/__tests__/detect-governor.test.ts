// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rpc-client", () => ({
  publicClient: { multicall: vi.fn() },
}));

import { publicClient } from "@/lib/rpc-client";

import { detectGovernor } from "../detect-governor";
import type { GovernorDetectionContext } from "../types";

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

const context: GovernorDetectionContext = {
  protocolAddress: "0x1234567890123456789012345678901234567890",
  blockNumber: BigInt(20_000_000),
};

describe("detectGovernor (Plan 02 D.3a)", () => {
  beforeEach(() => {
    multicallMock.mockReset();
  });

  it("identifies OZ_GOVERNOR when quorumNumerator succeeds and quorumVotes fails", async () => {
    multicallMock
      .mockResolvedValueOnce([
        ok("MyGovernor"),
        ok("1"),
        ok(BigInt(7200)),
        ok(BigInt(50_400)),
        ok(BigInt(4)),
        fail(),
        ok(BigInt("100000000000000000000")),
      ] as never)
      .mockResolvedValueOnce([fail(), fail(), fail()] as never);

    const result = await detectGovernor(context);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("OZ_GOVERNOR");
    expect(result?.version).toBe("1");
    expect(result?.address).toBe(context.protocolAddress.toLowerCase());
  });

  it("identifies COMPOUND_BRAVO when quorumVotes succeeds and quorumNumerator fails", async () => {
    multicallMock
      .mockResolvedValueOnce([
        ok("Compound Governor Bravo"),
        fail("no version()"),
        ok(BigInt(13_140)),
        ok(BigInt(17_280)),
        fail("no quorumNumerator"),
        ok(BigInt("400000000000000000000000")),
        ok(BigInt("65000000000000000000000")),
      ] as never)
      .mockResolvedValueOnce([fail(), fail(), fail()] as never);

    const result = await detectGovernor(context);

    expect(result).not.toBeNull();
    expect(result?.type).toBe("COMPOUND_BRAVO");
    expect(result?.version).toBeNull();
  });

  it("falls through to CUSTOM when both quorum functions succeed", async () => {
    multicallMock
      .mockResolvedValueOnce([
        ok("CustomGovernor"),
        ok("2"),
        ok(BigInt(7200)),
        ok(BigInt(50_400)),
        ok(BigInt(4)),
        ok(BigInt(100)),
        ok(BigInt(1)),
      ] as never)
      .mockResolvedValueOnce([fail(), fail(), fail()] as never);

    const result = await detectGovernor(context);

    expect(result?.type).toBe("CUSTOM");
  });

  it("returns null when votingDelay/votingPeriod missing (not a Governor)", async () => {
    multicallMock.mockResolvedValue([
      ok("NotAGovernor"),
      fail(),
      fail("no votingDelay"),
      fail("no votingPeriod"),
      fail(),
      fail(),
      fail(),
    ] as never);

    const result = await detectGovernor(context);

    expect(result).toBeNull();
  });

  it("returns null when neither quorum function succeeds (partial Governor stub)", async () => {
    multicallMock.mockResolvedValue([
      ok("PartialGovernor"),
      fail(),
      ok(BigInt(7200)),
      ok(BigInt(50_400)),
      fail(),
      fail(),
      ok(BigInt(1)),
    ] as never);

    const result = await detectGovernor(context);

    expect(result).toBeNull();
  });

  it("captures raw probe results for downstream debugging", async () => {
    multicallMock
      .mockResolvedValueOnce([
        ok("TestGov"),
        ok("v3"),
        ok(BigInt(7200)),
        ok(BigInt(50_400)),
        ok(BigInt(4)),
        fail(),
        ok(BigInt(100)),
      ] as never)
      .mockResolvedValueOnce([fail(), fail(), fail()] as never);

    const result = await detectGovernor(context);

    expect(result?.raw).toMatchObject({
      name: "TestGov",
      version: "v3",
      votingDelay: "7200",
      votingPeriod: "50400",
      quorumNumerator: "4",
      proposalThreshold: "100",
    });
    expect(result?.raw.quorumVotes).toBeNull();
  });

  it("returns null when the multicall itself rejects (RPC outage)", async () => {
    multicallMock.mockRejectedValue(new Error("All transports failed"));

    const result = await detectGovernor(context);

    expect(result).toBeNull();
  });

  it("normalises the protocol address to lowercase in the result", async () => {
    const upperContext: GovernorDetectionContext = {
      ...context,
      protocolAddress: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12",
    };
    multicallMock
      .mockResolvedValueOnce([
        ok("Gov"),
        fail(),
        ok(BigInt(1)),
        ok(BigInt(1)),
        ok(BigInt(1)),
        fail(),
        ok(BigInt(1)),
      ] as never)
      .mockResolvedValueOnce([fail(), fail(), fail()] as never);

    const result = await detectGovernor(upperContext);

    expect(result?.address).toBe(upperContext.protocolAddress.toLowerCase());
  });

  // ── E.4: snapshot-mechanism probe ──────────────────────────────────────
  // Maps detection to BLOCK_BASED | CURRENT_BALANCE | null:
  //   getVotes(addr, ts) succeeds  → BLOCK_BASED (modern OZ Governor)
  //   CLOCK_MODE responds          → BLOCK_BASED (4.9+; raw.clockMode set)
  //   only getCurrentVotes works   → CURRENT_BALANCE (Compound Bravo legacy)
  //   nothing works                → null (indeterminate)

  it("E.4: detects votingSnapshotType=BLOCK_BASED when getVotes(addr, timepoint) responds", async () => {
    multicallMock
      .mockResolvedValueOnce([
        ok("MyGovernor"),
        ok("1"),
        ok(BigInt(7200)),
        ok(BigInt(50_400)),
        ok(BigInt(4)),
        fail(),
        ok(BigInt(100)),
      ] as never)
      .mockResolvedValueOnce([
        ok(BigInt(0)), // getVotes succeeds — checkpoint API present
        fail(), // CLOCK_MODE not implemented
        fail(), // getCurrentVotes not implemented
      ] as never);

    const result = await detectGovernor(context);

    expect(result?.votingSnapshotType).toBe("BLOCK_BASED");
    expect(result?.raw.clockMode).toBeNull();
    expect(result?.raw.getVotesAvailable).toBe(true);
    expect(result?.raw.getCurrentVotesAvailable).toBe(false);
  });

  it("E.4: detects votingSnapshotType=BLOCK_BASED via CLOCK_MODE (timestamp variant captured in raw)", async () => {
    multicallMock
      .mockResolvedValueOnce([
        ok("ModernGov"),
        ok("4.9"),
        ok(BigInt(7200)),
        ok(BigInt(50_400)),
        ok(BigInt(4)),
        fail(),
        ok(BigInt(100)),
      ] as never)
      .mockResolvedValueOnce([
        ok(BigInt(0)),
        ok("mode=timestamp"),
        fail(),
      ] as never);

    const result = await detectGovernor(context);

    // Both block-number and timestamp clocks map to BLOCK_BASED for
    // GOV-004 purposes; the granularity stays in raw.clockMode.
    expect(result?.votingSnapshotType).toBe("BLOCK_BASED");
    expect(result?.raw.clockMode).toBe("mode=timestamp");
  });

  it("E.4: detects votingSnapshotType=CURRENT_BALANCE when only getCurrentVotes responds (Compound Bravo legacy)", async () => {
    multicallMock
      .mockResolvedValueOnce([
        ok("CompGovernor"),
        fail(),
        ok(BigInt(13_140)),
        ok(BigInt(17_280)),
        fail(),
        ok(BigInt("400000000000000000000000")),
        ok(BigInt("65000000000000000000000")),
      ] as never)
      .mockResolvedValueOnce([
        fail(), // getVotes (modern) not implemented
        fail(), // CLOCK_MODE not implemented
        ok(BigInt(0)), // legacy getCurrentVotes responds — vulnerable
      ] as never);

    const result = await detectGovernor(context);

    expect(result?.votingSnapshotType).toBe("CURRENT_BALANCE");
    expect(result?.raw.getCurrentVotesAvailable).toBe(true);
  });
});
