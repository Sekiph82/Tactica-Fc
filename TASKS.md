# TACTICA FC implementation tracker

This file is the single source of truth for milestone status. Mark work complete only after the stated evidence has been collected. “Partial” means the capability exists in CM Reborn but does not yet meet the TACTICA FC objective.

## TFC-M01: Repository audit and baseline — COMPLETE

- [x] Inspect canonical workspace and locate the app, database, match engine, saves, UI, tests, and platform configuration.
- [x] Confirm original `CM0102.iso` and `SI-Games-Patch-v3.9.68.exe` remain in the workspace parent and are not part of the app tree.
- [x] Document current engine architecture in this tracker: `MatchSim` advances deterministically in moments; the UI consumes snapshots and commentary, while `MatchReport` stores outcomes and statistics.
- [x] Install locked npm dependencies using `npm ci` inside `Tactica FC`.
- [x] Run baseline production build: `npm run build` passed. Vite reports one ineffective dynamic import and a 1.78 MB minified JS chunk.
- [x] Complete baseline `npm test`: 9 test files passed, 58 tests passed (55.23 seconds).
- [x] Verify the core singleplayer flow in a browser: created a new 2025/26 career, selected Liverpool, advanced to the first fixture, and started the live 2D match. Confirmed scoreboard, live clock, pitch and match tabs rendered.
- [x] Audit PWA/platform readiness, data licensing/attribution, and current product-facing CM Reborn branding. PWA is configured; no Electron or Capacitor projects are present. README attributes modern data to CC0 transfermarkt-datasets and code to MIT; additional asset review remains a later task. Product-facing CM Reborn labels and English/Danish-only localization are confirmed.
- [x] Attempt the existing full Playwright smoke script. It could not launch because the Chromium executable is not installed; the live career/match path was instead verified in the available in-app browser.

## TFC-M02: Rebranding and architecture — IN PROGRESS

- [x] Replace the primary product-facing CM Reborn branding with TACTICA FC while preserving MIT and third-party notices. Historical changelog entries and the current hosting URL are retained pending deployment ownership decisions.
- [x] Update the browser title, social metadata, PWA manifest, npm package identity, start-screen logo, footer, support/about/share strings, and fallback notification identity to TACTICA FC.
- [x] Make Turkish the default locale and add a complete Turkish dictionary while retaining English and Danish.
- [x] Define shared `MatchPitchSnapshot` and `MatchVisualAction` data contracts so the renderer can consume engine state through types instead of importing `MatchSim` internals.
- [x] Move career-save IndexedDB access, remembered-career preferences, and save-file download behavior behind `src/platform` adapters; keep browser implementations in `src/platform/browser.ts`.
- [ ] Keep shared game logic independent of platform-specific storage and input APIs.
- [ ] Confirm the existing React/Vite/PWA foundation before adding renderer or desktop/mobile dependencies.

## TFC-M03: 2D football pitch renderer — COMPLETE

- [x] Existing `src/ui/Pitch2D.tsx` renders a responsive SVG pitch, markings, goals, players, ball, weather, and set-piece layouts.
- [x] Replace marker-like player shapes with upright, full-body transparent player sprites. Use two visually distinct outfield players per kit and contrasting lime/orange goalkeeper kits, scale figures by pitch depth, face teams toward their attacking direction without laying figures sideways, and keep readable shirt numbers and holder highlighting layered above them.
- [x] Add a readable three-frame running loop driven by player movement between consecutive pitch snapshots; keep the upright full-body sprite as the standing pose and add subtle idle breathing.
- [x] Sequence the existing three-frame upright run atlas during cross and long-ball actions; these visual-only pose cycles leave match simulation unchanged.
- [x] Add original, kit-matched short/through-pass, shot, upright tackle, and celebration poses with standing-to-action transitions; reduced-motion mode shows the selected static pose.
- [x] Blend the goalkeeper's standing kit into the dive pose on saves/goals, then return to the upright kit when a held save is recorded.
- [x] Add original kit-matched long-ball and cross poses with standing-to-action transitions; reduced-motion mode shows the selected static pose.
- [x] Render actions and the matching snapshots captured from a fixed-seed `MatchSim` game in a browser fixture; visually inspect the engine-generated long-ball and cross events.
- [x] Inspect the primary `MatchScreen` in a separate-origin QA career at 4×, confirming the scoreboard clock follows the queued event minute and both goals/player figures remain visible.
- [x] Verify ordinary-action queue pacing and pose timing across speeds and through a complete live match. A live Liverpool–Leeds QA match ran at 1×, 2×, 4× and 8× to full-time; scoreboard and pitch clocks stayed aligned. The pitch retained 22 upright players, both goals, and no side roster panels. The match ended 0–1 with a matching report; details and the 8× backlog fix are recorded in `design-qa.md` (2026-10-30).
- [x] Add an optional ball-follow camera with a one-step return to the full-pitch default; the control only changes the view, not the simulation.
- [x] Improve pitch detail, goals/nets, and desktop/mobile readability with shaded, meshed SVG goal structures and compact small-screen match overlays; visually inspect 1280px and 390px browser layouts.
- [x] Provide a deterministic `Pitch2D` renderer fixture with 22 players, two goalkeepers, a ball, a running sprite loop, and ball-path animation markup.
- [x] Keep frame timing and rendering out of the simulation RNG and result calculation; fixed-seed engine reports remain identical with visual recording enabled or omitted, and the live presentation interval only drains queued events.

