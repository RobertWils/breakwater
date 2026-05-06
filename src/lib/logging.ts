/**
 * Structured logging for the scan lifecycle (Plan 02 spec §16).
 *
 * Each event variant pins the field set the consumer is allowed to rely on.
 * Adding a field to one variant does NOT auto-flow to others; widen each
 * variant deliberately so downstream queries (Vercel log filters,
 * dashboards) stay stable.
 *
 * Output is a single JSON line per call on stdout. Vercel's runtime
 * collects stdout into queryable deploy logs — no external aggregator
 * needed for Plan 02. Plan 07+ may layer pino/Datadog/Sentry on top.
 */
export type ScanLogEvent =
  | {
      event: "scan.submitted";
      scanId: string;
      chain: string;
      modulesEnabled: string[];
    }
  | {
      event: "scan.dispatched";
      scanId: string;
      inngestEventId?: string;
    }
  | {
      event: "scan.module.started";
      scanId: string;
      module: string;
    }
  | {
      event: "scan.module.completed";
      scanId: string;
      module: string;
      grade: string | null;
      executionMs: number;
    }
  | {
      event: "scan.completed";
      scanId: string;
      compositeGrade: string | null;
      totalExecutionMs: number;
    }
  | {
      event: "scan.failed";
      scanId: string;
      module: string;
      errorCode: string;
    }
  | {
      event: "detector.fired";
      scanId: string;
      detectorId: string;
      severity: string;
    };

export function log(payload: ScanLogEvent): void {
  const enriched = {
    ...payload,
    timestamp: new Date().toISOString(),
    service: "breakwater",
  };
  console.log(JSON.stringify(enriched));
}
