# Design QA — Match player artwork

**Result:** PASS for the requested upright player artwork; this is a scoped pass, not acceptance of the full screenshot recreation.

## Reference and preview

- Reference image: `C:\Users\sekip\Desktop\GAMES\other games and assets\cm0102\6acb4216-17bf-4a18-8843-718873e2aac4.png` (1536 × 1024).
- Preview: `http://127.0.0.1:5180/cm0102-reborn/` in the user's in-app browser at a 1536 × 1024 viewport.
- A full-page and focused pitch capture were visually inspected in the in-app browser. The capture API returned in-memory image bytes, so no screenshot file was persisted; the live preview remains available at the URL above.
- The existing manager navigation and match screen surround the pitch, so their composition is not identical to the reference image. This pass evaluates the player art within the existing application screen.

## Player-art checks

- The live pitch rendered 22 player images in upright full-body poses; no sideways/lying figures were visible.
- Two player appearances are selected for each outfield kit, with separate lime and orange goalkeeper art.
- Player scale changes with vertical pitch position to create a near/far broadcast-camera perspective.
- Shirt numbers, ball-holder highlighting, and pitch markings remain visible; side roster overlays are removed from the match pitch so both goals stay clear.
- The six sprite PNGs have alpha transparency and are reduced to 256 × 384. Their sizes are approximately 67–89 KB each.
- Browser console error/warning query returned no entries after the sprite update.
- `npm run build` passed. Existing warnings remain for the ineffective dynamic import in `src/game/data/cm0102.ts` and the large application JavaScript chunk. PWA precache after the optimized art is 7,701.90 KiB.

## Motion follow-up — 2026-10-29

- Added white-kit and striped-kit three-frame running atlases. `Pitch2D` selects the matching atlas and clips each frame to the player bounds; the loop is triggered by movement between consecutive pitch snapshots or the current dribble/receiver action. Stationary outfield players keep the upright standing sprite with subtle idle breathing.
- A saved or goal shot addressed to a goalkeeper switches to the matching generated full-body dive pose and applies a short transition effect. This is a single dive pose, not a multi-frame goalkeeper animation. Other action art still uses the existing emphasis effects.
- `npm run build` passed after these changes on 2026-10-29. The existing ineffective dynamic import and large JavaScript chunk warnings remain.
- The temporary in-app browser preview visibly showed the upright standing player art. The check match reached half-time and was left there without choosing a team talk, so this run did not visually verify a moving cycle or goalkeeper dive. No end-to-end animation visual pass is claimed.

## Team-facing and pitch-clearance check — 2026-10-29

- Started a clean career in Microsoft Edge at 1536 × 1024 and inspected a live match from a temporary Playwright screenshot. After the user's request to remove the side panels, a fresh screenshot showed 22 upright players and the ball with both goal areas unobstructed and no roster overlays.
- The final renderer DOM check contained 22 `.p2d-player` groups, 22 `.p2d-sprite` images, one pitch SVG, one ball, and zero `.match-lineup` panels; no browser console errors were reported. Ratings remain in the separate ratings tab.
- To inspect the heavy-rain CSS after reducing its density, a clean match screenshot temporarily applied the `wx-heavyRain` class in the browser. This confirmed that the updated pattern was thinner and more transparent; the match itself was sunny, so this was a CSS-state preview rather than a weather-engine test.
- The away team is mirrored at the sprite layer while vertical scaling remains positive; the jersey number is counter-flipped separately. The screenshot visually confirmed the upright full-body figures and updated match layout. This does not confirm every action pose or physical-device layout.
- A separate clean 4× session reached a long-ball action and exposed one `.p2d-sprite.running` loop plus SVG `<animateMotion>` for the ball, with 22 players and no console errors. A repeat run did not reach that dynamic DOM state within 20 seconds, so the live-action observation is evidence that it works when reached, not a repeatability guarantee for the encounter timing.
- A live goal-kick event exposed the CSS `p2d-sprite-goal-kick` animation in computed style while the pitch still had 22 players and active ball motion. The goal-kick actor changed before a focused screenshot could capture that short pose, so this is DOM/CSS evidence only.
- The screenshot was inspected locally and the temporary file was deleted after review. No screenshot artifact was retained in the project.

## Follow-up to user's display issue — 2026-10-29

- Further reduced the rain streak frequency and opacity after the user's screenshot showed the diagonal overlay competing with players and pitch markings.
- Inspected the live match view in the in-app browser without reloading or changing match controls. The current renderer showed the pitch and players without side lineup panels; ratings and condition remain in their separate sections. This view was at a narrow viewport and had heatwave weather, so it did not exercise the revised rain overlay or establish desktop-width visual acceptance.
- Confirmed the idle art source is a transparent, upright full-body player; running uses an upright three-frame sprite sheet. No screenshot from the user's saved match was reloaded or replaced.

## Screen obstruction follow-up — 2026-10-30

- The current in-app match DOM has a permanent pitch stage, 22 player sprites, and zero `.match-lineup` overlays; both goal areas are unobstructed at the inspected 604px viewport. Ratings stay in the separate Player ratings tab.
- Reduced both normal-rain and heavy-rain streak spacing and opacity again to keep weather from obscuring players and goal markings. The inspected live match had heatwave weather, so the new rain styling was not visually exercised in an actual rain-state match.
- `npm run build` passed after the CSS update. Existing ineffective dynamic-import and large-bundle warnings remain. The user's screenshot was not reloaded or replaced, and no capture from it was stored.

## Live tactics control-to-pitch check — 2026-10-30

- In an in-app preview match paused at 1', changed Liverpool's live formation from 4-4-2 to 4-3-3. Switching back to 4-4-2 changed six SVG player transforms; the formation was then restored to 4-3-3.
- Substituted Wirtz for Jones through the live panel. The SVG reported Wirtz wearing shirt number 7, the pitch retained 22 player groups, the substitution count changed from five to four, and commentary reported the substitution.
- The browser screenshot showed the full pitch, both goals, and no side lineup overlays. The test match was left paused without continuing the result into the career. This is a desktop browser preview check, not a physical-device or all-formation acceptance pass.

