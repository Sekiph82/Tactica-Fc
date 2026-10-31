use std::path::PathBuf;
use wasm_bindgen_cli_support::Bindgen;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let wasm = root.join("vendor/open-football-match-viewer/src/match/target/wasm32-unknown-unknown/release/match_viewer.wasm");
    let output = root.join("public/open-football-viewer");
    std::fs::create_dir_all(&output)?;

    let mut bindgen = Bindgen::new();
    bindgen
        .input_path(wasm)
        .out_name("match_viewer")
        .typescript(false)
        .debug(false)
        .keep_debug(false)
        .remove_name_section(true)
        .remove_producers_section(true);
    bindgen.web(true)?;
    bindgen.generate(&output)?;
    Ok(())
}
