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
};

export type ScanModuleCompletedEventData = {
  scanId: string;
  module: ModuleName;
  status: ModuleStatus;
  findingsCount: number;
  grade: string | null;
  executionMs: number;
};

export type ScanCompletedEventData = {
  scanId: string;
  finalStatus: string;
  compositeGrade: string | null;
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