## Remaining M03 work

The renderer now has a full-pitch default with optional ball-follow camera, and shared three-frame movement poses are sequenced during pass/shot/tackle events. Action-specific art, keeper recovery/celebration poses, pitch-detail work, and broader desktop/mobile readability remain open. The deterministic renderer fixture is covered by `tests/pitch-renderer.test.tsx`; see `TASKS.md` for remaining milestone work.

## Goalkeeper clearance engine check — 2026-10-30

- Added an open-play clearance branch when a goalkeeper holds possession and the team has selected Long passing. It calls the same engine long-ball resolver, so the recipient and interception/completion outcome come from match simulation. The visual event preserves the keeper's stored ball position.
- Added a fixed-seed regression that finds a keeper-initiated long ball after a held-ball event, checks its endpoints and recipient, and compares the report with visual recording disabled.
- `npm test -- tests/engine.test.ts` passed (16/16), the full `npm test` suite passed (10 files, 68 tests), and `npm run build` passed with the existing dynamic-import and large-chunk warnings. No browser visual capture of this new clearance action has been performed yet.

## Match obstruction follow-up — 2026-10-30

- The supplied match screenshot showed side roster panels covering the goal areas and diagonal rain streaks competing with the pitch. The current live-match JSX has no roster panels; added a defensive `.match-stage .match-lineup` hide rule for stale/legacy overlay markup.
- The in-app preview at `http://127.0.0.1:5180/cm0102-reborn/` was visually inspected at 1280 × 720 after the CSS update. Both goals were clear, the full-body player figures remained upright, and no side lineup cards appeared. Ratings and condition remain in the separate match tabs.
- Further reduced the rain streak spacing and opacity. The inspected match had heatwave weather, so this browser capture does not visually verify rain or heavy rain.
- `npm test` passed (10 files, 68 tests); `npm run build` passed. Existing warnings remain for the ineffective dynamic import in `src/game/data/cm0102.ts` and the large application chunk. The preview match reached full-time and was not continued into the career.

## Roster and pitch readability follow-up — 2026-10-30

- Added stage-scoped fallback selectors for legacy lineup, roster, and squad panel variants. The active `MatchScreen` itself does not render these side panels; on-pitch player name labels remain intact.
- Captured the separate in-app preview at a 604px viewport during a paused live match at 2'. Both goal areas were visible and no lineup cards covered the pitch. The test match remains paused; the user's existing match was not reloaded or touched.
- Normal and heavy-rain streaks are now more widely spaced and more transparent. This preview had heatwave weather, so the rain appearance still needs a direct rain-state visual check.
- `npm test` passed (10 files, 68 tests); `npm run build` passed. The existing ineffective dynamic-import and large-chunk warnings remain.

## Match camera control — 2026-10-30

- Added a camera toggle inside the pitch: the default fit shows the full field and both goals; “Focus on ball” zooms toward the current ball, and “Full pitch” restores the complete view. The focus is clamped vertically so a nearby goal remains in view during corner play.
- Manually toggled the control in the separate 604px in-app preview, confirmed the focused view follows the corner, then restored full pitch and verified both goals were visible with no lineup cards. The test match is paused at 0'.
- Camera motion only transforms the rendered pitch group; it does not change snapshots or simulation state.
- `npm test` passed (10 files, 68 tests); `npm run build` passed with the existing dynamic-import and large-chunk warnings.

## Action pose sequence update — 2026-10-30

- Pass, through-ball, long-ball, cross, shot, and tackle actors now play a one-shot three-frame sequence using the matching kit's existing upright run atlas. Tackle uses a different frame order; the sequence remains presentation-only and the keeper number/name layers are unaffected.
- A targeted keeper save now cross-fades from the upright goalkeeper sprite into the existing side-appropriate dive sprite, with the existing short dive motion.
- `tests/pitch-renderer.test.tsx` now checks the action-pose SVG animation markup and both keeper pose layers. The targeted renderer test passed (2/2). This verifies generated markup, not the final browser raster quality of each action; action-specific atlases and live-event visual checks remain open.

## Match roster removal follow-up — 2026-10-30

- Broadened the fallback hide rule to the complete `.match2d` viewer wrapper so older lineup/roster cards are suppressed whether nested over the pitch or rendered beside the stage.
- The in-app browser preview at 604px showed the full field and both goals, with no side roster cards. The preview was already at full-time and was left unchanged.
- `npm test` passed (10 files, 69 tests); `npm run build` passed. The preview had heatwave weather, so the reduced rain effect still needs an actual rain-state check.

## Kit-matched shot pose update — 2026-10-30

- The renderer now uses the existing transparent white-kit or blue/red-striped full-body shot sprite for the acting field player, cross-fading from the standing kit sprite. With reduced motion enabled it displays the kick pose without animation.
- The renderer now uses kit-matched pass sprites for short and through-ball actions as well as kit-matched shot sprites. Markup tests cover both teams, transitions, and transparent 256×384 PNG assets. Neither pose has yet been captured during a live simulated event, so browser raster quality and ball-to-foot alignment remain unverified.

## Upright action poses and isolated renderer preview — 2026-10-30

- Added transparent 256×384 white-kit and striped-kit artwork for standing tackles and goal celebrations. Short/through passes and shots also use their kit-matched action sprites. Goalkeeper recovery fades the existing side-appropriate dive sprite back into the upright keeper sprite on an engine-shaped held-save event.
- Added `tests/pitch-action-preview.html`, which renders the actual `Pitch2D` React component from the Vite dev server with deterministic action-shaped fixtures. At 604px, browser screenshots were inspected for shot, tackle, keeper-held recovery, and goal celebration; figures remained upright and the full field stayed visible.
- This preview bypasses the match engine, so it verifies component/asset raster behavior only. Live simulation timing, pass/ball alignment in a real match, and long-ball/cross action-specific art remain open.
- Renderer tests passed (8/8); the full suite passed (10 files, 75 tests); `npm run build` passed with the existing ineffective dynamic-import and large-chunk warnings.

