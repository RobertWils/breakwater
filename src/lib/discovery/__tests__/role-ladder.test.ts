import { describe, expect, it } from "vitest";

import { assignDiscoveredRole, type RoleSignals } from "../role-ladder";

const base: RoleSignals = { source: "GETTER" };

describe("assignDiscoveredRole — top-down ladder, first match wins (§4)", () => {
  it("rung 1: an implementation slot/beacon/bytecode source → PROXY_IMPLEMENTATION", () => {
    for (const source of [
      "IMPL_SLOT",
      "BEACON_IMPL",
      "UUPS_SLOT",
      "OZ_LEGACY_SLOT",
      "COMPOUND_IMPL",
      "MINIMAL_PROXY",
    ] as const) {
      expect(assignDiscoveredRole({ source }).role).toBe("PROXY_IMPLEMENTATION");
    }
  });

  it("rung 2: admin slot + confirmed Safe → DECLARED_MULTISIG", () => {
    expect(
      assignDiscoveredRole({ source: "ADMIN_SLOT", isConfirmedSafe: true }).role,
    ).toBe("DECLARED_MULTISIG");
  });

  it("rung 2: owner()/role-getter + confirmed Safe → DECLARED_MULTISIG", () => {
    expect(
      assignDiscoveredRole({ source: "GETTER", getterName: "owner", isConfirmedSafe: true })
        .role,
    ).toBe("DECLARED_MULTISIG");
    expect(
      assignDiscoveredRole({
        source: "GETTER",
        getterName: "getOwners",
        isConfirmedSafe: true,
      }).role,
    ).toBe("DECLARED_MULTISIG");
  });

  it("rung 2 does NOT fire when the owner-getter address is not a confirmed Safe", () => {
    // Falls through; with no other signal → RELATED.
    expect(
      assignDiscoveredRole({ source: "GETTER", getterName: "owner", isConfirmedSafe: false })
        .role,
    ).toBe("RELATED");
  });

  it("rung 3: timelock selectors → TIMELOCK", () => {
    expect(
      assignDiscoveredRole({ ...base, hasTimelockSelectors: true }).role,
    ).toBe("TIMELOCK");
  });

  it("rung 4: ERC-20 probe → TOKEN_CONTRACT", () => {
    expect(assignDiscoveredRole({ ...base, isErc20: true }).role).toBe("TOKEN_CONTRACT");
  });

  it("rung 5: bridge registry → DECLARED_BRIDGE", () => {
    expect(assignDiscoveredRole({ ...base, isBridgeRegistry: true }).role).toBe(
      "DECLARED_BRIDGE",
    );
  });

  it("rung 6: no decisive signal → RELATED with discoveredAs from the getter name", () => {
    expect(assignDiscoveredRole({ source: "GETTER", getterName: "oracle" })).toEqual({
      role: "RELATED",
      discoveredAs: "ORACLE",
    });
    expect(assignDiscoveredRole({ source: "GETTER", getterName: "pool" })).toEqual({
      role: "RELATED",
      discoveredAs: "DEX_POOL",
    });
    expect(assignDiscoveredRole({ source: "GETTER", getterName: "asset" })).toEqual({
      role: "RELATED",
      discoveredAs: "ASSET",
    });
    expect(assignDiscoveredRole({ source: "GETTER", getterName: "somethingElse" })).toEqual({
      role: "RELATED",
      discoveredAs: "somethingElse",
    });
    expect(assignDiscoveredRole({ source: "GETTER" })).toEqual({
      role: "RELATED",
      discoveredAs: "RELATED",
    });
  });

  // ── First-match precedence (the load-bearing ordering) ──
  it("PROXY_IMPLEMENTATION (rung 1) wins even when timelock/erc20 signals are also set", () => {
    expect(
      assignDiscoveredRole({
        source: "IMPL_SLOT",
        hasTimelockSelectors: true,
        isErc20: true,
        isConfirmedSafe: true,
      }).role,
    ).toBe("PROXY_IMPLEMENTATION");
  });

  it("DECLARED_MULTISIG (rung 2) wins over TOKEN_CONTRACT/TIMELOCK when admin+Safe", () => {
    expect(
      assignDiscoveredRole({
        source: "ADMIN_SLOT",
        isConfirmedSafe: true,
        hasTimelockSelectors: true,
        isErc20: true,
      }).role,
    ).toBe("DECLARED_MULTISIG");
  });

  it("TIMELOCK (rung 3) wins over TOKEN_CONTRACT (rung 4)", () => {
    expect(
      assignDiscoveredRole({ ...base, hasTimelockSelectors: true, isErc20: true }).role,
    ).toBe("TIMELOCK");
  });
});
