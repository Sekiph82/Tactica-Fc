# Open Football match viewer source

This directory contains the match viewer and its shared crate copied from
[`ZOXEXIVO/open-football`](https://github.com/ZOXEXIVO/open-football) at commit
`9741ee9e2c7321b080676a5910e246b83fcd1430`.

The upstream project is licensed under Apache License 2.0. Its full license
text is retained in `LICENSE`. TACTICA FC uses the upstream match viewer for
rendering and playback, while TACTICA's MatchSim remains authoritative for
match events and outcomes.

TACTICA integration changes add embedded-display configuration, inline
recording bootstrap and append APIs, and a host playback control API. The
`tactica_stage` example builds and optimizes the viewer WASM for the web app.
TACTICA continuously maps MatchSim player/ball snapshots into the viewer's
recording format so play keeps moving between narrated highlights. TACTICA's
commentary still controls the match text and event decisions; routine movement
does not create extra narration. The embedded UI hides the viewer's duplicate
clock, scoreboard, timeline, and transport controls so TACTICA can present its
own match controls.

This copy is limited to the viewer, its build helper, fonts, and shared
presentation data; it does not include Open Football's simulation engine or
football database. The upstream application is not copied wholesale.
