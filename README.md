# TACTICA FC

TACTICA FC now uses the complete Open Football simulator and its native match replay viewer. The local integration is pinned to upstream commit `9741ee9e2c7321b080676a5910e246b83fcd1430`; the upstream Apache 2.0 license and notices are retained under `vendor/open-football`.

## Run on Windows

From this directory:

```powershell
npm run dev
```

Open [http://localhost:5184/tactica-fc/](http://localhost:5184/tactica-fc/). The launcher keeps the browser closed; open the link yourself. It limits match simulation to four threads to leave capacity for other work.

For the Turkish manager-career flow, see [the quick-start guide](docs/manager-career-guide.md).

Build the Windows binary with:

```powershell
npm run build
```

The Rust executable is created at `vendor/open-football/target/fast/open_football.exe`.

## Match playback

Open Football resolves matches with its own Rust engine and supplies player-position recordings to its Bevy/WebAssembly viewer. Match recordings are goal-focused by default; `--match-recording-full` is available for full 90-minute position recordings and has a higher storage cost. `npm run dev` enables match event text and keeps the default goal-focused recordings.

Open Football is a simulation-first game: the engine resolves matches automatically. This replaces TACTICA's previous TypeScript match simulator and match presentation. The broader Open Football application supplies its own teams, competitions, tactics, and management screens.

## Upstream

- Project: [ZOXEXIVO/open-football](https://github.com/ZOXEXIVO/open-football)
- Pinned revision: `9741ee9e2c7321b080676a5910e246b83fcd1430`
- License: Apache License 2.0 (`vendor/open-football/LICENSE`)

The Open Football source is vendored in this repository and is built locally by
`npm run dev` / `npm run build`. Starting the game does not fetch or connect to
the GitHub repository. Cargo may download Rust build crates on a first build if
they are not already cached. Upstream attribution and license notices are kept
with the vendored source.
