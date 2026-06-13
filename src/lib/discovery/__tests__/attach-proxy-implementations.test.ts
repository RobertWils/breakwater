// @vitest-environment node
/**
 * Plan 05 Fase 1.4/1.5 — detect-and-attach unit tests (candidate model).
 *
 * Pure selection/builders + DI-orchestrator tests against an in-memory fake.
 * No RPC, no DB. The live wiring (detectProxy + Prisma) lives in the module's
 * factory; here we lock the load-bearing invariants: candidate dedup/idempotency,
 * the role-aware row builders, the non-recursion (depth-1) probe boundary, the
 * race-safe attach, and the attached-row shape (AUTO + role from the ladder).
 */

import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  attachWithRaceTolerance,
  buildAttachedContractData,
  buildModuleRunInputs,
  discoverAndAttach,
  isContractScanAddressUniqueViolation,
  selectCandidatesToAttach,
  type DiscoveredCandidate,
  type ManualContract,
  type StructuralDiscoveryDeps,
} from "../attach-proxy-implementations";

const cand = (
  address: string,
  role: DiscoveredCandidate["role"] = "PROXY_IMPLEMENTATION",
  discoveredAs = "IMPL_SLOT",
): DiscoveredCandidate => ({ address, role, discoveredAs });

function p2002(target: string | string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "5.22.0",
    meta: { target },
  });
}

describe("selectCandidatesToAttach (pure)", () => {
  it("returns new candidates lowercased (preserving role/discoveredAs)", () => {
    expect(
      selectCandidatesToAttach([cand("0xABC"), cand("0xDef", "TIMELOCK", "timelock_selectors")], []),
    ).toEqual([
      { address: "0xabc", role: "PROXY_IMPLEMENTATION", discoveredAs: "IMPL_SLOT" },
      { address: "0xdef", role: "TIMELOCK", discoveredAs: "timelock_selectors" },
    ]);
  });

  it("excludes candidates already present in the scan (case-insensitive)", () => {
    expect(
      selectCandidatesToAttach([cand("0xAbC"), cand("0xNEW")], ["0xabc", "0xother"]),
    ).toEqual([cand("0xnew")]);
  });

  it("dedups duplicate addresses among candidates (first occurrence wins its role)", () => {
    expect(
      selectCandidatesToAttach(
        [cand("0xAA", "PROXY_IMPLEMENTATION"), cand("0xaa", "TIMELOCK"), cand("0xBB")],
        [],
      ),
    ).toEqual([cand("0xaa"), cand("0xbb")]);
  });

  it("returns [] when every candidate is already present", () => {
    expect(selectCandidatesToAttach([cand("0xPRESENT")], ["0xpresent"])).toEqual([]);
  });
});

