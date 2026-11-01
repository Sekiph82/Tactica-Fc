# TACTICA FC design system

## Brand and theme

Use the Black Metal identity across the manager interface: near-black and graphite surfaces, brushed-silver text, and stadium red for selection, focus, and primary actions. Match status colors remain semantic: green for positive, amber for caution, and red for negative or urgent states.

The Open Football web interface defines these shared tokens in `vendor/open-football/src/web/assets/static/css/style.css`. Prefer semantic tokens in new components so a theme adjustment stays consistent:

| Role | Token | Current value |
| --- | --- | --- |
| Page background | `--bg` | `--tactica-black` (`#08090c`) |
| Secondary background | `--bg2` | `--tactica-graphite` (`#111318`) |
| Panel | `--surface` | `--tactica-panel` (`#191b20`) |
| Raised panel | `--surface2` | `--tactica-panel-raised` (`#22252b`) |
| Main text | `--text` | `--tactica-silver` (`#d8d9dc`) |
| Muted text | `--muted` | `--tactica-muted` (`#9b9da4`) |
| Selection and focus | `--accent` | `--tactica-red` (`#e32832`) |
| Strong accent | `--accent2` | `#f0525b` |
| Positive / caution / negative | `--good` / `--mid` / `--bad` | green / amber / red |

Keep player kit colors, club colors, pitch markings, and match-event semantics independent of the interface theme. Do not use the old navy/cyan shell palette for new TACTICA FC management screens.

## Shared component rules

- Reuse the shared button, form control, `.fm-panel`, `.fm-header`, `.fm-submenu`, `.fm-tabs`, and table patterns before adding screen-specific styling.
- Use `--accent` for selected, focused, and actionable states; reserve `--good`, `--mid`, and `--bad` for status.
- Use `--control-height`, `--radius-control`, `--radius-card`, and `--radius-pill` to keep controls and panels consistent.
- Keep dense squad, transfer, and fixture tables compact and horizontally scrollable on narrow layouts.
- Keep the pitch visually dominant on matchday. Do not place lineup or ratings panels over the live pitch; show ratings and condition in their separate views.
- Maintain readable contrast, visible keyboard focus, and touch-sized controls on laptop and mobile layouts.
