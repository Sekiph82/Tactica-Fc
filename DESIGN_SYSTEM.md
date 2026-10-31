# TACTICA FC design system

## Brand and themes

- The default interface uses deep navy surfaces with cyan and teal accents, matching the TACTICA FC matchday identity.
- `--brand-cyan` and `--brand-teal` are product brand colors. Keep them stable when a manager chooses a club theme.
- `--accent` and `--accent2` are semantic interface accents. Club themes may override them; controls, focus states, and selection states should use these semantic tokens.
- Light and dark themes share the same semantic roles. Keep text and controls legible in both.

## Shared tokens

- Surfaces: `--bg`, `--bg2`, `--surface`, `--surface2`, and `--surface3`.
- Content: `--text`, `--muted`, `--faint`, `--good`, `--mid`, and `--bad`.
- Spacing: `--space-1` through `--space-6` (4px through 24px).
- Controls: `--control-height` and `--radius-control`.
- Cards and overlays: `--radius-card`, `--radius-pill`, `--shadow`, and `--shadow-popover`.
- Typography: `--font` for interface text and `--mono` for data that benefits from fixed-width alignment.

## Component rules

- Reuse the shared button, form control, `.panel`, `.screen-head`, `.tabs`, and `table.grid` patterns before adding screen-specific styling.
- Use semantic accent tokens for selected, focused, and actionable states; reserve status tokens for positive, caution, and negative feedback.
- Keep dense management tables compact and horizontally scrollable on narrow layouts. Let the pitch remain visually dominant on matchday.
- Do not place lineup or rating panels over the live pitch. Ratings and condition belong in their existing separate views.
