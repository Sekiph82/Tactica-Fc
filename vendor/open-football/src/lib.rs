#![allow(dead_code)]

// Share the canonical server bootstrap with the Android JNI host. The Windows
// desktop binary continues to use the same `src/main.rs` entry point.
include!("main.rs");

pub use main as run_server;