describe("buildAttachedContractData (pure)", () => {
  it("defaults to PROXY_IMPLEMENTATION + AUTO, non-primary", () => {
    const data = buildAttachedContractData({ scanId: "s1", address: "0xabc", chain: "ETHEREUM" });
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

  it("carries the assigned role + discoveredAs (e.g. a TIMELOCK)", () => {
    const data = buildAttachedContractData({
      scanId: "s1",
      address: "0xtl",
      chain: "ETHEREUM",
      role: "TIMELOCK",
      discoveredAs: "timelock_selectors",
    });
    expect(data).toMatchObject({
      role: "TIMELOCK",
      discoveredAs: "timelock_selectors",
      discoverySource: "AUTO",
      roleSource: "AUTO",
    });
  });
});

describe("buildModuleRunInputs (pure, role-aware)", () => {
  it("ships GOVERNANCE QUEUED + unimplemented modules SKIPPED for a PROXY_IMPLEMENTATION", () => {
    const rows = buildModuleRunInputs("s1", "c-impl", "PROXY_IMPLEMENTATION", [
      "GOVERNANCE",
      "ORACLE",
      "SIGNER",
      "FRONTEND",
    ]);
    const byModule = Object.fromEntries(rows.map((r) => [r.module, r]));
    expect(byModule.GOVERNANCE!.status).toBe("QUEUED");
    expect(byModule.GOVERNANCE!.errorMessage).toBeNull();
    expect(byModule.ORACLE!.status).toBe("SKIPPED");
    expect(byModule.ORACLE!.errorMessage).toBe("module_not_implemented");
    expect(rows.every((r) => r.contractId === "c-impl" && !!r.idempotencyKey)).toBe(true);
  });

  it("ships GOVERNANCE SKIPPED (role_not_applicable) for a TOKEN_CONTRACT — no governance on a token, no hang", () => {
    const rows = buildModuleRunInputs("s1", "c-tok", "TOKEN_CONTRACT", ["GOVERNANCE"]);
    const gov = rows.find((r) => r.module === "GOVERNANCE")!;
    expect(gov.status).toBe("SKIPPED");
    expect(gov.errorMessage).toBe("role_not_applicable_to_module");
  });

  it("ships GOVERNANCE SKIPPED (module_disabled_by_user) when not in modulesEnabled — no hang", () => {
    const rows = buildModuleRunInputs("s1", "c-impl", "PROXY_IMPLEMENTATION", ["ORACLE"]);
    const gov = rows.find((r) => r.module === "GOVERNANCE")!;
    expect(gov.status).toBe("SKIPPED");
    expect(gov.errorMessage).toBe("module_disabled_by_user");
  });
});

// ─── DI orchestrator against an in-memory fake ─────────────────────────────

function makeWorld(opts: {
  manual: ManualContract[];
  existing?: string[];
  // manual address → candidates discovered from it
  candidates: Record<string, DiscoveredCandidate[]>;
}) {
  const probed: string[] = [];
  const attached: { address: string; role: string; discoveredAs: string }[] = [];
  const deps: StructuralDiscoveryDeps = {
    async loadManualContracts() {
      return opts.manual;
    },
    async loadExistingAddresses() {
      return opts.existing ?? opts.manual.map((c) => c.address);
    },
    async discoverCandidates(contract) {
      probed.push(contract.address);
      return opts.candidates[contract.address] ?? [];
    },
    async attachCandidate(p) {
      attached.push({ address: p.address, role: p.role, discoveredAs: p.discoveredAs });
    },
    log() {},
  };
  return { deps, probed, attached };
}

const PRIMARY: ManualContract = { id: "c-p", address: "0xprimary", chain: "ETHEREUM" };

describe("discoverAndAttach (orchestrator)", () => {
  it("attaches a newly-discovered candidate as a sibling with its role", async () => {
    const w = makeWorld({ manual: [PRIMARY], candidates: { "0xprimary": [cand("0ximpl")] } });
    const res = await discoverAndAttach(w.deps, "s1");
    expect(res.attached).toEqual([cand("0ximpl")]);
    expect(w.attached).toEqual([
      { address: "0ximpl", role: "PROXY_IMPLEMENTATION", discoveredAs: "IMPL_SLOT" },
    ]);
  });

  it("attaches candidates of mixed roles (impl + timelock)", async () => {
    const w = makeWorld({
      manual: [PRIMARY],
      candidates: {
        "0xprimary": [cand("0ximpl"), cand("0xtl", "TIMELOCK", "timelock_selectors")],
      },
    });
    const res = await discoverAndAttach(w.deps, "s1");
    expect(res.attached.map((c) => [c.address, c.role])).toEqual([
      ["0ximpl", "PROXY_IMPLEMENTATION"],
      ["0xtl", "TIMELOCK"],
    ]);
  });

  it("is idempotent: a candidate already present in the scan is not re-attached", async () => {
    const w = makeWorld({
      manual: [PRIMARY],
      existing: ["0xprimary", "0ximpl"], // already a contract (e.g. retry)
      candidates: { "0xprimary": [cand("0xIMPL")] },
    });
    const res = await discoverAndAttach(w.deps, "s1");
    expect(res.attached).toEqual([]);
    expect(w.attached).toEqual([]);
  });

  it("attaches nothing when no candidates are discovered", async () => {
    const w = makeWorld({ manual: [PRIMARY], candidates: { "0xprimary": [] } });
    const res = await discoverAndAttach(w.deps, "s1");
    expect(res.attached).toEqual([]);
  });

  it("dedups a candidate discovered from two manual contracts → attached once", async () => {
    const w = makeWorld({
      manual: [PRIMARY, { id: "c-r", address: "0xrelated", chain: "ETHEREUM" }],
      candidates: { "0xprimary": [cand("0xshared")], "0xrelated": [cand("0xSHARED")] },
    });
    const res = await discoverAndAttach(w.deps, "s1");
    expect(res.attached).toEqual([cand("0xshared")]);
    expect(w.attached).toHaveLength(1);
  });

  it("NON-RECURSION: discovers only from manual contracts, never from attached candidates", async () => {
    const w = makeWorld({ manual: [PRIMARY], candidates: { "0xprimary": [cand("0ximpl")] } });
    await discoverAndAttach(w.deps, "s1");
    expect(w.probed).toEqual(["0xprimary"]);
    expect(w.probed).not.toContain("0ximpl"); // the attached sibling is not re-discovered
  });

  it("no-ops when there are no manual contracts", async () => {
    const w = makeWorld({ manual: [], candidates: {} });
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
