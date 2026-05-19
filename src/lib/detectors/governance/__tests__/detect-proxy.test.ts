// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rpc-client", () => ({
  publicClient: {
    getStorageAt: vi.fn(),
    getCode: vi.fn(),
  },
}));

vi.mock("@/lib/etherscan-client", () => ({
  fetchContractAbi: vi.fn(),
}));

import { fetchContractAbi } from "@/lib/etherscan-client";
import { publicClient } from "@/lib/rpc-client";

import { detectProxy } from "../detect-proxy";

const getStorageAtMock = vi.mocked(publicClient.getStorageAt);
const getCodeMock = vi.mocked(publicClient.getCode);
const fetchContractAbiMock = vi.mocked(fetchContractAbi);

const PROTOCOL = "0x1111111111111111111111111111111111111111";
const IMPL = "abcdef1234567890abcdef1234567890abcdef12";
const ADMIN = "fedcba0987654321fedcba0987654321fedcba09";

function slot(addrHex: string): `0x${string}` {
  // 32-byte storage slot: 12 zero bytes + 20-byte address.
  return ("0x" + addrHex.padStart(64, "0")) as `0x${string}`;
}

const ZERO_SLOT =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

describe("detectProxy (Plan 02 D.3c)", () => {
  beforeEach(() => {
    getStorageAtMock.mockReset();
    getCodeMock.mockReset();
    fetchContractAbiMock.mockReset();
  });

  it("detects EIP_1967_TRANSPARENT when both impl + admin slots are set", async () => {
    getStorageAtMock
      .mockResolvedValueOnce(slot(IMPL)) // impl slot
      .mockResolvedValueOnce(slot(ADMIN)); // admin slot
    getCodeMock.mockResolvedValue("0x6080604052" as `0x${string}`);
    fetchContractAbiMock.mockResolvedValue({
      ok: true,
      data: '[{"name":"transfer"}]',
    });

    const result = await detectProxy({
      protocolAddress: PROTOCOL,
      blockNumber: BigInt(20_000_000),
    });

    expect(result.proxyType).toBe("EIP_1967_TRANSPARENT");
    expect(result.proxyImplementation).toBe(`0x${IMPL}`);
    expect(result.proxyAdminAddress).toBe(`0x${ADMIN}`);
    expect(result.proxyAdminIsContract).toBe(true);
    expect(result.implementationAbi).toContain("transfer");
  });

  it("classifies impl-set + admin-unset as CUSTOM (D.5 I2 — was over-claiming UUPS)", async () => {
    getStorageAtMock
      .mockResolvedValueOnce(slot(IMPL)) // impl slot SET
      .mockResolvedValueOnce(ZERO_SLOT); // admin slot empty
    fetchContractAbiMock.mockResolvedValue({ ok: true, data: "[]" });

    const result = await detectProxy({
      protocolAddress: PROTOCOL,
      blockNumber: BigInt(20_000_000),
    });

    // Without reading the implementation contract's interface
    // (proxiableUUID/upgradeToAndCall presence) we cannot positively
    // identify UUPS vs. custom non-OZ proxies. CUSTOM is the honest
    // classification — Phase E GOV-005 may upgrade to a confirmed
    // EIP_1822_UUPS once it inspects the implementation ABI.
    expect(result.proxyType).toBe("CUSTOM");
    expect(result.proxyImplementation).toBe(`0x${IMPL}`);
    expect(result.proxyAdminAddress).toBeNull();
    // No admin → no isContract probe attempted.
    expect(getCodeMock).not.toHaveBeenCalled();
  });

  it("returns NONE when the implementation slot is empty", async () => {
    getStorageAtMock
      .mockResolvedValueOnce(ZERO_SLOT)
      .mockResolvedValueOnce(ZERO_SLOT);

    const result = await detectProxy({
      protocolAddress: PROTOCOL,
      blockNumber: BigInt(20_000_000),
    });

    expect(result.proxyType).toBe("NONE");
    expect(result.proxyImplementation).toBeNull();
    expect(result.proxyAdminAddress).toBeNull();
    expect(result.proxyAdminIsContract).toBeNull();
    expect(result.implementationAbi).toBeNull();
    // Etherscan should not be queried when there's no implementation.
    expect(fetchContractAbiMock).not.toHaveBeenCalled();
  });

  it("throws when BOTH storage reads reject (D.5 I4 — propagate RPC outage to ModuleRun)", async () => {
    getStorageAtMock
      .mockRejectedValueOnce(new Error("RPC error 1"))
      .mockRejectedValueOnce(new Error("RPC error 2"));

    await expect(
      detectProxy({
        protocolAddress: PROTOCOL,
        blockNumber: BigInt(20_000_000),
      }),
    ).rejects.toThrow(/Proxy detection failed.*RPC error 1.*RPC error 2/);
    expect(fetchContractAbiMock).not.toHaveBeenCalled();
  });

  it("falls through to NONE when only the admin slot read rejects (single-read failure tolerated)", async () => {
    getStorageAtMock
      .mockResolvedValueOnce(ZERO_SLOT) // impl: empty (parses to null)
      .mockRejectedValueOnce(new Error("admin slot fetch failed"));

    const result = await detectProxy({
      protocolAddress: PROTOCOL,
      blockNumber: BigInt(20_000_000),
    });

    expect(result.proxyType).toBe("NONE");
    expect(fetchContractAbiMock).not.toHaveBeenCalled();
  });

  it("marks proxyAdminIsContract=false for an EOA admin", async () => {
    getStorageAtMock
      .mockResolvedValueOnce(slot(IMPL))
      .mockResolvedValueOnce(slot(ADMIN));
    getCodeMock.mockResolvedValue("0x" as `0x${string}`); // EOA: no code
    fetchContractAbiMock.mockResolvedValue({
      ok: false,
      reason: "not_found",
      message: "",
    });

    const result = await detectProxy({
      protocolAddress: PROTOCOL,
      blockNumber: BigInt(20_000_000),
    });

    expect(result.proxyType).toBe("EIP_1967_TRANSPARENT");
    expect(result.proxyAdminIsContract).toBe(false);
  });

  it("leaves implementationAbi null when Etherscan is unavailable", async () => {
    getStorageAtMock
      .mockResolvedValueOnce(slot(IMPL))
      .mockResolvedValueOnce(slot(ADMIN));
    getCodeMock.mockResolvedValue("0x6080" as `0x${string}`);
    fetchContractAbiMock.mockResolvedValue({
      ok: false,
      reason: "missing_api_key",
      message: "No key",
    });

    const result = await detectProxy({
      protocolAddress: PROTOCOL,
      blockNumber: BigInt(20_000_000),
    });

    expect(result.proxyType).toBe("EIP_1967_TRANSPARENT");
    expect(result.implementationAbi).toBeNull();
  });

  it("rejects malformed slot values (length other than 66 chars) → NONE", async () => {
    getStorageAtMock
      .mockResolvedValueOnce(("0x" + "ab".repeat(20)) as `0x${string}`) // 42 chars: too short
      .mockResolvedValueOnce(ZERO_SLOT);

    const result = await detectProxy({
      protocolAddress: PROTOCOL,
      blockNumber: BigInt(20_000_000),
    });

    expect(result.proxyType).toBe("NONE");
  });

  it("rejects slots whose high 12 bytes are non-zero (D.5 I3 — guard against garbage data)", async () => {
    getStorageAtMock
      // High bytes contain data — can't be a canonical address-shaped slot.
      .mockResolvedValueOnce(
        "0x1234567890abcdef00000000abcdef1234567890abcdef1234567890abcdef12" as `0x${string}`,
      )
      .mockResolvedValueOnce(ZERO_SLOT);

    const result = await detectProxy({
      protocolAddress: PROTOCOL,
      blockNumber: BigInt(20_000_000),
    });

    expect(result.proxyType).toBe("NONE");
    expect(result.proxyImplementation).toBeNull();
  });

  it("accepts canonical address-shaped slots (high 12 bytes zero, rightmost 20 bytes the address)", async () => {
    getStorageAtMock
      .mockResolvedValueOnce(
        "0x000000000000000000000000abcdef1234567890abcdef1234567890abcdef12" as `0x${string}`,
      )
      .mockResolvedValueOnce(ZERO_SLOT);
    fetchContractAbiMock.mockResolvedValue({ ok: true, data: "[]" });

    const result = await detectProxy({
      protocolAddress: PROTOCOL,
      blockNumber: BigInt(20_000_000),
    });

    expect(result.proxyImplementation).toBe(
      "0xabcdef1234567890abcdef1234567890abcdef12",
    );
  });
});
