// @vitest-environment node
/**
 * Plan 04 Scope F — populate-curated-demos unit tests.
 *
 * Pure logic + DI-orchestrator tests. NO database, NO Inngest, NO live
 * RPC — the IO is injected (`PopulateDeps`) and exercised through an
 * in-memory fake "world" so the orchestration behaviour (curated-gate
 * flip → submit → wait → publish → restore, idempotency, dry-run,
 * failure handling) is asserted on resulting state, not mock call
 * counts.
 *
 * The real DB/Inngest/RPC wiring lives in `populate-curated-demos.ts`
 * and only runs against a live environment (see that file's header).
 */

import { ContractRole } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { CURATED_DEMO_GRAPHS, type CuratedDemo } from "../../prisma/curated-demos";
import {
  buildScanSubmissionInput,
  expectedContractCount,
  planDemoAction,
  runPopulate,
  type DemoProtocolState,
  type PopulateDeps,
} from "../populate-curated-demos.logic";

const AAVE = CURATED_DEMO_GRAPHS["aave-v3-ethereum"]!;
const UNI = CURATED_DEMO_GRAPHS["uniswap-v3-ethereum"]!;

describe("expectedContractCount", () => {
  it("counts the PRIMARY row plus each related contract", () => {
    expect(expectedContractCount(AAVE)).toBe(4); // 1 PRIMARY + 3 related
    expect(expectedContractCount(UNI)).toBe(3); // 1 PRIMARY + 2 related
  });
});

describe("buildScanSubmissionInput", () => {
  it("maps a curated graph to a valid submitScan input with roles preserved", () => {
    const input = buildScanSubmissionInput(AAVE);
    expect(input.chain).toBe("ETHEREUM");
    expect(input.primaryContractAddress).toBe(AAVE.primaryContractAddress);
    expect(input.domain).toBe("aave.com");
    expect(input.relatedContracts).toHaveLength(3);
    expect(input.relatedContracts.map((r) => r.role)).toEqual([
      "PROXY_IMPLEMENTATION",
      "TIMELOCK",
      "DECLARED_MULTISIG",
    ]);
    expect(input.relatedContracts[0]!.address).toBe(
      AAVE.relatedContracts[0]!.address,
    );
  });

  it("defaults modulesEnabled to the public scan-form default set", () => {
    const input = buildScanSubmissionInput(UNI);
    expect(input.modulesEnabled).toEqual([
      "GOVERNANCE",
      "ORACLE",
      "SIGNER",
      "FRONTEND",
    ]);
  });

  it("rejects a curated entry that claims the PRIMARY role", () => {
    const bad: CuratedDemo = {
      ...UNI,
      relatedContracts: [
        {
          address: "0x000000000000000000000000000000000000dead",
          role: ContractRole.PRIMARY, // illegal for a related entry
          label: "bogus",
        },
      ],
    };
    expect(() => buildScanSubmissionInput(bad)).toThrow();
  });
});

describe("planDemoAction", () => {
  const published = (count: number): DemoProtocolState => ({
    exists: true,
    ownershipStatus: "CURATED",
    latestDemoScanId: "scan-existing",
    linkedScanStatus: "COMPLETE",
    linkedScanContractCount: count,
  });

  it("errors when the protocol row is missing (seed not run)", () => {
    const state: DemoProtocolState = {
      exists: false,
      ownershipStatus: null,
      latestDemoScanId: null,
      linkedScanStatus: null,
      linkedScanContractCount: null,
    };
    expect(planDemoAction(AAVE, state)).toEqual({
      action: "error",
      reason: "protocol_missing",
    });
  });

  it("skips when a complete demo scan with the right contract count is already linked", () => {
    expect(planDemoAction(AAVE, published(4))).toEqual({
      action: "skip",
      reason: "already_published",
    });
  });

  it("treats PARTIAL_COMPLETE with the right count as already published", () => {
    const state = { ...published(3), linkedScanStatus: "PARTIAL_COMPLETE" as const };
    expect(planDemoAction(UNI, state)).toEqual({
      action: "skip",
      reason: "already_published",
    });
  });

  it("populates when no demo scan is linked yet", () => {
    const state: DemoProtocolState = {
      exists: true,
      ownershipStatus: "CURATED",
      latestDemoScanId: null,
      linkedScanStatus: null,
      linkedScanContractCount: null,
    };
    expect(planDemoAction(AAVE, state)).toEqual({
      action: "populate",
      reason: "no_demo_scan",
    });
  });

  it("re-populates when the linked scan is not in a published state", () => {
    const state = { ...published(4), linkedScanStatus: "FAILED" as const };
    expect(planDemoAction(AAVE, state)).toEqual({
      action: "populate",
      reason: "demo_scan_unpublished",
    });
  });

  it("re-populates when the linked scan's contract count drifts from the graph", () => {
    expect(planDemoAction(AAVE, published(2))).toEqual({
      action: "populate",
      reason: "contract_count_mismatch",
    });
  });
});

// ─── DI-orchestrator tests against an in-memory fake world ──────────────────

interface FakeProtocol {
  exists: boolean;
  ownershipStatus: DemoProtocolState["ownershipStatus"];
  latestDemoScanId: string | null;
  linkedScanStatus: DemoProtocolState["linkedScanStatus"];
  linkedScanContractCount: number | null;
}

interface ScriptedScan {
  status: NonNullable<DemoProtocolState["linkedScanStatus"]>;
  contractCount: number;
}

