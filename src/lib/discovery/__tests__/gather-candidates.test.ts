// @vitest-environment node
/**
 * Plan 05 Fase 1.5b — gatherCandidates orchestration tests (fakes).
 *
 * Exercises the validatable seam: how the injected sources map to role'd
 * candidates via the §4 ladder, and the per-source degraded isolation. The LIVE
 * chain IO (makeCandidateSourceDeps) is validated at the live run, not here.
 */

import { describe, expect, it } from "vitest";

import { gatherCandidates, type CandidateSourceDeps } from "../gather-candidates";

const SAFE = {
  isConfirmedSafe: true,
  hasTimelockSelectors: false,
  isErc20: false,
  isBridgeRegistry: false,
};
const NOTHING = {
  isConfirmedSafe: false,
  hasTimelockSelectors: false,
  isErc20: false,
  isBridgeRegistry: false,
};

/** Build CandidateSourceDeps from canned source results; record probe calls. */
function fakeDeps(opts: {
  impls?: () => Promise<{ address: string; source: never }[]> | Array<{ address: string; source: string }>;
  targets?: Array<{ address: string; source: "ADMIN_SLOT" | "GETTER"; getterName?: string }>;
  probes?: Record<string, typeof NOTHING>;
  throwTargets?: boolean;
  throwProbeFor?: string;
  // bytecode is keyed by LOWERCASED candidate address; default true (a contract).
  bytecode?: Record<string, boolean>;
  throwBytecodeFor?: string;
}): { deps: CandidateSourceDeps; probed: string[]; logs: string[] } {
  const probed: string[] = [];
  const logs: string[] = [];
  const deps: CandidateSourceDeps = {
    resolveImplementations: async () =>
      (opts.impls ? await opts.impls() : []) as never,
    resolveOwnerAndGetterTargets: async () => {
      if (opts.throwTargets) throw new Error("getter RPC timeout");
      return opts.targets ?? [];
    },
    probeRoleSignals: async (address) => {
      probed.push(address);
      if (opts.throwProbeFor === address) throw new Error("safe API down");
      return opts.probes?.[address] ?? NOTHING;
    },
    hasBytecode: async (address) => {
      if (opts.throwBytecodeFor === address) throw new Error("getCode RPC error");
      return opts.bytecode?.[address] ?? true; // default: a contract
    },
    log: (line) => logs.push(line),
  };
  return { deps, probed, logs };
}

const C = { address: "0xprimary" };

