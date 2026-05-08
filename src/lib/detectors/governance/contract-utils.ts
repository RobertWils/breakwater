import { publicClient } from "@/lib/rpc-client";

/**
 * Probe whether `address` has bytecode at `blockNumber`.
 *
 * Three-state return distinguishes detector-relevant outcomes:
 *   - `true`  — address has non-empty bytecode (contract)
 *   - `false` — address has no bytecode (EOA)
 *   - `null`  — getCode RPC call failed (indeterminate)
 *
 * `null` is distinct from `false` so detectors that fire on EOA-admin
 * conditions (GOV-001, GOV-005) don't false-positive on a transient
 * RPC outage. Snapshot persists `null` and downstream detectors skip
 * the EOA branch when the field is null.
 *
 * Shared between `detect-proxy.ts` (D.3c) and `detect-timelock.ts`
 * (D.3b extended in D.6).
 */
export async function checkIsContract(
  address: string,
  blockNumber: bigint,
): Promise<boolean | null> {
  try {
    const code = await publicClient.getCode({
      address: address as `0x${string}`,
      blockNumber,
    });
    return Boolean(code && code !== "0x" && code.length > 2);
  } catch {
    return null;
  }
}
