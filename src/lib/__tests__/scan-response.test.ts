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
  getScan,
  shapeFindingEmail,
  shapeFindingPaid,
  shapeFindingUnauth,
  shapeModuleRun,
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
    // Plan 03 §3.5 PR 2: contractId is NOT NULL. Default to the
    // `makeContractRow` default id so findings line up with the default
    // single-Contract fixture; multi-Contract tests override per finding.
    contractId: "contract-1",
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
    // Plan 03 §3.5 PR 1: Prisma column renamed from `compositeScore`.
    // The response builder reads `scan.averageContractScore` and projects
    // it into the response's `compositeScore` field (Phase A.3 will
    // rewrite that response shape).
    averageContractScore: 80,
    worstContractScore: 80,
    isPartialCoverage: false,
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
      primaryContractAddress: "0xprimary",
    },
    modules: [],
    findings: [],
    contracts: [],
    ...overrides,
  };
}

function makeContractRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "contract-1",
    scanId: "scan-abc",
    address: "0x" + "1".repeat(40),
    chain: "ETHEREUM",
    role: "PRIMARY",
    label: null,
    isPrimary: true,
    crossChainTwins: [],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    compositeScore: 80,
    compositeGrade: "B",
    isPartialGrade: false,
    moduleRuns: [],
    findings: [],
    // Plan 03 §3.5 PR 2: GovernanceSnapshot.contractId is @unique, so the
    // relation is 1:1 — a single row or null, not an array.
    governanceSnapshot: null,
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

  it("unauth finding has tier + contractId + severity + publicTitle + remediationHint keys (Plan 03 §7.2 — contractId on every variant)", () => {
    const findings = [makeFinding({ publicRank: 1 })];

    const { findings: shaped } = filterFindings({ findings, tier: "unauth" });

    expect(shaped).toHaveLength(1);
    expect(Object.keys(shaped[0]).sort()).toEqual(
      ["contractId", "publicTitle", "remediationHint", "severity", "tier"].sort(),
    );
    expect(shaped[0]).toMatchObject({ tier: "UNAUTH" });
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
      contracts: [
        makeContractRow({
          moduleRuns: [makeModuleRun()],
          findings: [makeFinding({ publicRank: 1 })],
        }),
      ],
      findings: [makeFinding({ publicRank: 1 })],
    });
    mockFindUnique.mockResolvedValueOnce(scanRow);

    const result = await getScan({ scanId: "scan-abc", tier: "email" });

    expect(result).not.toBeNull();
    expect(result!.id).toBe("scan-abc");
    expect(result!.status).toBe("COMPLETE");
    // Phase G.6: legacy `compositeScore` alias removed from
    // ScanResponse; surface via `averageContractScore` instead.
    expect(result!.averageContractScore).toBe(80);
    expect(result!.compositeGrade).toBe("B");
    expect(result!.isPartialGrade).toBe(false);
    expect(result!.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result!.completedAt).toBe("2026-01-01T01:10:00.000Z");
    expect(result!.expiresAt).toBe("2026-04-01T00:00:00.000Z");
    expect(result!.protocol.slug).toBe("aave");
    // Plan 03 §3.5 PR 2: modules nest under the (real) Contract row.
    expect(result!.contracts).toHaveLength(1);
    expect(result!.contracts[0].modules).toHaveLength(1);
    expect(result!.findings).toHaveLength(1);
  });

  it("unauth tier: findings shaped as teaser, hiddenFindingsCount on per-Contract module (Phase G.6 — nested under contracts[i].modules)", async () => {
    const govFindings = [
      makeFinding({ id: "f1", module: "GOVERNANCE", publicRank: 1 }),
      makeFinding({ id: "f2", module: "GOVERNANCE", publicRank: 2 }),
      makeFinding({ id: "f3", module: "GOVERNANCE", publicRank: 3 }),
    ];
    const scanRow = makeScanRow({
      contracts: [
        makeContractRow({
          moduleRuns: [makeModuleRun({ module: "GOVERNANCE", findingsCount: 3 })],
          findings: govFindings,
        }),
      ],
      findings: govFindings,
    });
    mockFindUnique.mockResolvedValueOnce(scanRow);

    const result = await getScan({ scanId: "scan-abc", tier: "unauth" });

    expect(result).not.toBeNull();
    // Only 1 finding (publicRank=1 teaser)
    expect(result!.findings).toHaveLength(1);
    // Plan 03 §7.2: teaser has 5 keys — tier discriminator + contractId
    // + the 3 publicly-visible content fields.
    expect(Object.keys(result!.findings[0]).sort()).toEqual(
      ["contractId", "publicTitle", "remediationHint", "severity", "tier"].sort(),
    );
    // Single Contract; its GOVERNANCE module carries hiddenFindingsCount = 2
    // (3 findings, 1 teaser shown).
    expect(result!.contracts).toHaveLength(1);
    expect(result!.contracts[0].modules[0].hiddenFindingsCount).toBe(2);
    expect(result!.contracts[0].modules[0].errorStack).toBeNull();
  });

  it("paid tier: findings include remediationDetailed, errorStack exposed (Phase G.6 — nested under contracts[i].modules)", async () => {
    const scanRow = makeScanRow({
      contracts: [
        makeContractRow({
          moduleRuns: [makeModuleRun({ errorStack: "Error: real stack trace" })],
          findings: [makeFinding({ remediationDetailed: "Detailed steps here" })],
        }),
      ],
      findings: [makeFinding({ remediationDetailed: "Detailed steps here" })],
    });
    mockFindUnique.mockResolvedValueOnce(scanRow);

    const result = await getScan({ scanId: "scan-abc", tier: "paid" });

    expect(result).not.toBeNull();
    const finding = result!.findings[0] as { remediationDetailed: string };
    expect(finding.remediationDetailed).toBe("Detailed steps here");
    expect(result!.contracts[0].modules[0].errorStack).toBe(
      "Error: real stack trace",
    );
  });

  it("scan with no findings: empty arrays, no hiddenFindingsCount on any per-Contract module", async () => {
    const scanRow = makeScanRow({
      contracts: [
        makeContractRow({
          moduleRuns: [makeModuleRun()],
          findings: [],
        }),
      ],
      findings: [],
    });
    mockFindUnique.mockResolvedValueOnce(scanRow);

    const result = await getScan({ scanId: "scan-abc", tier: "unauth" });

    expect(result).not.toBeNull();
    expect(result!.findings).toHaveLength(0);
    expect("hiddenFindingsCount" in result!.contracts[0].modules[0]).toBe(false);
  });
});

