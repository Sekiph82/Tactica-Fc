//! Compressed, versioned snapshots of the authoritative football world.
//!
//! Saves are written to a fresh file and renamed into place before older
//! snapshots are pruned. If a write is interrupted, the previous snapshot
//! remains available for recovery.

use core::SimulatorData;
use flate2::Compression;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use memmap2::MmapOptions;
use serde::{Deserialize, Serialize};
use serde_wincode::SerdeCompat;
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use wincode::config::{Configuration, Deserialize as WincodeDeserialize};
use wincode::int_encoding::{LittleEndian, VarInt};
use wincode::io::std_write::WriteAdapter;
use wincode::len::BincodeLen;

const SCHEMA_VERSION: u32 = 1;
const FILE_PREFIX: &str = "career-world-";
const FILE_SUFFIX: &str = ".wincode.gz";
const RETAIN_SNAPSHOTS: usize = 2;
const MAX_WORLD_SAVE_BYTES: usize = 1_073_741_824;
type SaveCodec = Configuration<true, MAX_WORLD_SAVE_BYTES, BincodeLen, LittleEndian, VarInt, u32>;

#[derive(Serialize)]
struct WorldSaveRef<'a> {
    schema_version: u32,
    engine_version: String,
    database_signature: String,
    world: &'a SimulatorData,
}

#[derive(Deserialize)]
struct WorldSaveEnvelope {
    schema_version: u32,
    engine_version: String,
    database_signature: String,
    world: SimulatorData,
}

struct DecodedSaveTemp(PathBuf);

impl Drop for DecodedSaveTemp {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn decode_snapshot(path: &Path) -> io::Result<WorldSaveEnvelope> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temp_path = path.with_file_name(format!(
        "{}.decode-{}-{stamp}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(FILE_PREFIX),
        std::process::id()
    ));
    let mut decoded_file = OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&temp_path)?;
    let cleanup = DecodedSaveTemp(temp_path.clone());
    let decoder = GzDecoder::new(BufReader::new(File::open(path)?));
    let decoded_len = io::copy(
        &mut decoder.take(MAX_WORLD_SAVE_BYTES as u64 + 1),
        &mut decoded_file,
    )?;
    decoded_file.flush()?;

    if decoded_len == 0 || decoded_len > MAX_WORLD_SAVE_BYTES as u64 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("decoded snapshot size {decoded_len} is outside the supported range"),
        ));
    }

    // The Serde compatibility layer needs stable backing bytes for some enum
    // identifiers. A gzip stream cannot provide those borrows; a temporary
    // file mapping does so without allocating a second full-size heap buffer.
    let mapping = unsafe { MmapOptions::new().map(&decoded_file)? };
    let envelope =
        <SerdeCompat<WorldSaveEnvelope> as WincodeDeserialize<'_, SaveCodec>>::deserialize(
            mapping.as_ref(),
            SaveCodec::new(),
        )
        .map_err(io::Error::other)?;
    drop(mapping);
    drop(decoded_file);
    drop(cleanup);
    Ok(envelope)
}

pub struct WorldSaveStore {
    directory: PathBuf,
    database_signature: String,
    save_lock: Arc<Mutex<()>>,
}

impl WorldSaveStore {
    pub fn for_current_user(database_signature: String) -> Self {
        Self::new(
            super::manager_career_store::user_data_directory(),
            database_signature,
        )
    }

    pub fn new(directory: impl Into<PathBuf>, database_signature: String) -> Self {
        Self {
            directory: directory.into(),
            database_signature,
            save_lock: Arc::new(Mutex::new(())),
        }
    }

    /// Load the newest compatible snapshot, falling back to the previous
    /// snapshot if the newest file was truncated or cannot be decoded.
    pub fn load(&self) -> io::Result<Option<SimulatorData>> {
        let mut candidates = match fs::read_dir(&self.directory) {
            Ok(entries) => entries
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|path| is_world_save(path))
                .collect::<Vec<_>>(),
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        };
        candidates.sort();

        for path in candidates.into_iter().rev() {
            let decoded = decode_snapshot(&path);
            let envelope = match decoded {
                Ok(envelope) => envelope,
                Err(error) => {
                    log::warn!(
                        "ignoring unreadable career world save: {} ({error})",
                        path.display()
                    );
                    continue;
                }
            };
            if envelope.schema_version != SCHEMA_VERSION
                || envelope.engine_version != env!("CARGO_PKG_VERSION")
                || envelope.database_signature != self.database_signature
            {
                log::warn!(
                    "ignoring incompatible career world save: {} (schema {}/{}, engine {}/{}, database {}/{})",
                    path.display(),
                    envelope.schema_version,
                    SCHEMA_VERSION,
                    envelope.engine_version,
                    env!("CARGO_PKG_VERSION"),
                    envelope.database_signature,
                    self.database_signature,
                );
                continue;
            }

            let mut world = envelope.world;
            world.rebuild_derived_state();
            log::info!("restored career world snapshot from {}", path.display());
            return Ok(Some(world));
        }

        Ok(None)
    }

    /// Persist one complete world snapshot. Failed writes leave existing saves
    /// untouched; successful writes retain the latest two recovery points.
    pub fn save(&self, world: &SimulatorData) -> io::Result<()> {
        let started = Instant::now();
        let _guard = self
            .save_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        fs::create_dir_all(&self.directory)?;

        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let base_name = format!("{FILE_PREFIX}{stamp:032}{FILE_SUFFIX}");
        let final_path = self.directory.join(&base_name);
        let temp_path = self.directory.join(format!("{base_name}.tmp"));

        let result = (|| {
            let file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp_path)?;
            let mut encoder = GzEncoder::new(BufWriter::new(file), Compression::fast());
            {
                let writer = WriteAdapter::new(&mut encoder);
                let serializer = serde_wincode::Serializer::<_, SaveCodec>::new(writer);
                WorldSaveRef {
                    schema_version: SCHEMA_VERSION,
                    engine_version: env!("CARGO_PKG_VERSION").to_owned(),
                    database_signature: self.database_signature.clone(),
                    world,
                }
                .serialize(serializer)
                .map_err(io::Error::other)?;
            }
            let mut file = encoder.finish()?;
            file.flush()?;
            file.get_ref().sync_all()?;
            fs::rename(&temp_path, &final_path)?;
            let bytes = fs::metadata(&final_path)?.len();
            log::info!(
                "career world snapshot saved: {} bytes in {} ms",
                bytes,
                started.elapsed().as_millis()
            );
            Ok(())
        })();

        if let Err(error) = result {
            let _ = fs::remove_file(&temp_path);
            return Err(error);
        }

        if let Err(error) = self.prune_old_snapshots(&final_path) {
            // The new snapshot was already renamed into place. Report its
            // commit as successful; a pruning error must not make callers
            // roll back in-memory changes that are already durable on disk.
            log::warn!(
                "career world snapshot committed, but old snapshots could not be pruned: {error}"
            );
        }
        Ok(())
    }

    fn prune_old_snapshots(&self, newest: &Path) -> io::Result<()> {
        let mut snapshots = fs::read_dir(&self.directory)?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| is_world_save(path))
            .collect::<Vec<_>>();
        snapshots.sort();
        let keep = snapshots
            .iter()
            .rev()
            .take(RETAIN_SNAPSHOTS)
            .cloned()
            .collect::<std::collections::HashSet<_>>();
        for path in snapshots {
            if path != newest && !keep.contains(&path) {
                fs::remove_file(path)?;
            }
        }
        Ok(())
    }
}

fn is_world_save(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with(FILE_PREFIX) && name.ends_with(FILE_SUFFIX))
}