## TFC-M04: Match engine visual integration — IN PROGRESS

- [x] Existing `MatchSim.step()` supports live deterministic progression; simulation events, shots, tactical changes, and pitch snapshots are exposed to the UI.
- [x] Add an opt-in live-only visual action timeline with match moment/minute, actor, optional recipient/defender, zone-space endpoints, action kind, and outcome.
- [x] Add a regression check that recording visual actions leaves the exact match report unchanged for a fixed seed.
- [x] Connect the latest authoritative pass/cross/dribble/shot action to an SVG ball path animation on the live match pitch.
- [x] Sequence all recorded ordinary-play actions produced between live UI updates; replay highlights temporarily take over the pitch and then ordinary play resumes.
- [x] Pair every queued action with the `MatchSim.pitch()` snapshot captured immediately after the same engine step, so queued actors, recipients, ball paths, and event time remain tied to their event-time layout.
- [x] Record historical open-play actor and recipient positions from the same deterministic formation layout used by the renderer; targetless actions and explicit shots keep their ball/goal endpoints. Routine passes select a presentation-only receiver from existing zone weights (no RNG or outcome changes).
- [x] Record deterministic historical player centers and separate ball start/end positions from the shared pitch layout for each visual action; explicit shot/cross endpoints remain authoritative.
- [x] Record engine-resolved goalkeeper parries and post rebounds as separate events from the shot, with ball travel from the saved/post point to the selected rebounder.
- [x] Record keeper-held saves and keeper deflections that produce a corner; start the resulting corner delivery at the flag point.
- [x] Record blocked-shot and failed-cross defender contacts as deflections to a defender's controlled ball point or a corner flag.
- [x] Record a keeper distribution from the held-ball point to the actual next carrier chosen by the match engine.
- [x] Carry unclaimed-ball turnovers into the next engine-selected carrier, including continuity from the actual preceding ball endpoint.
- [x] Record goal-kick restarts after shots/post hits go out, from the goalkeeper's ball point to the next engine-selected carrier, without adding random draws or changing the match report.
- [x] Model engine-resolved open-play goalkeeper clearances when the team uses Long passing; resolve the target and result through the existing long-ball simulation and preserve the held-ball visual origin.
- [x] Audit remaining unowned-ball transitions not covered by saved, rebounded, deflected, goal-kick, or unclaimed-ball paths.
- [x] Render ordinary live actions alongside the existing highlight sequences; verify ball travel is driven by the recorded engine action and formation movement remains interpolated between snapshots.
- [x] Preserve deterministic score/event/RNG behavior when visual recording is enabled or omitted; fixed-seed reports compare equal with the optional timeline removed.
- [x] Add regression coverage for pass endpoint consistency, shot outcomes against the recorded shot report, and unchanged score/event reports.
- [ ] Resolve and visually verify live-action backtracking/stutter across pass interceptions, failed dribbles, and shot/rebound sequences.
- [ ] Use CM 2010 as a gameplay reference: implement ordered player/ball movement paths, support runs/feeds, defensive reactions, and ball-follow framing with original TACTICA assets; do not reuse proprietary ISO assets.
- [ ] Continue CM2010 static reverse engineering far enough to identify the match simulation-to-renderer event boundary, or document the protection barrier if the binary cannot be decoded offline (`docs/cm2010-static-analysis.md`).
- [ ] Exercise Open Football's selected-league simulation through a live save; confirm only selected competitions dispatch matches and document that unselected competition schedules remain paused while world dates advance.

## TFC-M05: Live tactical interaction — COMPLETE

- [x] Existing match screen exposes tactics, substitutions, and stoppage/half-time interactions.
- [x] Add deterministic engine regressions showing a live formation change rebuilds player zones and updates the next 22-player pitch snapshot without changing player identities.
- [x] Add deterministic engine regression showing a substitution updates the active slot, tactic lineup, bench, event timeline, pitch kit/number identity, and final player report.
- [x] Verify both changes through the live browser controls and visually confirm the updated formation and incoming player's kit/number on the rendered pitch.

## TFC-M06: Match interface and polish — COMPLETE

