// @vitest-environment node
/**
 * Plan 05 Fase 1.4 — detect-and-attach unit tests.
 *
 * Pure selection/builders + DI-orchestrator tests against an in-memory fake.
 * No RPC, no DB. The live wiring (detectProxy + Prisma) lives in the module's
 * factory; here we lock the load-bearing invariants: dedup/idempotency, the
 * non-recursion probe boundary, and the attached-row shape (PROXY_IMPLEMENTATION
 * + AUTO).
 */

import { describe, expect, it } from "vitest";

import {
  buildAttachedContractData,
  buildModuleRunInputs,
  discoverAndAttach,
  selectImplsToAttach,
  type ManualContract,
  type ProxyAttachDeps,
} from "../attach-proxy-implementations";

describe("selectImplsToAttach (pure)", () => {
  it("returns new impls lowercased, dropping nulls", () => {
    expect(selectImplsToAttach(["0xABC", null, undefined, "0xDef"], [])).toEqual([
      "0xabc",
      "0xdef",
    ]);
  });

  it("excludes impls already present in the scan (case-insensitive)", () => {
    expect(
      selectImplsToAttach(["0xAbC", "0xNEW"], ["0xabc", "0xother"]),
    ).toEqual(["0xnew"]);
  });

  it("dedups duplicate impls among the resolved set", () => {
    expect(selectImplsToAttach(["0xAA", "0xaa", "0xBB"], [])).toEqual([
      "0xaa",
      "0xbb",
    ]);
  });

  it("returns [] when every impl is null or already present", () => {
    expect(selectImplsToAttach([null, "0xPRESENT"], ["0xpresent"])).toEqual([]);
  });
});

describe("buildAttachedContractData (pure)", () => {
  it("marks the attached contract PROXY_IMPLEMENTATION + AUTO, non-primary", () => {
    const data = buildAttachedContractData({
      scanId: "s1",
      address: "0xabc",
      chain: "ETHEREUM",
    });
    expect(data).toMatchObject({
      scanId: "s1",
      address: "0xabc",
      chain: "ETHEREUM",
      role: "PROXY_IMPLEMENTATION",
      discoverySource: "AUTO",
      roleSource: "AUTO",
      isPrimary: false,
    });
  });
});

describe("buildModuleRunInputs (pure)", () => {
  it("ships GOVERNANCE QUEUED and unimplemented modules SKIPPED for a PROXY_IMPLEMENTATION", () => {
    const rows = buildModuleRunInputs("s1", "c-impl", ["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"]);
    const byModule = Object.fromEntries(rows.map((r) => [r.module, r]));
    expect(byModule.GOVERNANCE!.status).toBe("QUEUED");
    expect(byModule.GOVERNANCE!.errorMessage).toBeNull();
    // ORACLE/SIGNER/FRONTEND are unimplemented → SKIPPED module_not_implemented
    expect(byModule.ORACLE!.status).toBe("SKIPPED");
    expect(byModule.ORACLE!.errorMessage).toBe("module_not_implemented");
    // every row carries the contract + an idempotency key
    expect(rows.every((r) => r.contractId === "c-impl" && !!r.idempotencyKey)).toBe(true);
  });

  it("ships GOVERNANCE SKIPPED (module_disabled_by_user) when not in modulesEnabled — no hang", () => {
    const rows = buildModuleRunInputs("s1", "c-impl", ["ORACLE"]);
    const gov = rows.find((r) => r.module === "GOVERNANCE")!;
    expect(gov.status).toBe("SKIPPED");
    expect(gov.errorMessage).toBe("module_disabled_by_user");
  });
});

// ─── DI orchestrator against an in-memory fake ─────────────────────────────

function makeWorld(opts: {
  manual: ManualContract[];
  existing?: string[];
  impls: Record<string, string | null>; // manual address → resolved impl
}) {
  const probed: string[] = [];
  const attached: { scanId: string; address: string; chain: string }[] = [];
  const deps: ProxyAttachDeps = {
    async loadManualContracts() {
      return opts.manual;
    },
    async loadExistingAddresses() {
      return opts.existing ?? opts.manual.map((c) => c.address);
    },
    async resolveImplementation(address) {
      probed.push(address);
      return opts.impls[address] ?? null;
    },
    async attachImplementation(p) {
      attached.push(p);
    },
    log() {},
  };
  return { deps, probed, attached };
}

const PRIMARY: ManualContract = { id: "c-p", address: "0xprimary", chain: "ETHEREUM" };

describe("discoverAndAttach (orchestrator)", () => {
  it("attaches a newly-resolved implementation as a sibling", async () => {
    const w = makeWorld({ manual: [PRIMARY], impls: { "0xprimary": "0ximpl" } });
    const res = await discoverAndAttach(w.deps, "s1");
    expect(res.attached).toEqual(["0ximpl"]);
    expect(w.attached).toEqual([{ scanId: "s1", address: "0ximpl", chain: "ETHEREUM" }]);
  });

  it("is idempotent: an implementation already present in the scan is not re-attached", async () => {
    const w = makeWorld({
      manual: [PRIMARY],
      existing: ["0xprimary", "0ximpl"], // impl already a contract (e.g. retry)
      impls: { "0xprimary": "0xIMPL" },
    });
    const res = await discoverAndAttach(w.deps, "s1");
    expect(res.attached).toEqual([]);
    expect(w.attached).toEqual([]);
  });

  it("attaches nothing when the primary is not a proxy", async () => {
    const w = makeWorld({ manual: [PRIMARY], impls: { "0xprimary": null } });
    const res = await discoverAndAttach(w.deps, "s1");
    expect(res.attached).toEqual([]);
  });

  it("dedups a shared implementation across two manual contracts → attached once", async () => {
    const w = makeWorld({
      manual: [PRIMARY, { id: "c-r", address: "0xrelated", chain: "ETHEREUM" }],
      impls: { "0xprimary": "0xshared", "0xrelated": "0xSHARED" },
    });
    const res = await discoverAndAttach(w.deps, "s1");
    expect(res.attached).toEqual(["0xshared"]);
    expect(w.attached).toHaveLength(1);
  });

  it("NON-RECURSION: probes only the manual contracts, never the attached implementation", async () => {
    const w = makeWorld({ manual: [PRIMARY], impls: { "0xprimary": "0ximpl" } });
    await discoverAndAttach(w.deps, "s1");
    // 0ximpl (the attached sibling) must NOT have been probed for its own proxy.
    expect(w.probed).toEqual(["0xprimary"]);
    expect(w.probed).not.toContain("0ximpl");
  });

  it("no-ops when there are no manual contracts", async () => {
    const w = makeWorld({ manual: [], impls: {} });
    const res = await discoverAndAttach(w.deps, "s1");
    expect(res).toEqual({ probed: 0, attached: [] });
    expect(w.probed).toEqual([]);
  });
});
