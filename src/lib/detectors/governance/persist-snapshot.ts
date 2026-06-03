import type {
  GovernanceSnapshot,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

import type { GovernanceSnapshotData } from "./types";

/**
 * Structural client type covering both the top-level PrismaClient and
 * the in-transaction client passed by `prisma.$transaction(async (tx) => …)`.
 * Same convention as `ScanAttemptClient` in `src/lib/scan-attempt.ts` —
 * keeps the public API decoupled from Prisma's specific union types.
 */
// Plan 03 Phase E.2: SnapshotClient now keys lookups on contractId
// (spec §5.3.1 idempotency invariant — every persistence op scoped by
// the full composite key). The PR 1 GovernanceSnapshot.scanId column
// stays nullable on the schema for legacy reads, but the function
// implementation uses contractId exclusively. The previous Phase A
// `findFirst({ where: { scanId } })` pattern, which existed as a
// transitional fallback before Phase E re-keyed this, is gone.
//
// Narrow concrete signatures are kept because Prisma's generic
// `GovernanceSnapshotDelegate` is too wide for `vi.fn<T>()` to satisfy;
// the real Prisma delegate is structurally compatible with the narrow
// form below at every call site we make.
export type SnapshotClient = {
  governanceSnapshot: {
    findFirst: (args: {
      where: { contractId: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
    update: (args: {
      where: { id: string };
      data: Prisma.GovernanceSnapshotUncheckedUpdateInput;
    }) => Promise<GovernanceSnapshot>;
    create: (args: {
      data: Prisma.GovernanceSnapshotUncheckedCreateInput;
    }) => Promise<GovernanceSnapshot>;
  };
};

export interface PersistSnapshotContext {
  scanId: string;
  contractId: string;
  snapshot: GovernanceSnapshotData;
}

/**
 * Persist a governance snapshot to the GovernanceSnapshot table.
 *
 * Plan 03 §5.3.1 idempotency invariant: keyed on contractId. Plan 02
 * keyed on scanId (under the @unique constraint), which under Plan 03's
 * N-Contract-per-scan model would conflict across siblings. Each
 * Contract gets its own GovernanceSnapshot row.
 *
 * Plan 03 §3.5 PR 1 transition: scanId lost its @unique, so the
 * Plan 02 atomic `upsert({ where: { scanId } })` is replaced with
 * `findFirst → create / update` keyed on contractId. This is NOT
 * atomic against concurrent writes for the same contractId, but the
 * production safety holds because (Codex Review #4 NICE_TO_HAVE):
 *   - `markModuleRunning`'s compare-and-set on RUNNING prevents
 *     concurrent same-Contract execution within a scan.
 *   - Inngest sequential replay semantics prevent concurrent steps
 *     within a single function execution.
 *   - Different Contract rows target different snapshot rows
 *     (Phase E.2's per-Contract scoping ensures each invocation
 *     persists only its own contractId).
 * PR 2 adds `@unique(contractId)` to GovernanceSnapshot; this
 * function can return to atomic upsert at that point.
 */
export async function persistGovernanceSnapshot(
  context: PersistSnapshotContext,
  client: SnapshotClient = prisma,
): Promise<GovernanceSnapshot> {
  const { scanId, contractId, snapshot } = context;
  const data = mapSnapshotToCreate(snapshot);

  const existing = await client.governanceSnapshot.findFirst({
    where: { contractId },
    select: { id: true },
  });
  if (existing) {
    return client.governanceSnapshot.update({
      where: { id: existing.id },
      data: { ...data, capturedAt: new Date() },
    });
  }
  return client.governanceSnapshot.create({
    data: { scanId, contractId, ...data },
  });
}

/**
 * Map a GovernanceSnapshotData into the Prisma scalar-only shape
 * accepted by both create and update inputs. Fields are 1:1 with the
 * schema (verified during Phase D.4 pre-flight); enum values flow
 * through unchanged because both producer (snapshot type) and consumer
 * (Prisma client) import the same enum from `@prisma/client`.
 */
function mapSnapshotToCreate(
  data: GovernanceSnapshotData,
): Omit<Prisma.GovernanceSnapshotUncheckedCreateInput, "scanId"> {
  return {
    blockNumber: data.blockNumber,
    capturedAt: data.capturedAt,

    hasGovernor: data.hasGovernor,
    governorAddress: data.governorAddress,
    governorType: data.governorType,
    governorVersion: data.governorVersion,

    hasTimelock: data.hasTimelock,
    timelockAddress: data.timelockAddress,
    timelockMinDelay: data.timelockMinDelay,
    timelockAdmin: data.timelockAdmin,
    timelockAdminIsContract: data.timelockAdminIsContract,

    hasMultisig: data.hasMultisig,
    multisigAddress: data.multisigAddress,
    multisigThreshold: data.multisigThreshold,
    multisigOwnerCount: data.multisigOwnerCount,
    multisigOwners: data.multisigOwners,

    proxyType: data.proxyType,
    proxyAdminAddress: data.proxyAdminAddress,
    proxyImplementation: data.proxyImplementation,
    proxyVerified: data.proxyVerified,
    proxyAdminIsContract: data.proxyAdminIsContract,
    implementationAbi: data.implementationAbi,
    protocolAbi: data.protocolAbi,

    votingTokenAddress: data.votingTokenAddress,
    votingSnapshotType: data.votingSnapshotType,

    rawState: data.rawState as Prisma.InputJsonValue,
  };
}