- [x] Existing match screen includes scoreboard, clock, controls, statistics, commentary, match events, and tactical controls.
- [x] Remove side lineup/rating panels from the live pitch; keep player ratings and condition details in their separate match and squad sections so both goals remain visible.
- [x] Add match-view-scoped fallback styles for legacy lineup/roster panel variants so they cannot cover the goals; preserve on-pitch player name labels and reduce rain streak contrast and density further.
- [x] Reduce rain overlay density and opacity so weather stays visible without obscuring players, pitch markings, or goal areas.
- [x] Make the animated pitch the permanent primary match view; retain commentary as a supplemental panel, not an alternative viewing mode.
- [x] Add a ball-follow camera toggle while keeping full pitch and both goals as the default view.
- [x] Improve responsive scoreboard and matchday visual polish; compact the live score, clock, team names, and crests for narrow widths without collisions (checked at 390px and 320px).
- [x] Inspect the revised rain effect in a match whose actual weather is rain or heavy rain using an isolated MatchSim run with `weather: 'rain'`; verify the pitch overlay remains visible without obscuring the field.
- [x] Verify one complete match from kick-off through full-time in the live viewer, including halftime talk and the post-match report (manual browser QA career, 9 August 2025; Liverpool 1–1 West Ham).

## TFC-M07: Management UI modernisation — IN PROGRESS

- [x] Add Turkish to the language type, language selectors, community language metadata, AI text requests, and locale-aware number/date formatting; add a starter Turkish dictionary for common, start, navigation, and match strings with English fallback.
- [x] Translate all landing-page, new-career, options, top-bar, match, tactics, team/player instructions, player profile, player attributes, chemistry, staff roles, table headings, and status-tag keys into Turkish.
- [x] Translate and review the transfer, offer, bid, clause, loan, enquiry, contract, signing, negotiation, and agent UI keys into Turkish; total coverage is now 794 / 4,192 English keys.
- [x] Translate staff management, scouting, finance, board budget, club information, and inbox news keys into Turkish; total coverage is now 997 / 4,192 English keys.
- [x] Translate board confidence and expectation messages, training schedules, job-centre workflows, and youth intake news into Turkish; total coverage is now 1,145 / 4,192 English keys.
- [x] Translate first-day onboarding, manager rankings, achievements, and trophy celebrations into Turkish; total coverage is now 1,326 / 4,192 English keys.
- [x] Translate the in-game help articles for reputation, board confidence, fans, player management, finances, transfers, scouting, press, and rankings into Turkish; total coverage is now 1,375 / 4,192 English keys.
- [x] Translate the 87 press-conference question prompts into Turkish; total coverage is now 1,462 / 4,192 English keys.
- [x] Translate the 231 press-conference reply options into Turkish; total coverage is now 1,693 / 4,192 English keys.
- [x] Translate manager press responses, journalist reactions, and effect labels into Turkish; total coverage is now 1,740 / 4,192 English keys.
- [x] Translate all remaining press-conference titles, tone descriptions, promises, progress text, and headlines; all 425 `press.*` keys are now covered, with total Turkish coverage of 1,800 / 4,192 English keys.
- [x] Translate player complaints and negotiations, team talks, and one-to-one player talks; total Turkish coverage is now 1,969 / 4,192 English keys.
- [x] Translate match commentary, highlights, team statistics, and match reports; total coverage is now 2,172 / 4,192 English keys.
- [x] Translate fixtures, league tables, competition summaries, manager performance, attendance, facilities, and dropped-lead analysis; total coverage is now 2,284 / 4,192 English keys.
- [x] Translate player unrest, trial periods, sponsorship, transfer-window, rejected-offer dialogue, and manager promises/personality; total coverage is now 2,428 / 4,192 English keys.
- [x] Translate transfer-market search/filter labels, scouting report descriptors, and board confidence/request workflows; total coverage is now 2,601 / 4,192 English keys.
- [x] Translate tactical analysis, attribute abbreviations, player traits, team talks, season stories, manager history, scouting recommendations, club records, weekly summaries, rivalries, and competition rounds; total coverage is now 2,810 / 4,192 English keys.
- [x] Translate fan sentiment, transfer bidding wars, training camps, club projects, transfer realism, player rehabilitation, and opposition instructions; total coverage is now 3,018 / 4,192 English keys.
- [x] Translate database import, draft-mode landing content, inbox categories, weather, public profiles, manager comparisons, supporter information, and AI managers; total coverage is now 3,258 / 4,192 English keys.
- [x] Translate the Draft League room, draft picks, auction flow, season summaries, and expert ratings; total coverage is now 3,474 / 4,192 English keys.
- [x] Translate the manager chat, AI banter, and transfer conversations; total coverage is now 3,579 / 4,192 English keys.
- [x] Translate online multiplayer setup, readiness, turn simulation, live head-to-head matches, and deadline/autopilot messages; total coverage is now 3,675 / 4,192 English keys.
- [x] Translate the community suggestion board, categories, statuses, voting, comments, and error messages; total coverage is now 3,742 / 4,192 English keys.
- [x] Translate the assistant lineup/benchmark tools and press-war exchanges; total coverage is now 3,784 / 4,192 English keys.
- [x] Translate monthly/season awards, counter-offer negotiation, and all career challenges; total coverage is now 3,834 / 4,192 English keys.
- [x] Translate public manager profiles, friendly matches, transfer-history filters, finance forecasts, and match-performance insights; total coverage is now 3,902 / 4,192 English keys.
- [x] Translate injury labels, manager head-to-head records, match stats, award news, inbox settings, and player development; total coverage is now 4,028 / 4,192 English keys.
- [x] Translate all remaining 164 keys and review the complete English dictionary; coverage is 4,193 / 4,193 English keys after adding the localized pitch accessible name.
- [x] Establish shared TACTICA FC design tokens for brand colors, semantic accents, spacing, control sizing, radii, and elevations; document theme/component rules in `DESIGN_SYSTEM.md`.
- [x] Make the deep navy TACTICA FC theme the default for installations without a saved theme preference; preserve explicit saved theme selections.
- [x] Apply the shared design system to the dashboard inbox feed: keyboard-operable message buttons, clear selected/unread states, aligned date/icon columns, and responsive text wrapping.
- [x] Remove the pre-match first-XI/condition list; keep formation/mentality context, the tactics link, and the separate ratings section while hiding legacy side-roster overlays above the pitch.
- [x] Move the 2D pitch accessible name into English, Danish, and Turkish localization dictionaries.
- [x] Add localized player-name search and goalkeeper/defence/midfield/attack filters to the squad table, including a no-results state. In the 2027 Fulham career UI, the goalkeeper filter reduced 23 players to one (Alfie McNally); accent-insensitive search for `jimenez` found Raúl Jiménez; clearing filters restored all 23 (`design-qa.md`, 2026-10-30).
- [ ] Apply the design system while modernising the main menu, career setup, dashboard, squad, player, tactics, transfers, fixtures, and results.
- [x] Add Turkish as the default interface locale and preserve English and Danish.
- [ ] Move user-visible strings into the existing localisation architecture.
- [ ] Verify the core manager workflows use real shared game state.

