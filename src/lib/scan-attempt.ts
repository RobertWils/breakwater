import { ScanAttemptStatus, type Prisma, type ScanAttempt } from "@prisma/client";

/**
 * Status values that record a non-success outcome — the audit trail must
 * carry a concrete reason so operators can interpret the row without
 * cross-referencing application logs.
 *
 * ACCEPTED is intentionally absent: success rows store `reason = null`
 * since "accepted" carries no extra information beyond the status itself.
 */
const STATUSES_REQUIRING_REASON: ReadonlySet<ScanAttemptStatus> = new Set([
  ScanAttemptStatus.INVALID,
  ScanAttemptStatus.RATE_LIMITED,
  ScanAttemptStatus.ERROR,
  ScanAttemptStatus.DUPLICATE,
]);

export class ScanAttemptValidationError extends Error {
  constructor(public readonly status: ScanAttemptStatus) {
    super(
      `[scan-attempt] ${status} ScanAttempt requires a non-empty reason; ` +
        `pass reason explicitly or use status=ACCEPTED for success rows.`,
    );
    this.name = "ScanAttemptValidationError";
  }
}

/**
 * Structural type covering both the top-level PrismaClient and the
 * transaction-scoped client passed into `prisma.$transaction(async (tx) => …)`.
 * Both expose `scanAttempt.create` with the same signature.
 */
export type ScanAttemptClient = {
  scanAttempt: {
    create: (args: {
      data: Prisma.ScanAttemptUncheckedCreateInput;
    }) => Promise<ScanAttempt>;
  };
};

/**
 * Single insertion path for ScanAttempt rows. Centralises the
 * status/reason invariant: failure-path statuses must carry a non-empty
 * reason; ACCEPTED rows store `reason = null`.
 */
export async function createScanAttempt(
  client: ScanAttemptClient,
  data: Prisma.ScanAttemptUncheckedCreateInput,
): Promise<ScanAttempt> {
  assertReasonRequired(data.status as ScanAttemptStatus, data.reason ?? null);
  return client.scanAttempt.create({ data });
}

export function assertReasonRequired(
  status: ScanAttemptStatus,
  reason: string | null,
): void {
  if (!STATUSES_REQUIRING_REASON.has(status)) return;
  if (reason === null || reason === "") {
    throw new ScanAttemptValidationError(status);
  }
}