function makeWorld(
  demo: CuratedDemo,
  protocol: FakeProtocol,
  opts: {
    submit?: () => Promise<{ scanId: string }>;
    scanResult?: ScriptedScan;
  } = {},
) {
  const ownershipHistory: string[] = [];
  const submittedDemos: string[] = [];
  const published: { scanId: string }[] = [];

  const deps: PopulateDeps = {
    async readProtocolState() {
      return {
        exists: protocol.exists,
        ownershipStatus: protocol.ownershipStatus,
        latestDemoScanId: protocol.latestDemoScanId,
        linkedScanStatus: protocol.linkedScanStatus,
        linkedScanContractCount: protocol.linkedScanContractCount,
      };
    },
    async setOwnership(_demo, status) {
      protocol.ownershipStatus = status;
      ownershipHistory.push(status);
    },
    async submit() {
      submittedDemos.push(demo.slug);
      if (opts.submit) return opts.submit();
      return { scanId: `scan-${demo.slug}` };
    },
    async waitForScan() {
      return opts.scanResult ?? { status: "COMPLETE", contractCount: expectedContractCount(demo) };
    },
    async publishDemoScan(_demo, scanId) {
      protocol.latestDemoScanId = scanId;
      protocol.ownershipStatus = "CURATED";
      published.push({ scanId });
    },
    log() {},
  };

  return { deps, protocol, ownershipHistory, submittedDemos, published };
}

describe("runPopulate (orchestrator)", () => {
  it("skips an already-published demo without submitting", async () => {
    const w = makeWorld(UNI, {
      exists: true,
      ownershipStatus: "CURATED",
      latestDemoScanId: "scan-old",
      linkedScanStatus: "COMPLETE",
      linkedScanContractCount: 3,
    });

    const summary = await runPopulate(w.deps, { demos: [UNI] });

    expect(summary.skipped).toBe(1);
    expect(summary.populated).toBe(0);
    expect(w.submittedDemos).toEqual([]);
    expect(w.protocol.ownershipStatus).toBe("CURATED");
  });

  it("populates a demo: opens the curated gate, links the scan, restores CURATED", async () => {
    const w = makeWorld(UNI, {
      exists: true,
      ownershipStatus: "CURATED",
      latestDemoScanId: null,
      linkedScanStatus: null,
      linkedScanContractCount: null,
    });

    const summary = await runPopulate(w.deps, { demos: [UNI] });

    expect(summary.populated).toBe(1);
    expect(w.submittedDemos).toEqual([UNI.slug]);
    // gate opened (UNCLAIMED) then restored to CURATED via publish
    expect(w.ownershipHistory).toContain("UNCLAIMED");
    expect(w.protocol.ownershipStatus).toBe("CURATED");
    expect(w.protocol.latestDemoScanId).toBe(`scan-${UNI.slug}`);
    expect(w.published).toHaveLength(1);
  });

  it("dry-run reports the populate plan without writing or submitting", async () => {
    const w = makeWorld(UNI, {
      exists: true,
      ownershipStatus: "CURATED",
      latestDemoScanId: null,
      linkedScanStatus: null,
      linkedScanContractCount: null,
    });

    const summary = await runPopulate(w.deps, { demos: [UNI], dryRun: true });

    expect(summary.wouldPopulate).toBe(1);
    expect(summary.populated).toBe(0);
    expect(w.submittedDemos).toEqual([]);
    expect(w.ownershipHistory).toEqual([]); // no writes
    expect(w.protocol.ownershipStatus).toBe("CURATED");
    expect(w.protocol.latestDemoScanId).toBeNull();
  });

  it("leaves the protocol CURATED and unlinked when the scan does not complete", async () => {
    const w = makeWorld(
      UNI,
      {
        exists: true,
        ownershipStatus: "CURATED",
        latestDemoScanId: null,
        linkedScanStatus: null,
        linkedScanContractCount: null,
      },
      { scanResult: { status: "FAILED", contractCount: 3 } },
    );

    const summary = await runPopulate(w.deps, { demos: [UNI] });

    expect(summary.errors).toBe(1);
    expect(summary.populated).toBe(0);
    expect(w.protocol.ownershipStatus).toBe("CURATED"); // restored
    expect(w.protocol.latestDemoScanId).toBeNull(); // not linked
  });

  it("restores CURATED when submitScan throws", async () => {
    const w = makeWorld(
      UNI,
      {
        exists: true,
        ownershipStatus: "CURATED",
        latestDemoScanId: null,
        linkedScanStatus: null,
        linkedScanContractCount: null,
      },
      {
        submit: async () => {
          throw new Error("protocol_cooldown");
        },
      },
    );

    const summary = await runPopulate(w.deps, { demos: [UNI] });

    expect(summary.errors).toBe(1);
    expect(w.protocol.ownershipStatus).toBe("CURATED");
    expect(w.protocol.latestDemoScanId).toBeNull();
  });

  it("does not publish a scan whose contract count drifts from the graph", async () => {
    const w = makeWorld(
      UNI,
      {
        exists: true,
        ownershipStatus: "CURATED",
        latestDemoScanId: null,
        linkedScanStatus: null,
        linkedScanContractCount: null,
      },
      { scanResult: { status: "COMPLETE", contractCount: 99 } },
    );

    const summary = await runPopulate(w.deps, { demos: [UNI] });

    expect(summary.errors).toBe(1);
    expect(summary.populated).toBe(0);
    expect(w.protocol.latestDemoScanId).toBeNull();
    expect(w.protocol.ownershipStatus).toBe("CURATED");
  });

  it("errors (without submitting) when the protocol row is missing", async () => {
    const w = makeWorld(UNI, {
      exists: false,
      ownershipStatus: null,
      latestDemoScanId: null,
      linkedScanStatus: null,
      linkedScanContractCount: null,
    });

    const summary = await runPopulate(w.deps, { demos: [UNI] });

    expect(summary.errors).toBe(1);
    expect(w.submittedDemos).toEqual([]);
    expect(w.ownershipHistory).toEqual([]);
  });
});
