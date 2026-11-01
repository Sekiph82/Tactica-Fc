mod about;
mod ai;
mod champions_league;
mod common;
mod conference_league;
mod copa_libertadores;
mod countries;
mod cups;
mod date;
mod error;
mod europa_league;
mod face;
mod game;
pub mod i18n;
mod leagues;
mod r#match;
mod national_competitions;
mod player;
mod playoffs;
mod routes;
mod search;
pub mod settings;
mod staff;
mod teams;
mod views;
mod watchlist;
pub mod worker;
mod workers;

pub use settings::Settings;

pub use ai::{AiConfig, AiJobs, LlmSettings};
pub use error::{ApiError, ApiResult};
pub use game::{ManagerCareerSnapshot, ManagerCareerStore, WorldSaveStore};
pub use i18n::events::{EventI18n, EventI18nManager};
pub use i18n::news::{NewsI18n, NewsI18nManager};
pub use i18n::{I18n, I18nManager};
pub use worker::{
    DistributedDispatcher, WorkerRegistry, WorkerServer, WorkerSnapshot, WorkerStatus,
};

use crate::routes::ServerRoutes;
use axum::response::IntoResponse;
use core::SimulatorData;
use database::DatabaseEntity;
use log::{error, info};
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use tokio::net::TcpListener;
use tokio::sync::{Mutex, RwLock};
use tower::ServiceBuilder;
use tower_http::catch_panic::CatchPanicLayer;

pub struct FootballSimulatorServer {
    data: GameAppData,
}

impl FootballSimulatorServer {
    pub fn new(data: GameAppData) -> Self {
        FootballSimulatorServer { data }
    }

    pub async fn run(&self) {
        let app = ServerRoutes::create()
            .layer(ServiceBuilder::new()
                    // Catch panics in handlers and convert them to 500 errors
                    .layer(CatchPanicLayer::custom(|_err| {
                        (
                            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                            "Internal server error - handler panicked".to_string(),
                        )
                            .into_response()
                    })))
            .with_state(self.data.clone());

        let port = std::env::var("TACTICA_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(5184);
        let bind_ip = std::env::var("TACTICA_BIND_ADDRESS")
            .ok()
            .and_then(|value| value.parse::<std::net::IpAddr>().ok())
            .unwrap_or(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED));
        let addr = SocketAddr::from((bind_ip, port));

        let listener = match TcpListener::bind(addr).await {
            Ok(listener) => listener,
            Err(e) => {
                error!("Failed to bind to address {}: {}", addr, e);
                panic!("Cannot start server without binding to port");
            }
        };

        info!("listen at: http://localhost:{port}");

        if let Err(e) = axum::serve(listener, app).await {
            error!("Server error: {}", e);
            error!("Server stopped unexpectedly, but not crashing the process");
        }
    }
}

pub struct GameAppData {
    pub database: Arc<DatabaseEntity>,
    pub data: Arc<RwLock<Option<Arc<SimulatorData>>>>,
    /// The single local manager career currently attached to this server.
    /// The selected team ID is restored from `manager_career_store`; the
    /// full simulator world is restored from `world_save_store` when valid.
    pub manager_team_id: Arc<RwLock<Option<u32>>>,
    /// Append-only local persistence for the selected manager team. This is
    /// separate from, and does not persist, the simulator world graph.
    pub manager_career_store: Arc<game::ManagerCareerStore>,
    /// Compressed snapshots of the authoritative world, flushed after each
    /// processed day so results, transfers and calendar progress resume.
    pub world_save_store: Arc<game::WorldSaveStore>,
    /// Active or most recent managed fixture snapshot. Readable by the match
    /// controls while the world's day-processing task runs in the background.
    pub live_match_session: Arc<RwLock<Option<Arc<core::r#match::LiveMatchSession>>>>,
    pub process_lock: Arc<Mutex<()>>,
    pub cancel_flag: Arc<AtomicBool>,
    pub i18n: Arc<I18nManager>,
    /// Press vocabulary, scoped away from `i18n` so the chrome bundle every
    /// page clones stays small. Only the newspaper pages resolve against it.
    pub news_i18n: Arc<NewsI18nManager>,
    /// Happiness-event vocabulary, scoped for the same reason. Only the
    /// player events page resolves against it.
    pub events_i18n: Arc<EventI18nManager>,
    /// Live registry of distributed match workers. Always present;
    /// starts empty and is populated at runtime from the /workers page.
    pub workers: WorkerRegistry,
    /// In-memory OpenAI-compatible LLM contract, set from the home-page
    /// "AI" badge dialog. Unset until the operator saves settings.
    pub ai: AiConfig,
    /// In-flight AI agent runs, polled by the per-page report dialogs so
    /// tool calls stream in live.
    pub ai_jobs: AiJobs,
}

impl Clone for GameAppData {
    fn clone(&self) -> Self {
        GameAppData {
            database: Arc::clone(&self.database),
            data: Arc::clone(&self.data),
            manager_team_id: Arc::clone(&self.manager_team_id),
            manager_career_store: Arc::clone(&self.manager_career_store),
            world_save_store: Arc::clone(&self.world_save_store),
            live_match_session: Arc::clone(&self.live_match_session),
            process_lock: Arc::clone(&self.process_lock),
            cancel_flag: Arc::clone(&self.cancel_flag),
            i18n: Arc::clone(&self.i18n),
            news_i18n: Arc::clone(&self.news_i18n),
            events_i18n: Arc::clone(&self.events_i18n),
            workers: self.workers.clone(),
            ai: self.ai.clone(),
            ai_jobs: self.ai_jobs.clone(),
        }
    }
}
