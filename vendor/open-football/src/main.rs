#[cfg(target_os = "windows")]
use mimalloc::MiMalloc;
#[cfg(target_os = "linux")]
use tikv_jemallocator::Jemalloc;

// A scalable, thread-caching allocator matters more than any single hot
// path: the world sim fans out across every core and the OS heaps
// serialise concurrent alloc/free on a global lock, which becomes the
// dominant cost under that fan-out. jemalloc on Linux, mimalloc on
// Windows (the Windows system heap is the worst offender).
#[cfg(target_os = "linux")]
#[global_allocator]
static GLOBAL: Jemalloc = Jemalloc;

#[cfg(target_os = "windows")]
#[global_allocator]
static GLOBAL: MiMalloc = MiMalloc;

use database::{DatabaseEntity, DatabaseGenerator, DatabaseLoader};
use env_logger::Env;
use log::info;
use simulator_core::r#match::MatchDispatcherRegistry;
use simulator_core::utils::TimeEstimation;
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use web::{
    AiConfig, AiJobs, DistributedDispatcher, EventI18nManager, FootballSimulatorServer,
    GameAppData, I18nManager, ManagerCareerStore, NewsI18nManager, Settings, WorkerRegistry,
    WorkerServer, WorldSaveStore,
};

#[tokio::main]
pub async fn main() {
    color_eyre::install().unwrap();

    env_logger::Builder::from_env(Env::default().default_filter_or("debug")).init();

    info!("SIMD: {}", simulator_core::utils::cpu::simd_kernel_name());

    let settings = Settings::from_env();

    settings.apply();
    settings.log();

    // Worker mode: skip DB load + UI, just serve match RPCs.
    if settings.worker_mode {
        WorkerServer::new(settings.worker_port).run().await;
        return;
    }

    // Start with an empty worker registry — remote workers are added at
    // runtime from the /workers page. While the registry is empty the
    // dispatcher returns `Err` for every batch and the pool falls back
    // to the local rayon path.
    let workers = WorkerRegistry::empty();

    // Install the dispatcher into core. The pool will use it for every
    // batch from here on; empty registry → Err → local rayon fallback.
    // `local_threads` lets the coordinator host participate as a virtual
    // worker so its CPU isn't idle while remote workers crunch. We use
    // the same match_threads value as the local rayon pool.
    MatchDispatcherRegistry::set(Box::new(DistributedDispatcher::new(
        workers.clone(),
        tokio::runtime::Handle::current(),
        settings.match_threads,
    )));

    let (database, estimated) = TimeEstimation::estimate(DatabaseLoader::load);
    let manager_career_store = Arc::new(ManagerCareerStore::for_current_user());
    let database_signature = career_database_signature(&database);
    let world_save_store = Arc::new(WorldSaveStore::for_current_user(database_signature));
    let restored_world = world_save_store.load().unwrap_or_else(|error| {
        log::error!("failed to load career world save: {error}");
        None
    });
    let has_restored_world = restored_world.is_some();
    let (mut game_data, gen_ms) = match restored_world {
        Some(restored) => {
            // Generation seeds the process-global IDs for new academy/staff
            // records. A loaded career needs the same invariant without
            // constructing and then discarding a second 80k-player world.
            restored.seed_player_id_sequence();
            (restored, 0)
        }
        None => TimeEstimation::estimate(|| DatabaseGenerator::generate(&database)),
    };
    info!(
        "database loaded: {} ms, world {}: {} ms",
        estimated,
        if has_restored_world { "restored" } else { "generated" },
        gen_ms
    );

    let i18n = Arc::new(I18nManager::new());

    let news_i18n = Arc::new(NewsI18nManager::new());
    let events_i18n = Arc::new(EventI18nManager::new(&i18n));

    i18n.set_date(game_data.date);

    let manager_team_id = manager_career_store
        .load_team_id()
        .filter(|team_id| {
            game_data
                .team(*team_id)
                .is_some_and(|team| team.team_type == simulator_core::TeamType::Main)
        });
    if let Some(team_id) = manager_team_id {
        info!("restored manager team selection: {team_id}");
        if let Some(snapshot) = manager_career_store.load_snapshot(team_id) {
            if !has_restored_world {
                if snapshot.apply_to_simulation(&mut game_data, team_id) {
                    info!("restored manager tactics, lineup, training, and transfer-list choices");
                }
            }
            let replayed = snapshot.apply_pending_transfer_list_updates(&mut game_data, team_id);
            if replayed > 0 {
                info!("replayed {replayed} pending manager transfer-list change(s)");
            }
            let replayed = snapshot.apply_pending_transfer_negotiations(&mut game_data, team_id);
            if replayed > 0 {
                info!("replayed {replayed} pending manager transfer offer/update(s)");
            }
            let replayed = snapshot.apply_pending_transfer_responses(&mut game_data, team_id);
            if replayed > 0 {
                info!("replayed {replayed} pending manager transfer response(s)");
            }
        }
    }

    let data = GameAppData {
        database: Arc::new(database),
        data: Arc::new(RwLock::new(Some(Arc::new(game_data)))),
        manager_team_id: Arc::new(RwLock::new(manager_team_id)),
        manager_career_store,
        world_save_store,
        live_match_session: Arc::new(RwLock::new(None)),
        process_lock: Arc::new(Mutex::new(())),
        cancel_flag: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        i18n,
        news_i18n,
        events_i18n,
        workers,
        ai: AiConfig::new(),
        ai_jobs: AiJobs::new(),
    };

    // TACTICA FC leaves browser choice to the manager. The packaged runner
    // may opt in to the upstream convenience behavior explicitly.
    if std::env::var_os("TACTICA_NO_BROWSER").is_none() {
        let port = std::env::var("TACTICA_PORT").unwrap_or_else(|_| "5184".to_string());
        let url = format!("http://localhost:{port}/tactica-fc/");
        #[cfg(target_os = "windows")]
        {
            let _ = std::process::Command::new("cmd")
                .args(["/C", "start"])
                .arg(&url)
                .spawn();
        }
        #[cfg(target_os = "macos")]
        {
            let _ = std::process::Command::new("open").arg(&url).spawn();
        }
        #[cfg(target_os = "linux")]
        {
            let _ = std::process::Command::new("xdg-open").arg(&url).spawn();
        }
    }

    FootballSimulatorServer::new(data).run().await;
}