## TFC-M08: Career integration and saves — PARTIAL

- [x] Existing game includes modern 2025/26 data, competitions, transfers, player development, finances, and IndexedDB-backed save/import/export code.
- [x] Audit and implement versioned local/exported save snapshots with legacy-read support and atomic payload-plus-metadata records.
- [x] Add compatibility coverage for legacy unwrapped saves, current versioned saves, malformed payloads, and unsupported future versions.
- [x] Fault-inject a rejected platform-store replacement and verify the previously committed save remains intact and listed.
- [x] Retry failed autosaves with capped exponential backoff while the career stays open.
- [x] Abort a real browser IndexedDB replacement transaction and verify both the previous payload and metadata remain intact.
- [x] Run two seasons headless and verify archived seasons and retained match reports survive a versioned save/load round-trip.
- [x] Verify multi-season IndexedDB save/load progression through the UI after match changes. The in-browser QA fixture advanced a cloned Fulham career from 2025-08-09 through 2027-07-02, saved and reloaded its versioned record, matched the save-list metadata, and the normal app auto-resumed the saved career in a separate in-conversation tab; then the actual `Oyunu kaydet` UI button showed its success toast, the updated save appeared at the top of the load list, and selecting it restored the normal app header at 2 July 2027. Two archived seasons and 40 match reports were retained (`design-qa.md`, 2026-10-30).
- [x] Add safe migration coverage for the versioned save envelope introduced by this work.

## TFC-M09: Windows release — NOT STARTED

- [ ] Select and configure a secure Electron wrapper if compatible with the existing app.
- [ ] Build and launch a Windows desktop package; verify offline singleplayer, match viewing, and career saves.

## TFC-M10: Android release — NOT STARTED

- [ ] Configure Capacitor Android with touch-friendly layout and lifecycle-safe local saves.
- [ ] Build a debug APK and verify runtime behavior where facilities permit.
- [ ] Document signing prerequisites for any AAB release.

## TFC-M11: iOS preparation and release — NOT STARTED

- [ ] Prepare a Capacitor iOS project and validate platform-independent behavior on Windows.
- [ ] Document outstanding macOS/Xcode, signing, and device validation requirements.
- [ ] Do not claim native release validation without an appropriate Apple build/runtime environment.

## TFC-M12: Final QA and optimisation — NOT STARTED

- [ ] Run automated engine, event/render mapping, save/load, navigation, and regression checks.
- [ ] Measure rendering performance on available targets and distinguish desktop measurements from physical mobile-device results.
- [ ] Record per-platform evidence and unresolved release blockers.

## Baseline environment notes

