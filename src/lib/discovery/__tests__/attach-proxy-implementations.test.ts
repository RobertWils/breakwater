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

import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  attachWithRaceTolerance,
  buildAttachedContractData,
  buildModuleRunInputs,
  discoverAndAttach,
  isContractScanAddressUniqueViolation,
  selectImplsToAttach,
  type ManualContract,
  type ProxyAttachDeps,
} from "../attach-proxy-implementations";

function p2002(target: string | string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "5.22.0",
    meta: { target },
  });
}

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

// ─── Codex claim 5: race-safe idempotency ──────────────────────────────────

describe("isContractScanAddressUniqueViolation (narrow P2002 scoping)", () => {
  it("matches P2002 on the (scanId, address) field list", () => {
    expect(isContractScanAddressUniqueViolation(p2002(["scanId", "address"]))).toBe(true);
  });

  it("matches P2002 on the named (scanId, address) constraint", () => {
    expect(
      isContractScanAddressUniqueViolation(p2002("Contract_scanId_address_key")),
    ).toBe(true);
  });

  it("matches regardless of field order (set equality, not positional)", () => {
    expect(isContractScanAddressUniqueViolation(p2002(["address", "scanId"]))).toBe(true);
  });

  // Codex point 1 — the substring trap. EXACT match must reject these:
  it("does NOT match a target with EXTRA fields beyond scanId+address", () => {
    expect(
      isContractScanAddressUniqueViolation(p2002(["scanId", "address", "other"])),
    ).toBe(false);
  });

  it("does NOT match a different constraint NAME that merely contains both words", () => {
    expect(
      isContractScanAddressUniqueViolation(p2002("SomeOther_scanId_address_extra_key")),
    ).toBe(false);
  });

  it("does NOT match unexpected target shapes (empty array, undefined)", () => {
    expect(isContractScanAddressUniqueViolation(p2002([]))).toBe(false);
    const noTarget = new Prisma.PrismaClientKnownRequestError("Unique failed", {
      code: "P2002",
      clientVersion: "5.22.0",
    });
    expect(isContractScanAddressUniqueViolation(noTarget)).toBe(false);
  });

  it("does NOT match P2002 on a DIFFERENT unique (idempotencyKey)", () => {
    expect(isContractScanAddressUniqueViolation(p2002(["idempotencyKey"]))).toBe(false);
  });

  it("does NOT match P2002 on address alone (not the compound)", () => {
    expect(isContractScanAddressUniqueViolation(p2002(["address"]))).toBe(false);
  });

  it("does NOT match a non-P2002 Prisma error", () => {
    const e = new Prisma.PrismaClientKnownRequestError("Record not found", {
      code: "P2025",
      clientVersion: "5.22.0",
    });
    expect(isContractScanAddressUniqueViolation(e)).toBe(false);
  });

  it("does NOT match a generic error", () => {
    expect(isContractScanAddressUniqueViolation(new Error("rpc down"))).toBe(false);
  });
});

describe("attachWithRaceTolerance", () => {
  it("returns attached:true when the attach succeeds", async () => {
    expect(await attachWithRaceTolerance(async () => {})).toEqual({ attached: true });
  });

  it("swallows the benign (scanId,address) P2002 race as a no-op (no throw)", async () => {
    const res = await attachWithRaceTolerance(async () => {
      throw p2002(["scanId", "address"]);
    });
    expect(res).toEqual({ attached: false });
  });

  it("rethrows any OTHER error so the degraded-fallback still fires", async () => {
    await expect(
      attachWithRaceTolerance(async () => {
        throw p2002(["idempotencyKey"]); // a different unique → real failure
      }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    await expect(
      attachWithRaceTolerance(async () => {
        throw new Error("rpc down");
      }),
    ).rejects.toThrow("rpc down");
  });

  it("RACE NO-OP: two attach attempts for the same scan/impl → one row, no throw", async () => {
    // In-memory store standing in for @@unique([scanId, address]): the second
    // create for the same key raises P2002, exactly as the DB would.
    const store = new Set<string>();
    const key = "s1|0ximpl";
    const create = async () => {
      if (store.has(key)) throw p2002(["scanId", "address"]);
      store.add(key);
    };

    const r1 = await attachWithRaceTolerance(create); // winner
    const r2 = await attachWithRaceTolerance(create); // racing loser

    expect(r1).toEqual({ attached: true });
    expect(r2).toEqual({ attached: false }); // benign no-op
    expect(store.size).toBe(1); // exactly one row
    // No throw ⇒ executeScan's wrapper never sets discoveryDegraded.
  });
});
