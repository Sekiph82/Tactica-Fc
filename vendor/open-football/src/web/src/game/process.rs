use crate::GameAppData;
use crate::I18nManager;
use crate::r#match::stores::MatchStore;
use crate::game::{ManagerCareerStore, ManagerMatchReport, ManagerTrainingReport};
use axum::Json;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use core::FootballSimulator;
use core::MatchRuntime;
use core::r#match::LiveMatchSession;
use core::SimulationResult;
use core::SimulatorData;
use log::{debug, error};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use tokio::runtime::Handle;
use tokio::sync::Semaphore;
use tokio::task::{JoinSet, spawn_blocking};

#[derive(Deserialize)]
pub struct ProcessQuery {
    pub days: Option<u32>,
    pub league_ids: Option<String>,
}

fn manager_has_pending_transfer_decision(simulator_data: &SimulatorData, team_id: u32) -> bool {
    let Some(team) = simulator_data.team(team_id) else {
        return false;
    };
    if team.team_type != core::TeamType::Main {
        return false;
    }
    let club_id = team.club_id;
    simulator_data
        .continents
        .iter()
        .flat_map(|continent| &continent.countries)
        .flat_map(|country| country.transfer_market.negotiations.values())
        .any(|negotiation| {
            let club_phase = matches!(
                negotiation.phase,
                core::transfers::deal::negotiation::NegotiationPhase::ClubNegotiation { .. }
            );
            let manager_needs_to_respond = negotiation.manager_decision.is_none()
                && (negotiation.selling_club_id == club_id
                    && matches!(
                        negotiation.status,
                        core::transfers::deal::negotiation::NegotiationStatus::Pending
                            | core::transfers::deal::negotiation::NegotiationStatus::Countered
                    )
                    || negotiation.buying_club_id == club_id
                        && negotiation.status
                            == core::transfers::deal::negotiation::NegotiationStatus::Countered);
            club_phase && manager_needs_to_respond
        })
}

pub async fn game_process_action(
    State(state): State<GameAppData>,
    Query(query): Query<ProcessQuery>,
) -> impl IntoResponse {
    let days = query.days.unwrap_or(1);
    let Some(raw_league_ids) = query.league_ids else {
        return StatusCode::BAD_REQUEST;
    };
    let selected_leagues: HashSet<u32> = raw_league_ids
        .split(',')
        .filter(|part| !part.trim().is_empty())
        .filter_map(|part| part.trim().parse::<u32>().ok())
        .collect();
    if selected_leagues.is_empty()
        || raw_league_ids
            .split(',')
            .filter(|part| !part.trim().is_empty())
            .any(|part| part.trim().parse::<u32>().is_err())
    {
        return StatusCode::BAD_REQUEST;
    }

    // If already processing, return immediately
    let process_guard = match Arc::clone(&state.process_lock).try_lock_owned() {
        Ok(guard) => guard,
        Err(_) => return StatusCode::OK,
    };

    // Reset cancel flag at start
    state.cancel_flag.store(false, Ordering::SeqCst);

    // Keep the authoritative world behind the write lock for this processing
    // run. Copying SimulatorData here duplicates the full global player/team
    // graph (80k+ players) before every day advance. The match-view API and
    // manager live commands use their own session lock, so the active match
    // remains interactive while world-reading pages wait for the completed
    // tick to publish.
    let data_guard = Arc::clone(&state.data).write_owned().await;
    if data_guard.is_none() {
        return StatusCode::SERVICE_UNAVAILABLE;
    }
    let manager_team_id = *state.manager_team_id.read().await;
    if manager_team_id.is_some_and(|team_id| {
        data_guard
            .as_ref()
            .is_some_and(|simulator_data| manager_has_pending_transfer_decision(simulator_data, team_id))
    }) {
        return StatusCode::CONFLICT;
    }
    let mut player_names = HashMap::new();
    if manager_team_id.is_some() && let Some(simulator_data) = data_guard.as_ref() {
        for continent in &simulator_data.continents {
            for country in &continent.countries {
                for club in &country.clubs {
                    for team in &club.teams.teams {
                        for player in &team.players.players {
                            player_names.insert(player.id, player.full_name.to_string());
                        }
                    }
                }
            }
        }
    }

    let run = ProcessingRun {
        handle: Handle::current(),
        i18n: Arc::clone(&state.i18n),
        cancel_flag: Arc::clone(&state.cancel_flag),
        selected_leagues,
        manager_team_id,
        manager_career_store: Arc::clone(&state.manager_career_store),
        world_save_store: Arc::clone(&state.world_save_store),
        live_session: {
            let session = manager_team_id.map(|team_id| {
                Arc::new(LiveMatchSession::with_player_names(
                    team_id,
                    player_names,
                ))
            });
            *state.live_match_session.write().await = session.clone();
            MatchRuntime::set_live_session(session.clone());
            session
        },
    };

    // Run CPU-bound simulation on the blocking thread pool so tokio worker
    // threads stay free to serve HTTP requests while processing runs.
    // Await completion so the client knows when processing is done.
    let join_result = spawn_blocking(move || {
        let _guard = process_guard;
        let mut data_guard = data_guard;
        let world = data_guard
            .as_mut()
            .expect("world was checked before starting the processing task");
        run.execute(Arc::make_mut(world), days);
    })
    .await;

    if let Err(err) = join_result {
        MatchRuntime::set_live_session(None);
        error!("game process task failed: {err}");
        return StatusCode::INTERNAL_SERVER_ERROR;
    }

    StatusCode::OK
}

