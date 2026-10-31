use flate2::write::GzEncoder;
use flate2::Compression;
use std::fs;
use std::io::Write;
use std::path::Path;
use wasm_bindgen_cli_support::Bindgen;

fn main() -> Result<(), String> {
    let assets = std::env::args_os()
        .nth(1)
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "usage: cargo run --example tactica_stage -- <assets-dir>".to_string())?;
    let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let viewer_dir = crate_dir.parent().ok_or("missing viewer source directory")?;
    let wasm = viewer_dir
        .join("target")
        .join("wasm32-unknown-unknown")
        .join("release")
        .join("match_viewer.wasm");
    let staging = viewer_dir.join("target").join("tactica-stage");
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    fs::create_dir_all(&assets).map_err(|e| e.to_string())?;

    let mut bindgen = Bindgen::new();
    bindgen
        .input_path(wasm)
        .out_name("match_viewer")
        .typescript(false)
        .debug(false)
        .keep_debug(false)
        .remove_name_section(true)
        .remove_producers_section(true);
    bindgen.web(true).map_err(|e| e.to_string())?;
    bindgen.generate(&staging).map_err(|e| e.to_string())?;

    let raw_wasm = staging.join("match_viewer_bg.wasm");
    let optimized_wasm = staging.join("match_viewer.opt.wasm");
    wasm_opt::OptimizationOptions::new_optimize_for_size_aggressively()
        .enable_feature(wasm_opt::Feature::Simd)
        .enable_feature(wasm_opt::Feature::BulkMemory)
        .enable_feature(wasm_opt::Feature::TruncSat)
        .enable_feature(wasm_opt::Feature::SignExt)
        .enable_feature(wasm_opt::Feature::MutableGlobals)
        .enable_feature(wasm_opt::Feature::ReferenceTypes)
        .enable_feature(wasm_opt::Feature::Multivalue)
        .debug_info(false)
        .run(&raw_wasm, &optimized_wasm)
        .map_err(|e| format!("wasm-opt failed: {e}"))?;
    fs::rename(optimized_wasm, &raw_wasm).map_err(|e| e.to_string())?;

    for file in ["match_viewer.js", "match_viewer_bg.wasm"] {
        let bytes = fs::read(staging.join(file)).map_err(|e| e.to_string())?;
        fs::write(assets.join(file), &bytes).map_err(|e| e.to_string())?;
        let mut encoder = GzEncoder::new(Vec::new(), Compression::best());
        encoder.write_all(&bytes).map_err(|e| e.to_string())?;
        let zipped = encoder.finish().map_err(|e| e.to_string())?;
        fs::write(assets.join(format!("{file}.gz")), zipped).map_err(|e| e.to_string())?;
    }
    Ok(())
}
