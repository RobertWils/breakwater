/**
 * Etherscan v2 API client (Plan 02 D.1).
 *
 * Routes contract-introspection lookups (currently: contract ABI for
 * GOV-002; proxy implementation slot for D.3c) through the Etherscan v2
 * REST API. v1 (`api.etherscan.io/api`) was deprecated 2025-08-15;
 * v2 mandates `chainid` + `apikey` query params on every call.
 *
 * Discriminated EtherscanResult lets call sites differentiate between:
 *   - `missing_api_key`  → graceful skip (the only "expected" failure
 *                          when ETHERSCAN_API_KEY is unset on dev/preview)
 *   - `rate_limit`       → transient, retry per spec §8.4
 *   - `not_found`        → terminal, address has no verified source
 *   - `invalid_response` → schema mismatch, treat as bug
 *   - `network_error`    → transient, retry
 */

export type EtherscanResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      reason:
        | "missing_api_key"
        | "rate_limit"
        | "not_found"
        | "invalid_response"
        | "network_error";
      message: string;
    };

const ETHERSCAN_V2_BASE = "https://api.etherscan.io/v2/api";
const ETHEREUM_CHAIN_ID = "1";
const REQUEST_TIMEOUT_MS = 10_000;

interface EtherscanEnvelope {
  status: "0" | "1";
  message: string;
  result: unknown;
}

/**
 * Inspect a status="0" envelope and pick the most specific reason from
 * the message+result text. Etherscan sets `message: "NOTOK"` on every
 * failure response — the real signal is in `result`, so the substring
 * check covers both fields. Order matters: most specific first.
 */
function classifyErrorEnvelope(envelope: EtherscanEnvelope): {
  reason: "rate_limit" | "not_found" | "missing_api_key" | "invalid_response";
  message: string;
} {
  const resultText = typeof envelope.result === "string" ? envelope.result : "";
  const combined = `${envelope.message} ${resultText}`.toLowerCase();
  const message = resultText || envelope.message || "unknown";

  if (combined.includes("rate limit")) {
    return { reason: "rate_limit", message };
  }
  if (combined.includes("contract source code not verified")) {
    return { reason: "not_found", message };
  }
  if (combined.includes("api key") || combined.includes("apikey")) {
    return { reason: "missing_api_key", message };
  }
  return { reason: "invalid_response", message };
}

/**
 * Fetches the verified contract ABI for `address` on Ethereum mainnet.
 * Returns the raw ABI string as Etherscan delivers it (a JSON-encoded
 * array). Callers parse with JSON.parse — defer parsing to the call site
 * since some detectors only need shape probes (e.g., "does this method
 * exist?") and don't need the full parsed AST.
 */
export async function fetchContractAbi(
  address: string,
): Promise<EtherscanResult<string>> {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      reason: "missing_api_key",
      message: "ETHERSCAN_API_KEY env var not set; GOV-002 will be skipped",
    };
  }

  const url = new URL(ETHERSCAN_V2_BASE);
  url.searchParams.set("chainid", ETHEREUM_CHAIN_ID);
  url.searchParams.set("module", "contract");
  url.searchParams.set("action", "getabi");
  url.searchParams.set("address", address.toLowerCase());
  url.searchParams.set("apikey", apiKey);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return {
        ok: false,
        reason: "network_error",
        message: `Etherscan request timed out (${REQUEST_TIMEOUT_MS}ms)`,
      };
    }
    return {
      ok: false,
      reason: "network_error",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (!response.ok) {
    if (response.status === 429) {
      return {
        ok: false,
        reason: "rate_limit",
        message: "Etherscan rate limit hit (HTTP 429)",
      };
    }
    return {
      ok: false,
      reason: "network_error",
      message: `Etherscan returned HTTP ${response.status}`,
    };
  }

  let envelope: EtherscanEnvelope;
  try {
    envelope = (await response.json()) as EtherscanEnvelope;
  } catch (err) {
    return {
      ok: false,
      reason: "invalid_response",
      message: `Etherscan response was not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  if (envelope.status === "0") {
    return { ok: false, ...classifyErrorEnvelope(envelope) };
  }

  if (typeof envelope.result !== "string") {
    return {
      ok: false,
      reason: "invalid_response",
      message: "Etherscan returned non-string result for ABI",
    };
  }

  return { ok: true, data: envelope.result };
}

/**
 * Skeleton for D.3c — proxy detection will use this to resolve a
 * proxy contract's implementation address via Etherscan. D.1 ships
 * the type signature so D.3c only needs to fill the body without
 * cascading import changes through detector modules.
 */
export async function fetchProxyImplementation(
  _proxyAddress: string,
): Promise<EtherscanResult<string | null>> {
  void _proxyAddress;
  return {
    ok: false,
    reason: "not_found",
    message: "fetchProxyImplementation not yet implemented (Phase D.3c)",
  };
}
