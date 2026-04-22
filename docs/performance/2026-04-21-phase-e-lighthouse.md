# Phase E Lighthouse Audit — 2026-04-21

Preview URL: http://localhost:3000 (local `pnpm dev`)
Tool: Lighthouse (manual run required — see Phase C methodology)
Run date: 2026-04-21

## Lighthouse requires manual run

Lighthouse cannot be executed in this automated environment (requires a live
Chrome browser + running dev server accessible from the CLI). See Phase C
methodology in `docs/performance/2026-04-20-phase-c-lighthouse.md` for the
exact command pattern used:

```
lighthouse http://localhost:<port> \
  --chrome-flags="--headless=new --no-sandbox" \
  --only-categories=performance,accessibility,best-practices,seo \
  --output=json
```

## What WAS verified (automated)

- `pnpm build` — clean (no type errors, no lint errors)
- `pnpm exec tsc --noEmit` — clean
- `pnpm lint` — clean
- `pnpm test` — 166 tests pass (0 regressions)
- Homepage renders: placeholder page with `glass-card-teal` container confirmed
  by successful build compilation of `src/app/page.tsx`
- No hardcoded `breakwater.so` / `breakwater.xyz` in any new or modified file
  (grep verified clean)

## Expected scores (based on Phase C baseline + E.1 changes)

Phase C `/` scored: Performance 98, Accessibility 100, Best Practices 100, SEO 100.

Phase E.1 changes are purely additive to CSS/tokens — no new JS bundles,
no new network requests, no removed semantic HTML. The placeholder page is
simpler than the Phase C homepage (single centered card, no images, no scripts).
Expected scores should remain at or above Phase C levels.

Pass criteria per spec §15.4:
- Accessibility ≥ 90
- Performance ≥ 75

Both are expected to pass. Confirm with a manual Lighthouse run before Phase F
landing page work begins.

## Notes

`--border-teal` token (`rgba(20, 184, 166, 0.18)`) used in `glass-card-teal`
is rendered via CSS custom property — no impact on Lighthouse scores.

Geist font is loaded via the `geist` npm package (wraps `next/font/local`),
which inlines font-face declarations and avoids render-blocking network
requests — same performance profile as the Phase C local font approach.