- Canonical app path: `C:\Users\sekip\Desktop\GAMES\other games and assets\cm0102\Tactica FC`.
- The workspace parent is not a Git repository; do not assume Git history or branch metadata is available.
- Initial `npm test` and `npm run build` attempts could not start because dependencies were absent. After `npm ci`, baseline tests and build passed as recorded above.
- Post-rebrand verification: `npm run build` passed; `npm test` passed (9 files, 58 tests, 36.87 seconds). Production output still warns about the ineffective dynamic import and ~1.78 MB minified bundle.
- Post-visual-timeline verification: `npm run build` passed; `npm test` passed (9 files, 59 tests, 37.23 seconds), including the deterministic report-equivalence check. Bundle warning remains (~1.78 MB, same ineffective dynamic import).
- Latest visual pass: opened the rebranded app at the Vite base path, confirmed TACTICA FC title, started Liverpool–West Ham in the refreshed SVG pitch, observed vector kit players and the animated ball during live play, completed both halves with a halftime team talk, and reached the 1–1 post-match report. This is manual desktop-browser evidence; it does not establish mobile layout or native-platform behavior.
- Latest visual-action queue update: the live UI now queues each new engine timeline entry between clock updates and presents them in order on an independent interval. `npm run build` passed; `npm test` passed (9 files, 59 tests, 36.44 seconds). Browser QA resumed the saved Liverpool career, started Liverpool–Sunderland, and observed the live clock advance through ordinary action commentary including a through ball while the 2D pitch remained active at the narrow in-app viewport. Separate historical ball-flight endpoints were added in the later update below.
- Follow-up build after keeping the action queue active through the full-time state also passed. The queue's presentation interval is independent of match speed/RNG and may finish presenting the final ordinary-play actions after the report appears.
- Match-screen follow-up: the animated pitch now stays mounted as the primary view while commentary, ratings, statistics, and tactics remain supplemental tabs. Full `npm test` passed (10 files, 67 tests); `npm run build` passed after the pitch persistence and scroll-to-top changes. Manual in-app browser inspection at a 604px viewport showed 22 upright players, both goals clear, zero lineup overlays, and the pitch still visible with Commentary selected. This test match reached full-time but was not continued into the career. A direct kickoff-from-scrolled-preview check remains open; desktop-width and mobile-device acceptance remain unverified.
- Display issue follow-up: the live renderer DOM in the current preview contains zero `.match-lineup` elements; the attached screenshot still shows lineup overlays, so it does not reflect the current preview DOM. Reduced rain and heavy-rain streak density/opacity again because diagonal weather lines were competing with the field and goal markings. The current browser session had heatwave weather, so the final rain appearance needs a rain-state visual check. After the final CSS-only change, `npm run build` passed with the same existing dynamic-import and large-chunk warnings.
- M05 browser-control verification: in an isolated in-app preview match paused at 1', switched Liverpool from 4-4-2 to 4-3-3, then compared the rendered SVG player transforms after switching back: 6 of 22 player positions changed. Substituted Wirtz for Jones; the pitch DOM showed Wirtz with shirt number 7 in Jones's slot, 22 total pitch players, and the available-sub count dropped from 5 to 4. Restored the test match to 4-3-3 and left it paused; no full-time result was committed. M05 control-to-render check is complete for this browser scenario; it does not establish all formations/device layouts.
- Upright player-art update: replaced the small pitch markers with six optimized transparent PNG sprites (two white-kit players, two striped-kit players, and lime/orange goalkeepers). The browser preview at `http://127.0.0.1:5180/cm0102-reborn/` showed 22 upright full-body players, varying sprite size with field depth and distinguishing kits and keepers. `npm run build` passed; existing dynamic-import and large-JavaScript-chunk warnings remain. See the scoped visual record in `design-qa.md`.
- Shared-layout endpoint update: `src/game/match-pitch.ts` now calculates the renderer's deterministic open-play positions and is used by both `Pitch2D` and `MatchSim` visual-event recording. Engine regressions assert recorded pass endpoints equal the event-time actor/recipient positions, every recorded shot action corresponds to a reported shot outcome, and enabling visual recording leaves fixed-seed reports unchanged. `npm run build` passed; `npm test` passed (9 files, 60 tests, 44.71 seconds). Manual in-app browser check observed the updated match screen at a narrow viewport during a live highlight. Reduced-motion preference suppresses the new player/ball action motion. These checks do not establish rendered animation quality across all physical devices.
- Player motion update: three-frame white-kit and striped-kit running atlases now loop inside a player-sized SVG clip, triggered by movement between consecutive snapshots and relevant live actions. Idle players retain the upright standing art with subtle breathing. Saved/goal shots addressed to a goalkeeper select the matching generated dive pose and transition it briefly. `npm run build` passed on 2026-10-29; existing ineffective-dynamic-import and large-JavaScript-chunk warnings remain. The temporary browser preview displayed upright players, then was left at half-time without selecting a team talk; this is not recorded as end-to-end running/dive animation visual acceptance. Complete multi-pose action and goalkeeper sequences remain open.
- Live tactics regression update (engine-only stage): `npm test -- tests/engine.test.ts` passed (15/15 tests), including fixed-seed formation/snapshot and substitution/report consistency cases. `npm run build` passed. The live visual control-to-render check was still open at that point and was subsequently verified in the M05 browser-control entry above.
- Ball-path endpoint update: each visual action now carries the deterministic layout ball origin and arrival point separately from the actor/recipient centers. The pitch animates from these held-ball/receiver positions, preserving explicit engine-supplied goal and cross targets; older timeline entries fall back to their existing center coordinates. `npm run build` passed and `npm test` passed (9 files, 60 tests), including assertions that recorded pass ball endpoints equal the corresponding deterministic source/receiver layout ball points and that visual recording does not alter the match report.
- Rebound event update: saved shots that the engine parries for an attacking rebound and shots that hit the post before an attacking rebound now add a second `rebound` timeline event from the engine-resolved save/post point to the selected attacker. The renderer animates the ball through the extra event and cues the receiver's run. A regression searches deterministic seeds for a rebound and verifies its contact origin, target data, finite ball endpoints, and equality of the resulting match report with visual recording disabled. `npm run build` passed; `npm test` passed (9 files, 61 tests). Held saves, goalkeeper clearances, blocked-shot deflections, and other loose-ball states remain open. This update has engine/test evidence but no new browser visual acceptance.
- Keeper recovery update: saved shots that the engine holds now record a keeper possession event to the keeper's historical ball point. A save diverted to a corner records a keeper deflection from the save point to the actual corner flag; the following corner cross begins at that same point. Deterministic-seed regressions cover held and corner outcomes and compare each visual report with the same seed without recording. `npm run build` passed; `npm test` passed (9 files, 62 tests). Keeper distribution/clearance, blocked-shot deflections, and other loose-ball states remain open. No browser visual acceptance was performed for this update.
- Defender contact update: blocked shots now terminate at the selected defender's historical position; a second `deflection` action carries the ball to the defender's control point or the corner flag. Blocked crosses use the defender's contact point and the resulting corner delivery starts from the flag. The transition is presentation-only and preserves the existing random branch order. `npm run build` passed; `npm test` passed (9 files, 63 tests), including seeded assertions that contact points chain between blocked shots/crosses and deflections, corner crosses continue from the flag, and reports match with visual recording disabled. Keeper distribution and other loose-ball transitions remain open. No browser visual acceptance was performed.
- Keeper distribution update: a goalkeeper who catches a shot or claims a cross retains a presentation-only held-ball point; when the engine chooses the next actual carrier, the timeline records a distribution from that exact stored point. The later clearance update adds a real Long-passing tactic branch; remaining loose-ball transition coverage stays open. The distribution regression compared fixed-seed reports with visual recording disabled.
- Player-facing and loose-ball update: upright player sprites now face their team's attacking direction while remaining vertically upright; away shirt numbers receive a counter-flip so they stay readable. Unclaimed turnovers (including offside restarts) now connect the prior actual ball endpoint to the next carrier chosen by the match engine. The seeded regression forces the offside instruction, checks exact endpoint continuity and confirms visual recording leaves the report unchanged. A 1536 × 1024 Edge session rendered a live match with 22 upright player groups, 22 sprites, the ball, and no console errors; one separate 4× session reached a long-ball action with a running sprite and SVG ball travel, while a repeat attempt timed out waiting for that action state. `design-qa.md` records scope and limits. `npm run build` passed; `npm test` passed (10 files, 65 tests). Keeper clearances and full multi-pose animation remain open.
- Renderer-fixture update: `tests/pitch-renderer.test.tsx` server-renders the real `Pitch2D` component twice from a fixed 22-player snapshot and asserts identical markup, 22 sprites, two goalkeepers, upright positive vertical scaling with both team facings, readable counter-flipped shirt numbers, the three-frame running loop, and SVG ball travel. The targeted test passed, then the full suite passed (10 files, 65 tests) and `npm run build` passed. Existing ineffective-dynamic-import and large-JavaScript-chunk warnings remain. The fixture validates component markup, not browser rasterization or visual acceptance.
- Goal-kick update: off-target shots and post hits that do not produce an attacking rebound now start a goal-kick possession with the engine's goalkeeper and record its release to the next carrier already chosen by the engine. The keeper action has its own upright kick cue and explicit `goalKick` outcome; no random branch or receiver selection was added. Seeded coverage includes saved, held, parried, corner, normal distribution, and goal-kick outcomes and compares each report with visual recording disabled. `npm test` passed (10 files, 65 tests) and `npm run build` passed. An Edge match observed `p2d-sprite-goal-kick` as the computed animation during a goal-kick event; the player element changed before a focused screenshot could be taken, so no visual pose acceptance is claimed.
- Pitch-clearance UI update: removed both live roster overlays from the field, preserving squad/rating tabs and the scoreboard, and made the normal/heavy-rain pattern thinner, less dense, and more transparent. A 1536 × 1024 Edge live-match screenshot with a temporary heavy-rain class showed 22 players, 22 sprites, one ball, zero lineup panels, both goal mouths visible, and no console errors. The screenshot and modified browser context were temporary; no image artifact was retained.
- The named pitch snapshot now preserves post-hit outcomes explicitly and is compiled/tested with the renderer consuming the shared type.
- `npm ci` reported 10 dependency audit findings (5 low, 1 moderate, 4 high) and a pending `esbuild` install script approval warning. No automatic dependency upgrades were applied.
- An existing `.github/workflows/deploy.yml` is present. No workflow was enabled or changed.
- Keeper-clearance update: open-play keeper claims now have a deterministic, engine-resolved chance to clear long when team passing is explicitly set to Long. The shared long-ball resolver selects the actual recipient and outcome, and the visual event starts at the stored keeper-held ball point. `npm test -- tests/engine.test.ts` passed (16/16), including a fixed-seed clearance and render-independence regression; the full `npm test` suite passed (10 files, 68 tests); `npm run build` passed. This does not close the separate audit of all loose-ball transitions.
- Match obstruction follow-up (2026-10-30): the provided screenshot showed the older side rosters covering the goal areas and strong diagonal rain streaks. The current match JSX contains no roster overlays; added a `.match-stage .match-lineup` fallback hide rule and lowered both rain streak opacity and frequency. In the live 1280×720 preview, both goals remained clear and upright full-body players were visible. `npm test` passed (10 files, 68 tests); `npm run build` passed with the existing dynamic-import and large-bundle warnings. The preview match had heatwave weather, so the changed rain appearance still needs a true rain-state visual check. The full-time test match remains uncontinued.
- Loose-ball transition audit (2026-10-30): enumerated the `turnover(null)` entry paths in `MatchSim`: an unresolved through ball caught offside, an exhausted/no-carrier recovery, and a long ball without a selected receiver/defender. They retain the last recorded ball endpoint in the loose-ball state; when a carrier is subsequently found, the renderer receives a `looseBall/recovered` action from that point. Strengthened the fixed-seed offside regression to require the recovered action's `ballFrom` to equal the offside through-ball's `ballTo`. `npm test -- tests/engine.test.ts` passed (16/16); full `npm test` passed (10 files, 68 tests); `npm run build` passed. This closes the audit item, not every future match-event or renderer QA item.

