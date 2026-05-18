// @vitest-environment node
/**
 * Spec §14 — incident-anchor regression contract (Plan 02 I.1 FIX 4).
 *
 * Locks in the multi-detector trigger set each named fixture must
 * produce when fed through the full GOVERNANCE_DETECTORS registry:
 *
 *   - driftLikeFixture     → GOV-001 + GOV-002 + GOV-003 (grade F)
 *   - beanstalkLikeFixture → GOV-001 + GOV-002 + GOV-004
 *   - audiusLikeFixture    → GOV-005 + GOV-006
 *
 * Per-detector unit tests verify each detector's rule logic in
 * isolation. This file is the cross-detector regression that proves
 * the incident anchors stay genuine: a fixture that loses its multi-
 * detector profile (e.g. a future refactor that flattens an ABI surface)
 * breaks this file loudly rather than silently re-introducing the
 * single-surface fixtures that motivated I.1 FIX 4.
 */

import { describe, expect, it } from "vitest";

import { calculateCompositeGrade } from "@/lib/scoring/composite-grade";

import { GOVERNANCE_DETECTORS } from "../registry";
import {
  audiusLikeFixture,
  beanstalkLikeFixture,
  driftLikeFixture,
} from "./fixtures";

import type { GovernanceFindingInput } from "../types";

function runAllDetectors(
  snapshot: Parameters<(typeof GOVERNANCE_DETECTORS)[number]["detector"]>[0],
): GovernanceFindingInput[] {
  return GOVERNANCE_DETECTORS.flatMap((d) => d.detector(snapshot));
}

function detectorIdsFired(findings: GovernanceFindingInput[]): Set<string> {
  return new Set(findings.map((f) => f.detectorId));
}

describe("Spec §14 incident-anchor regression (I.1 FIX 4)", () => {
  describe("driftLikeFixture → GOV-001 + GOV-002 + GOV-003 (grade F)", () => {
    const findings = runAllDetectors(driftLikeFixture);
    const ids = detectorIdsFired(findings);

    it("fires GOV-001", () => {
      expect(ids.has("GOV-001")).toBe(true);
    });

    it("fires GOV-002", () => {
      expect(ids.has("GOV-002")).toBe(true);
    });

    it("fires GOV-003", () => {
      expect(ids.has("GOV-003")).toBe(true);
    });

    it("does NOT fire GOV-004 (votingSnapshotType=BLOCK_BASED stays quiet)", () => {
      expect(ids.has("GOV-004")).toBe(false);
    });

    it("does NOT fire GOV-005 or GOV-006 (proxyType=NONE)", () => {
      expect(ids.has("GOV-005")).toBe(false);
      expect(ids.has("GOV-006")).toBe(false);
    });

    it("composite grade is F (matches spec §14 — grade F for drift-like)", () => {
      const { grade } = calculateCompositeGrade(findings);
      expect(grade).toBe("F");
    });
  });

  describe("beanstalkLikeFixture → GOV-001 + GOV-002 + GOV-004", () => {
    const findings = runAllDetectors(beanstalkLikeFixture);
    const ids = detectorIdsFired(findings);

    it("fires GOV-001", () => {
      expect(ids.has("GOV-001")).toBe(true);
    });

    it("fires GOV-002", () => {
      expect(ids.has("GOV-002")).toBe(true);
    });

    it("fires GOV-004 (CURRENT_BALANCE voting weight)", () => {
      expect(ids.has("GOV-004")).toBe(true);
    });

    it("does NOT fire GOV-003 (no multisig in fixture)", () => {
      expect(ids.has("GOV-003")).toBe(false);
    });

    it("does NOT fire GOV-005 or GOV-006 (proxyType=NONE)", () => {
      expect(ids.has("GOV-005")).toBe(false);
      expect(ids.has("GOV-006")).toBe(false);
    });
  });

  describe("audiusLikeFixture → GOV-005 + GOV-006", () => {
    const findings = runAllDetectors(audiusLikeFixture);
    const ids = detectorIdsFired(findings);

    it("fires GOV-005 (CUSTOM proxy pattern, MEDIUM)", () => {
      expect(ids.has("GOV-005")).toBe(true);
    });

    it("fires GOV-006 (upgradeable contract lacks pause)", () => {
      expect(ids.has("GOV-006")).toBe(true);
    });

    it("does NOT fire GOV-001 or GOV-004 (no governor in fixture)", () => {
      expect(ids.has("GOV-001")).toBe(false);
      expect(ids.has("GOV-004")).toBe(false);
    });

    it("does NOT fire GOV-002 (ABI has no bypass-pattern function)", () => {
      expect(ids.has("GOV-002")).toBe(false);
    });

    it("does NOT fire GOV-003 (no multisig)", () => {
      expect(ids.has("GOV-003")).toBe(false);
    });
  });
});
