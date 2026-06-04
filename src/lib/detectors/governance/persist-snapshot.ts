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
// Plan 03 §3.5 PR 2: SnapshotClient exposes a single atomic `upsert`
// keyed on contractId. PR 2 added `@unique(contractId)` to
// GovernanceSnapshot, which makes the contractId-keyed upsert possible
// and closes the non-atomic findFirst→write race window the PR 1
// transition carried. The PR 1 `scanId` column stays nullable for legacy
// reads but plays no part here — the upsert keys on contractId only.
//
// Narrow concrete signatures are kept because Prisma's generic
// `GovernanceSnapshotDelegate` is too wide for `vi.fn<T>()` to satisfy;
// the real Prisma delegate is structurally compatible with the narrow
// form below at every call site we make.
export type SnapshotClient = {
  governanceSnapshot: {
    upsert: (args: {
      where: { contractId: string };
      create: Prisma.GovernanceSnapshotUncheckedCreateInput;
      update: Prisma.GovernanceSnapshotUncheckedUpdateInput;
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
 * Plan 03 §3.5 PR 2: now an ATOMIC upsert keyed on the
 * `GovernanceSnapshot.contractId` unique constraint that PR 2 added.
 * The PR 1 transition used a non-atomic `findFirst → create / update`
 * (scanId had lost its @unique and contractId was not yet unique),
 * which left a race window between the read and the write. PR 2's
 * `@unique(contractId)` lets a single `upsert({ where: { contractId } })`
 * do the create-or-update in one statement — the read/write gap is gone.
 * A new Contract's first snapshot creates; a re-snapshot of the same
 * Contract updates (bumping `capturedAt`). What is written is unchanged
 * from the PR 1 branches; only the mechanism is atomic now.
 */
export async function persistGovernanceSnapshot(
  context: PersistSnapshotContext,
  client: SnapshotClient = prisma,
): Promise<GovernanceSnapshot> {
  const { scanId, contractId, snapshot } = context;
  const data = mapSnapshotToCreate(snapshot);

  return client.governanceSnapshot.upsert({
    where: { contractId },
    create: { scanId, contractId, ...data },
    update: { ...data, capturedAt: new Date() },
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
): Omit<Prisma.GovernanceSnapshotUncheckedCreateInput, "scanId" | "contractId"> {
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
