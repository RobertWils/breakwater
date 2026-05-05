import { createPublicClient, fallback, http } from "viem";
import { mainnet } from "viem/chains";

const PRIMARY_RPC_URL =
  process.env.PRIMARY_ETH_RPC_URL ?? "https://rpc.ankr.com/eth";
const FALLBACK_RPC_URL =
  process.env.FALLBACK_ETH_RPC_URL ?? "https://cloudflare-eth.com";

export const publicClient = createPublicClient({
  chain: mainnet,
  transport: fallback([http(PRIMARY_RPC_URL), http(FALLBACK_RPC_URL)]),
  batch: {
    multicall: true,
  },
});

export type PublicClient = typeof publicClient;
