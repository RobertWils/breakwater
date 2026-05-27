import { EventSchemas, Inngest } from "inngest";

export type Chain = "ETHEREUM" | "SOLANA";

export type ModuleName = "GOVERNANCE" | "ORACLE" | "SIGNER" | "FRONTEND";

export type ModuleStatus = "COMPLETE" | "FAILED" | "SKIPPED";

export type ScanQueuedEventData = {
  scanId: string;
  protocolId: string;
  chain: Chain;
  primaryContractAddress: string;
  modulesEnabled: ModuleName[];
};

export type ScanModuleRequestedEventData = {
  scanId: string;
  module: ModuleName;
  /**
   * Plan 03 §4.3: identifies the Contract row this module run targets.
   * Optional during the D.1 → D.3 transition so the Plan 02 emitter in
   * execute-scan continues to compile; D.3 tightens both the emitter
   * and the waiter, at which point this field becomes effectively
   * required (every Plan 03-era event carries it).
   */
  contractId?: string;
  /**
   * Plan 03 §4.3: denormalised Contract.address for log readability +
   * to avoid an extra DB round-trip when execute-governance-module
   * loads the Contract context. Same optionality lifecycle as
   * contractId above.
   */
  contractAddress?: string;
};

export type ScanModuleCompletedEventData = {
  scanId: string;
  module: ModuleName;
  /**
   * Plan 03 §4.3: identifies the Contract row this completion event
   * belongs to. Required for the compound `if`-expression match in
   * execute-scan's per-(module, contractId) waiter to scope correctly.
   * Optional during the D.1 → D.3 transition; D.3 tightens.
   */
  contractId?: string;
  /** Plan 03 §4.3 — denormalised Contract.address. */
  contractAddress?: string;
  status: ModuleStatus;
  findingsCount: number;
  grade: string | null;
  executionMs: number;
};

export type ScanCompletedEventData = {
  scanId: string;
  finalStatus: string;
  compositeGrade: string | null;
  /** Composite score 0-100 (F.3). Null when finalStatus !== "COMPLETE". */
  compositeScore: number | null;
  /** Total findings persisted for this scan (F.3). */
  findingsCount: number;
  executionMs: number;
};

type BreakwaterEventSchemas = {
  "scan.queued": { data: ScanQueuedEventData };
  "scan.module.requested": { data: ScanModuleRequestedEventData };
  "scan.module.completed": { data: ScanModuleCompletedEventData };
  "scan.completed": { data: ScanCompletedEventData };
};

export const inngest = new Inngest({
  id: process.env.INNGEST_APP_ID ?? "breakwater",
  eventKey: process.env.INNGEST_EVENT_KEY,
  schemas: new EventSchemas().fromRecord<BreakwaterEventSchemas>(),
});

export type BreakwaterInngest = typeof inngest;
