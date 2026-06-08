# Breakwater Plan 04 — Design System + Multi-Contract Input Path

**Status:** DRAFT (design exploration complete; spec for review)
**Author:** Robert (orchestrated with Claude)
**Date:** 2026-06-08
**Depends on:** Plan 03 (multi-Contract execution model — shipped, v0.3.0-plan-03)

---

## 0. Why this plan exists

Plan 03 shipped the multi-Contract *machinery*: a scan can hold N contracts
with roles, fan out per-contract execution, score a protocol composite, and
render a multi-Contract response. But two gaps were captured in NOTES.md at
Plan 03 close:

1. **The multi-Contract INPUT path does not exist.** The public homepage form
   accepts a single address. There is no UI to submit related contracts with
   roles. A user cannot start a multi-Contract scan through the app — only
   programmatically via `submitScan({ relatedContracts })`. *The machinery is
   built but has no user-facing gas pedal.*

2. **The UI is undifferentiated.** The current design is functional but generic
   ("vrij suf"). It does not tell the product's story or build the trust a
   security tool needs.

Plan 04 closes both, in the right order: **design foundation first, then build
the multi-Contract input on the new foundation** — so the input path is built
once, in the final design, not built-then-rebuilt.

This plan is explicitly scoped to AVOID the Plan 03 failure mode where the
visible product looked unchanged for weeks. Every phase here should produce a
*visible* change.

---

## 1. The design direction (decided)

After exploring ~13 landing-page mockups across premium/water, retro-gaming,
editorial, blueprint, and sonar directions, the chosen foundation is:

**Sonar + Contagion** — a dark sonar-scope aesthetic where the landing page
tells a scroll-driven story:

- **Phase 1 — Your protocol:** one green blip at radar center, labelled
  air-traffic-control style ("YOUR PROTOCOL / PRIMARY"). "You run a tight ship."
- **Phase 2 — The graph:** the direct contracts appear (proxy, timelock,
  guardian) with connection lines. "A protocol is never one contract."
- **Phase 3 — The graph grows:** the graph extends outward (bridge + further
  dependencies). "The graph keeps growing."
- **Phase 4 — The contagion:** each quadrant shows a dependency sub-graph.
  Nodes inherit the WORST score among their dependencies (see §2). One unsafe
  (red) dependency makes its dependent red; sibling branches keep their own
  colour. Your core protocol inherits red. "You're safe. But are they?"
- **Phase 5 — The breakwater:** Breakwater locks and neutralizes the
  compromised/external nodes, your own graph heals back to green, a shield
  ring appears around the core. "We catch it before it reaches shore."

**Reference artifact:** `G1f-with-stats.html` (the approved prototype). This is
the source of truth for the visual + interaction direction. The build should
match its look & feel, not reinvent it.

### Design tokens (from the prototype)
- **Fonts:** Chakra Petch (display/headings), IBM Plex Mono (labels, data,
  technical chrome).
- **Palette:**
  - `--abyss #020a0e`, `--deep #04161c` (backgrounds)
  - `--sonar #1ee0b0` (safe / brand primary), `--sonar-d #0e7a60`
  - `--amber #ffcf5c` (moderate / warning score)
  - `--red #ff5a6e` (unsafe / breached score)
  - `--foam #dcfff5` (text), `--muted #6a9b92` (secondary text)
- **Motion language:** slow, controlled, deliberate. Sweep ~4.5s rotation.
  Threats drift/lock/neutralize, never explode. Subtle shore-water waves at
  bottom (opacity 5-7%). Restraint is the rule — this is a security tool, not
  an arcade game.
- **Layout (desktop):** "cockpit" — radar left (sticky, grows with scroll),
  scan card fixed right, rotating stat block under the scan card. "Scan a
  protocol" is ALWAYS visible.

