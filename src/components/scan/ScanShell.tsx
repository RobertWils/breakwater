"use client"

import { useMemo } from "react"

import type {
  ContractResponse,
  ModuleRunResponse,
  ScanResponse,
  VisibilityTier,
} from "@/lib/scan-response"
import {
  useScanPolling,
  type PolledContractState,
} from "@/hooks/useScanPolling"

import { ScanHero } from "./ScanHero"
import { ProtocolGraphDisclaimer } from "./ProtocolGraphDisclaimer"
import { CompositePanel } from "./CompositePanel"
import { ContractList } from "./ContractList"
import { FindingsList } from "./FindingsList"
import { UnlockCTA } from "./UnlockCTA"

interface ScanShellProps {
  scan: ScanResponse
  tier: VisibilityTier
}

/**
 * Phase G client wrapper around the scan results layout. Drives live
 * status updates via `useScanPolling`, which calls `router.refresh()`
 * on terminal transitions so the server-rendered snapshot (findings,
 * grade) refreshes once detection completes.
 *
 * Phase G.4: `ContractList` replaced Plan 02's flat module grid; per-
 * (Contract, module) `ModuleCard`s nest inside each `ContractCard`.
 * `useScanPolling` now returns a per-Contract polled-state map keyed
 * by `(contractId, module)`; ScanShell merges it over the server
 * snapshot's `contracts[i].modules` array.
 */
export function ScanShell({ scan, tier }: ScanShellProps) {
  const { currentStatus, errorCount, polledContracts } = useScanPolling(
    scan.id,
    scan.status,
  )

  // Phase G.5: merge polled per-(Contract, module) state over the
  // server snapshot. Only `status` and `grade` are polled; every
  // other field stays from the server. `grade` only overrides when
  // polling has a non-null value (terminal modules); otherwise we
  // keep the server value so a late `router.refresh()` arriving after
  // a stale poll doesn't blank the rendered grade.
  const mergedContracts: ContractResponse[] = useMemo(() => {
    if (!polledContracts) return scan.contracts
    const byContractId = new Map<string, PolledContractState>(
      polledContracts.map((c) => [c.id, c]),
    )
    return scan.contracts.map((server) => {
      const polled = byContractId.get(server.id)
      if (!polled) return server
      const moduleByName = new Map(polled.modules.map((m) => [m.module, m]))
      const mergedModules: ModuleRunResponse[] = server.modules.map((m) => {
        const p = moduleByName.get(m.module)
        if (!p) return m
        return {
          ...m,
          status: p.status as ModuleRunResponse["status"],
          grade: p.grade ?? m.grade,
        }
      })
      return { ...server, modules: mergedModules }
    })
  }, [scan.contracts, polledContracts])

  return (
    <div className="space-y-6">
      <ScanHero scan={scan} />

      <ProtocolGraphDisclaimer contractCount={mergedContracts.length} />

      <CompositePanel scan={scan} currentStatus={currentStatus} />

      <ContractList contracts={mergedContracts} />

      <FindingsList
        findings={scan.findings}
        contracts={mergedContracts}
        tier={tier}
        status={currentStatus}
        hasAnyHiddenFindings={mergedContracts.some((c) =>
          c.modules.some((m) => (m.hiddenFindingsCount ?? 0) > 0),
        )}
      />

      {tier === "unauth" && <UnlockCTA scanId={scan.id} />}

      {errorCount > 0 && (
        <p
          role="status"
          aria-live="polite"
          className="text-center text-xs font-mono text-sev-medium"
        >
          Connection issues detected. Retrying…
        </p>
      )}
    </div>
  )
}
