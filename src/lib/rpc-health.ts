import { publicClient } from "./rpc-client";

export type RpcHealth = {
  reachable: boolean;
  blockNumber: bigint | null;
  error: string | null;
};

/**
 * Lightweight reachability probe. The viem fallback transport switches
 * between primary and fallback URLs internally; this helper reports only
 * whether at least one endpoint succeeded for a single getBlockNumber call.
 * Distinguishing primary vs. fallback success requires lower-level transport
 * tracking, which is out of scope for Plan 02.
 */
export async function checkRpcHealth(): Promise<RpcHealth> {
  try {
    const blockNumber = await publicClient.getBlockNumber();
    return {
      reachable: true,
      blockNumber,
      error: null,
    };
  } catch (err) {
    return {
      reachable: false,
      blockNumber: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
