import { describe, it, expect } from "vitest";
import { ScanSubmissionSchema, Chain, Module } from "@/lib/schemas/scan";

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

describe("ScanSubmissionSchema — Module enum", () => {
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

describe("Chain and Module standalone enums", () => {
  it("Chain accepts ETHEREUM and SOLANA", () => {
    expect(Chain.safeParse("ETHEREUM").success).toBe(true);
    expect(Chain.safeParse("SOLANA").success).toBe(true);
    expect(Chain.safeParse("BTC").success).toBe(false);
  });

  it("Module accepts all four module names", () => {
    for (const m of ["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"]) {
      expect(Module.safeParse(m).success).toBe(true);
    }
    expect(Module.safeParse("LIQUIDATION").success).toBe(false);
  });
});
