import { z } from "zod";

export const Chain = z.enum(["ETHEREUM", "SOLANA"]);

export const ModuleName = z.enum(["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"]);

export const ScanSubmissionSchema = z.object({
  chain: Chain,
  primaryContractAddress: z.string().min(1),
  extraContractAddresses: z.array(z.string()).optional().default([]),
  domain: z.string().optional(), // SINGULAR, no .url()
  multisigs: z.array(z.string()).optional().default([]),
  // H.9 BLOCKER Layer A: require at least one module. Schema-level
  // rejection prevents `modulesEnabled: []` from reaching the
  // submission path; without this guard an empty array trickles
  // through, every ModuleRun seeds SKIPPED, and the scan finalises
  // with a misleading composite grade. The .min(1) check happens
  // BEFORE the default fires (zod evaluates min on present values),
  // so default-resolved arrays of length 4 are still valid.
  modulesEnabled: z
    .array(ModuleName)
    .min(1, "modulesEnabled must contain at least one module")
    .optional()
    .default(["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"]),
  submittedEmail: z.string().email().optional(),
  // displayName NOT in schema — server-derived per spec §5.1 step 8
});

export type ScanSubmission = z.infer<typeof ScanSubmissionSchema>;
