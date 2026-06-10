import type { ContractResponse } from "@/lib/scan-response"

import { ModuleCard } from "./ModuleCard"

interface ContractCardProps {
  contract: ContractResponse
}

const ROLE_LABELS: Record<ContractResponse["role"], string> = {
  PRIMARY: "Primary",
  PROXY_IMPLEMENTATION: "Proxy implementation",
  DECLARED_MULTISIG: "Multisig",
  TIMELOCK: "Timelock",
  TOKEN_CONTRACT: "Token contract",
  DECLARED_BRIDGE: "Bridge",
  RELATED: "Related",
}

function truncateAddress(address: string): string {
  if (address.length <= 14) return address
  return `${address.slice(0, 8)}…${address.slice(-4)}`
}

/**
 * Plan 03 §7.4 — per-Contract card. Renders role label, optional
 * user-supplied label, truncated address, per-Contract grade chip,
 * findings count, the §5.3 proxy detect-and-warn affordance (inline
 * note styled like ProtocolGraphDisclaimer), and the per-(Contract,
 * module) ModuleCards nested inside the card so each module's status
 * pulse stays scoped to its contract.
 */
export function ContractCard({ contract }: ContractCardProps) {
  const roleLabel = ROLE_LABELS[contract.role] ?? contract.role
  const headingId = `contract-${contract.id}-heading`
  const hasGrade = contract.compositeGrade !== null
  const findingsLabel = `${contract.findingsCount} finding${contract.findingsCount !== 1 ? "s" : ""}`

  return (
    <article
      aria-labelledby={headingId}
      className="sonar-card p-6 space-y-4"
    >
      <header className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3
            id={headingId}
            className="font-display text-base font-semibold text-foam"
          >
            {contract.label ?? roleLabel}
          </h3>
          <p className="text-xs font-data text-sonar-muted/70 mt-1">
            <span className="uppercase tracking-wider">{roleLabel}</span>
            <span aria-hidden="true"> · </span>
            <span title={contract.address}>{truncateAddress(contract.address)}</span>
          </p>
        </div>
        {hasGrade && (
          <div className="flex items-baseline gap-2 shrink-0">
            <span
              className="font-display text-3xl font-semibold [letter-spacing:-0.02em]"
              style={{ color: `var(--grade-${contract.compositeGrade!.toLowerCase()})` }}
              aria-label={`Grade ${contract.compositeGrade}`}
            >
              {contract.compositeGrade}
            </span>
            {contract.compositeScore !== null && (
              <span className="font-data text-xs text-sonar-muted">
                {contract.compositeScore}/100
              </span>
            )}
          </div>
        )}
      </header>

      {/*
        Spec §5.3 detect-and-warn. Subtle accent border, no icon,
        styled like ProtocolGraphDisclaimer so it reads as informational
        rather than alarming. The user can click through to resubmit
        with the implementation added; rendering is non-modal per spec.
      */}
      {contract.proxyImplementationWarning && (
        <aside
          role="note"
          aria-label="Proxy implementation detected"
          className="rounded-md border border-sonar/15 border-l-4 border-l-sonar bg-sonar/5 px-3 py-2 text-xs text-sonar-muted"
        >
          Proxy implementation detected at{" "}
          <span className="font-data">
            {truncateAddress(contract.proxyImplementationWarning.detectedAddress)}
          </span>
          {" "}— included in this contract&apos;s snapshot but not graded as a separate
          Contract. Resubmit with the implementation as a{" "}
          <code className="font-data">PROXY_IMPLEMENTATION</code> related
          contract to get a separate grade.
        </aside>
      )}

      {/*
        Spec §7.4 — per-(Contract, module) ModuleCards nested inside the
        Contract card. A 4-Contract scan renders 4 ContractCards, each
        with its own module grid; status pulses fire per ModuleRun (not
        per scan-wide module name) per spec §7.5.

        The region label includes the contract's label (when present) or
        truncated address (when not), so a scan with two same-role
        contracts produces distinct screen-reader region labels rather
        than two identical "Multisig modules" announcements (Phase G
        remediation #3 / Codex Review #5 NTH 3).
      */}
      {contract.modules.length > 0 && (
        <div
          role="region"
          aria-label={`${roleLabel} modules — ${
            contract.label ?? truncateAddress(contract.address)
          }`}
          className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-sonar/15"
        >
          {contract.modules.map((m) => (
            <ModuleCard key={m.id} module={m} />
          ))}
        </div>
      )}

      <p className="text-xs text-sonar-muted/70 font-data">{findingsLabel} on this contract</p>
    </article>
  )
}
