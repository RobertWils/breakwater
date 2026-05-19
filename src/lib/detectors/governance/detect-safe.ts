import { fetchSafeInfo } from "@/lib/safe-client";

/**
 * Discriminated result for Safe detection.
 *
 * `isSafe: true`  → confirmed Safe with owners + threshold (GOV-003
 *                   computes concentration ratios from these).
 * `isSafe: false` with `reason: 'not_a_safe'`
 *                 → confirmed non-Safe (HTTP 404 from Safe API). This
 *                   is itself a finding for GOV-003 when the address
 *                   was declared as a multisig in scan input but is not
 *                   actually a Safe.
 * `isSafe: false` with `reason: 'api_unavailable'`
 *                 → transient: rate limit / network / invalid response.
 *                   Detector layer treats this as "skip with note",
 *                   not as a finding.
 */
export interface SafeDetectionResult {
  address: string;
  threshold: number;
  ownerCount: number;
  owners: string[];
  isSafe: true;
}

export interface NotSafeResult {
  address: string;
  isSafe: false;
  reason: "not_a_safe" | "api_unavailable";
  errorMessage?: string;
}

export interface SafeDetectionContext {
  candidateAddress: string;
}

export async function detectSafe(
  context: SafeDetectionContext,
): Promise<SafeDetectionResult | NotSafeResult> {
  const { candidateAddress } = context;
  const lowerAddress = candidateAddress.toLowerCase();

  const result = await fetchSafeInfo(candidateAddress);

  if (result.ok) {
    return {
      address: result.data.address.toLowerCase(),
      threshold: result.data.threshold,
      ownerCount: result.data.owners.length,
      owners: result.data.owners.map((o) => o.toLowerCase()),
      isSafe: true,
    };
  }

  if (result.reason === "not_a_safe") {
    return {
      address: lowerAddress,
      isSafe: false,
      reason: "not_a_safe",
    };
  }

  return {
    address: lowerAddress,
    isSafe: false,
    reason: "api_unavailable",
    errorMessage: result.message,
  };
}