fn career_database_signature(database: &DatabaseEntity) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    env!("CARGO_PKG_VERSION").hash(&mut hasher);
    for continent in &database.continents {
        continent.id.hash(&mut hasher);
        continent.name.hash(&mut hasher);
        for country in database
            .countries
            .iter()
            .filter(|country| {
                country.continent_id == continent.id
                    && database
                        .leagues
                        .iter()
                        .any(|league| league.country_id == country.id)
            })
        {
            country.id.hash(&mut hasher);
            country.slug.hash(&mut hasher);
            country.name.hash(&mut hasher);
            for league in database
                .leagues
                .iter()
                .filter(|league| league.country_id == country.id)
            {
                league.id.hash(&mut hasher);
                league.slug.hash(&mut hasher);
                league.name.hash(&mut hasher);
            }
            // The original world signature included generated youth
            // subleagues appended after each country's real leagues. Recreate
            // those identity fields from the database so old career snapshots
            // remain compatible without generating the full world first.
            for parent in database
                .leagues
                .iter()
                .filter(|league| league.country_id == country.id)
            {
                for configured_type in &parent.sub_leagues_competitions {
                    let Some((team_type, type_offset)) = youth_team_type(configured_type) else {
                        continue;
                    };
                    let has_team_type = database.clubs.iter().any(|club| {
                        club.country_id == country.id
                            && club.teams.iter().any(|team| {
                                team.team_type == "Main" && team.league_id == Some(parent.id)
                            })
                            && club.teams.iter().any(|team| team.team_type == team_type)
                    });
                    if !has_team_type {
                        continue;
                    }

                    (parent.id + type_offset).hash(&mut hasher);
                    format!("{}-{}", parent.slug, team_type.to_ascii_lowercase())
                        .hash(&mut hasher);
                    format!("{} {}", parent.name, team_type).hash(&mut hasher);
                }
            }
            for club in database
                .clubs
                .iter()
                .filter(|club| club.country_id == country.id)
            {
                club.id.hash(&mut hasher);
                club.name.hash(&mut hasher);
            }
        }
    }
    format!("{}-{:016x}", env!("CARGO_PKG_VERSION"), hasher.finish())
}

fn youth_team_type(configured: &str) -> Option<(&'static str, u32)> {
    match configured {
        "U18" => Some(("U18", 100_000)),
        "U19" => Some(("U19", 110_000)),
        "U20" => Some(("U20", 120_000)),
        "U21" => Some(("U21", 130_000)),
        "U23" => Some(("U23", 140_000)),
        _ => None,
    }
}
