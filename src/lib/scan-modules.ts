/**
 * Module-planning primitives shared by scan submission and discovery.
 *
 * Plan 05 Fase 1.4 — extracted from `scan-submission.ts` so the detect-and-
 * attach step (and, transitively, executeScan) can build ModuleRun rows for an
 * auto-attached contract WITHOUT importing the heavy submission graph (zod
 * schemas, config, Inngest). This module depends only on `@prisma/client`
 * enums + `crypto`. `scan-submission.ts` re-exports these for its existing
 * consumers, so nothing changes for them.
 */

import { createHash } from "crypto";

import { ContractRole, ModuleName } from "@prisma/client";

/**
 * Modules that have an Inngest handler registered in this build.
 *
 * Plan 02 ships only GOVERNANCE. ORACLE / SIGNER / FRONTEND are scheduled for
 * Plan 03+. ModuleRun rows for unimplemented modules are created as SKIPPED
 * with `errorMessage = "module_not_implemented"` so the dispatcher's
 * `markComplete` step doesn't hang waiting for a handler that doesn't exist.
 *
 * Typed as `ReadonlySet<ModuleName>` so the compiler catches a typo or stale
 * enum value at the source of truth. Exported so the completeness unit test in
 * `scan-submission-modules.test.ts` can assert every ModuleName is either
 * implemented or explicitly acknowledged as a placeholder.
 */
export const IMPLEMENTED_MODULES: ReadonlySet<ModuleName> = new Set<ModuleName>(
  [ModuleName.GOVERNANCE],
);

/**
 * Discriminator for why a ModuleRun ships SKIPPED. `null` means the row will
 * ship QUEUED (no skip condition triggered).
 */
export type SkipReason =
  | "module_disabled_by_user"
  | "module_not_implemented"
  | "role_not_applicable_to_module"
  | "domain_required"
  | null;

/**
 * Plan 03 §4.2 — applicable Contract roles per module. The GOVERNANCE module
 * skips TOKEN_CONTRACT (ERC-20 surface, not governance) and DECLARED_BRIDGE
 * (deferred to Plan 04 GOV-007). Future modules add their own entries here.
 */
const APPLICABLE_ROLES_BY_MODULE: Record<ModuleName, ReadonlySet<ContractRole>> = {
  [ModuleName.GOVERNANCE]: new Set<ContractRole>([
    ContractRole.PRIMARY,
    ContractRole.PROXY_IMPLEMENTATION,
    ContractRole.DECLARED_MULTISIG,
    ContractRole.TIMELOCK,
    ContractRole.RELATED,
  ]),
  // ORACLE / SIGNER / FRONTEND are not yet implemented; their entries here are
  // placeholders so the type is exhaustive. The module_not_implemented gate
  // fires before the role check for these.
  [ModuleName.ORACLE]: new Set<ContractRole>(),
  [ModuleName.SIGNER]: new Set<ContractRole>(),
  [ModuleName.FRONTEND]: new Set<ContractRole>(),
};

/**
 * Pure priority-resolution for the skip reason on a ModuleRun row. Priority
 * order (first match wins):
 *   1. `module_disabled_by_user` — user explicit opt-out is the most useful
 *      audit signal.
 *   2. `module_not_implemented` — no Inngest handler; "we cannot run this at
 *      all" beats role/domain checks.
 *   3. `role_not_applicable_to_module` — Plan 03 §4.2. Implemented but doesn't
 *      apply to this Contract's role.
 *   4. `domain_required` — the FRONTEND-needs-domain case.
 *
 * Returns `null` when none trigger — the caller seeds the row QUEUED with
 * `errorMessage: null`. See `scan-submission-modules.test.ts`.
 */
export function computeSkipReason(params: {
  module: ModuleName;
  role: ContractRole;
  enabled: boolean;
  implemented: boolean;
  requiresDomain: boolean;
  hasDomain: boolean;
}): SkipReason {
  if (!params.enabled) return "module_disabled_by_user";
  if (!params.implemented) return "module_not_implemented";
  if (!APPLICABLE_ROLES_BY_MODULE[params.module].has(params.role)) {
    return "role_not_applicable_to_module";
  }
  if (params.requiresDomain && !params.hasDomain) return "domain_required";
  return null;
}

/**
 * Deterministic-per-hour idempotency key for a (scan, module, contract)
 * ModuleRun. Exported (Plan 05 Fase 1.4) so detect-and-attach builds rows with
 * the same key shape submitScan uses.
 */
export function generateIdempotencyKey(
  scanId: string,
  module: string,
  contractId: string,
): string {
  const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
  return createHash("sha256")
    .update(`${scanId}:${module}:${contractId}:${hourBucket}`)
    .digest("hex");
}
