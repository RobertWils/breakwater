import { fetchContractAbi } from "./etherscan-client";

/**
 * DAI's verified mainnet contract — used as the health-check target since
 * its source has been continuously verified for years and the call
 * exercises the same code path as a real GOV-002 lookup. Address is
 * intentionally lowercased; fetchContractAbi normalizes anyway.
 */
const HEALTH_CHECK_ADDRESS = "0x6b175474e89094c44da98b954eedeac495271d0f";

export type EtherscanHealth = {
  reachable: boolean;
  hasApiKey: boolean;
  error: string | null;
};

/**
 * Single round-trip probe. Distinguishes "no API key configured"
 * (`hasApiKey: false`) from network/HTTP failures (`hasApiKey: true,
 * reachable: false`) so observability dashboards can trigger different
 * alerts: missing-key is a config issue, reachable=false is an upstream
 * incident.
 */
export async function checkEtherscanHealth(): Promise<EtherscanHealth> {
  const result = await fetchContractAbi(HEALTH_CHECK_ADDRESS);
  if (result.ok) {
    return { reachable: true, hasApiKey: true, error: null };
  }
  if (result.reason === "missing_api_key") {
    return { reachable: false, hasApiKey: false, error: result.message };
  }
  return { reachable: false, hasApiKey: true, error: result.message };
}
