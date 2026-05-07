/**
 * Safe Transaction Service API client (Plan 02 D.2).
 *
 * Routes multisig introspection (owners + threshold) for GOV-003 through
 * the Safe Transaction Service. Hostname migrated 2025/2026:
 *   safe-transaction-mainnet.safe.global → api.safe.global/tx-service/eth
 * The legacy hostname 308-redirects to the new one (verified in recon
 * commit 8286689); we point at the new hostname directly to skip the
 * redirect hop.
 *
 * `not_a_safe` is treated as a FIRST-CLASS RESULT, not an error: HTTP
 * 404 from this endpoint means "address is not registered as a Safe",
 * which is itself useful signal for GOV-003 (e.g., a declared multisig
 * that turns out not to be a Safe at all).
 */

export type SafeResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      reason:
        | "not_a_safe"
        | "rate_limit"
        | "invalid_response"
        | "network_error";
      message: string;
    };

export interface SafeInfo {
  address: string;
  threshold: number;
  owners: string[];
  nonce: number;
  modules?: string[];
  guard?: string;
}

const DEFAULT_SAFE_API_BASE = "https://api.safe.global/tx-service/eth";
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Resolve the Safe Transaction Service base URL at call time. Trailing
 * slash on the env var doesn't matter; we strip it before joining the
 * /api/v1/safes/... path. Reads at call time (not module load) so tests
 * can `vi.stubEnv` between cases without `vi.resetModules`.
 */
function resolveBaseUrl(): string {
  const fromEnv = process.env.SAFE_API_BASE_URL;
  const base = fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_SAFE_API_BASE;
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = process.env.SAFE_API_KEY;
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

export async function fetchSafeInfo(
  address: string,
): Promise<SafeResult<SafeInfo>> {
  const url = `${resolveBaseUrl()}/api/v1/safes/${address.toLowerCase()}/`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: buildHeaders(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return {
        ok: false,
        reason: "network_error",
        message: `Safe API request timed out (${REQUEST_TIMEOUT_MS}ms)`,
      };
    }
    return {
      ok: false,
      reason: "network_error",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (response.status === 404) {
    return {
      ok: false,
      reason: "not_a_safe",
      message: `Address ${address.toLowerCase()} is not registered as a Safe`,
    };
  }

  if (response.status === 429) {
    return {
      ok: false,
      reason: "rate_limit",
      message: "Safe API rate limit hit (HTTP 429)",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: "network_error",
      message: `Safe API returned HTTP ${response.status}`,
    };
  }

  let raw: Partial<SafeInfo>;
  try {
    raw = (await response.json()) as Partial<SafeInfo>;
  } catch (err) {
    return {
      ok: false,
      reason: "invalid_response",
      message: `Safe API response was not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  if (
    typeof raw.address !== "string" ||
    typeof raw.threshold !== "number" ||
    !Array.isArray(raw.owners)
  ) {
    return {
      ok: false,
      reason: "invalid_response",
      message:
        "Safe API returned unexpected shape (missing address/threshold/owners)",
    };
  }

  return {
    ok: true,
    data: {
      address: raw.address,
      threshold: raw.threshold,
      owners: raw.owners,
      nonce: typeof raw.nonce === "number" ? raw.nonce : 0,
      modules: raw.modules,
      guard: raw.guard,
    },
  };
}
