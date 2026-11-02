# TACTICA FC

TACTICA FC is a football management game built on the repository's React and TypeScript game. TACTICA owns the career, club management, match decisions, score and match events. The embedded Open Football WebAssembly viewer presents the live match from TACTICA's positions and visual-action timeline; its playback timing never decides match outcomes. The viewer's upstream Apache 2.0 license and notices are retained under `vendor/open-football`.

## Run on Windows

Install the locked dependencies once:

```powershell
npm ci
```

Start the TACTICA web app:

```powershell
npm run dev
```

Vite prints the exact local URL when it starts. Open that URL with `/en`, for example `http://127.0.0.1:5184/en`. If port 5184 is busy, Vite automatically picks the next free port, so leave other running services alone and use that port with `/en` (for example `http://127.0.0.1:5186/en`). The app does not launch Chrome automatically. Production builds keep the `/tactica-fc/` prefix for GitHub Pages.

For the club-selection, career, tactics, training, transfers and live-match flow, see [the Turkish manager-career guide](docs/manager-career-guide.md).

## Build and package

Build the production web app into `dist/tactica-manager`:

```powershell
npm run build
```

Launch the desktop development app or build the Windows installer:

```powershell
npm run desktop:dev
npm run desktop:build
```

Build and synchronize the Android app with the shared TACTICA web runtime:

```powershell
npm run android:sync
npm run android:apk
```

## Match engine and viewer boundary

- The React/TypeScript game creates and advances `MatchSim`; it owns tactics, player choices, goals, match reports and results.
- `src/ui/OpenFootballPitch.tsx` adapts TACTICA snapshots and visual actions into the embedded Open Football viewer's recording format. The viewer draws the pitch/player/ball presentation and does not choose outcomes.
- `npm run dev`, `npm run build`, `npm test`, and the TACTICA desktop/Android launchers target the TACTICA app.
- `npm run open-football` is a separate development command for the vendored upstream application. It is not required to run a TACTICA career, and TACTICA does not connect to GitHub at runtime.

The game can use its included modern database. An optional CM 01/02 database import is user-controlled and uses data supplied by the owner; the original ISO and patch are not required and are not included in the application.

## Licensing and upstream attribution

The Open Football viewer source/assets remain attributed to [ZOXEXIVO/open-football](https://github.com/ZOXEXIVO/open-football), pinned in the vendored source at `9741ee9e2c7321b080676a5910e246b83fcd1430`, under Apache License 2.0. See `vendor/open-football/LICENSE` and bundled desktop notices. Only the viewer and the required viewer integration are used in the TACTICA product runtime; the upstream game server and management app are separate.
