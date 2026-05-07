import { fetchSafeInfo } from "./safe-client";

/**
 * Gnosis DAO Safe — well-known public mainnet Safe used as the
 * health-check target. Verified during Phase D recon (commit 8286689):
 * GET /api/v1/safes/{addr}/ returns 200 with owners + threshold.
 */
const HEALTH_CHECK_ADDRESS = "0x849D52316331967b6fF1198e5E32A0eB168D039d";

export type SafeApiHealth = {
  reachable: boolean;
  hasApiKey: boolean;
  error: string | null;
};

/**
 * Single round-trip probe. `hasApiKey` reflects whether SAFE_API_KEY is
 * configured (anonymous tier still works without one — 2 RPS, 5K/month —
 * but production deployments should configure a key for headroom).
 *
 * Surface logic:
 *   - ok                       → reachable: true,  hasApiKey reflects env
 *   - not_a_safe (defensive)   → reachable: true   (API responded; 404 on
 *                                this canonical address would mean Safe
 *                                deregistered or upstream changed shape)
 *   - rate_limit / network_*   → reachable: false  (genuine upstream issue)
 */
export async function checkSafeApiHealth(): Promise<SafeApiHealth> {
  const hasApiKey = Boolean(process.env.SAFE_API_KEY);
  const result = await fetchSafeInfo(HEALTH_CHECK_ADDRESS);

  if (result.ok) {
    return { reachable: true, hasApiKey, error: null };
  }

  if (result.reason === "not_a_safe") {
    return {
      reachable: true,
      hasApiKey,
      error:
        "Health-check Safe address returned 404 — Gnosis DAO deregistered or upstream shape changed",
    };
  }

  return {
    reachable: false,
    hasApiKey,
    error: result.message,
  };
}
