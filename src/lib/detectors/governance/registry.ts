import { detectGov001 } from "./GOV-001-timelock";
import { detectGov002 } from "./GOV-002-bypass";
import { detectGov003 } from "./GOV-003-multisig";
import { detectGov004 } from "./GOV-004-voting";
import { detectGov005 } from "./GOV-005-proxy-admin";
import { detectGov006 } from "./GOV-006-pause";
import type { GovernanceDetector } from "./types";

export interface RegisteredDetector {
  id: string;
  detector: GovernanceDetector;
}

export type DetectorRegistry = ReadonlyArray<RegisteredDetector>;

/**
 * Registry of all governance detectors (Plan 02 F.1).
 *
 * The Phase F orchestrator iterates over this list in declared order,
 * skipping any detector whose id matches `isDetectorDisabled(id)`.
 * Order is stable so findings emerge in a deterministic sequence
 * across runs — useful for snapshot tests, UI display, and audit logs.
 *
 * `runDetectors` accepts the registry as a parameter (defaulting to
 * this constant) so tests can inject a synthetic registry — easier
 * than module-level spy-and-restore on individual detector exports.
 */
export const GOVERNANCE_DETECTORS: DetectorRegistry = [
  { id: "GOV-001", detector: detectGov001 },
  { id: "GOV-002", detector: detectGov002 },
  { id: "GOV-003", detector: detectGov003 },
  { id: "GOV-004", detector: detectGov004 },
  { id: "GOV-005", detector: detectGov005 },
  { id: "GOV-006", detector: detectGov006 },
] as const;