## Match roster removal follow-up — 2026-10-30

- Broadened legacy lineup and roster fallback selectors from the pitch stage to the full match-view wrapper, covering side-card variants rendered alongside the stage. The active match JSX still has no roster cards; on-pitch names and player-rating/condition tabs remain.
- Rechecked the 604px in-app browser preview after the CSS update: both goals are visible and no lineup panels cover the field. The test match was already full-time and was left there.
- `npm test` passed (10 files, 69 tests); `npm run build` passed with the existing ineffective dynamic-import and large-chunk warnings. This preview used heatwave weather and does not validate rain appearance.

## Kit-matched shot pose update — 2026-10-30

- Connected the existing transparent white-kit and blue/red-striped shot sprites to field-player shot actions. The renderer cross-fades from the upright kit sprite into the kick pose; reduced-motion mode keeps the shot pose static. Shot ball travel and the match engine are unchanged.
- Connected existing transparent white-kit and blue/red-striped pass sprites to short and through-ball events. Pass and shot actors transition from the standing kit sprite into matching action art; reduced-motion mode keeps each selected pose static.
- Added two kit-matched upright tackle sprites and made a held-save keeper event transition from the dive sprite back to the keeper's standing kit. Added upright celebration art for the scorer; these are presentation-only and do not alter ball travel or simulation results.
- Added `tests/pitch-action-preview.html`, an isolated browser page that renders the real `Pitch2D` component using engine-shaped pass, shot, tackle, keeper-held, goal, cross, and long-ball samples. At 604px, manual screenshots showed the upright tackle, goalkeeper recovery, and goal pose. This fixture does not run the match engine.
- Expanded `tests/pitch-renderer.test.tsx` to assert both kits, pass/shot/tackle/celebration layers, keeper recovery, and 256×384 RGBA PNG assets. Targeted renderer suite passed (8/8); full `npm test` passed (10 files, 75 tests); `npm run build` passed with the existing dynamic-import and large-chunk warnings.
- Added kit-matched upright long-ball and cross artwork and connected both action kinds to their own standing-to-pose transitions. Renderer tests check both kit variants and all four transparent PNGs; the isolated Vite fixture visibly rendered `cross: claimed` and `longBall: complete` with upright player figures. This fixture does not run the match engine.
- Corrected a stale `actionPose` reference found during integration; running is now suppressed whenever a dedicated action pose is active.
- `npm test -- tests/pitch-renderer.test.tsx` passed (9/9), `npm test` passed, and `npm run build` passed with the existing ineffective dynamic-import and large-chunk warnings. Actual simulated live-match timing and full action-sequence visual QA remain open.