## Upright long-ball and cross poses — 2026-10-30

- Added original transparent 256×384 white-kit and blue/red-striped sprites for long-ball and cross follow-throughs. `Pitch2D` transitions from the standing sprite to the correct kit-matched pose; reduced-motion mode renders the static pose.
- The isolated browser fixture rendered both `cross: claimed` and `longBall: complete` samples. The field figures stayed upright, and the long-ball action showed its follow-through pose. The fixture does not run `MatchSim`, so actual live-match timing remains unverified.
- Fixed a stale running-state reference discovered during integration. Targeted renderer tests passed (9/9), the full suite passed (10 files, 76 tests), and `npm run build` passed. Build retains the existing dynamic-import and large-chunk warnings.

## Real MatchSim action and snapshot visual check — 2026-10-30

- Added `tests/pitch-live-engine-preview.html`, which runs `MatchSim` with deterministic seed 1 on world-database Arsenal FC and Burnley FC squads. It stores actual pitch snapshots alongside actions from the engine timeline and renders the selected pair through the production `Pitch2D` component without starting or saving a career.
- The browser page produced pass, through-ball, long-ball, cross, shot, and tackle samples. Visual inspection of the real long-ball and cross samples showed the full pitch and goals unobstructed and the players upright.
- This establishes engine-generated action/snapshot compatibility at the renderer boundary. It does not verify event queue ordering or animation timing in the primary `MatchScreen`; that live-career check remains open.

## Live action queue snapshot alignment — 2026-10-30

- Ordinary live visual actions are now queued together with the `MatchSim.pitch()` snapshot captured immediately after the action's engine step. `Pitch2D` renders each action against its own event-time layout and returns to the latest match snapshot after the queue drains.
- The head-to-head background advances the visual cursor without retaining off-screen replay frames.
- A fixed-seed regression confirms FIFO action order, one-step snapshot timing (`snapshot.moment === action.moment + 1`), and actor presence for actual `MatchSim` events. Full suite: 10 files, 77 tests passed. `npm run build` passed with the existing ineffective-dynamic-import and large-chunk warnings.
- At this stage the primary match screen still needed a dedicated live-career browser inspection of queue pacing and pose timing; the later full-match follow-up is recorded below.

## Primary live match queue inspection — 2026-10-30

- Started the shipped `MatchScreen` on separate local origin `127.0.0.1:5181` with a fresh QA career, preserving the existing match and save on port 5180. Played Liverpool–Chelsea at 4× through first-half actions, a goal and VAR check, halftime talk, then second-half play.
- During a queued action, the scoreboard and pitch both displayed 43'. After resuming, a 10' last-ditch highlight showed the 22-player pitch with both goals clear and no roster panels. The real match screen remained responsive and displayed event commentary.
- The first observation exposed a clock mismatch (43' pitch vs 46' scoreboard). Bound the scoreboard clock to the queued action minute and rechecked: both surfaces showed 43'.
- `npm test` passed (10 files, 77 tests); `npm run build` passed. This bounded 4× browser run did not verify pacing at every speed or full time; the following section records that follow-up.

## Live queue back-pressure and full-match check — 2026-10-30

