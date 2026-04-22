// @vitest-environment node
/**
 * Unit tests for src/lib/scan-response.ts
 * Mocks prisma — no real DB needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock prisma ──────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    scan: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  filterFindings,
  shapeModuleRun,
  getScan,
} from "@/lib/scan-response";
import type { Finding, ModuleRun } from "@prisma/client";

const mockFindUnique = prisma.scan.findUnique as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Fixture helpers ──────────────────────────────────────────────────────────

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "finding-1",
    scanId: "scan-1",
    moduleRunId: "modrun-1",
    module: "GOVERNANCE",
    severity: "HIGH",
    publicTitle: "Public title",
    title: "Full title",
    description: "Description text",
    evidence: { raw: "0xdeadbeef" },
    affectedComponent: "Governor.sol",
    references: ["https://example.com"],
    remediationHint: "Upgrade to v2",
    remediationDetailed: "Step-by-step remediation details",
    publicRank: 1,
    detectorId: "gov-upgrade-001",
    detectorVersion: 1,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  } as Finding;
}

function makeModuleRun(overrides: Partial<ModuleRun> = {}): ModuleRun {
  return {
    id: "modrun-1",
    scanId: "scan-1",
    module: "GOVERNANCE",
    status: "COMPLETE",
    grade: "B",
    score: 75,
    findingsCount: 3,
    startedAt: new Date("2026-01-01T01:00:00.000Z"),
    completedAt: new Date("2026-01-01T01:05:00.000Z"),
    attemptCount: 1,
    errorMessage: null,
    errorStack: "Error: stack trace here",
    detectorVersions: { "gov-upgrade-001": 1 },
    inputSnapshot: {},
    rpcCallsUsed: 42,
    idempotencyKey: "idempkey-1",
    ...overrides,
  } as unknown as ModuleRun;
}

function makeScanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "scan-abc",
    status: "COMPLETE",
    compositeScore: 80,
    compositeGrade: "B",
    isPartialGrade: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    completedAt: new Date("2026-01-01T01:10:00.000Z"),
    expiresAt: new Date("2026-04-01T00:00:00.000Z"),
    protocol: {
      slug: "aave",
      displayName: "Aave",
      chain: "ETHEREUM",
      domain: "app.aave.com",
      ownershipStatus: "CURATED",
    },
    modules: [],
    findings: [],
    ...overrides,
  };
}

// ── filterFindings: unauth ────────────────────────────────────────────────────

describe("filterFindings — unauth tier", () => {
  it("keeps only publicRank=1 per module, one per module", () => {
    const findings = [
      makeFinding({ id: "f1", module: "GOVERNANCE", publicRank: 1 }),
      makeFinding({ id: "f2", module: "GOVERNANCE", publicRank: 2 }),
      makeFinding({ id: "f3", module: "GOVERNANCE", publicRank: 3 }),
      makeFinding({ id: "f4", module: "ORACLE", publicRank: 1 }),
      makeFinding({ id: "f5", module: "ORACLE", publicRank: 2 }),
    ];

    const { findings: shaped } = filterFindings({ findings, tier: "unauth" });

    expect(shaped).toHaveLength(2);
  });

  it("returns correct hiddenByModule counts", () => {
    const findings = [
      makeFinding({ id: "f1", module: "GOVERNANCE", publicRank: 1 }),
      makeFinding({ id: "f2", module: "GOVERNANCE", publicRank: 2 }),
      makeFinding({ id: "f3", module: "GOVERNANCE", publicRank: 3 }),
      makeFinding({ id: "f4", module: "ORACLE", publicRank: 1 }),
      makeFinding({ id: "f5", module: "ORACLE", publicRank: 2 }),
    ];

    const { hiddenByModule } = filterFindings({ findings, tier: "unauth" });

    // GOVERNANCE: 3 total, 1 shown → 2 hidden
    expect(hiddenByModule.get("GOVERNANCE")).toBe(2);
    // ORACLE: 2 total, 1 shown → 1 hidden
    expect(hiddenByModule.get("ORACLE")).toBe(1);
  });

  it("unauth finding has ONLY severity, publicTitle, remediationHint keys", () => {
    const findings = [makeFinding({ publicRank: 1 })];

    const { findings: shaped } = filterFindings({ findings, tier: "unauth" });

    expect(shaped).toHaveLength(1);
    expect(Object.keys(shaped[0]).sort()).toEqual(
      ["publicTitle", "remediationHint", "severity"].sort(),
    );
  });

  it("module with no publicRank=1 finding: 0 teasers, all count as hidden", () => {
    const findings = [
      makeFinding({ id: "f1", module: "ORACLE", publicRank: 2 }),
      makeFinding({ id: "f2", module: "ORACLE", publicRank: 3 }),
    ];

    const { findings: shaped, hiddenByModule } = filterFindings({
      findings,
      tier: "unauth",
    });

    expect(shaped).toHaveLength(0);
    // 2 total, 0 shown → 2 hidden
    expect(hiddenByModule.get("ORACLE")).toBe(2);
  });

  it("empty findings list: returns empty arrays and empty map", () => {
    const { findings: shaped, hiddenByModule } = filterFindings({
      findings: [],
      tier: "unauth",
    });
    expect(shaped).toHaveLength(0);
    expect(hiddenByModule.size).toBe(0);
  });
});

// ── filterFindings: email ─────────────────────────────────────────────────────

describe("filterFindings — email tier", () => {
  it("returns all findings", () => {
    const findings = [
      makeFinding({ id: "f1", publicRank: 1 }),
      makeFinding({ id: "f2", publicRank: 2 }),
      makeFinding({ id: "f3", publicRank: 3 }),
    ];

    const { findings: shaped } = filterFindings({ findings, tier: "email" });

    expect(shaped).toHaveLength(3);
  });

  it("email finding shape has no remediationDetailed key", () => {
    const findings = [makeFinding({ id: "f1" })];

    const { findings: shaped } = filterFindings({ findings, tier: "email" });
    const keys = Object.keys(shaped[0]);

    expect(keys).not.toContain("remediationDetailed");
    // Must include full fields
    expect(keys).toContain("title");
    expect(keys).toContain("description");
    expect(keys).toContain("evidence");
  });

  it("hiddenByModule is empty for email tier", () => {
    const findings = [makeFinding({ id: "f1" })];

    const { hiddenByModule } = filterFindings({ findings, tier: "email" });

    expect(hiddenByModule.size).toBe(0);
  });

  it("date fields serialized as ISO 8601 strings", () => {
    const findings = [
      makeFinding({ createdAt: new Date("2026-03-15T12:30:00.000Z") }),
    ];

    const { findings: shaped } = filterFindings({ findings, tier: "email" });
    const f = shaped[0] as { createdAt: string };

    expect(f.createdAt).toBe("2026-03-15T12:30:00.000Z");
  });
});

// ── filterFindings: paid ──────────────────────────────────────────────────────

describe("filterFindings — paid tier", () => {
  it("includes remediationDetailed", () => {
    const findings = [
      makeFinding({ remediationDetailed: "Step 1: upgrade contract" }),
    ];

    const { findings: shaped } = filterFindings({ findings, tier: "paid" });
    const keys = Object.keys(shaped[0]);

    expect(keys).toContain("remediationDetailed");
    const f = shaped[0] as { remediationDetailed: string };
    expect(f.remediationDetailed).toBe("Step 1: upgrade contract");
  });
});

// ── shapeModuleRun ────────────────────────────────────────────────────────────

describe("shapeModuleRun", () => {
  it("errorStack is null for unauth tier", () => {
    const m = makeModuleRun({ errorStack: "Error: real stack" });
    const result = shapeModuleRun(m, "unauth", 0);
    expect(result.errorStack).toBeNull();
  });

  it("errorStack is null for email tier", () => {
    const m = makeModuleRun({ errorStack: "Error: real stack" });
    const result = shapeModuleRun(m, "email", 0);
    expect(result.errorStack).toBeNull();
  });

  it("errorStack is the real value for paid tier", () => {
    const m = makeModuleRun({ errorStack: "Error: real stack" });
    const result = shapeModuleRun(m, "paid", 0);
    expect(result.errorStack).toBe("Error: real stack");
  });

  it("hiddenFindingsCount present for unauth tier when count > 0", () => {
    const m = makeModuleRun();
    const result = shapeModuleRun(m, "unauth", 3);
    expect(result.hiddenFindingsCount).toBe(3);
  });

  it("hiddenFindingsCount absent for unauth tier when count === 0", () => {
    const m = makeModuleRun();
    const result = shapeModuleRun(m, "unauth", 0);
    expect("hiddenFindingsCount" in result).toBe(false);
  });

  it("hiddenFindingsCount absent for email tier even when count > 0", () => {
    const m = makeModuleRun();
    const result = shapeModuleRun(m, "email", 5);
    expect("hiddenFindingsCount" in result).toBe(false);
  });

  it("hiddenFindingsCount absent for paid tier even when count > 0", () => {
    const m = makeModuleRun();
    const result = shapeModuleRun(m, "paid", 5);
    expect("hiddenFindingsCount" in result).toBe(false);
  });

  it("date fields serialized as ISO 8601 strings", () => {
    const m = makeModuleRun({
      startedAt: new Date("2026-01-01T01:00:00.000Z"),
      completedAt: new Date("2026-01-01T01:05:00.000Z"),
    });
    const result = shapeModuleRun(m, "email", 0);
    expect(result.startedAt).toBe("2026-01-01T01:00:00.000Z");
    expect(result.completedAt).toBe("2026-01-01T01:05:00.000Z");
  });

  it("null dates remain null", () => {
    const m = makeModuleRun({ startedAt: null, completedAt: null });
    const result = shapeModuleRun(m, "email", 0);
    expect(result.startedAt).toBeNull();
    expect(result.completedAt).toBeNull();
  });
});

// ── getScan ───────────────────────────────────────────────────────────────────

describe("getScan", () => {
  it("returns null when scan not found", async () => {
    mockFindUnique.mockResolvedValueOnce(null);

    const result = await getScan({ scanId: "nonexistent-uuid", tier: "email" });

    expect(result).toBeNull();
    expect(mockFindUnique).toHaveBeenCalledOnce();
  });

  it("returns correct top-level shape with nested data (email tier)", async () => {
    const scanRow = makeScanRow({
      modules: [makeModuleRun()],
      findings: [makeFinding({ publicRank: 1 })],
    });
    mockFindUnique.mockResolvedValueOnce(scanRow);

    const result = await getScan({ scanId: "scan-abc", tier: "email" });

    expect(result).not.toBeNull();
    expect(result!.id).toBe("scan-abc");
    expect(result!.status).toBe("COMPLETE");
    expect(result!.compositeScore).toBe(80);
    expect(result!.compositeGrade).toBe("B");
    expect(result!.isPartialGrade).toBe(false);
    expect(result!.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result!.completedAt).toBe("2026-01-01T01:10:00.000Z");
    expect(result!.expiresAt).toBe("2026-04-01T00:00:00.000Z");
    expect(result!.protocol.slug).toBe("aave");
    expect(result!.modules).toHaveLength(1);
    expect(result!.findings).toHaveLength(1);
  });

  it("unauth tier: findings shaped as teaser, hiddenFindingsCount on module", async () => {
    const scanRow = makeScanRow({
      modules: [makeModuleRun({ module: "GOVERNANCE", findingsCount: 3 })],
      findings: [
        makeFinding({ id: "f1", module: "GOVERNANCE", publicRank: 1 }),
        makeFinding({ id: "f2", module: "GOVERNANCE", publicRank: 2 }),
        makeFinding({ id: "f3", module: "GOVERNANCE", publicRank: 3 }),
      ],
    });
    mockFindUnique.mockResolvedValueOnce(scanRow);

    const result = await getScan({ scanId: "scan-abc", tier: "unauth" });

    expect(result).not.toBeNull();
    // Only 1 finding (publicRank=1 teaser)
    expect(result!.findings).toHaveLength(1);
    // Teaser has only 3 keys
    expect(Object.keys(result!.findings[0]).sort()).toEqual(
      ["publicTitle", "remediationHint", "severity"].sort(),
    );
    // Module has hiddenFindingsCount = 2
    expect(result!.modules[0].hiddenFindingsCount).toBe(2);
    // errorStack is null
    expect(result!.modules[0].errorStack).toBeNull();
  });

  it("paid tier: findings include remediationDetailed, errorStack exposed", async () => {
    const scanRow = makeScanRow({
      modules: [
        makeModuleRun({ errorStack: "Error: real stack trace" }),
      ],
      findings: [makeFinding({ remediationDetailed: "Detailed steps here" })],
    });
    mockFindUnique.mockResolvedValueOnce(scanRow);

    const result = await getScan({ scanId: "scan-abc", tier: "paid" });

    expect(result).not.toBeNull();
    const finding = result!.findings[0] as { remediationDetailed: string };
    expect(finding.remediationDetailed).toBe("Detailed steps here");
    expect(result!.modules[0].errorStack).toBe("Error: real stack trace");
  });

  it("scan with no findings: empty arrays, no hiddenFindingsCount on any module", async () => {
    const scanRow = makeScanRow({
      modules: [makeModuleRun()],
      findings: [],
    });
    mockFindUnique.mockResolvedValueOnce(scanRow);

    const result = await getScan({ scanId: "scan-abc", tier: "unauth" });

    expect(result).not.toBeNull();
    expect(result!.findings).toHaveLength(0);
    expect("hiddenFindingsCount" in result!.modules[0]).toBe(false);
  });
});
