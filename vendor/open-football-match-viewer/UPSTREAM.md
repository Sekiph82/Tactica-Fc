# Legacy Open Football viewer integration

This directory is an earlier TACTICA renderer integration prototype. It is
not the active match engine or viewer used by `npm run dev`. The current app
builds and runs the complete vendored Open Football application under
`vendor/open-football`, including its Rust match engine and Bevy/WebAssembly
viewer.

The prototype's viewer and shared crate were copied from
[`ZOXEXIVO/open-football`](https://github.com/ZOXEXIVO/open-football) at commit
`9741ee9e2c7321b080676a5910e246b83fcd1430`.

The upstream Apache License 2.0 text is retained in `LICENSE`. The active
application's license and attribution notices are in
`vendor/open-football/LICENSE` and `vendor/open-football/README.md`.