/// One processing run behind `POST /api/game/process`.
struct ProcessingRun {
    handle: Handle,
    i18n: Arc<I18nManager>,
    cancel_flag: Arc<AtomicBool>,
    selected_leagues: HashSet<u32>,
    manager_team_id: Option<u32>,
    manager_career_store: Arc<ManagerCareerStore>,
    live_session: Option<Arc<LiveMatchSession>>,
    world_save_store: Arc<super::WorldSaveStore>,
}

impl ProcessingRun {
    /// Simulate `days` daily ticks directly in the exclusively-held world.
    /// Match frames and live coach/substitution commands remain available via
    /// their independent session API while manager pages queue behind the
    /// world lock until the final tick is committed.
    fn execute(self, simulator_data: &mut SimulatorData, days: u32) {
        for _ in 0..days {
            // Check cancellation before each day
            if self.cancel_flag.load(Ordering::SeqCst) {
                break;
            }

            let day = simulator_data.date.date().to_string();
            let training_before: HashMap<u32, u16> = self.manager_team_id
                .and_then(|team_id| simulator_data.team(team_id))
                .map(|team| team.players.players.iter()
                    .map(|player| (player.id, player.training.sessions_completed))
                    .collect())
                .unwrap_or_default();
            let result = self
                .handle
                .block_on(FootballSimulator::simulate_selected_with(
                    &mut *simulator_data,
                    &core::SimulatorConfig::default(),
                    &self.selected_leagues,
                ));
            if let Some(manager_team_id) = self.manager_team_id {
                let reports: Vec<_> = result.match_results.iter()
                    .filter_map(|match_result| {
                        let is_home = match_result.home_team_id == manager_team_id;
                        let is_away = match_result.away_team_id == manager_team_id;
                        if !is_home && !is_away { return None; }
                        let opponent_id = if is_home { match_result.away_team_id } else { match_result.home_team_id };
                        let opponent = simulator_data.team(opponent_id)?.name.clone();
                        let home_goals = match_result.score.home_team.get();
                        let away_goals = match_result.score.away_team.get();
                        Some(ManagerMatchReport {
                            match_id: match_result.id.clone(),
                            date: day.clone(),
                            opponent,
                            score: if is_home { format!("{home_goals}–{away_goals}") } else { format!("{away_goals}–{home_goals}") },
                            is_home,
                        })
                    })
                    .collect();
                if !reports.is_empty() {
                    if let Err(error) = self.manager_career_store.update_snapshot(manager_team_id, |snapshot| {
                        for report in reports { snapshot.record_match_report(report); }
                    }) {
                        error!("failed to persist manager match reports: {error}");
                    }
                }
                if let Some(report) = Self::training_report(simulator_data, manager_team_id, &day, &training_before) {
                    if let Err(error) = self.manager_career_store.update_snapshot(manager_team_id, |snapshot| {
                        snapshot.record_training_report(report);
                    }) {
                        error!("failed to persist manager training report: {error}");
                    }
                }
            }
            if result.has_match_results() && MatchRuntime::recordings_mode() {
                self.handle.block_on(Self::write_match_results(result));
            }
            self.i18n.set_date(simulator_data.date);
            if let Err(error) = self.world_save_store.save(simulator_data) {
                error!("failed to persist career world snapshot: {error}");
            }
        }

        self.cancel_flag.store(false, Ordering::SeqCst);
        if let Some(session) = &self.live_session {
            session.finish();
        }
        MatchRuntime::set_live_session(None);
        self.i18n.set_date(simulator_data.date);
    }

