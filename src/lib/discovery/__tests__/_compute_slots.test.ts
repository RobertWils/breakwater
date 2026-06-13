// @vitest-environment node
/**
 * Plan 05 Fase 1.5b — source-constants slot derivation check.
 *
 * Re-derives each proxy slot constant from its preimage via keccak256 and
 * asserts it matches the hardcoded value in source-constants.ts. The EIP-1967
 * impl/admin derivations match detect-proxy.ts's known-good constants, which
 * confirms the derivation method; the same method yields the beacon / UUPS /
 * OZ-legacy constants. This makes the slot VALUES test-verified even though the
 * getStorageAt READS against real proxies are only validatable at the live run.
 */

import { keccak256, stringToBytes } from "viem";
import { describe, expect, it } from "vitest";

import {
  EIP1822_PROXIABLE_SLOT,
  EIP1967_BEACON_SLOT,
  OZ_LEGACY_IMPL_SLOT,
} from "../source-constants";

const eip1967 = (label: string): string =>
  "0x" +
  (BigInt(keccak256(stringToBytes(label))) - BigInt(1)).toString(16).padStart(64, "0");
const raw = (label: string): string => keccak256(stringToBytes(label));

describe("source-constants — proxy slot derivations", () => {
  it("method check: EIP-1967 impl/admin match detect-proxy's known-good constants", () => {
    expect(eip1967("eip1967.proxy.implementation")).toBe(
      "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
    );
    expect(eip1967("eip1967.proxy.admin")).toBe(
      "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
    );
  });

  it("EIP-1967 beacon slot", () => {
    expect(EIP1967_BEACON_SLOT).toBe(eip1967("eip1967.proxy.beacon"));
  });

  it("EIP-1822 PROXIABLE slot (raw keccak, no -1)", () => {
    expect(EIP1822_PROXIABLE_SLOT).toBe(raw("PROXIABLE"));
  });

  it("OZ legacy zos implementation slot (raw keccak)", () => {
    expect(OZ_LEGACY_IMPL_SLOT).toBe(raw("org.zeppelinos.proxy.implementation"));
  });
});