- The in-conversation browser panel ran a separate-origin QA career on `127.0.0.1:5182`; the owner's career on port 5180 was not used. A Liverpool–Leeds Premier League match was played to full time, including halftime talk, a 46' Mac Allister goal, and the post-match report (Leeds United 0–1 Liverpool FC, matching the displayed score and report).
- Before the fix, the first 8× run paused for a van Dijk injury while the scoreboard and pitch still showed 22', even though the engine had already advanced into the second half. This confirmed that the match simulation could outrun ordinary-action replay at high speed.
- `src/ui/screens/Match.tsx` now stops live simulation advancement when one visual action is waiting in the queue; H2H playback keeps its existing independent clock. A helper in `src/game/match-visual.ts` expresses the capacity rule, with a focused regression test in `tests/engine.test.ts`.
- The clean follow-up match ran through 8×, then 1×, 2×, 4×, and back to 8×. Clock samples and visible pitch minutes stayed aligned (including the 46' goal and full time). The pitch showed the full 22-player layout, upright player sprites, both goals, and no side roster panels. The final result and report agreed.
- Focused regression: `npx vitest run tests/engine.test.ts -t "back-pressures the live simulation"` passed (1 passed, 17 skipped). `npm run build` exited 0; the existing ineffective dynamic-import and large-chunk warnings remain.
- Full `npm test` did not pass in this run: 49 passed, 21 skipped, 8 failed at the configured 5s/120s test-timeout limits, plus one 10s `beforeAll` timeout in `tests/ai-systems.test.ts`. Failures were in long simulation/statistical and multiplayer suites. Keep these failures visible; they were not changed by the focused queue regression.

## Goal geometry and responsive pitch check — 2026-10-30

- Added separate SVG structures for each goal: shaded net depth, mesh strands, and bright posts/crossbar, mirrored at the two end lines. The shapes remain aligned with the existing pitch coordinate system and don't alter match state.
- Tightened possession/camera overlays and the event banner on narrow screens so they stay within the pitch width.
- `npm test -- tests/pitch-renderer.test.tsx` passed (9/9), including assertions for both goal frames, nets, and mesh. `npm run build` passed with the existing ineffective dynamic-import and large-chunk warnings.
- Inspected the live engine-generated pitch fixture in the in-conversation browser at 1280×720 and 390×844. Both goals, the full field, and upright players remained visible at both widths; no side rosters were present. The live fixture uses fixed-seed `MatchSim` samples and does not start/save a career.
- TFC-M03 pitch renderer exit criteria are met. Physical mobile-device validation remains outside this browser check; TFC-M04 and later milestones remain in progress.

## Responsive live scoreboard check — 2026-10-30

- Narrow-screen scoreboard names now shrink and ellipsize within their team cells while scores and the match clock keep fixed readable space.
- Used the live stylesheet in headless Chrome with representative long club names at 390px and 320px viewport widths. The team, clock, and away-team cells measured 157/42/157px at 390px and 122/42/122px at 320px, with no horizontal overlap.
- `npm run build` passed; existing dynamic-import and large-chunk warnings are unchanged. The actual-weather visual follow-up and M06 completion are recorded below.

## Rain weather visual check — 2026-10-30

- Extended the isolated live-engine pitch fixture so `MatchSim` receives the same explicit `weather: 'rain'` value passed to `Pitch2D`; the preview labels its weather and does not create or save a career.
- Inspected the rendered rain overlay at 1280×720 in the in-conversation browser and a local Chrome screenshot. Restored enough contrast to make the sparse moving streaks visible while keeping the pitch, players, goal frames, and markings easy to read. Heavy rain uses a slightly stronger variant.
- `npm run build` passed with the existing dynamic-import and large-chunk warnings. Together with the complete-match and mobile scoreboard checks above, TFC-M06 exit criteria are met. Mobile validation remains browser-based, not a physical-device test.

## Turkish locale foundation — 2026-10-30

- Added the `tr` language type, Turkish language buttons/select option, Turkish community language label, Turkish AI response language, Turkish number/date locale, and a `src/i18n/tr.ts` dictionary covering shared actions, navigation, options, match controls, the full landing page, and the new-career screen. Untranslated strings intentionally fall back to English; Turkish is not the default yet.
- Current dictionary counts from the TypeScript objects: English 4,192 keys, Danish 4,191 keys, Turkish 595 keys. Complete Turkish key coverage is verified for landing (114), new career (34), options (52), top bar (23), match (42), tactics and instructions (97), staff roles/table headings/status tags (44), player profile (45), attributes (48), and chemistry (44). Overall Turkish localization remains incomplete.
- Fixed two remaining visible CM Reborn brands found during Turkish-page review: the landing and Draft landing headers now say TACTICA FC, and `public/icon.svg` uses a TFC pitch mark.
- `npm test -- tests/i18n.test.ts` passed (3/3): selected-language strings, English fallback, Turkish formatting/nation label, placeholder parity, and complete key coverage for the listed UI categories. Chrome preview at 390px had `documentWidth === viewportWidth` with no untranslated `land.*` key labels. The latest `npm run build` passed with the existing dynamic-import and large-chunk warnings.
- TFC-M07 remains in progress. Translate and review the remaining strings, establish the reusable management UI design system, and verify core manager workflows before closing the milestone.

## Transfer and contract Turkish coverage — 2026-10-30

- Added Turkish translations for all 199 keys across transfer events, offers, bids, clauses, loans, enquiries, contracts, signings, negotiations, and agent traits. Dictionary coverage is now 794 / 4,192 English keys; Turkish remains incomplete and is not the default locale.
- Expanded `tests/i18n.test.ts` to require complete translations in these workflow namespaces. The first test run caught a missing `{club}` placeholder in `transfer.refuseAbroad`; corrected it, then `npm test -- tests/i18n.test.ts` passed (3/3), including translated-key coverage and placeholder parity.
- `npm run build` passed. Existing warnings remain for a dynamic import also imported statically and a minified JavaScript chunk above 500 kB.
- TFC-M07 remains in progress. Next, continue translating other frequently used management workflows, then implement the management UI design system and verify career-management flows.

## Staff, scouting, finance, and inbox Turkish coverage — 2026-10-30

- Added 203 Turkish strings for staff hiring and contracts (51 keys), scouting (37), finances (28), board budgets (39), club information (19), and inbox news (29). The dictionary now covers 997 / 4,192 English keys; Turkish remains incomplete and is not the default locale.
- Extended the full-namespace coverage assertion in `tests/i18n.test.ts`. `npm test -- tests/i18n.test.ts` passed (3/3), including complete coverage for these namespaces and placeholder parity.
- TFC-M07 remains in progress. Continue with other frequently used management workflows, then establish the shared UI design system and verify career-management flows.

## Board, training, jobs, and youth Turkish coverage — 2026-10-30

- Added 148 Turkish strings for board confidence and match feedback (57 keys), training (36), job-centre offers and applications (29), and youth intake (26). The dictionary now covers 1,145 / 4,192 English keys; Turkish remains incomplete and is not the default locale.
- Extended the namespace coverage assertion to include these workflows. `npm test -- tests/i18n.test.ts` passed (3/3), and `npm run build` passed. Existing dynamic-import and large-chunk warnings remain.

## Onboarding, rankings, achievements, and trophies in Turkish — 2026-10-30

- Added 181 strings for the first-day onboarding flow (39), rankings (61), achievements (51), and trophy celebrations (30). The dictionary now covers 1,326 / 4,192 English keys; Turkish remains incomplete and is not the default locale.
- The in-conversation local preview showed the first-day onboarding and inbox screens in a saved career. The page state was left unchanged. Expanded namespace assertions passed (`npm test -- tests/i18n.test.ts`, 3/3), and `npm run build` passed with the existing dynamic-import and large-chunk warnings.

## In-game help in Turkish — 2026-10-30

- Added all 49 help strings covering club and manager reputation, board confidence, fans, morale, condition, chemistry, development, youth, finances, tickets, transfers, scouting, press conferences, and manager score. The dictionary now covers 1,375 / 4,192 English keys; Turkish remains incomplete and is not the default locale.
- Added `help.` to the namespace coverage assertion. `npm test -- tests/i18n.test.ts` passed (3/3), and `npm run build` passed with the existing dynamic-import and large-chunk warnings.

## Press conference question prompts in Turkish — 2026-10-30

- Added all 87 dynamic press-conference question prompts, including match results, player form, transfers, injuries, board confidence, rivalries, and follow-up questions. Turkish coverage is now 1,462 / 4,192 English keys.
- Added `press.q.` to the namespace coverage assertion. `npm test -- tests/i18n.test.ts` passed (3/3), and `npm run build` passed with the existing dynamic-import and large-chunk warnings; remaining press answers and reactions are still untranslated.

## Press conference replies in Turkish — 2026-10-30

- Added all 231 response options for form, results, players, transfers, supporters, tactical questions, and follow-ups. The press question and answer banks now both have full Turkish key coverage. Total dictionary coverage is 1,693 / 4,192 English keys.
- Added `press.a.` to the locale coverage assertion. `npm test -- tests/i18n.test.ts` passed (3/3), and `npm run build` passed with the existing dynamic-import and large-chunk warnings.

## Press conference presentation text in Turkish — 2026-10-30

- Added manager response lines (8), journalist reactions (24), and response effect labels (15). Total Turkish coverage is now 1,740 / 4,192 English keys.
- Added their namespaces to the i18n completeness assertion. `npm test -- tests/i18n.test.ts` passed (3/3), and `npm run build` passed with the existing dynamic-import and large-chunk warnings.

## Complete press-conference localization — 2026-10-30

- Translated the remaining 60 titles, tone choices and hints, invite/report states, promise messages, progress labels, and headlines. All 425 `press.*` keys now have Turkish strings. Total Turkish coverage is 1,800 / 4,192 English keys; overall localization remains incomplete.
- Replaced the narrower press-subgroup checks with complete `press.` coverage. `npm test -- tests/i18n.test.ts` passed (3/3), and `npm run build` passed with the existing dynamic-import and large-chunk warnings.

## Player conversations and team talks in Turkish — 2026-10-30

- Added all 62 complaint and contract-conversation keys, 58 team-talk keys, and 49 one-to-one player-talk keys. Total Turkish coverage is now 1,969 / 4,192 English keys.
- Added all three namespaces to the i18n completeness assertion. `npm test -- tests/i18n.test.ts` passed (3/3), and `npm run build` passed with the existing dynamic-import and large-chunk warnings.

## TACTICA FC design token foundation — 2026-10-30

- Added product brand cyan/teal tokens and mapped the default dark and light interface accents to them. Club themes continue to override semantic accents without changing the product brand colors.
- Added shared spacing, control height, radius, and elevation tokens; applied them to common buttons, selects, searchable selectors, panels, and the app-wide header accent.
- Documented token and theme usage in `DESIGN_SYSTEM.md`. Management-screen redesign and Turkish default locale remain open; this change establishes the shared foundation only.
- `npm run build` passed. The in-conversation preview remained on the existing Liverpool career inbox; the red club skin rendered, confirming current club theme behavior remained active. No career actions were taken.

## Match interface localization — 2026-10-30

- Added Turkish for all 106 `c.*` commentary lines, 66 `hl.*` highlight labels/captions, 15 `stats.*` labels, and 16 `report.*` strings. Turkish coverage is now 2,172 / 4,192 English keys; the default language remains English while translation coverage is incomplete.
- `npm test -- tests/i18n.test.ts` passed (3/3), including complete namespace coverage and placeholder parity. `npm run build` passed. Existing warnings remain for the ineffective dynamic import and the >500 kB minified JavaScript chunk.

## Competition and stadium localization — 2026-10-30

- Added all 112 keys across `fix.*`, `tbl.*`, `comp.*`, `score.*`, `att.*`, `fac.*`, and `ll.*`. Total Turkish coverage is now 2,284 / 4,192; 1,908 English keys remain untranslated, and Turkish is not yet the default.
- The first placeholder check found a missing `{opp}` in the dropped-lead analysis; corrected it. `npm test -- tests/i18n.test.ts` then passed (3/3), and `npm run build` passed with the existing dynamic-import and large-chunk warnings.

## Career events and dialogue localization — 2026-10-30

- Added all 144 Turkish keys for player unrest and praise, trial players, sponsorship, transfer-window events, rejected-offer dialogue, and manager promises/personality. Coverage is now 2,428 / 4,192 English keys; 1,764 remain untranslated.
- `npm test -- tests/i18n.test.ts` passed (3/3), including namespace completeness and placeholder parity. `npm run build` passed with the existing dynamic-import and large-chunk warnings.

## Transfer search and board workflows in Turkish — 2026-10-30

- Added all 173 Turkish strings for transfer-market filters and states (58), player scouting descriptors (59), and board confidence and requests (56). Overall coverage is 2,601 / 4,192 English keys; 1,591 remain untranslated.
- `npm test -- tests/i18n.test.ts` passed (3/3), including complete namespace coverage and placeholder parity. `npm run build` passed after the dictionary/test additions; subsequent copy refinements also passed the targeted i18n test. Existing build warnings remain unchanged.

## Dashboard inbox feed — 2026-10-30

- Changed each inbox message from a clickable `div` to a semantic button with `aria-current`, preserving its existing read/open behavior. The shared styles now align the icon/date/title columns, keep long titles within the row, and distinguish selected, unread, and transfer-window messages.
- `npm run build` passed. The first full test run overlapped the build and hit the engine tests' 5-second timeout in two match-motor cases (79/81 passed); a standalone `npm test` rerun passed all 11 files and 81 tests. The conversation-browser binding did not provide the existing tab this turn, so this specific inbox styling change has not had a new visual screenshot check.

## Career analysis and history localization — 2026-10-30

- Added 209 Turkish entries across tactical analysis (20), player-attribute abbreviations (17), traits (18), team talks (17), season stories (25), manager history (17), scouting recommendations (31), club records (29), weekly summaries (11), rivalries (12), and competition rounds (12). Coverage is now 2,810 / 4,192; 1,382 English keys remain.
- `npm test -- tests/i18n.test.ts` passed (3/3), including namespace completeness and placeholder parity. `npm run build` passed with the existing dynamic-import and large-chunk warnings.

## Fan, club-project, and match-instruction localization — 2026-10-30

- Added all 208 Turkish entries across fan mood/reactions (33), fan news (17), transfer bidding wars (37), training camps (39), club projects (20), transfer realism (20), player rehabilitation (20), and opposition instructions (22). Coverage is 3,018 / 4,192; 1,174 keys remain.
- `npm test -- tests/i18n.test.ts` passed (3/3), including complete namespaces and placeholder parity. `npm run build` passed with the existing warnings for the ineffective dynamic import and large JavaScript chunk.

## Game setup, public profile, and AI manager localization — 2026-10-30

- Added all 240 Turkish keys across database selection/import (19), Draft League page copy (72), inbox categories (12), weather (14), public profiles (19), manager comparisons (16), supporter information (57), and AI manager screens (31). Total is 3,258 / 4,192; 934 remain untranslated.
- Updated the fallback test to use an untranslated club-management key after translating every `dl.*` string. `npm test -- tests/i18n.test.ts` passed (3/3); `npm run build` passed with the existing dynamic-import and large-chunk warnings.

## Draft League room localization — 2026-10-30

- Added all 216 Turkish entries for Draft League setup, lobby, player selection, season management, auction, and season predictions. Coverage is now 3,474 / 4,192 English keys; 718 remain untranslated.
- `npm test -- tests/i18n.test.ts` passed (3/3), including complete namespace coverage and placeholder parity. `npm run build` passed with the existing dynamic-import and large-chunk warnings.

## Manager chat and transfer conversation localization — 2026-10-30

- Added all 105 Turkish entries for manager chat, AI banter, match reactions, transfer conversations, and quick replies. Coverage is now 3,579 / 4,192 English keys; 613 remain untranslated.
- `npm test -- tests/i18n.test.ts` passed (3/3), including complete namespace coverage and placeholder parity. `npm run build` passed with the existing dynamic-import and large-chunk warnings.

## Online multiplayer localization — 2026-10-30

- Added all 96 Turkish entries for online lobby setup, invites, player readiness, turn simulation, live manager matches, and deadline/autopilot behavior. Coverage is now 3,675 / 4,192 English keys; 517 remain untranslated.
- `npm test -- tests/i18n.test.ts` passed (3/3), including complete namespace coverage and placeholder parity. `npm run build` passed with the existing dynamic-import and large-chunk warnings.

## Community suggestion board localization — 2026-10-30

- Added all 67 previously untranslated Turkish entries for the community board, including voting, suggestions, statuses, comments, reports, and validation messages. Coverage is now 3,742 / 4,192 English keys; 450 remain untranslated.
- `npm test -- tests/i18n.test.ts` passed (3/3), including complete namespace coverage and placeholder parity. `npm run build` passed with the existing dynamic-import and large-chunk warnings.

## Tactical assistant and press rivalry localization — 2026-10-30

- Added all 42 Turkish strings for lineup recommendations, tactic benchmarking, manager comparisons, and press-war taunts/reactions. Coverage is now 3,784 / 4,192 English keys; 408 remain untranslated.
- `npm test -- tests/i18n.test.ts` passed (3/3), including complete namespace coverage and placeholder parity. `npm run build` passed with the existing dynamic-import and large-chunk warnings.

## Awards, negotiations, and career challenge localization — 2026-10-30

- Added all 50 Turkish entries for monthly/season awards, transfer counter-offers, and all career challenges. Coverage is now 3,834 / 4,192 English keys; 358 remain untranslated.
- `npm test -- tests/i18n.test.ts` passed (3/3), including complete namespace coverage and placeholder parity. `npm run build` passed with the existing dynamic-import and large-chunk warnings.

## Profiles, friendlies, finance, and match insight localization — 2026-10-30

- Added 68 Turkish entries for manager profiles (15), friendlies (15), transfer history (13), finance forecasts (13), and post-match performance insights (12). Coverage is now 3,902 / 4,192 English keys; 290 remain untranslated.
- `npm test -- tests/i18n.test.ts` passed (3/3), including complete namespace coverage and placeholder parity. `npm run build` passed with the existing dynamic-import and large-chunk warnings.

## Injury, statistics, and inbox localization — 2026-10-30

- Added all 58 remaining keys for injury names, manager head-to-head records, match statistics, award news, inbox settings, and player development. Coverage is now 4,028 / 4,192 English keys; 164 remain untranslated.
- `npm test -- tests/i18n.test.ts` passed (3/3), including complete namespace coverage and placeholder parity. `npm run build` passed with the existing dynamic-import and large-chunk warnings.

## Complete Turkish dictionary and default locale — 2026-10-30

- Added the final 164 translations for match notifications, draft news, transfer terms, financial rules, squad labels, job changes, ticket pricing, club strategy, rumours, auctions, player interest, and match visualization labels. The Turkish dictionary now contains all 4,193 English keys after adding a localized accessible name for the pitch.
- New installations now default to Turkish; saved English or Danish language preferences remain honored. Reworked the i18n coverage test to check every English key and retained placeholder parity checks.
- `npm test -- tests/i18n.test.ts` passed (3/3). `npm run build` passed with the existing dynamic-import and large-chunk warnings. Turkish coverage: 4,193 / 4,193.

## Match preview roster cleanup and Turkish default validation — 2026-10-30

- Removed the pre-match player-by-player first XI list and condition bars. The preview now shows formation and mentality with a direct link to tactics; live player ratings remain in their own tab. The match viewer keeps the existing fallback rule that hides legacy side-roster variants above the pitch.
- The full suite initially hit five 5-second engine-test timeouts and one 10-second data-loading hook timeout while running in parallel (55 passed, 21 skipped). `npm test -- --maxWorkers=1` then passed all 11 files and 81 tests in 141.94 seconds. The i18n suite passes all 4,192-key completeness and placeholder checks; `npm run build` passed with the existing dynamic-import and large-chunk warnings.
- The request to avoid desktop computer use was honored. A clean QA career on the isolated Vite origin `127.0.0.1:5183` reached Leeds United–Fulham FC pre-match; a 1280 × 720 in-conversation browser screenshot confirmed the first-XI/condition list is absent and the formation/mentality summary remains. The career uses separate origin storage and did not touch the existing 5182 user save.
- Started the same isolated match and inspected the live screen at 1280 × 720: all 22 named player groups rendered on the pitch as upright figures, both goals were visible, and no side lineup cards covered the field. The capture was reviewed in-session; no screenshot file was retained. This is a screenshot/UI check at kickoff, not acceptance of every animation, weather state, or viewport.

## Default navy theme and squad screen — 2026-10-30

- Changed the theme fallback for installations without an explicit `cm-theme` preference from club-colour light mode to the deep navy TACTICA FC theme. Existing explicit `dark`, `light`, `club`, and supporter theme values remain unchanged.
- At 1280 × 720 in a second in-conversation tab on isolated origin `127.0.0.1:5183`, the Fulham squad screen rendered in navy with readable player table, condition bars, nation flags, and current match controls. The first tab remained on the live Leeds–Fulham match with both goals visible and standing player figures. The QA origin is separate from the user's 5182 save.
- `npm run build` passed after the theme fallback change. Vite retained the existing ineffective dynamic-import warning for `src/game/data/cm0102.ts` and the >500 kB bundle warning.

## Career save versioning and recovery — 2026-10-30

- Local and exported careers now use the `tactica-fc-save` schema envelope (version 1); unwrapped CM Reborn gzip JSON remains readable through the legacy path. Unknown or future schema versions fail before `setGame`, so they cannot replace the current in-memory career. Online snapshot serialization remains on its existing wire format.
- New IndexedDB records store the save blob and its list metadata together under one record key. The prior `save:<id>` and `meta:<id>` keys remain readable and are removed only after the new record is written; cleanup failure leaves a valid new record and any legacy data intact.
- `npm test -- tests/save-snapshot.test.ts tests/save-storage.test.ts` passed (6/6), including rejection of a replacement write while confirming the committed record and list metadata remain available, plus legacy metadata listing. In the isolated 5183 in-conversation preview, manually saved the QA Fulham career, saw it in the load list, and loaded it back at 9 August 2025. This exercised the current IndexedDB record path without using the 5182 career.
- `npm run build` passed with the existing ineffective dynamic-import and large-bundle warnings. At this point, forced IndexedDB interruption and multi-season save/load verification were still open; the later transaction-abort result is recorded below, and multi-season IndexedDB UI restore remains open.
- Follow-up platform split: `src/game/save.ts` now consumes the platform storage/preferences/file-export contracts; IndexedDB, `localStorage`, and DOM download APIs live in `src/platform/browser.ts`. A source scan found no direct `localStorage`, IndexedDB, `document`, or `navigator` calls in `src/game`. After navigating the isolated tab through a fresh app load, the saved QA career auto-resumed through the registered browser adapter. The save-focused suite passed (6/6) and `npm run build` passed; native mobile adapters remain unverified. A real browser IndexedDB replacement-transaction abort was subsequently exercised as recorded below.
- `npm test -- --maxWorkers=1 tests/draft.test.ts tests/multiplayer.test.ts` passed (13/13), confirming existing draft and multiplayer snapshot serialization remains compatible. Running both files in parallel first caused one 5-second multiplayer snapshot timeout; the serial rerun passed all tests in 92.36 seconds.
- Extended `scripts/simulate-season.ts` to fail if the requested season boundary is not reached and to round-trip schema-versioned saves while checking identity, date, season, club, player/fixture counts, archived-season count, retained match-report count, and RNG state. `npm run simulate -- 2 190` completed 732 simulation days across seasons 2025 and 2026; the listed leagues, domestic cup, UEFA competitions, and promotion playoffs reported finished with `pending=0`. At 2027-07-02, the schema 1 save/load round-trip preserved 2 archived seasons, 40 retained match reports, and 24,230 players. This is headless progression/serialization evidence; multi-season IndexedDB UI restore remains open. Browser transaction interruption is separately verified below.
- `npm run build` passed after the simulation/check update. Existing ineffective dynamic-import and large-chunk warnings remain.

## Autosave retry after storage errors — 2026-10-30

- A failed autosave now keeps the career dirty and schedules another attempt with a 1.5-second initial delay that doubles up to a 60-second cap; a new edit resets the delay. This recovers from transient storage errors while the career remains open.
- Strengthened the autosave test to advance the actual scheduled retry callback. `npm test -- tests/save-snapshot.test.ts tests/save-storage.test.ts` passed (2 files, 7/7 tests). The storage test proves no write occurs before each due time; repeated injected failures retry after 1.5, 3, 6, 12, 24, and 48 seconds, then at the capped 60-second interval, and the following 60-second retry commits the save. Compression is stubbed only in this timer-focused test; gzip compatibility is covered by the save snapshot tests.
- `npm run build` passed with existing dynamic-import and large-chunk warnings.
- Added `tests/indexeddb-interruption.html` and ran it in the isolated in-conversation browser on origin 5183. The fixture writes a save-shaped `{blob, meta}` record through `idb-keyval`, aborts the replacement transaction, confirms the write rejects, and reads back the previous payload and metadata unchanged. The temporary probe record is deleted afterward. This verifies IndexedDB's single-record transaction behavior; it does not inject an abort into the app's own live save click or validate a native mobile database adapter.
- Added `tests/multi-season-save-qa.html` and ran it on isolated in-conversation origin 5183. It copied the existing Fulham QA career (original save id unchanged), advanced the copy through the actual `runUntil` simulation from 2025-08-09 to 2027-07-02, and wrote it using the browser IndexedDB adapter. `loadGame` restored an identical summary (season 2027, 23,951 players, 1,442 fixtures, 40 reports, 2 archived seasons, RNG state) and `listSaves` returned matching Fulham FC/date metadata. Opening the normal app in a separate in-conversation tab auto-resumed this career; the rendered header showed Fulham FC, 2 July 2027, and the inbox contained 2027/28 season news and prior match-result entries. The test copy lives only on origin 5183 and the original QA record was preserved. The fixture performs simulation/save via actual game modules and verifies load in the normal UI; it does not exercise the manual save button on a 2027 screen or a native mobile adapter.
- Follow-up UI check in the same isolated in-conversation browser/origin: on the normal app at 2 July 2027, clicked `Oyunu kaydet` and observed the `Oyun kaydedildi` toast. After exiting to the landing page and opening the load list, the newly saved Fulham record appeared first with the updated save time (30 October 2026, 11:27:59). Selecting that row loaded the career back into the normal app; its rendered header again showed Fulham FC, 2 July 2027. No desktop Chrome interaction was used. This closes the manual-save-button and save-list-load UI checks for the browser adapter; native mobile storage remains unverified.
- Added the accessible match-pitch label to English, Danish, and Turkish dictionaries; `npm test -- tests/i18n.test.ts tests/pitch-renderer.test.tsx` passed (12/12) and `npm run build` passed.

## Squad list search and position filters — 2026-10-30

- Added name search and goalkeeper, defence, midfield, and attack filters above the real squad table. Filtering also applies to the loaned-out list; overview, attribute, and contract table modes share the controls. Search ignores diacritics, and an empty result set has a localized message. Labels and status text exist in English, Danish, and Turkish; layout uses the shared spacing, surface, border, radius, and accent tokens.
- Manually checked the normal app in the in-conversation browser on isolated origin 5183 using the 2 July 2027 Fulham career: all 23 squad players displayed; goalkeeper filter showed one first-team player (Alfie McNally); searching `jimenez` returned Raúl Jiménez; a no-match query displayed the empty state; clearing controls restored all 23. Desktop Chrome was not used.
- `npm run build` passed. Existing warnings remain: CM0102 data is statically and dynamically imported, and the minified JavaScript bundle exceeds 500 kB. The broader TFC-M07 screen modernization and full core-workflow audit remain open.

## Photo-backed live match view follow-up — 2026-10-30

- Updated `Pitch2D` to use the actual stadium image as the visible field surface and map player/ball positions to the photographed grass bounds. The background, players, and ball share one camera transform, so ball focus no longer zooms the overlay independently of the stadium.
- Removed the independently drawn field/goal geometry and the repeated on-pitch minute, commentary banner, and large text flash. The centered scoreboard retains the single match clock; the existing line beneath the pitch retains the single live event description.
- Replaced the oval vector ball with a generated transparent football image. Added per-action destination/possession snapshots for events in the same simulation moment; fixed tackle possession on the visual timeline and included the currently animating action in queue capacity.
- Made the weekly transfer digest table wrap long club and player names within its card.
- `npm run build` passed. This is code/build evidence only. The requested visual verification in the in-chat browser is blocked for now because its browser transport failed twice; the user's desktop Chrome was not used. Recheck pitch projection, ball-follow framing, duplicate HUD removal, action chronology, and digest-table width when the in-chat browser reconnects.

## Localhost route correction — 2026-10-30

- Changed the local Vite base route to `/tactica-fc/` and updated developer docs and helper defaults.
- The prior `5184` Vite process was no longer listening, which caused the refused connection. Restarted it on `0.0.0.0:5184` with strict port selection.
- `http://localhost:5184/tactica-fc/` returned HTTP 200 and opened successfully in the in-chat browser; the TACTICA FC landing screen rendered. The tab was marked to stay open for the owner.
- `npm run build` passed with the pre-existing import/chunk warnings. This verifies the local route and landing page; match-screen visual acceptance is still a separate check.

## Match action continuity and original CM0102 ISO inspection — 2026-10-30

- Traced the repeated forward/back motion to multiple visual actions emitted for a single failed possession contest: intercepted passes and failed dribbles could render a tackle and then a second turnover action for the same ball win. The engine now emits one tackle action for those cases, and generic turnover recording skips a same-moment event when the winner is already the actor or receiver of the previous possession-changing action.
- Restricted pitch shot snapshots to the engine moment in which the shot was resolved. This prevents an earlier shot from lingering through later actions that happen within the same displayed minute.
- Expanded the SVG ball animation key to include recipient, outcome, and ball endpoints so distinct actions in one moment cannot reuse a frozen animation instance.
- Mounted the owner's `CM0102.iso` read-only and dismounted it after inventory. The root contains the original game executables, an InstallShield `data1.cab`/`data1.hdr`, and a manual PDF. Header strings name optional `Pictures\Stadium Pictures` and other stadium-picture components, but the archive is InstallShield format and the built-in Windows CAB listing tool did not enumerate its payload. No game or installer executable was run, and no original data was copied into the product.
- The original CM0102 match presentation is not an animated 2D pitch engine with sprites whose movement can be transplanted. The local CM Reborn architecture describes its engine as a zone-based, CM3-inspired simulation; its `MatchSim` resolves action outcomes and the current TACTICA renderer animates those events. Source/code internals are not included in the ISO as plain source files.
- `npm run build` passed after the continuity changes. No test suite or live-match visual verification was run this turn, so the stutter fix remains open pending in-chat live-match review.

## Championship Manager 2010 gameplay reference — 2026-10-30

- Mounted the owner-provided `Championship Manager 2010.iso` read-only and dismounted it after inspection. It is a 1.04 GB CM2010 disc (`CM2010` volume label). The ISO contains the English and Turkish manuals, main `Setup/Game/CM2010.exe`, and InstallShield `data1`/`data2` archives; no files were executed or imported into the product.
- The English manual describes a fully animated 3D match engine, tactical changes during play, set-piece design/practice, and ProZone analysis. It specifically calls out runs and feeds with and without possession, and reviewing match footage with controls to pause and follow areas of play.
- InstallShield header strings identify 3D asset groups for `Pitches\Models`, `Pitches\Textures`, weather-dependent `Pitches\World` variants (dry/wet/snow, stripe patterns and wear/tear), `Players\Models`, `Players\Textures`, `Animations` (including goal/person/flag assets), `MatchEvents` (including kick, tackle, goalkeeper catch/parry, net/post), and crowd reactions. This confirms the ISO contains an actual 3D match presentation pipeline and event assets, unlike the original CM0102 reference.
- The archive payload itself was not unpacked. The names above are verified from the InstallShield header, not visual inspection of each 3D model or animation. These copyrighted assets are research reference only; TACTICA FC will use independently created/licensed art and an original implementation.
- The tracked implementation direction is now to represent each engine action as a stable, ordered player/ball movement path with supporting runs, defensive reactions, and camera framing, rather than replaying isolated zone changes. No CM2010 code or asset has been copied. The next validation needs a live TACTICA match; this ISO inspection does not verify the prior stutter fix.