// ── tier discriminator (G.4) ─────────────────────────────────────────────────

describe("FindingResponse tier discriminator (G.4)", () => {
  it("shapeFindingUnauth stamps tier: 'UNAUTH'", () => {
    const result = shapeFindingUnauth(makeFinding({ publicRank: 1 }));
    expect(result.tier).toBe("UNAUTH");
  });

  it("shapeFindingEmail stamps tier: 'EMAIL'", () => {
    const result = shapeFindingEmail(makeFinding({ id: "f-email" }));
    expect(result.tier).toBe("EMAIL");
  });

  it("shapeFindingPaid stamps tier: 'PAID' (overrides spread EMAIL discriminator)", () => {
    const result = shapeFindingPaid(
      makeFinding({ id: "f-paid", remediationDetailed: "Step 1: rotate keys" }),
    );
    expect(result.tier).toBe("PAID");
    expect(result.remediationDetailed).toBe("Step 1: rotate keys");
  });

  it("filterFindings (unauth) returns findings narrowable by tier discriminator", () => {
    const findings = [makeFinding({ publicRank: 1 })];
    const { findings: shaped } = filterFindings({ findings, tier: "unauth" });
    expect(shaped[0].tier).toBe("UNAUTH");
  });

  it("filterFindings (email) returns findings with tier: 'EMAIL'", () => {
    const findings = [makeFinding({ id: "f1" })];
    const { findings: shaped } = filterFindings({ findings, tier: "email" });
    expect(shaped[0].tier).toBe("EMAIL");
  });

  it("filterFindings (paid) returns findings with tier: 'PAID'", () => {
    const findings = [makeFinding({ id: "f1" })];
    const { findings: shaped } = filterFindings({ findings, tier: "paid" });
    expect(shaped[0].tier).toBe("PAID");
  });
});