## Engine-generated action visual check — 2026-10-30

- Added `tests/pitch-live-engine-preview.html`. It constructs teams from the existing world database, runs the actual `MatchSim` with deterministic seed 1, captures engine timeline actions alongside the corresponding pitch snapshots, then renders those real pairs through `Pitch2D`. It does not create or save a career.
- The browser fixture produced short pass, through ball, long ball, cross, shot, and tackle examples from Arsenal FC–Burnley FC. At 1280 × 640, the full pitch, both goals, upright players, and the real long-ball/cross sample states rendered. This validates actual engine action/snapshot compatibility at the component boundary, not the timing/order of the primary `MatchScreen` queue.
- `MatchScreen` action-queue ordering and pose timing remain open for direct live-career verification.

## Match action queue snapshot alignment — 2026-10-30

- Changed the live ordinary-action queue to store `{action, snap}` frames. Each `advance()` engine step pairs newly recorded timeline entries with that step's `sim.pitch()` snapshot; the renderer replays historical snapshots in FIFO order and returns to the current live snapshot when the queue empties.
- Head-to-head matches do not accumulate local replay frames while their UI queue is disabled; background simulation advances its presentation cursor and clears unseen frames.
- Added a seeded regression using actual Arsenal FC–Burnley FC `MatchSim` data. Queued actions match the engine timeline in order, each paired snapshot is exactly one step after its action moment, and the acting player is present. `npm test` passed (10 files, 77 tests); `npm run build` passed.
- Primary `MatchScreen` live-career visual timing and queue-drain inspection remains open.

