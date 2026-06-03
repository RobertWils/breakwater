import { z } from "zod";

import { MAX_RELATED_CONTRACTS } from "@/lib/config";

export const Chain = z.enum(["ETHEREUM", "SOLANA"]);

export const ModuleName = z.enum(["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"]);

/**
 * Plan 03 §3.1: ContractRole values matching the Prisma enum. Kept as
 * a zod literal union (rather than `nativeEnum(ContractRole)`) so this
 * file doesn't import the Prisma client — schemas are consumed at the
 * route boundary where the Prisma client load is undesirable.
 *
 * `PRIMARY` is deliberately excluded from the user-submittable role
 * set: the primary contract role is determined by the submission shape
 * (`primaryContractAddress`), not chosen by the client. A `RelatedContractSchema`
 * entry with `role: "PRIMARY"` is rejected at parse time.
 */
export const RelatedContractRole = z.enum([
  "PROXY_IMPLEMENTATION",
  "DECLARED_MULTISIG",
  "DECLARED_BRIDGE",
  "TOKEN_CONTRACT",
  "TIMELOCK",
  "RELATED",
]);

export type RelatedContractRoleValue = z.infer<typeof RelatedContractRole>;

/**
 * Plan 03 §4.1: per-entry shape inside `relatedContracts`.
 *
 * Role defaults to `RELATED` so a Plan 02-style plain-string submission
 * (the legacy `extraContractAddresses` array, normalised by `submitScan`
 * before calling `validateRelatedContracts`) lands as RELATED.
 */
export const RelatedContractSchema = z.object({
  address: z.string().min(1),
  role: RelatedContractRole.optional().default("RELATED"),
  label: z.string().max(80).optional(),
  crossChainTwins: z
    .array(
      z.object({
        chain: z.string(),
        address: z.string(),
      }),
    )
    .optional()
    .default([]),
});

export type RelatedContractInput = z.infer<typeof RelatedContractSchema>;

export const ScanSubmissionSchema = z.object({
  chain: Chain,
  primaryContractAddress: z.string().min(1),
  /**
   * Plan 03 §4.1 — structured related-contracts array. Capped at
   * MAX_RELATED_CONTRACTS via zod `.max()`; the cap message surfaces
   * `too_many_related_contracts` via zod's standard validation_error
   * response shape on the route boundary.
   */
  relatedContracts: z
    .array(RelatedContractSchema)
    .max(MAX_RELATED_CONTRACTS, "too_many_related_contracts")
    .optional()
    .default([]),
  /**
   * Legacy Plan 01/02 plain-string array. `submitScan` normalises these
   * into RELATED-role entries and merges with `relatedContracts` before
   * validation. Kept for backward compat with API clients on the old
   * shape (spec §4.1).
   */
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

/**
 * Plan 03 §4.1 — normalized output of `validateRelatedContracts`. Each
 * entry corresponds 1:1 with a Contract row that `submitScan` will
 * create. The address here is the lowercased / normalized form (caller
 * normalizes before passing in).
 */
export interface NormalizedRelatedContract {
  address: string;
  role: RelatedContractRoleValue;
  label: string | undefined;
  crossChainTwins: { chain: string; address: string }[];
}

export type ValidateRelatedContractsResult =
  | { ok: true; normalized: NormalizedRelatedContract[] }
  | { ok: false; code: "primary_address_in_related"; details: { address: string; role: RelatedContractRoleValue } };

/**
 * Plan 03 §4.1 — primary-address-in-related rule + inter-related dedupe.
 *
 * Caller passes:
 *   - `primary`: the (already normalized) primary address.
 *   - `related`: the post-zod-parse RelatedContractInput[] WITH the legacy
 *     `extraContractAddresses` already merged in as `role: RELATED` entries.
 *
 * Sub-cases (per spec):
 *   1. `addr === primary` AND role !== "RELATED": misconfiguration — the
 *      user is trying to assign the primary contract two roles
 *      simultaneously. Returns `ok: false, code: "primary_address_in_related"`.
 *   2. `addr === primary` AND (role unspecified OR role === "RELATED"):
 *      silent dedupe — drop the duplicate; PRIMARY Contract already covers
 *      this address. No error.
 *   3. Inter-related dedupe: two related entries share an address — drop
 *      the second; no error. (Harmless ambiguity; the user listed an
 *      address twice.)
 *
 * Addresses are compared case-insensitively; the caller is expected to
 * have lowercased / normalized `primary` and `related[*].address`.
 */
export function validateRelatedContracts(
  primary: string,
  related: RelatedContractInput[],
): ValidateRelatedContractsResult {
  const primaryLower = primary.toLowerCase();
  const seen = new Set<string>([primaryLower]);
  const out: NormalizedRelatedContract[] = [];

  for (const entry of related) {
    const addr = entry.address.toLowerCase();
    if (addr === primaryLower) {
      if (entry.role !== "RELATED") {
        return {
          ok: false,
          code: "primary_address_in_related",
          details: { address: entry.address, role: entry.role },
        };
      }
      continue; // silent dedupe — PRIMARY row covers this address
    }
    if (seen.has(addr)) continue; // inter-related dedupe
    seen.add(addr);
    out.push({
      address: entry.address,
      role: entry.role,
      label: entry.label,
      crossChainTwins: entry.crossChainTwins,
    });
  }

  return { ok: true, normalized: out };
}
