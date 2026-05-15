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
};
