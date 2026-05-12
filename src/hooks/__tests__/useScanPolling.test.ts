import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, renderHook } from "@testing-library/react";

// Real next/navigation useRouter returns a stable reference across
// renders. Mirroring that here is critical — if the mock returned a
// fresh object on every call the hook's useEffect (which has `router`
// in its dependency array) would re-run on every setState, restart
// the polling timer chain, and produce a runaway. Single object,
// hoisted alongside the refresh fn.
const { mockRefresh, mockRouter } = vi.hoisted(() => {
  const refresh = vi.fn();
  return { mockRefresh: refresh, mockRouter: { refresh } };
});

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
}));

import { useScanPolling } from "../useScanPolling";

// Helpers ───────────────────────────────────────────────────────────────────
//
// We deliberately avoid @testing-library/react's `waitFor` because it
// polls on setTimeout internally; with vi.useFakeTimers active those
// internal timers never fire and the helper hangs until the test
// timeout. Instead we wrap `vi.advanceTimersByTimeAsync` in `act` —
// timer advancement drains microtasks (fetch resolution + setState),
// and act() flushes React's commit phase before we assert.

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function mockStatusOnce(status: string) {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ id: "scan-1", status, modules: [] }),
  } as Response);
}

function mockErrorOnce(message = "Network error") {
  (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
    new Error(message),
  );
}

// Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn());
  mockRefresh.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Tests ─────────────────────────────────────────────────────────────────────

describe("useScanPolling — terminal initial status (no polling)", () => {
  it("does not poll when initialStatus is COMPLETE", async () => {
    const { result } = renderHook(() => useScanPolling("scan-1", "COMPLETE"));
    expect(result.current.currentStatus).toBe("COMPLETE");

    await advance(10_000);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not poll when initialStatus is FAILED", async () => {
    renderHook(() => useScanPolling("scan-1", "FAILED"));
    await advance(10_000);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not poll when initialStatus is EXPIRED", async () => {
    renderHook(() => useScanPolling("scan-1", "EXPIRED"));
    await advance(10_000);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not call router.refresh() when initialStatus is already terminal", async () => {
    renderHook(() => useScanPolling("scan-1", "COMPLETE"));
    await advance(10_000);
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

describe("useScanPolling — normal polling flow", () => {
  it("does not fetch before the first 3 s interval", async () => {
    mockStatusOnce("RUNNING");
    renderHook(() => useScanPolling("scan-1", "QUEUED"));
    await advance(2_999);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fetches /api/scan/[id]/status with cache:no-store after first interval", async () => {
    mockStatusOnce("RUNNING");
    renderHook(() => useScanPolling("scan-1", "QUEUED"));

    await advance(3_000);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/scan/scan-1/status",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("updates currentStatus from polled response", async () => {
    mockStatusOnce("RUNNING");
    const { result } = renderHook(() => useScanPolling("scan-1", "QUEUED"));

    expect(result.current.currentStatus).toBe("QUEUED");
    await advance(3_000);
    expect(result.current.currentStatus).toBe("RUNNING");
  });

  it("continues polling at 3 s intervals while non-terminal", async () => {
    mockStatusOnce("RUNNING");
    mockStatusOnce("RUNNING");
    renderHook(() => useScanPolling("scan-1", "QUEUED"));

    await advance(3_000);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await advance(3_000);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("calls router.refresh() and stops polling on terminal transition", async () => {
    mockStatusOnce("RUNNING");
    mockStatusOnce("COMPLETE");
    const { result } = renderHook(() => useScanPolling("scan-1", "QUEUED"));

    await advance(3_000);
    expect(result.current.currentStatus).toBe("RUNNING");
    expect(mockRefresh).not.toHaveBeenCalled();

    await advance(3_000);
    expect(result.current.currentStatus).toBe("COMPLETE");
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    // No further polls after terminal transition.
    await advance(15_000);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("useScanPolling — error handling", () => {
  it("increments errorCount on fetch rejection", async () => {
    mockErrorOnce();
    const { result } = renderHook(() => useScanPolling("scan-1", "QUEUED"));

    await advance(3_000);
    expect(result.current.errorCount).toBe(1);
  });

  it("treats non-2xx response as error (4xx/5xx)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as Response);
    const { result } = renderHook(() => useScanPolling("scan-1", "QUEUED"));

    await advance(3_000);
    expect(result.current.errorCount).toBe(1);
  });

  it("resets errorCount to 0 on a successful poll after an error", async () => {
    mockErrorOnce();
    mockStatusOnce("RUNNING");
    const { result } = renderHook(() => useScanPolling("scan-1", "QUEUED"));

    await advance(3_000);
    expect(result.current.errorCount).toBe(1);

    // Backoff after 1 error = 1 s. Total elapsed = 4 s.
    await advance(1_000);
    expect(result.current.errorCount).toBe(0);
    expect(result.current.currentStatus).toBe("RUNNING");
  });

  it("stops polling after 5 consecutive errors", async () => {
    for (let i = 0; i < 6; i++) mockErrorOnce(); // 6th call should never happen
    const { result } = renderHook(() => useScanPolling("scan-1", "QUEUED"));

    // Error schedule:
    //   t=3000   error 1 → backoff 1 s
    //   t=4000   error 2 → backoff 2 s
    //   t=6000   error 3 → backoff 4 s
    //   t=10000  error 4 → backoff 8 s
    //   t=18000  error 5 → STOP (no further schedule)
    await advance(20_000);
    expect(result.current.errorCount).toBe(5);
    expect(global.fetch).toHaveBeenCalledTimes(5);

    // Advance well past any conceivable backoff — fetch count must stay flat.
    await advance(60_000);
    expect(global.fetch).toHaveBeenCalledTimes(5);
  });

  it("applies exponential backoff between consecutive errors (1 s → 2 s)", async () => {
    mockErrorOnce();
    mockErrorOnce();
    renderHook(() => useScanPolling("scan-1", "QUEUED"));

    // First poll at t=3000.
    await advance(3_000);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // After error 1: backoff 1 s → next at t=4000. Advance 999 ms (to t=3999),
    // fetch count should still be 1.
    await advance(999);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Cross the 1 s backoff threshold (to t=4001).
    await advance(2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("useScanPolling — duration cap + unmount safety", () => {
  it("stops polling after 15 min total duration", async () => {
    // Queue more responses than the cap could ever consume.
    for (let i = 0; i < 400; i++) mockStatusOnce("RUNNING");
    renderHook(() => useScanPolling("scan-1", "QUEUED"));

    // Advance 16 min — well past the 15 min cap.
    await advance(16 * 60 * 1_000);

    // At a 3 s cadence the cap allows at most 300 polls (15 min / 3 s).
    const fetchCount = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(fetchCount).toBeLessThanOrEqual(300);
    expect(fetchCount).toBeGreaterThan(0);

    await advance(60_000);
    expect(global.fetch).toHaveBeenCalledTimes(fetchCount);
  });

  it("cancels pending poll on unmount (no fetch fires after cleanup)", async () => {
    mockStatusOnce("RUNNING");
    const { unmount } = renderHook(() => useScanPolling("scan-1", "QUEUED"));

    unmount();

    await advance(10_000);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("cancels chained polls — unmount mid-cycle prevents further fetches", async () => {
    mockStatusOnce("RUNNING");
    mockStatusOnce("RUNNING");
    const { unmount } = renderHook(() => useScanPolling("scan-1", "QUEUED"));

    // First poll completes.
    await advance(3_000);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Unmount mid-cycle, before the second 3 s interval elapses.
    unmount();

    await advance(30_000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
