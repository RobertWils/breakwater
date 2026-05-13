"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Client-side polling hook for /api/scan/[id]/status (Plan 02 G.2).
 *
 * Drives /scan/[id] live status updates without manual page refresh.
 * Polls the lightweight G.1 endpoint (~200 bytes/poll) every 3 s while
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
 *     the bailout count moves up. G.5 N1 doc clarification.
 *   - Terminal initial status → no polling at all (bail immediately)
 *   - Unmount safe via `cancelled` flag in closure
 *
 * Terminal statuses match spec §6.2: COMPLETE, FAILED, EXPIRED.
 * PARTIAL_COMPLETE is non-terminal — polling continues while remaining
 * modules finish.
 *
 * Per-module state (G.5 I1): in addition to the scan-level status, the
 * hook surfaces the polled `modules` array as `polledModules`. ScanShell
 * merges this over its server snapshot so individual ModuleCards
 * transition live (RUNNING pulse + COMPLETE grade badge) without
 * waiting for the terminal `router.refresh()`. `polledModules` is null
 * until the first successful poll, signalling "no live data yet, use
 * the server snapshot."
 *
 * The hook uses both a closure-local `consecutiveErrors` counter (for
 * control-flow decisions inside one effect run) AND `setErrorCount`
 * (for the return-value useful in UI). React 18 state batching can
 * make `errorCount` lag the closure value across renders, so the
 * closure variable is the source of truth for backoff/bailout
 * decisions.
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
  modules: PolledModuleState[];
}

/**
 * Per-module slice surfaced from /api/scan/[id]/status. ScanShell merges
 * this over its server-rendered ModuleRunResponse snapshot for live
 * RUNNING/COMPLETE transitions (G.5 I1).
 */
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
   * Last-polled per-module state. Null until the first successful poll,
   * which signals callers to fall back to the server snapshot. After
   * the first successful poll this is always the latest array — never
   * goes back to null on subsequent errors.
   */
  polledModules: PolledModuleState[] | null;
}

export function useScanPolling(
  scanId: string,
  initialStatus: string,
): UseScanPollingResult {
  const router = useRouter();
  const [currentStatus, setCurrentStatus] = useState(initialStatus);
  const [errorCount, setErrorCount] = useState(0);
  const [polledModules, setPolledModules] = useState<
    PolledModuleState[] | null
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
        setPolledModules(data.modules);

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

  return { currentStatus, errorCount, polledModules };
}
