import { z } from "zod";

export const Chain = z.enum(["ETHEREUM", "SOLANA"]);

export const Module = z.enum(["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"]);

export const ScanSubmissionSchema = z.object({
  chain: Chain,
  primaryContractAddress: z.string().min(1),
  extraContractAddresses: z.array(z.string()).optional().default([]),
  domain: z.string().optional(), // SINGULAR, no .url()
  multisigs: z.array(z.string()).optional().default([]),
  modulesEnabled: z
    .array(Module)
    .optional()
    .default(["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"]),
  submittedEmail: z.string().email().optional(),
  // displayName NOT in schema — server-derived per spec §5.1 step 8
});

export type ScanSubmission = z.infer<typeof ScanSubmissionSchema>;
