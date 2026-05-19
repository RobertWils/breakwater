import { createPublicClient, fallback, http } from "viem";
import { mainnet } from "viem/chains";

const PRIMARY_RPC_URL =
  process.env.PRIMARY_ETH_RPC_URL ?? "https://rpc.ankr.com/eth";
const FALLBACK_RPC_URL =
  process.env.FALLBACK_ETH_RPC_URL ?? "https://cloudflare-eth.com";

export const publicClient = createPublicClient({
  chain: mainnet,
  transport: fallback(
    [http(PRIMARY_RPC_URL), http(FALLBACK_RPC_URL)],
    {
      // rank:false → strict primary-first, fall back only on error.
      // retryCount + retryDelay come from spec §8.1; keeps a single
      // public endpoint flap from cascading into a detector failure.
      rank: false,
      retryCount: 2,
      retryDelay: 150,
    },
  ),
  batch: {
    multicall: true,
  },
});

export type PublicClient = typeof publicClient;