// ── Phase G.1 — multi-Contract response builder ─────────────────────────────

describe("getScan — Phase G.1 multi-Contract path", () => {
  it("populates contracts[] from Scan.contracts when present (graceful adapter NOT used)", async () => {
    const scanRow = makeScanRow({
      contracts: [
        makeContractRow({
          id: "c-primary",
          address: "0xaaa",
          role: "PRIMARY",
          isPrimary: true,
          compositeGrade: "B",
          compositeScore: 80,
          findings: [makeFinding({ id: "fa", contractId: "c-primary" })],
          moduleRuns: [
            makeModuleRun({ id: "mr-a", scanId: "scan-abc" }),
          ],
        }),
        makeContractRow({
          id: "c-impl",
          address: "0xbbb",
          role: "PROXY_IMPLEMENTATION",
          isPrimary: false,
          compositeGrade: "A",
          compositeScore: 95,
          findings: [],
          moduleRuns: [],
        }),
      ],
      findings: [makeFinding({ id: "fa", contractId: "c-primary" })],
      modules: [],
    });
    mockFindUnique.mockResolvedValueOnce(scanRow);

    const result = await getScan({ scanId: "scan-abc", tier: "email" });
    expect(result).not.toBeNull();
    expect(result!.contracts).toHaveLength(2);
    // PRIMARY first, then PROXY_IMPLEMENTATION.
    expect(result!.contracts[0].role).toBe("PRIMARY");
    expect(result!.contracts[0].id).toBe("c-primary");
    expect(result!.contracts[1].role).toBe("PROXY_IMPLEMENTATION");
    expect(result!.contracts[0].compositeGrade).toBe("B");
    expect(result!.contracts[0].compositeScore).toBe(80);
    expect(result!.contracts[1].compositeGrade).toBe("A");
    // Per-Contract findingsCount populated.
    expect(result!.contracts[0].findingsCount).toBe(1);
    expect(result!.contracts[1].findingsCount).toBe(0);
  });

  it("orders contracts: PRIMARY → TIMELOCK → DECLARED_MULTISIG → PROXY_IMPLEMENTATION → TOKEN_CONTRACT → DECLARED_BRIDGE → RELATED → by address", async () => {
    const scanRow = makeScanRow({
      contracts: [
        makeContractRow({ id: "c-rel", role: "RELATED", isPrimary: false, address: "0xrr" }),
        makeContractRow({ id: "c-bridge", role: "DECLARED_BRIDGE", isPrimary: false, address: "0xbb" }),
        makeContractRow({ id: "c-token", role: "TOKEN_CONTRACT", isPrimary: false, address: "0xtt" }),
        makeContractRow({ id: "c-impl", role: "PROXY_IMPLEMENTATION", isPrimary: false, address: "0xii" }),
        makeContractRow({ id: "c-multi", role: "DECLARED_MULTISIG", isPrimary: false, address: "0xmm" }),
        makeContractRow({ id: "c-timelock", role: "TIMELOCK", isPrimary: false, address: "0xll" }),
        makeContractRow({ id: "c-primary", role: "PRIMARY", isPrimary: true, address: "0xpp" }),
      ],
    });
    mockFindUnique.mockResolvedValueOnce(scanRow);

    const result = await getScan({ scanId: "scan-abc", tier: "email" });
    expect(result!.contracts.map((c) => c.id)).toEqual([
      "c-primary",
      "c-timelock",
      "c-multi",
      "c-impl",
      "c-token",
      "c-bridge",
      "c-rel",
    ]);
  });

  it("proxyImplementationWarning: detected proxy + no sibling PROXY_IMPLEMENTATION → warning set", async () => {
    const scanRow = makeScanRow({
      contracts: [
        makeContractRow({
          id: "c-primary",
          address: "0xaaa",
          role: "PRIMARY",
          isPrimary: true,
          governanceSnapshot: { proxyImplementation: "0xIMPL", scanId: "scan-abc" },
        }),
      ],
    });
    mockFindUnique.mockResolvedValueOnce(scanRow);

    const result = await getScan({ scanId: "scan-abc", tier: "email" });
    expect(result!.contracts[0].proxyImplementationWarning).toEqual({
      detectedAddress: "0xIMPL",
    });
  });

  it("proxyImplementationWarning: detected proxy + sibling PROXY_IMPLEMENTATION at same address → warning null (user explicitly added it)", async () => {
    const scanRow = makeScanRow({
      contracts: [
        makeContractRow({
          id: "c-primary",
          address: "0xaaa",
          role: "PRIMARY",
          isPrimary: true,
          governanceSnapshot: { proxyImplementation: "0xIMPL", scanId: "scan-abc" },
        }),
        makeContractRow({
          id: "c-impl",
          address: "0xIMPL", // case-insensitive match
          role: "PROXY_IMPLEMENTATION",
          isPrimary: false,
        }),
      ],
    });
    mockFindUnique.mockResolvedValueOnce(scanRow);

    const result = await getScan({ scanId: "scan-abc", tier: "email" });
    const primary = result!.contracts.find((c) => c.role === "PRIMARY")!;
    expect(primary.proxyImplementationWarning).toBeNull();
  });

  it("proxyImplementationWarning: non-proxy contract → warning null", async () => {
    const scanRow = makeScanRow({
      contracts: [
        makeContractRow({
          id: "c-primary",
          address: "0xaaa",
          role: "PRIMARY",
          isPrimary: true,
          // snapshot present but proxyImplementation is null → no warning.
          governanceSnapshot: { proxyImplementation: null, scanId: "scan-abc" },
        }),
      ],
    });
    mockFindUnique.mockResolvedValueOnce(scanRow);

    const result = await getScan({ scanId: "scan-abc", tier: "email" });
    expect(result!.contracts[0].proxyImplementationWarning).toBeNull();
  });

  it("unauth tier per-(Contract, module) teaser semantic: one teaser per Contract-module pair", async () => {
    // 2 Contracts, each with 1 GOVERNANCE module + 2 findings.
    const scanRow = makeScanRow({
      contracts: [
        makeContractRow({
          id: "c-a",
          address: "0xaaa",
          role: "PRIMARY",
          isPrimary: true,
          findings: [
            makeFinding({ id: "fa1", contractId: "c-a", module: "GOVERNANCE", publicRank: 1 }),
            makeFinding({ id: "fa2", contractId: "c-a", module: "GOVERNANCE", publicRank: 2 }),
          ],
        }),
        makeContractRow({
          id: "c-b",
          address: "0xbbb",
          role: "PROXY_IMPLEMENTATION",
          isPrimary: false,
          findings: [
            makeFinding({ id: "fb1", contractId: "c-b", module: "GOVERNANCE", publicRank: 1 }),
            makeFinding({ id: "fb2", contractId: "c-b", module: "GOVERNANCE", publicRank: 2 }),
          ],
        }),
      ],
      findings: [
        makeFinding({ id: "fa1", contractId: "c-a", module: "GOVERNANCE", publicRank: 1 }),
        makeFinding({ id: "fa2", contractId: "c-a", module: "GOVERNANCE", publicRank: 2 }),
        makeFinding({ id: "fb1", contractId: "c-b", module: "GOVERNANCE", publicRank: 1 }),
        makeFinding({ id: "fb2", contractId: "c-b", module: "GOVERNANCE", publicRank: 2 }),
      ],
    });
    mockFindUnique.mockResolvedValueOnce(scanRow);

    const result = await getScan({ scanId: "scan-abc", tier: "unauth" });
    // Spec §7.4: one teaser per (Contract, module) pair → 2 teasers.
    expect(result!.findings).toHaveLength(2);
    expect(result!.findings.map((f) => f.contractId).sort()).toEqual(["c-a", "c-b"]);
  });

});
