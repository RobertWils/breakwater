# Breakwater Design System

Design tokens live in src/styles/tokens.css. Tailwind config exposes them as classes.

## Colors

- `bg-base`, `bg-elevated` — backgrounds
- `bg-storm-gradient` — main body gradient
- `text-primary`, `text-muted` — text colors
- `teal` (accent), `sky` (secondary accent)
- `sev-{critical|high|medium|low|info}` — severity scale
- `grade-{a|b|c|d|f}` — grade scale (same values as severity)

## Typography

- `font-sans` — Geist Sans (body, headlines)
- `font-mono` — Geist Mono (detector IDs, addresses, code)
- Weights: 400, 500, 600, 700 sans; 400, 500 mono

## Glass card pattern

Two variants:
- `.glass-card` — standard border
- `.glass-card-teal` — teal glow border for emphasized cards

Both have: glass-surface bg, 12px blur, 12px radius.

## Spacing

Rely on Tailwind defaults (4px scale). No custom spacing tokens in Plan 01.

## Breakpoints

Rely on Tailwind defaults. No custom breakpoints in Plan 01.

## Not-yet-defined (reserved for Plan 02+)

- Motion tokens / easing curves
- Shadow scale
- Icon system