### Responsive strategy (decided — own mobile design, not squeezed desktop)
Mobile gets a PURPOSE-BUILT vertical design, not a shrunk cockpit. Reference
artifact: `mobile-radar-story.html` (approved prototype).
- **Scan form is top and prominent** — a mobile visitor reaches the scan action
  within the first screen (that's why they came).
- **One sticky radar** sits on its own layer ABOVE the text (higher z-index)
  with an opaque-to-transparent backdrop, so the story text scrolls UP and
  disappears BEHIND the radar rather than overlapping it. The radar stays in
  place and changes phase as the text beats scroll past — same single-radar
  scrollytelling as desktop, but stacked vertically instead of side-by-side.
- The contagion scoring + colours are identical to desktop (one shared model).
- Stats fold into the per-beat statline rather than a separate block.
- The radar DEGRADES gracefully (simplifies); it is never a tiny shrunk copy of
  the desktop radar, and the narrative is never sacrificed to fit.
- Build implication: Phases B and C must treat mobile as a first-class layout
  with its own composition, sharing the radar COMPONENT and the scoring model
  but not the cockpit grid.

---

## 2. The scoring model (load-bearing — drives both UI and backend)

The contagion animation visualizes a real scoring rule that Plan 04 must make
real, not just animate:

**A node inherits the WORST score among itself and its dependencies.**
- Scores ordered: SAFE (green) < MODERATE (amber) < UNSAFE (red), worst wins.
- A red dependency makes its dependent red. An amber dependency makes its
  dependent at-least-amber. A purely-green dependency chain stays green.
- **Contagion flows UP the dependency edges** (toward what relies on the node),
  NOT sideways to siblings. Sibling branches keep their own score.
- The PRIMARY (your protocol) inherits the worst score across its entire
  reachable graph. One unsafe dependency anywhere in the chain → PRIMARY unsafe,
  regardless of how clean the primary's own code is.

This must be reconciled with Plan 03's existing composite scoring
(`deriveContractStatus`, the protocol composite in `scan-response.ts`). Plan 03
used "any FAILED → FAILED" at the module level within a contract. Plan 04
extends the same worst-wins philosophy ACROSS contracts in the graph. **A design
task in Phase A is to confirm whether the existing composite already implements
graph-level worst-wins, or whether it only aggregates within a single contract's
modules — and to specify the gap precisely before building.**

> DRIFT GUARD: if the existing Plan 03 composite scoring contradicts the
> worst-wins-up-the-graph rule described here, STOP and reconcile in the spec
> before implementing. The animation promises a scoring behaviour; the backend
> must actually deliver it or the product lies to the user.

---

## 3. Scope

### In scope
1. A design system (tokens, base components) derived from the prototype.
2. The landing page rebuilt as the sonar/contagion scroll narrative with REAL
   data feeding the stats.
3. The multi-Contract input path: a UI to submit a primary contract plus
   related contracts with roles, feeding `submitScan({ relatedContracts })`.
4. The scan-result graph visualization: a user's real scan rendered as the
   exposure graph with the worst-wins scoring made visible.
5. `scripts/populate-curated-demos.ts` (the never-written Plan 03 follow-up) so
   the curated demos render as real multi-Contract scans.

### Out of scope (explicitly deferred)
- Auth / accounts / saved scans (unless already present; not a Plan 04 concern).
- Continuous monitoring / alerting (the "continuous" in the copy is aspirational
  for now; this plan is about scan-on-demand + the graph).
- Mobile-perfect parity of the radar animation (graceful degradation is fine;
  the radar may simplify or hide on small screens as the prototype does).
- Retiring the dead Plan 03 code (backfill script, filterFindings) — separate
  cleanup, can ride along but is not gated by this plan.

---

## 4. Phases

Each phase ends with a Codex review before merge, same as Plan 03. Robert
pushes manually. Each phase must produce a visible change (anti-"looks-the-same"
rule).

### Phase A — Design system foundation
- Extract the prototype's tokens into the app's styling system (Tailwind config
  / globals.css `:root` vars). Fonts, palette, motion primitives.
- Build the base shell: header, the dark abyss background, the shore-water
  component, typography scale.
- Reconcile the scoring model (§2): audit existing composite scoring, write down
  precisely how graph-level worst-wins maps onto it, flag any gap. NO scoring
  code change yet — just the spec'd reconciliation + a failing/pending test that
  encodes the intended rule.
- **Visible result:** the app adopts the new colour/type/background system even
  before new features land.

### Phase B — The radar component
- Build the sonar scope as a real, reusable React component: rings, sweep,
  blips with ATC labels, edges, the score-colour states (green/amber/red),
  lock + neutralize + heal transitions, shield ring.
- Driven by a data model: `{ nodes: [{id,label,role,score,deps}], edges }`.
  The component renders any graph, not just the hardcoded demo.
- Unit/interaction tests for the scoring-colour mapping (worst-wins) at the
  component level — this is where §2's rule first becomes executable code.
- **Visible result:** the radar renders from data, reusable for both the
  landing story and real scan results.

### Phase C — The landing page
- Compose Phase B's radar + the scroll narrative (5 beats) + the fixed scan
  card + the rotating stat block.
- Wire the stats to REAL data (the production counts: scans, contracts,
  module runs already exist; add value-scanned + hacks-indexed if data exists,
  else clearly mark as placeholder and track).
- Scroll-driven phase advancement (IntersectionObserver, as prototype).
- Build BOTH layouts: desktop cockpit (`G1f-with-stats.html`) and the mobile
  vertical design (`mobile-radar-story.html`) per the responsive strategy in §1.
  Mobile is not an afterthought — it ships with this phase.
- **Visible result:** the new landing page is live, telling the story, on both
  desktop and mobile.

### Phase D — Multi-Contract input path  ← THE HEADLINE GAP
- The scan form gains a progressive-disclosure multi-Contract mode:
  - Default: single address (today's behaviour) — unchanged for the common case.
  - Expand: "add related contract" → address + role selector
    (PROXY_IMPLEMENTATION, DECLARED_MULTISIG, TIMELOCK, TOKEN_CONTRACT,
    DECLARED_BRIDGE, RELATED — the Plan 03 roles).
  - The toggle should make single-OR-multi feel effortless (Robert's stated
    interaction: "kies voor 1 contract maar ook heel makkelijk voor beiden").
- Validation: address format, role required per related contract, dedupe.
- Wire to `submitScan({ relatedContracts })` — the backend that ALREADY EXISTS
  from Plan 03. This phase is the UI + wiring, not new backend execution.
- **Visible result:** a user can finally start a multi-Contract scan from the
  app. The gas pedal exists.

> DRIFT GUARD: Phase D must use the EXISTING submitScan multi-Contract path
> unchanged. If the UI reveals a missing capability in the backend, STOP and
> spec it — do not silently extend the executor in a UI phase.

### Phase E — Scan-result exposure graph
- A completed scan renders its real protocol graph using Phase B's radar
  component: the user's contracts as blips, real scores, the worst-wins
  contagion colouring, the per-contract / per-module detail on interaction.
- This is where the landing-page promise pays off: the same visual that sold
  the story now shows the user's actual exposure.
- **Visible result:** scan results look like the radar story, with real data.

### Phase F — Curated demos populated
- Write `scripts/populate-curated-demos.ts` (consumes `CURATED_DEMO_GRAPHS`,
  calls submitScan with the Aave/Uniswap related contracts against real
  RPC/Etherscan/Safe). Run it so the curated demos are real multi-Contract
  scans that render in the new graph.
- **Visible result:** /demo/ pages show real multi-Contract exposure graphs.

---

## 5. Sequencing rationale

Design-first (A→B→C) before input (D) before result-rendering (E) is deliberate:
- The radar component (B) is shared by both the landing story (C) and the real
  results (E) — build it once, use it twice.
- The input path (D) is built ON the new design, never on the old one — no
  build-then-rebuild.
- Demos (F) come last because they exercise the full chain (input → execution →
  result graph) end-to-end, doubling as the integration smoke that Plan 03's
  NOTES.md flagged as missing.

---

## 6. Open questions (resolve before/with Phase A)

1. **Scoring reconciliation (§2):** does Plan 03's composite already do
   graph-level worst-wins, or only within-contract? (Phase A audit.)
2. **Stat data availability:** which of the four landing stats (contracts
   scanned / graph contracts mapped / value scanned / hacks indexed / 12-month
   loss total) are backed by real data, and which are placeholder? Placeholders
   must be visibly tracked, not silently shipped as if real.
3. **"Continuous" copy:** the prototype says "continuous threat detection" and
   "sonar active · listening". Scan-on-demand doesn't yet match that. Either
   soften the copy for now or scope a follow-up — do not imply a capability
   that doesn't exist.

---

## 7. Non-negotiables (carried from Plan 03 working style)

- Spec frozen on a commit before build; implementation plan lives on the branch.
- Codex adversarial review per phase before merge.
- Robert pushes manually; prod mutations are Robert's hand on the keyboard.
- One scope per phase; each phase produces a visible change.
- DRIFT GUARDS (§2, Phase D) are STOP-and-reconcile points, not suggestions.