describe("gatherCandidates", () => {
  it("classifies implementation-class sources as PROXY_IMPLEMENTATION (rung 1, no probe)", async () => {
    const w = fakeDeps({
      impls: () => [
        { address: "0xIMPL", source: "IMPL_SLOT" },
        { address: "0xBEACONIMPL", source: "BEACON_IMPL" },
      ],
    });
    const { candidates, degraded } = await gatherCandidates(w.deps, C);
    expect(degraded).toBe(false);
    expect(candidates).toEqual([
      { address: "0ximpl", role: "PROXY_IMPLEMENTATION", discoveredAs: "IMPL_SLOT" },
      { address: "0xbeaconimpl", role: "PROXY_IMPLEMENTATION", discoveredAs: "BEACON_IMPL" },
    ]);
    expect(w.probed).toEqual([]); // impl-class addresses are NOT probed
  });

  it("classifies an admin-slot/owner target that is a confirmed Safe as DECLARED_MULTISIG", async () => {
    const w = fakeDeps({
      targets: [{ address: "0xSAFE", source: "ADMIN_SLOT" }],
      probes: { "0xSAFE": SAFE },
    });
    const { candidates } = await gatherCandidates(w.deps, C);
    expect(candidates).toEqual([
      { address: "0xsafe", role: "DECLARED_MULTISIG", discoveredAs: "confirmed_safe" },
    ]);
    expect(w.probed).toEqual(["0xSAFE"]);
  });

  it("classifies an oracle() getter target with no decisive signal as RELATED/ORACLE", async () => {
    const w = fakeDeps({
      targets: [{ address: "0xORACLE", source: "GETTER", getterName: "oracle" }],
      probes: { "0xORACLE": NOTHING },
    });
    const { candidates } = await gatherCandidates(w.deps, C);
    expect(candidates).toEqual([
      { address: "0xoracle", role: "RELATED", discoveredAs: "ORACLE" },
    ]);
  });

  it("ISOLATION: a failing implementation-source does not drag down the getter source", async () => {
    const w = fakeDeps({
      impls: () => Promise.reject(new Error("slot read RPC error")),
      targets: [{ address: "0xSAFE", source: "ADMIN_SLOT" }],
      probes: { "0xSAFE": SAFE },
    });
    const { candidates, degraded } = await gatherCandidates(w.deps, C);
    expect(degraded).toBe(true); // the failed source marks degraded
    // …but the getter source still produced its candidate
    expect(candidates).toEqual([
      { address: "0xsafe", role: "DECLARED_MULTISIG", discoveredAs: "confirmed_safe" },
    ]);
  });

  it("ISOLATION: a failing per-address probe skips ONE candidate, not the rest", async () => {
    const w = fakeDeps({
      impls: () => [{ address: "0xIMPL", source: "IMPL_SLOT" }],
      targets: [
        { address: "0xBAD", source: "GETTER", getterName: "owner" },
        { address: "0xGOOD", source: "GETTER", getterName: "oracle" },
      ],
      probes: { "0xGOOD": NOTHING },
      throwProbeFor: "0xBAD",
    });
    const { candidates, degraded } = await gatherCandidates(w.deps, C);
    expect(degraded).toBe(true);
    // impl candidate intact + the good getter classified; only 0xBAD dropped
    expect(candidates.map((c) => c.address)).toEqual(["0ximpl", "0xgood"]);
  });

  it("a failing getter source marks degraded but keeps the implementation candidates", async () => {
    const w = fakeDeps({
      impls: () => [{ address: "0xIMPL", source: "IMPL_SLOT" }],
      throwTargets: true,
    });
    const { candidates, degraded } = await gatherCandidates(w.deps, C);
    expect(degraded).toBe(true);
    expect(candidates).toEqual([
      { address: "0ximpl", role: "PROXY_IMPLEMENTATION", discoveredAs: "IMPL_SLOT" },
    ]);
  });

  it("no sources, no failures → empty + not degraded", async () => {
    const w = fakeDeps({});
    expect(await gatherCandidates(w.deps, C)).toEqual({ candidates: [], degraded: false });
  });

  // ── EOA-terminality filter (spec §2 — live-run fix) ──
  it("drops a discovered EOA (no bytecode) BEFORE attach — not a candidate, not degraded", async () => {
    const w = fakeDeps({
      targets: [{ address: "0xEOA", source: "GETTER", getterName: "owner" }],
      probes: { "0xEOA": NOTHING },
      bytecode: { "0xeoa": false }, // EOA: no code
    });
    const { candidates, degraded } = await gatherCandidates(w.deps, C);
    expect(candidates).toEqual([]); // never attached → never gets a ModuleRun → never FAILED
    expect(degraded).toBe(false); // dropping an EOA is expected, not degradation
  });

  it("keeps contract candidates but drops the EOA among them", async () => {
    const w = fakeDeps({
      impls: () => [{ address: "0xIMPL", source: "IMPL_SLOT" }],
      targets: [{ address: "0xEOA", source: "GETTER", getterName: "owner" }],
      probes: { "0xEOA": NOTHING },
      bytecode: { "0ximpl": true, "0xeoa": false },
    });
    const { candidates, degraded } = await gatherCandidates(w.deps, C);
    expect(candidates.map((c) => c.address)).toEqual(["0ximpl"]); // EOA filtered out
    expect(degraded).toBe(false);
  });

  it("a getCode FAILURE conservatively drops the candidate AND marks degraded", async () => {
    const w = fakeDeps({
      impls: () => [{ address: "0xIMPL", source: "IMPL_SLOT" }],
      throwBytecodeFor: "0ximpl",
    });
    const { candidates, degraded } = await gatherCandidates(w.deps, C);
    expect(candidates).toEqual([]); // unverifiable → not attached
    expect(degraded).toBe(true); // couldn't verify → coverage uncertain
  });
});
