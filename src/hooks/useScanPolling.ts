"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Client-side polling hook for /api/scan/[id]/status.
 *
 * Drives /scan/[id] live status updates without manual page refresh.
 * Polls the lightweight status endpoint (~200 bytes/poll for a single-
 * Contract scan; scales linearly with Contract count) every 3 s while
 * the scan is non-terminal, then calls router.refresh() on terminal
 * transition to re-fetch the full server-rendered snapshot.
 *
 * Behavior per spec §7.1:
 *   - 3 s poll interval (POLL_INTERVAL_MS)
 *   - 15 min total cap (MAX_DURATION_MS)
 *   - 5 consecutive errors → bail (MAX_ERROR_COUNT)
 *   - Exponential backoff on error: 1 s → 2 s → 4 s → 8 s, then stop.
 *     MAX_ERROR_COUNT = 5 means the 5th poll happens after the 8 s
 *     wait (errors 1–4 schedule the next attempt; error 5 returns
 *     without scheduling). The 16 s / 30 s tiers from ERROR_BACKOFF_
 *     MAX_MS are unreachable today — they exist for future tuning if
 *     the bailout count moves up.
 *   - Terminal initial status → no polling at all (bail immediately)
 *   - Unmount safe via `cancelled` flag in closure
 *
 * Terminal statuses match spec §6.2: COMPLETE, FAILED, EXPIRED.
 * PARTIAL_COMPLETE is non-terminal — polling continues while remaining
 * modules finish.
 *
 * Phase G.5 — per-Contract polling shape per spec §7.3 + §7.5. The
 * hook surfaces `polledContracts` (Array<PolledContractState>) instead
 * of the legacy flat `polledModules`. Each entry carries the
 * Contract's id + its per-(Contract, module) statuses; ScanShell
 * merges this over the server snapshot's `contracts[i].modules` so
 * each module's RUNNING pulse stays scoped to its own contract.
 *
 * `polledContracts` is null until the first successful poll, signalling
 * "no live data yet, use the server snapshot." After the first success
 * it's always the latest array — never goes back to null on subsequent
 * errors (the merge falls back per-Contract per-module to the server
 * value when a poll entry is missing).
 *
 * The hook uses both a closure-local `consecutiveErrors` counter (for
 * control-flow decisions inside one effect run) AND `setErrorCount`
 * (for the return-value useful in UI).
 */

const POLL_INTERVAL_MS = 3_000;
const MAX_DURATION_MS = 15 * 60 * 1_000;
const MAX_ERROR_COUNT = 5;
const ERROR_BACKOFF_BASE_MS = 1_000;
const ERROR_BACKOFF_MAX_MS = 30_000;

const TERMINAL_STATUSES = ["COMPLETE", "FAILED", "EXPIRED"] as const;

function isTerminalStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

interface StatusResponse {
  id: string;
  status: string;
  contracts: PolledContractState[];
}

/**
 * Plan 03 §7.3 — per-Contract polling slice surfaced from
 * /api/scan/[id]/status. ScanShell merges this over its server-
 * rendered ContractResponse[] snapshot for live RUNNING/COMPLETE
 * transitions on each (Contract, module) pair.
 */
export interface PolledContractState {
  id: string;
  address: string;
  label: string | null;
  role: string;
  isPrimary: boolean;
  modules: PolledModuleState[];
}

export interface PolledModuleState {
  module: string;
  status: string;
  grade: string | null;
}

export interface UseScanPollingResult {
  /** Last status observed from polling (or initialStatus before first poll). */
  currentStatus: string;
  /** Consecutive error counter — resets to 0 on a successful poll. */
  errorCount: number;
  /**
   * Last-polled per-Contract state (Plan 03 §7.3). Null until the
   * first successful poll, which signals callers to fall back to the
   * server snapshot. After the first successful poll this is always
   * the latest array.
   */
  polledContracts: PolledContractState[] | null;
}

export function useScanPolling(
  scanId: string,
  initialStatus: string,
): UseScanPollingResult {
  const router = useRouter();
  const [currentStatus, setCurrentStatus] = useState(initialStatus);
  const [errorCount, setErrorCount] = useState(0);
  const [polledContracts, setPolledContracts] = useState<
    PolledContractState[] | null
  >(null);

  useEffect(() => {
    if (isTerminalStatus(initialStatus)) {
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let consecutiveErrors = 0;
    const startTime = Date.now();

    async function poll() {
      if (cancelled) return;

      if (Date.now() - startTime > MAX_DURATION_MS) {
        return;
      }

      try {
        const response = await fetch(`/api/scan/${scanId}/status`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Status ${response.status}`);
        }

        const data: StatusResponse = await response.json();
        if (cancelled) return;

        consecutiveErrors = 0;
        setErrorCount(0);
        setCurrentStatus(data.status);
        setPolledContracts(data.contracts);

        if (isTerminalStatus(data.status)) {
          router.refresh();
          return;
        }

        timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
      } catch {
        if (cancelled) return;

        consecutiveErrors += 1;
        setErrorCount(consecutiveErrors);

        if (consecutiveErrors >= MAX_ERROR_COUNT) {
          return;
        }

        const backoffMs = Math.min(
          ERROR_BACKOFF_BASE_MS * Math.pow(2, consecutiveErrors - 1),
          ERROR_BACKOFF_MAX_MS,
        );
        timeoutId = setTimeout(poll, backoffMs);
      }
    }

    timeoutId = setTimeout(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    };
  }, [scanId, initialStatus, router]);

  return { currentStatus, errorCount, polledContracts };
}