## Primary live match screen replay check — 2026-10-30

- Ran the actual `MatchScreen` through a separate Vite origin (`127.0.0.1:5181`) with a fresh QA career, leaving the existing user origin and save untouched. Liverpool–Chelsea progressed through the first half, goal/VAR commentary, halftime team talk, and second-half action.
- At 4×, inspected the pitch during a 43' queued action and during a 10' last-ditch highlight. The pitch and scoreboard showed the same event minute after the replay-clock fix; the full field, both goals, and upright player sprites remained visible with no side lineup panels.
- This was a bounded live UI check, not a full-match or every-speed queue-pacing acceptance. That remains open. `npm test` passed (10 files, 77 tests); `npm run build` passed with the existing dynamic-import and large-chunk warnings.

## Photo-field alignment and match HUD cleanup — 2026-10-30

- The stadium photograph is now the actual pitch background inside the same SVG camera group as the players and ball. Player coordinates project onto the grass quadrilateral (about 12.5–85.5% of image height, with a small rear-touchline x inset); the prior full-screen SVG field markings and artificial goals are removed.
- The ball-follow camera now pans and zooms the photographic field together with the action. The duplicate pitch clock, pitch commentary toast, and large on-pitch goal text are removed; the scoreboard is the only match clock and the line below the field is the only live commentary banner.
- Replaced the stretched oval ball drawing with a transparent, generated football sprite at reduced asset size.
- A multi-action engine moment could previously attach every action to the final pitch snapshot of that whole moment. Each frame now uses the action's own destination zone and possession/holder, tackle events award presentation possession to the tackling team, and the active animation counts toward queue back-pressure. This aims to keep the rendered pass sequence chronological without changing match RNG or scoring.
- The inbox transfer digest table now uses a fixed responsive layout and wraps player/club names inside its panel.
- `npm run build` passed after these changes. Existing Vite warnings remain: CM0102 data is dynamically and statically imported from the same module, and the main JS chunk is above 500 kB.
- Live browser inspection remains pending: the in-chat browser service returned `transport closed` while opening/rebinding the isolated preview on port 5184. The desktop Chrome window was not used. Do not treat visual alignment or live match pacing as browser-accepted until the in-chat preview can be inspected.

## Local preview route and server recovery — 2026-10-30

- Changed the Vite development base from `/cm0102-reborn/` to `/tactica-fc/`; kept Vercel root routing and GitHub Pages repository-name routing intact.
- Updated README, smoke/screenshot helper defaults, and the multi-season QA return link to the new local route.
- Restarted Vite on port 5184 bound to all local interfaces. `http://localhost:5184/tactica-fc/` returned HTTP 200, and the in-chat browser loaded the TACTICA FC landing screen at that exact URL. Desktop Chrome was not used.
- `npm run build` passed. Existing dynamic-import and large-bundle warnings remain.

## Open Football full-engine migration — IN PROGRESS (2026-10-31)

- The active `npm run dev` and `npm run build` paths now use the full Open Football application at pinned upstream commit `9741ee9e2c7321b080676a5910e246b83fcd1430`; the former TypeScript/Vite match simulator is no longer launched.
- Retained upstream Apache-2.0 license and attribution. Rebuilt and embedded Open Football's Bevy/WebAssembly match viewer from the same pinned source, with the TACTICA FC stadium marks and watermark.
- Built the Windows Open Football executable using Cargo's `fast` profile with two jobs. The full engine, embedded database, and web server compile together; the only compiler warning is one upstream unused import.
- Local runtime listens on port 5184, opens no browser automatically, and serves `/tactica-fc/` as a redirect into the Turkish Open Football interface. HTTP checks returned 200 for the app and 200 for the JS, WASM, and gzipped WASM viewer assets.
- Current playback configuration records goal-focused match-position clips and match event text. A full 90-minute recording is available upstream but is not enabled by default because of additional storage cost.
- Remaining acceptance: play a user-facing match through the Open Football screens and inspect a recorded goal replay on the laptop. Do not claim the prior cut/stutter or missed-goal issue is visually resolved until that replay is observed.
