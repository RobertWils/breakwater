/**
 * Typed error class and factory functions for scan submission failures.
 */

export class ScanSubmissionError extends Error {
  constructor(
    public code: string,
    public statusCode: number,
    message: string,
    public details: Record<string, unknown> = {},
    public headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ScanSubmissionError";
  }
}

export const ScanErrors = {
  invalidAddress: (
    chain: string,
    address: string,
    context?: { field: string; index: number },
  ) =>
    new ScanSubmissionError(
      "invalid_address",
      400,
      `Invalid ${chain} address format`,
      { chain, address, ...(context ?? {}) },
    ),

  rateLimited: (scope: "ip" | "user", retryAfterSec: number) =>
    new ScanSubmissionError(
      "rate_limited",
      429,
      `Too many scan requests from this ${scope}`,
      { scope, retryAfterSec },
      { "Retry-After": String(retryAfterSec) },
    ),

  protocolCooldown: (retryAfterSec: number) =>
    new ScanSubmissionError(
      "protocol_cooldown",
      429,
      "This protocol was scanned recently, try again later",
      { retryAfterSec },
      { "Retry-After": String(retryAfterSec) },
    ),

  curatedProtocol: (latestDemoScanId: string | null, slug: string | null) =>
    new ScanSubmissionError(
      "curated_protocol",
      409,
      "This protocol is a Breakwater demo. Cached results available.",
      {
        latestDemoScanId,
        demoUrl: latestDemoScanId
          ? `/scan/${latestDemoScanId}`
          : slug
            ? `/demo/${slug}`
            : null,
      },
    ),

  /**
   * H.9 BLOCKER Layer B: thrown when every ModuleRun for a submission
   * would be SKIPPED (no runnable module). Catches the case where
   * `modulesEnabled` contains only unimplemented modules — the
   * schema-level `.min(1)` only rejects empty arrays. 422 because the
   * input parses correctly but cannot be processed.
   */
  noRunnableModules: (implementedModules: string[]) =>
    new ScanSubmissionError(
      "no_runnable_modules",
      422,
      `Scan has no runnable modules. At least one implemented module must be enabled. Currently implemented: ${implementedModules.join(", ")}.`,
      { implementedModules },
    ),

  /**
   * Plan 03 §4.1: only Ethereum scanning is supported. The Chain enum
   * still includes SOLANA so curated Solana demos render unchanged, but
   * a live submission with chain !== "ETHEREUM" is rejected here. Plan
   * 04+ lifts this gate when multi-chain scanning lands.
   */
  unsupportedChain: (chain: string) =>
    new ScanSubmissionError(
      "unsupported_chain_for_plan_03",
      400,
      `Plan 03 only supports ETHEREUM scans. Received chain: ${chain}.`,
      { chain },
    ),

  /**
   * Plan 03 §4.1: the user submitted `primaryContractAddress` AND listed
   * the same address in `relatedContracts` with a non-default role
   * (anything other than RELATED). This is a misconfiguration — the data
   * model cannot represent one address with two roles. RELATED + no-role
   * duplicates are silently deduped instead (see `validateRelatedContracts`).
   */
  primaryAddressInRelated: (address: string, role: string) =>
    new ScanSubmissionError(
      "primary_address_in_related",
      400,
      `Primary address ${address} also appears in relatedContracts with role ${role}. Submit it with role RELATED to dedupe silently, or remove it from relatedContracts.`,
      { address, role },
    ),
};
