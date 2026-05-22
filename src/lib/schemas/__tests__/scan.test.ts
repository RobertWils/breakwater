import { describe, it, expect } from "vitest";
import {
  Chain,
  ModuleName,
  RelatedContractSchema,
  ScanSubmissionSchema,
  validateRelatedContracts,
} from "@/lib/schemas/scan";
import { MAX_RELATED_CONTRACTS } from "@/lib/config";

describe("ScanSubmissionSchema — happy paths", () => {
  it("parses a full valid submission with all fields", () => {
    const result = ScanSubmissionSchema.safeParse({
      chain: "ETHEREUM",
      primaryContractAddress: "0xabcdef0123456789abcdef0123456789abcdef01",
      extraContractAddresses: ["0xbbbb000000000000000000000000000000000002"],
      domain: "app.uniswap.org",
      multisigs: ["0xcccc000000000000000000000000000000000003"],
      modulesEnabled: ["GOVERNANCE", "ORACLE"],
      submittedEmail: "alice@example.com",
    });
    expect(result.success).toBe(true);
  });

  it("parses with only required fields; optional fields get defaults", () => {
    const result = ScanSubmissionSchema.safeParse({
      chain: "SOLANA",
      primaryContractAddress: "So11111111111111111111111111111111111111112",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.extraContractAddresses).toEqual([]);
    expect(result.data.multisigs).toEqual([]);
    expect(result.data.modulesEnabled).toEqual([
      "GOVERNANCE",
      "ORACLE",
      "SIGNER",
      "FRONTEND",
    ]);
    expect(result.data.domain).toBeUndefined();
    expect(result.data.submittedEmail).toBeUndefined();
  });

  it("modulesEnabled defaults to all 4 modules when omitted", () => {
    const result = ScanSubmissionSchema.safeParse({
      chain: "ETHEREUM",
      primaryContractAddress: "0xabcdef0123456789abcdef0123456789abcdef01",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.modulesEnabled).toEqual([
      "GOVERNANCE",
      "ORACLE",
      "SIGNER",
      "FRONTEND",
    ]);
  });
});

describe("ScanSubmissionSchema — chain enum", () => {
  it("accepts ETHEREUM", () => {
    const result = ScanSubmissionSchema.safeParse({
      chain: "ETHEREUM",
      primaryContractAddress: "0x1234567890123456789012345678901234567890",
    });
    expect(result.success).toBe(true);
  });

  it("accepts SOLANA", () => {
    const result = ScanSubmissionSchema.safeParse({
      chain: "SOLANA",
      primaryContractAddress: "So11111111111111111111111111111111111111112",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid chain string", () => {
    const result = ScanSubmissionSchema.safeParse({
      chain: "BITCOIN",
      primaryContractAddress: "some-address",
    });
    expect(result.success).toBe(false);
  });
});

describe("ScanSubmissionSchema — ModuleName enum", () => {
  it("accepts all valid module values", () => {
    const result = ScanSubmissionSchema.safeParse({
      chain: "ETHEREUM",
      primaryContractAddress: "0x1234567890123456789012345678901234567890",
      modulesEnabled: ["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown module name", () => {
    const result = ScanSubmissionSchema.safeParse({
      chain: "ETHEREUM",
      primaryContractAddress: "0x1234567890123456789012345678901234567890",
      modulesEnabled: ["GOVERNANCE", "UNKNOWN_MODULE"],
    });
    expect(result.success).toBe(false);
  });
});

describe("ScanSubmissionSchema — primaryContractAddress", () => {
  it("is required and rejects an empty string", () => {
    const result = ScanSubmissionSchema.safeParse({
      chain: "ETHEREUM",
      primaryContractAddress: "",
    });
    expect(result.success).toBe(false);
  });

  it("is required and fails when missing", () => {
    const result = ScanSubmissionSchema.safeParse({ chain: "ETHEREUM" });
    expect(result.success).toBe(false);
  });
});

describe("ScanSubmissionSchema — domain field", () => {
  it("accepts a bare hostname string", () => {
    const result = ScanSubmissionSchema.safeParse({
      chain: "ETHEREUM",
      primaryContractAddress: "0x1234567890123456789012345678901234567890",
      domain: "app.uniswap.org",
    });
    expect(result.success).toBe(true);
  });

  it("rejects domain when passed as an array", () => {
    const result = ScanSubmissionSchema.safeParse({
      chain: "ETHEREUM",
      primaryContractAddress: "0x1234567890123456789012345678901234567890",
      domain: ["app.uniswap.org"],
    });
    expect(result.success).toBe(false);
  });
});

describe("ScanSubmissionSchema — submittedEmail", () => {
  it("accepts a valid email address", () => {
    const result = ScanSubmissionSchema.safeParse({
      chain: "ETHEREUM",
      primaryContractAddress: "0x1234567890123456789012345678901234567890",
      submittedEmail: "user@example.com",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed email address", () => {
    const result = ScanSubmissionSchema.safeParse({
      chain: "ETHEREUM",
      primaryContractAddress: "0x1234567890123456789012345678901234567890",
      submittedEmail: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("allows omission of submittedEmail", () => {
    const result = ScanSubmissionSchema.safeParse({
      chain: "ETHEREUM",
      primaryContractAddress: "0x1234567890123456789012345678901234567890",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.submittedEmail).toBeUndefined();
  });
});

describe("ScanSubmissionSchema — unknown fields", () => {
  it("strips unknown fields by default (zod default behavior)", () => {
    const result = ScanSubmissionSchema.safeParse({
      chain: "ETHEREUM",
      primaryContractAddress: "0x1234567890123456789012345678901234567890",
      displayName: "should-be-stripped",
      unknownField: 42,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    // displayName and unknownField must not appear in the output
    expect(Object.keys(result.data)).not.toContain("displayName");
    expect(Object.keys(result.data)).not.toContain("unknownField");
  });
});

describe("Chain and ModuleName standalone enums", () => {
  it("Chain accepts ETHEREUM and SOLANA", () => {
    expect(Chain.safeParse("ETHEREUM").success).toBe(true);
    expect(Chain.safeParse("SOLANA").success).toBe(true);
    expect(Chain.safeParse("BTC").success).toBe(false);
  });

  it("ModuleName accepts all four module names", () => {
    for (const m of ["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"]) {
      expect(ModuleName.safeParse(m).success).toBe(true);
    }
    expect(ModuleName.safeParse("LIQUIDATION").success).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Plan 03 §4.1 — relatedContracts validation
// ────────────────────────────────────────────────────────────────────────────

const PRIMARY = "0xaaaa000000000000000000000000000000000001";
const OTHER_A = "0xbbbb000000000000000000000000000000000002";
const OTHER_B = "0xcccc000000000000000000000000000000000003";

describe("RelatedContractSchema (Plan 03 §4.1)", () => {
  it("accepts the minimum shape — address only, role defaults to RELATED", () => {
    const result = RelatedContractSchema.safeParse({ address: OTHER_A });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.role).toBe("RELATED");
    expect(result.data.label).toBeUndefined();
    expect(result.data.crossChainTwins).toEqual([]);
  });

  it("rejects PRIMARY as a user-submittable role", () => {
    const result = RelatedContractSchema.safeParse({
      address: OTHER_A,
      role: "PRIMARY",
    });
    expect(result.success).toBe(false);
  });

  it("rejects label longer than 80 chars", () => {
    const result = RelatedContractSchema.safeParse({
      address: OTHER_A,
      label: "x".repeat(81),
    });
    expect(result.success).toBe(false);
  });

  it("accepts all six user-submittable roles", () => {
    for (const role of [
      "PROXY_IMPLEMENTATION",
      "DECLARED_MULTISIG",
      "DECLARED_BRIDGE",
      "TOKEN_CONTRACT",
      "TIMELOCK",
      "RELATED",
    ]) {
      const result = RelatedContractSchema.safeParse({
        address: OTHER_A,
        role,
      });
      expect(result.success, `role ${role} should parse`).toBe(true);
    }
  });
});

describe("ScanSubmissionSchema relatedContracts cap (Plan 03 §4.1)", () => {
  it(`accepts ${MAX_RELATED_CONTRACTS} relatedContracts`, () => {
    const result = ScanSubmissionSchema.safeParse({
      chain: "ETHEREUM",
      primaryContractAddress: PRIMARY,
      relatedContracts: Array.from(
        { length: MAX_RELATED_CONTRACTS },
        (_, i) => ({
          address: `0x${(i + 100).toString(16).padStart(40, "0")}`,
        }),
      ),
    });
    expect(result.success).toBe(true);
  });

  it(`rejects ${MAX_RELATED_CONTRACTS + 1} relatedContracts with too_many_related_contracts`, () => {
    const result = ScanSubmissionSchema.safeParse({
      chain: "ETHEREUM",
      primaryContractAddress: PRIMARY,
      relatedContracts: Array.from(
        { length: MAX_RELATED_CONTRACTS + 1 },
        (_, i) => ({
          address: `0x${(i + 100).toString(16).padStart(40, "0")}`,
        }),
      ),
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.some(
        (issue) => issue.message === "too_many_related_contracts",
      ),
      "expected an issue with message=too_many_related_contracts",
    ).toBe(true);
  });

  it("defaults relatedContracts to [] when omitted (Plan 02 backward compat)", () => {
    const result = ScanSubmissionSchema.safeParse({
      chain: "ETHEREUM",
      primaryContractAddress: PRIMARY,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.relatedContracts).toEqual([]);
  });
});

describe("validateRelatedContracts (Plan 03 §4.1)", () => {
  it("returns ok with empty array when no relateds are supplied", () => {
    const r = validateRelatedContracts(PRIMARY, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.normalized).toEqual([]);
  });

  it("returns the normalized list unchanged when relateds are unique + non-primary", () => {
    const r = validateRelatedContracts(PRIMARY, [
      {
        address: OTHER_A,
        role: "PROXY_IMPLEMENTATION",
        label: "impl",
        crossChainTwins: [],
      },
      { address: OTHER_B, role: "TIMELOCK", crossChainTwins: [] },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.normalized).toHaveLength(2);
    expect(r.normalized[0]!.role).toBe("PROXY_IMPLEMENTATION");
    expect(r.normalized[1]!.role).toBe("TIMELOCK");
  });

  it("rejects primary-in-related with non-default role (DECLARED_MULTISIG)", () => {
    const r = validateRelatedContracts(PRIMARY, [
      {
        address: PRIMARY,
        role: "DECLARED_MULTISIG",
        crossChainTwins: [],
      },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("primary_address_in_related");
    expect(r.details.role).toBe("DECLARED_MULTISIG");
  });

  it("rejects primary-in-related case-insensitively", () => {
    const r = validateRelatedContracts(PRIMARY.toUpperCase(), [
      { address: PRIMARY.toLowerCase(), role: "TIMELOCK", crossChainTwins: [] },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("primary_address_in_related");
  });

  it("silently dedupes primary-in-related with RELATED role (legacy plain-string shape)", () => {
    const r = validateRelatedContracts(PRIMARY, [
      { address: PRIMARY, role: "RELATED", crossChainTwins: [] },
      { address: OTHER_A, role: "RELATED", crossChainTwins: [] },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.normalized).toHaveLength(1);
    expect(r.normalized[0]!.address).toBe(OTHER_A);
  });

  it("silently dedupes inter-related duplicates (same address listed twice)", () => {
    const r = validateRelatedContracts(PRIMARY, [
      { address: OTHER_A, role: "PROXY_IMPLEMENTATION", crossChainTwins: [] },
      { address: OTHER_A, role: "DECLARED_MULTISIG", crossChainTwins: [] },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Second entry is dropped; first wins.
    expect(r.normalized).toHaveLength(1);
    expect(r.normalized[0]!.role).toBe("PROXY_IMPLEMENTATION");
  });

  it("dedupes inter-related case-insensitively", () => {
    const r = validateRelatedContracts(PRIMARY, [
      { address: OTHER_A.toLowerCase(), role: "RELATED", crossChainTwins: [] },
      { address: OTHER_A.toUpperCase(), role: "RELATED", crossChainTwins: [] },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.normalized).toHaveLength(1);
  });
});