    fn training_report(
        simulator_data: &SimulatorData,
        manager_team_id: u32,
        day: &str,
        before: &HashMap<u32, u16>,
    ) -> Option<ManagerTrainingReport> {
        let team = simulator_data.team(manager_team_id)?;
        let mut trained: Vec<_> = team.players.players.iter()
            .filter(|player| player.training.sessions_completed > before.get(&player.id).copied().unwrap_or(0))
            .map(|player| {
                let form = (player.training.training_performance * 10.0).round().clamp(10.0, 200.0) as u8;
                (player.full_name.to_string(), form)
            })
            .collect();
        if trained.is_empty() {
            return None;
        }
        trained.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
        let (lowest_player, lowest_performance_tenths) = trained.first()?.clone();
        let (best_player, best_performance_tenths) = trained.last()?.clone();
        let focus = match team.training_schedule.manager_focus {
            core::ManagerTrainingFocus::Balanced => "balanced",
            core::ManagerTrainingFocus::Fitness => "fitness",
            core::ManagerTrainingFocus::Technical => "technical",
            core::ManagerTrainingFocus::Tactical => "tactical",
            core::ManagerTrainingFocus::SetPieces => "set_pieces",
            core::ManagerTrainingFocus::Recovery => "recovery",
        };
        Some(ManagerTrainingReport {
            date: day.to_string(),
            trained_players: trained.len().min(u8::MAX as usize) as u8,
            focus: focus.to_string(),
            best_player,
            best_performance_tenths,
            lowest_player,
            lowest_performance_tenths,
        })
    }

    async fn write_match_results(result: SimulationResult) {
        let now = Instant::now();

        let max_concurrent = MatchRuntime::store_max_threads();
        let semaphore = Arc::new(Semaphore::new(max_concurrent));

        let mut tasks = JoinSet::new();

        // Friendlies are stored too — see `Match::play` for why the exclusion
        // that used to sit here is gone. `MatchRuntime::recordings_mode()`,
        // checked by the caller, is now the only thing that decides whether a
        // match is written, and it decides it the same way for every match.
        for match_result in result.match_results {
            let permit = Arc::clone(&semaphore);
            tasks.spawn(async move {
                let _permit = permit.acquire().await.unwrap();
                MatchStore::store(match_result).await;
            });
        }

        tasks.join_all().await;

        let elapsed = now.elapsed();
        debug!("match results stored in {} ms", elapsed.as_millis());
    }
}

#[derive(Serialize)]
pub struct ProcessingStatus {
    pub processing: bool,
}

pub async fn game_processing_status_action(
    State(state): State<GameAppData>,
) -> Json<ProcessingStatus> {
    let processing = state.process_lock.try_lock().is_err();
    Json(ProcessingStatus { processing })
}

pub async fn game_cancel_action(State(state): State<GameAppData>) -> StatusCode {
    state.cancel_flag.store(true, Ordering::SeqCst);
    StatusCode::OK
}
