use crate::GameAppData;
use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use core::shared::currency::{Currency, CurrencyValue};
use core::transfers::deal::negotiation::{
    NegotiationPhase, NegotiationStatus, TransferNegotiation,
};
use core::transfers::deal::offer::{PersonalTermsOffer, TransferOffer};
use core::transfers::market::TransferListingStatus;
use core::{
    IndividualTrainingPlan, MatchTacticType, Person, RoleFamiliarity, SkillType, TacticalStyle,
    Tactics, TrainingFocus,
};
use serde::Deserialize;
use std::sync::Arc;

#[derive(Deserialize)]
pub struct TacticRequest {
    pub formation: String,
    pub style: Option<String>,
    pub pressing: Option<u8>,
    pub defensive_line: Option<u8>,
}

#[derive(Deserialize)]
pub struct LineupRequest {
    pub slots: Vec<Option<u32>>,
}

#[derive(Deserialize)]
pub struct TrainingRequest {
    pub focus: String,
}

#[derive(Deserialize)]
pub struct TeamTrainingFocusRequest {
    pub focus: String,
}

#[derive(Deserialize)]
pub struct TransferOfferRequest {
    pub player_id: u32,
    pub fee: f64,
    pub annual_wage: u32,
    pub contract_years: u8,
    pub loan_duration_months: Option<u8>,
}

fn validate_transfer_offer_request(body: &TransferOfferRequest) -> Result<(), StatusCode> {
    if !body.fee.is_finite()
        || body.fee <= 0.0
        || !(1..=6).contains(&body.contract_years)
        || (body.loan_duration_months.is_none() && body.annual_wage == 0)
        || body
            .loan_duration_months
            .is_some_and(|months| !matches!(months, 3 | 6 | 12))
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct TransferNegotiationUpdateRequest {
    pub negotiation_id: u32,
    pub fee: Option<f64>,
    pub annual_wage: Option<u32>,
    pub contract_years: u8,
}

#[derive(Deserialize)]
pub struct TransferSellerDecisionRequest {
    pub negotiation_id: u32,
    pub accept: bool,
}

fn queue_manager_seller_decision(
    negotiation: &mut TransferNegotiation,
    accept: bool,
) -> Result<(), StatusCode> {
    if !matches!(
        &negotiation.status,
        NegotiationStatus::Pending | NegotiationStatus::Countered
    ) || !matches!(
        &negotiation.phase,
        NegotiationPhase::ClubNegotiation { .. }
    ) || negotiation.manager_seller_decision.is_some()
    {
        return Err(StatusCode::CONFLICT);
    }
    negotiation.manager_seller_decision = Some(accept);
    Ok(())
}

async fn managed_team_id(state: &GameAppData) -> Option<u32> {
    *state.manager_team_id.read().await
}

pub async fn set_tactics_action(
    State(state): State<GameAppData>,
    Json(body): Json<TacticRequest>,
) -> StatusCode {
    let Some(team_id) = managed_team_id(&state).await else {
        return StatusCode::FORBIDDEN;
    };
    let tactic_type = match body.formation.as_str() {
        "T442" => MatchTacticType::T442,
        "T433" => MatchTacticType::T433,
        "T451" => MatchTacticType::T451,
        "T4231" => MatchTacticType::T4231,
        "T352" => MatchTacticType::T352,
        "T442Diamond" => MatchTacticType::T442Diamond,
        "T442DiamondWide" => MatchTacticType::T442DiamondWide,
        "T442Narrow" => MatchTacticType::T442Narrow,
        "T4141" => MatchTacticType::T4141,
        "T4411" => MatchTacticType::T4411,
        "T343" => MatchTacticType::T343,
        "T1333" => MatchTacticType::T1333,
        "T4312" => MatchTacticType::T4312,
        "T4222" => MatchTacticType::T4222,
        _ => return StatusCode::BAD_REQUEST,
    };
    let requested_style = match body.style.as_deref() {
        None => None,
        Some("attacking") => Some(TacticalStyle::Attacking),
        Some("defensive") => Some(TacticalStyle::Defensive),
        Some("balanced") => Some(TacticalStyle::Balanced),
        Some("possession") => Some(TacticalStyle::Possession),
        Some("counterattack") => Some(TacticalStyle::Counterattack),
        Some("wing_play") => Some(TacticalStyle::WingPlay),
        Some("wide_play") => Some(TacticalStyle::WidePlay),
        Some("compact") => Some(TacticalStyle::Compact),
        Some("experimental") => Some(TacticalStyle::Experimental),
        Some(_) => return StatusCode::BAD_REQUEST,
    };
    if body.pressing.is_some_and(|value| value > 10)
        || body.defensive_line.is_some_and(|value| value > 10)
    {
        return StatusCode::BAD_REQUEST;
    }

    let data = Arc::clone(&state.data);
    let mut guard = data.write().await;
    let Some(sim) = guard.as_mut() else {
        return StatusCode::SERVICE_UNAVAILABLE;
    };
    let sim = Arc::make_mut(sim);
    let Some(team) = sim.team(team_id) else {
        return StatusCode::NOT_FOUND;
    };
    if team.team_type != core::TeamType::Main {
        return StatusCode::FORBIDDEN;
    }
    let previous_lineup = team
        .tactics
        .as_ref()
        .filter(|tactics| tactics.manager_controlled)
        .map(|tactics| tactics.manager_lineup.clone())
        .unwrap_or_default();
    let previous_pinned: Vec<_> = team
        .players
        .players
        .iter()
        .filter(|player| player.is_force_match_selection)
        .map(|player| player.id)
        .collect();
    let previous_style = team
        .tactics
        .as_ref()
        .filter(|tactics| tactics.manager_controlled)
        .and_then(|tactics| tactics.manager_tactical_style);
    let previous_pressing = team
        .tactics
        .as_ref()
        .filter(|tactics| tactics.manager_controlled)
        .and_then(|tactics| tactics.manager_pressing_override);
    let previous_line = team
        .tactics
        .as_ref()
        .filter(|tactics| tactics.manager_controlled)
        .and_then(|tactics| tactics.manager_line_override);
    let Some(team) = sim.team_mut(team_id) else {
        return StatusCode::NOT_FOUND;
    };
    let mut tactics = Tactics::new(tactic_type);
    tactics.manager_controlled = true;
    tactics.manager_tactical_style = requested_style.or(previous_style);
    tactics.manager_pressing_override = body
        .pressing
        .map(|value| value as f32 / 10.0)
        .or(previous_pressing);
    tactics.manager_line_override = body
        .defensive_line
        .map(|value| value as f32 / 10.0)
        .or(previous_line);
    let manager_lineup = remap_manager_lineup(team, &tactics, &previous_lineup);
    let pinned_player_ids = if manager_lineup.iter().any(Option::is_some) {
        manager_lineup.iter().flatten().copied().collect()
    } else {
        previous_pinned
    };
    if let Err(error) = state.manager_career_store.update_snapshot(team_id, |snapshot| {
        snapshot.formation = Some(body.formation.clone());
        if let Some(style) = body.style.as_ref() { snapshot.style = Some(style.clone()); }
        if let Some(pressing) = body.pressing { snapshot.pressing = Some(pressing); }
        if let Some(line) = body.defensive_line { snapshot.defensive_line = Some(line); }
        snapshot.lineup = manager_lineup.clone();
        snapshot.pinned_player_ids = pinned_player_ids;
    }) {
        log::error!("failed to persist manager formation and remapped lineup: {error}");
        return StatusCode::INTERNAL_SERVER_ERROR;
    }
    tactics.manager_lineup = manager_lineup;
    team.tactics = Some(tactics);
    StatusCode::OK
}

/// Mark current club and followed-league editions plus stored match reports
/// as read. The edition numbers are resolved from the authoritative world.
pub async fn manager_mark_news_read_action(State(state): State<GameAppData>) -> StatusCode {
    let Some(team_id) = managed_team_id(&state).await else {
        return StatusCode::FORBIDDEN;
    };
    let (latest_issue, followed_issue_numbers) = {
        let guard = state.data.read().await;
        let Some(data) = guard.as_ref() else {
            return StatusCode::SERVICE_UNAVAILABLE;
        };
        let Some(team) = data.team(team_id) else {
            return StatusCode::NOT_FOUND;
        };
        let snapshot = state.manager_career_store.load_snapshot(team_id).unwrap_or_default();
        let followed = snapshot.followed_league_ids.iter().filter_map(|league_id| {
            let issue = data.league(*league_id)?.newsroom.latest().map(|issue| issue.number).unwrap_or(0);
            Some((*league_id, issue))
        }).collect::<Vec<_>>();
        (team.newsroom.latest().map(|issue| issue.number).unwrap_or(0), followed)
    };
    match state.manager_career_store.update_snapshot(team_id, |snapshot| {
        snapshot.last_read_newspaper_issue = snapshot.last_read_newspaper_issue.max(latest_issue);
        for (league_id, issue_number) in followed_issue_numbers {
            let last_read = snapshot.last_read_league_issues.entry(league_id).or_default();
            *last_read = (*last_read).max(issue_number);
        }
        snapshot.last_read_match_reports = snapshot.match_reports.len();
    }) {
        Ok(_) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

/// Mark the stored managed-team match reports as read without changing the
/// authoritative match history or its replay data.
pub async fn manager_mark_match_reports_read_action(State(state): State<GameAppData>) -> StatusCode {
    let Some(team_id) = managed_team_id(&state).await else {
        return StatusCode::FORBIDDEN;
    };
    match state.manager_career_store.update_snapshot(team_id, |snapshot| {
        snapshot.last_read_match_reports = snapshot.match_reports.len();
    }) {
        Ok(_) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

pub async fn manager_toggle_follow_league_action(
    State(state): State<GameAppData>,
    Path(league_id): Path<u32>,
) -> StatusCode {
    let Some(team_id) = managed_team_id(&state).await else {
        return StatusCode::FORBIDDEN;
    };
    let latest_issue = {
        let guard = state.data.read().await;
        let Some(data) = guard.as_ref() else {
            return StatusCode::SERVICE_UNAVAILABLE;
        };
        let Some(league) = data.league(league_id) else {
            return StatusCode::NOT_FOUND;
        };
        league.newsroom.latest().map(|issue| issue.number).unwrap_or(0)
    };
    match state.manager_career_store.update_snapshot(team_id, |snapshot| {
        if snapshot.followed_league_ids.contains(&league_id) {
            snapshot.followed_league_ids.retain(|id| *id != league_id);
            snapshot.last_read_league_issues.remove(&league_id);
        } else {
            snapshot.followed_league_ids.push(league_id);
            snapshot.last_read_league_issues.insert(league_id, latest_issue);
        }
    }) {
        Ok(_) => StatusCode::NO_CONTENT,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

pub async fn manager_mark_league_news_read_action(
    State(state): State<GameAppData>,
    Path(league_id): Path<u32>,
) -> StatusCode {
    let Some(team_id) = managed_team_id(&state).await else {
        return StatusCode::FORBIDDEN;
    };
    let latest_issue = {
        let guard = state.data.read().await;
        let Some(data) = guard.as_ref() else {
            return StatusCode::SERVICE_UNAVAILABLE;
        };
        let Some(league) = data.league(league_id) else {
            return StatusCode::NOT_FOUND;
        };
        league.newsroom.latest().map(|issue| issue.number).unwrap_or(0)
    };
    let result = state.manager_career_store.update_snapshot(team_id, |snapshot| {
        if snapshot.followed_league_ids.contains(&league_id) {
            let last_read = snapshot.last_read_league_issues.entry(league_id).or_default();
            *last_read = (*last_read).max(latest_issue);
        }
    });
    match result {
        Ok(snapshot) if snapshot.followed_league_ids.contains(&league_id) => StatusCode::NO_CONTENT,
        Ok(_) => StatusCode::FORBIDDEN,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

/// Keep the manager's chosen XI when the formation changes, moving players
/// into the new shape's most familiar positions. Any picks that cannot be
/// matched by a playable position are retained in the remaining slots, so a
/// formation change never silently drops a selected starter.
fn remap_manager_lineup(
    team: &core::Team,
    tactics: &Tactics,
    previous: &[Option<u32>],
) -> Vec<Option<u32>> {
    if previous.is_empty() {
        return Vec::new();
    }

    let mut selected_ids = Vec::new();
    for player_id in previous.iter().flatten().copied() {
        if !selected_ids.contains(&player_id)
            && team
                .players
                .players
                .iter()
                .any(|player| player.id == player_id)
        {
            selected_ids.push(player_id);
        }
    }

    let positions = tactics.positions();
    let players: Vec<_> = selected_ids
        .iter()
        .filter_map(|id| team.players.players.iter().find(|player| player.id == *id))
        .collect();
    let mut pairings = Vec::with_capacity(players.len() * positions.len());
    for (player_index, player) in players.iter().enumerate() {
        for (slot_index, position) in positions.iter().enumerate() {
            let strength = RoleFamiliarity::strength_at_slot(
                player.player_attributes.current_ability,
                &player.positions,
                *position,
            );
            if strength > 0.0 {
                pairings.push((strength, player_index, slot_index));
            }
        }
    }
    pairings.sort_by(|left, right| {
        right
            .0
            .total_cmp(&left.0)
            .then_with(|| left.1.cmp(&right.1))
            .then_with(|| left.2.cmp(&right.2))
    });

    let mut mapped = vec![None; positions.len()];
    let mut used_players = vec![false; players.len()];
    for (_, player_index, slot_index) in pairings {
        if !used_players[player_index] && mapped[slot_index].is_none() {
            mapped[slot_index] = Some(players[player_index].id);
            used_players[player_index] = true;
        }
    }

    // Keep any remaining manager picks, even if their position familiarity
    // is zero, rather than turning a formation change into an XI reset.
    let remaining = selected_ids
        .into_iter()
        .filter(|id| !mapped.contains(&Some(*id)))
        .collect::<Vec<_>>();
    let mut remaining = remaining.into_iter();
    for slot in &mut mapped {
        if slot.is_none() {
            *slot = remaining.next();
        }
    }
    mapped
}

pub async fn set_lineup_action(
    State(state): State<GameAppData>,
    Json(body): Json<LineupRequest>,
) -> StatusCode {
    let Some(team_id) = managed_team_id(&state).await else {
        return StatusCode::FORBIDDEN;
    };
    let data = Arc::clone(&state.data);
    let mut guard = data.write().await;
    let Some(sim) = guard.as_mut() else {
        return StatusCode::SERVICE_UNAVAILABLE;
    };
    let sim = Arc::make_mut(sim);
    let Some(team) = sim.team(team_id) else {
        return StatusCode::NOT_FOUND;
    };
    if team.team_type != core::TeamType::Main {
        return StatusCode::FORBIDDEN;
    }
    let current_tactics = team.tactics();
    let positions = current_tactics.positions();
    if body.slots.len() != positions.len() {
        return StatusCode::BAD_REQUEST;
    }
    let mut selected_ids = std::collections::HashSet::new();
    for player_id in body.slots.iter().flatten() {
        if !selected_ids.insert(*player_id) {
            return StatusCode::CONFLICT;
        }
        let Some(player) = team.players.players.iter().find(|p| p.id == *player_id) else {
            return StatusCode::BAD_REQUEST;
        };
        if player.is_loaned_out_from(team.club_id) || !player.is_ready_for_match() {
            return StatusCode::BAD_REQUEST;
        }
    }
    let pinned_player_ids: Vec<_> = body.slots.iter().flatten().copied().collect();
    if let Err(error) = state.manager_career_store.update_snapshot(team_id, |snapshot| {
        snapshot.lineup = body.slots.clone();
        snapshot.pinned_player_ids = pinned_player_ids;
    }) {
        log::error!("failed to persist manager lineup: {error}");
        return StatusCode::INTERNAL_SERVER_ERROR;
    }
    let Some(team) = sim.team_mut(team_id) else {
        return StatusCode::NOT_FOUND;
    };
    let tactics = team
        .tactics
        .get_or_insert_with(|| Tactics::new(MatchTacticType::T442));
    tactics.manager_lineup = body.slots;
    tactics.manager_controlled = true;
    for player in &mut team.players.players {
        player.is_force_match_selection = selected_ids.contains(&player.id);
    }
    StatusCode::OK
}

pub async fn set_training_action(
    State(state): State<GameAppData>,
    Path(player_id): Path<u32>,
    Json(body): Json<TrainingRequest>,
) -> StatusCode {
    let Some(team_id) = managed_team_id(&state).await else {
        return StatusCode::FORBIDDEN;
    };
    let focus = match body.focus.as_str() {
        "none" => None,
        "fitness" => Some(TrainingFocus::FitnessBuilding),
        "mental" => Some(TrainingFocus::MentalDevelopment),
        "free_kicks" => Some(TrainingFocus::SpecificSkill(SkillType::FreeKicks)),
        "long_shots" => Some(TrainingFocus::SpecificSkill(SkillType::LongShots)),
        "heading" => Some(TrainingFocus::SpecificSkill(SkillType::Heading)),
        "tackling" => Some(TrainingFocus::SpecificSkill(SkillType::Tackling)),
        "crossing" => Some(TrainingFocus::SpecificSkill(SkillType::Crossing)),
        "dribbling" => Some(TrainingFocus::SpecificSkill(SkillType::Dribbling)),
        "weak_foot" => Some(TrainingFocus::WeakFootImprovement),
        _ => return StatusCode::BAD_REQUEST,
    };

    let data = Arc::clone(&state.data);
    let mut guard = data.write().await;
    let Some(sim) = guard.as_mut() else {
        return StatusCode::SERVICE_UNAVAILABLE;
    };
    let Some(team) = sim.team(team_id) else {
        return StatusCode::NOT_FOUND;
    };
    if team.team_type != core::TeamType::Main {
        return StatusCode::FORBIDDEN;
    }
    let sim = Arc::make_mut(sim);
    let date = sim.date.date();
    let Some(team) = sim.team_mut(team_id) else {
        return StatusCode::NOT_FOUND;
    };
    let Some(player) = team.players.players.iter_mut().find(|p| p.id == player_id) else {
        return StatusCode::NOT_FOUND;
    };

    if let Err(error) = state.manager_career_store.update_snapshot(team_id, |snapshot| {
        snapshot.player_training.insert(player_id, body.focus.clone());
    }) {
        log::error!("failed to persist player training focus: {error}");
        return StatusCode::INTERNAL_SERVER_ERROR;
    }

    player.individual_training = focus.map(|focus| IndividualTrainingPlan {
        player_id,
        focus_areas: vec![focus],
        intensity_modifier: 1.0,
        special_instructions: Vec::new(),
        started: Some(date),
    });
    StatusCode::OK
}

pub async fn set_team_training_focus_action(
    State(state): State<GameAppData>,
    Json(body): Json<TeamTrainingFocusRequest>,
) -> StatusCode {
    let Some(team_id) = managed_team_id(&state).await else {
        return StatusCode::FORBIDDEN;
    };
    let focus = match body.focus.as_str() {
        "balanced" => core::ManagerTrainingFocus::Balanced,
        "fitness" => core::ManagerTrainingFocus::Fitness,
        "technical" => core::ManagerTrainingFocus::Technical,
        "tactical" => core::ManagerTrainingFocus::Tactical,
        "set_pieces" => core::ManagerTrainingFocus::SetPieces,
        "recovery" => core::ManagerTrainingFocus::Recovery,
        _ => return StatusCode::BAD_REQUEST,
    };
    let data = Arc::clone(&state.data);
    let mut guard = data.write().await;
    let Some(sim) = guard.as_mut() else {
        return StatusCode::SERVICE_UNAVAILABLE;
    };
    let Some(team) = sim.team(team_id) else {
        return StatusCode::NOT_FOUND;
    };
    if team.team_type != core::TeamType::Main {
        return StatusCode::FORBIDDEN;
    }
    if let Err(error) = state.manager_career_store.update_snapshot(team_id, |snapshot| {
        snapshot.team_training_focus = Some(body.focus.clone());
    }) {
        log::error!("failed to persist team training focus: {error}");
        return StatusCode::INTERNAL_SERVER_ERROR;
    }
    let Some(team) = Arc::make_mut(sim).team_mut(team_id) else {
        return StatusCode::NOT_FOUND;
    };
    team.training_schedule.manager_focus = focus;
    StatusCode::OK
}

pub async fn toggle_transfer_list_action(
    State(state): State<GameAppData>,
    Path(player_id): Path<u32>,
) -> StatusCode {
    let Some(team_id) = managed_team_id(&state).await else {
        return StatusCode::FORBIDDEN;
    };

    let data = Arc::clone(&state.data);
    let mut guard = data.write().await;
    let Some(sim) = guard.as_mut() else {
        return StatusCode::SERVICE_UNAVAILABLE;
    };
    let sim = Arc::make_mut(sim);
    let date = sim.date.date();
    let Some(team) = sim.team(team_id) else {
        return StatusCode::NOT_FOUND;
    };
    let club_score = team.reputation.market_value_score();
    let league_rep = team.league_reputation;
    let Some(player) = team.players.players.iter().find(|p| p.id == player_id) else {
        return StatusCode::NOT_FOUND;
    };
    if player.is_on_loan() {
        return StatusCode::BAD_REQUEST;
    }
    let listed = player.statuses.has(core::PlayerStatusType::Lst);
    let asking_price = player.value(date, league_rep, club_score);
    if let Err(error) = state.manager_career_store.update_snapshot(team_id, |snapshot| {
        if listed {
            snapshot.listed_player_ids.retain(|id| *id != player_id);
        } else if !snapshot.listed_player_ids.contains(&player_id) {
            snapshot.listed_player_ids.push(player_id);
        }
    }) {
        log::error!("failed to persist manager transfer list: {error}");
        return StatusCode::INTERNAL_SERVER_ERROR;
    }
    let team = sim.team_mut(team_id).expect("team was just resolved");
    let player = team
        .players
        .players
        .iter_mut()
        .find(|p| p.id == player_id)
        .expect("player was just resolved");
    if listed {
        player.statuses.remove(core::PlayerStatusType::Lst);
        if let Some(contract) = player.contract.as_mut() {
            contract.is_transfer_listed = false;
        }
    } else {
        player.statuses.add(date, core::PlayerStatusType::Lst);
        if let Some(contract) = player.contract.as_mut() {
            contract.is_transfer_listed = true;
        }
    }
    // End the player borrow before mutating the sibling transfer-list field.
    if listed {
        team.transfer_list.remove(player_id);
    } else {
        team.add_player_to_transfer_list(
            player_id,
            CurrencyValue::new(asking_price, Currency::Usd),
        );
    }
    StatusCode::OK
}

pub async fn toggle_match_selection_action(
    State(state): State<GameAppData>,
    Path(player_id): Path<u32>,
) -> StatusCode {
    let Some(team_id) = managed_team_id(&state).await else {
        return StatusCode::FORBIDDEN;
    };
    let data = Arc::clone(&state.data);
    let mut guard = data.write().await;
    let Some(sim) = guard.as_mut() else {
        return StatusCode::SERVICE_UNAVAILABLE;
    };
    let Some(team) = sim.team(team_id) else {
        return StatusCode::NOT_FOUND;
    };
    let Some(player) = team.players.players.iter().find(|p| p.id == player_id) else {
        return StatusCode::NOT_FOUND;
    };
    let currently_pinned = player.is_force_match_selection;
    if !currently_pinned {
        if !player.is_ready_for_match() {
            return StatusCode::BAD_REQUEST;
        }
        let pinned_count = team
            .players
            .players
            .iter()
            .filter(|player| player.is_force_match_selection)
            .count();
        if pinned_count >= 11 {
            return StatusCode::CONFLICT;
        }
    }
    if let Err(error) = state.manager_career_store.update_snapshot(team_id, |snapshot| {
        if currently_pinned {
            snapshot.pinned_player_ids.retain(|id| *id != player_id);
        } else if !snapshot.pinned_player_ids.contains(&player_id) {
            snapshot.pinned_player_ids.push(player_id);
        }
    }) {
        log::error!("failed to persist manager starter preference: {error}");
        return StatusCode::INTERNAL_SERVER_ERROR;
    }
    let Some(team) = Arc::make_mut(sim).team_mut(team_id) else {
        return StatusCode::NOT_FOUND;
    };
    let Some(player) = team.players.players.iter_mut().find(|p| p.id == player_id) else {
        return StatusCode::NOT_FOUND;
    };
    player.is_force_match_selection = !currently_pinned;
    StatusCode::OK
}

pub async fn make_transfer_offer_action(
    State(state): State<GameAppData>,
    Json(body): Json<TransferOfferRequest>,
) -> StatusCode {
    let Some(buyer_team_id) = managed_team_id(&state).await else {
        return StatusCode::FORBIDDEN;
    };
    let is_loan_offer = body.loan_duration_months.is_some();
    if let Err(status) = validate_transfer_offer_request(&body) {
        return status;
    }

    let data = Arc::clone(&state.data);
    let mut guard = data.write().await;
    let Some(sim) = guard.as_mut() else {
        return StatusCode::SERVICE_UNAVAILABLE;
    };
    let sim = Arc::make_mut(sim);
    let date = sim.date.date();
    let Some(buyer_team) = sim.team(buyer_team_id) else {
        return StatusCode::NOT_FOUND;
    };
    if buyer_team.team_type != core::TeamType::Main {
        return StatusCode::FORBIDDEN;
    }
    let buyer_club_id = buyer_team.club_id;
    let buyer_rep = buyer_team.reputation.overall_score();
    let buyer_league_rep = buyer_team.league_reputation;
    let buyer_country_id = sim.country_by_club(buyer_club_id).map(|c| c.id);
    let Some(buyer_club) = sim.club(buyer_club_id) else {
        return StatusCode::NOT_FOUND;
    };
    let budget = buyer_club
        .finance
        .transfer_budget
        .as_ref()
        .map(|b| b.amount)
        .unwrap_or_else(|| (buyer_club.finance.balance.balance.max(0) as f64) * 0.3);
    if body.fee > budget {
        return StatusCode::PAYMENT_REQUIRED;
    }

    // The market holds its listing and negotiation in the seller's country.
    let mut seller_context = None;
    for continent in &sim.continents {
        for country in &continent.countries {
            let Some(listing) = country.transfer_market.listings.iter().find(|listing| {
                listing.player_id == body.player_id
                    && listing.club_id != buyer_club_id
                    && (matches!(
                        &listing.listing_type,
                        core::transfers::market::TransferListingType::Loan
                    ) == is_loan_offer)
                    && matches!(
                        listing.status,
                        TransferListingStatus::Available | TransferListingStatus::InNegotiation
                    )
            }) else {
                continue;
            };
            if let Some(seller_team) = sim.team(listing.team_id) {
                seller_context = Some((
                    country.id,
                    seller_team.id,
                    sim.club(seller_team.club_id)
                        .map(|club| club.name.clone())
                        .unwrap_or_default(),
                    seller_team.reputation.overall_score(),
                    seller_team.league_reputation,
                    listing.listing_type.clone(),
                    listing.asking_price.amount,
                    country.transfer_market.transfer_window_open,
                ));
                break;
            }
        }
        if seller_context.is_some() {
            break;
        }
    }
    let Some((
        seller_country_id,
        seller_team_id,
        seller_club_name,
        seller_rep,
        seller_league_rep,
        listing_type,
        _asking_price,
        window_open,
    )) = seller_context
    else {
        return StatusCode::NOT_FOUND;
    };
    if seller_team_id == buyer_team_id || !window_open {
        return StatusCode::CONFLICT;
    }
    if matches!(
        listing_type,
        core::transfers::market::TransferListingType::Loan
    ) != is_loan_offer
    {
        return StatusCode::BAD_REQUEST;
    }
    let Some(player) = sim.player(body.player_id) else {
        return StatusCode::NOT_FOUND;
    };
    let player_age = player.age(date);
    let player_ambition = player.attributes.ambition;
    let player_name = player.full_name.to_string();
    let offer = TransferOffer::new(
        CurrencyValue::new(body.fee, Currency::Usd),
        buyer_club_id,
        date,
    );
    let offer = if let Some(months) = body.loan_duration_months {
        offer.with_loan_duration_months(months)
    } else {
        offer.with_contract_length(body.contract_years)
    };

    // The day-tick negotiation resolver reads all country markets, so keep
    // the bid in the listing owner's market just like engine-generated bids.
    let active_bids = sim
        .continents
        .iter()
        .flat_map(|continent| &continent.countries)
        .map(|country| {
            country
                .transfer_market
                .active_negotiation_count_for_club(buyer_club_id)
        })
        .sum::<u32>();
    if active_bids >= 5 {
        return StatusCode::TOO_MANY_REQUESTS;
    }
    let Some(seller_country) = sim.country_mut(seller_country_id) else {
        return StatusCode::NOT_FOUND;
    };
    let Some(negotiation_id) = seller_country.transfer_market.start_negotiation(
        body.player_id,
        buyer_club_id,
        offer,
        date,
        seller_rep,
        buyer_rep,
        player_age,
        player_ambition,
    ) else {
        return StatusCode::CONFLICT;
    };
    if let Some(negotiation) = seller_country
        .transfer_market
        .negotiations
        .get_mut(&negotiation_id)
    {
        negotiation.player_name = player_name;
        negotiation.selling_club_name = seller_club_name;
        negotiation.selling_league_reputation = seller_league_rep;
        negotiation.buying_league_reputation = buyer_league_rep;
        if buyer_country_id != Some(seller_country_id) {
            negotiation.selling_country_id = Some(seller_country_id);
        }
        if !negotiation.is_loan {
            negotiation.open_salary_at(body.annual_wage);
        }
    }
    StatusCode::ACCEPTED
}

/// Let the manager respond to the engine's current negotiation stage.
/// During club talks this submits a higher fee; during personal terms it
/// improves the wage package. The normal country-day resolver still makes
/// the seller/player decision and completes the transfer.
pub async fn update_transfer_negotiation_action(
    State(state): State<GameAppData>,
    Json(body): Json<TransferNegotiationUpdateRequest>,
) -> StatusCode {
    if !(1..=6).contains(&body.contract_years)
        || body.annual_wage == Some(0)
        || body.fee.is_some_and(|fee| !fee.is_finite() || fee <= 0.0)
    {
        return StatusCode::BAD_REQUEST;
    }
    let Some(buyer_team_id) = managed_team_id(&state).await else {
        return StatusCode::FORBIDDEN;
    };
    let data = Arc::clone(&state.data);
    let mut guard = data.write().await;
    let Some(sim) = guard.as_mut() else {
        return StatusCode::SERVICE_UNAVAILABLE;
    };
    let sim = Arc::make_mut(sim);
    let date = sim.date.date();
    let Some(buyer_team) = sim.team(buyer_team_id) else {
        return StatusCode::NOT_FOUND;
    };
    if buyer_team.team_type != core::TeamType::Main {
        return StatusCode::FORBIDDEN;
    }
    let buyer_club_id = buyer_team.club_id;
    let budget = sim.club(buyer_club_id).map(|club| {
        club.finance
            .transfer_budget
            .as_ref()
            .map(|budget| budget.amount)
            .unwrap_or_else(|| (club.finance.balance.balance.max(0) as f64) * 0.3)
    });

    let Some(country) = sim
        .continents
        .iter_mut()
        .flat_map(|continent| &mut continent.countries)
        .find(|country| {
            country
                .transfer_market
                .negotiations
                .get(&body.negotiation_id)
                .is_some_and(|negotiation| negotiation.buying_club_id == buyer_club_id)
        })
    else {
        return StatusCode::NOT_FOUND;
    };
    let Some(negotiation) = country
        .transfer_market
        .negotiations
        .get_mut(&body.negotiation_id)
    else {
        return StatusCode::NOT_FOUND;
    };
    if !matches!(
        &negotiation.status,
        NegotiationStatus::Pending | NegotiationStatus::Countered
    ) {
        return StatusCode::CONFLICT;
    }

    match &negotiation.phase {
        NegotiationPhase::ClubNegotiation { round, .. } => {
            if *round >= 3 {
                return StatusCode::CONFLICT;
            }
            let Some(fee) = body.fee else {
                return StatusCode::BAD_REQUEST;
            };
            if fee < negotiation.current_offer.base_fee.amount {
                return StatusCode::BAD_REQUEST;
            }
            if budget.is_some_and(|available| fee > available) {
                return StatusCode::PAYMENT_REQUIRED;
            }
            let mut offer = negotiation.current_offer.clone();
            offer.base_fee.amount = fee;
            offer.offered_date = date;
            offer.contract_length_years = Some(body.contract_years);
            let terms = offer
                .personal_terms
                .get_or_insert_with(PersonalTermsOffer::default);
            terms.contract_years = Some(body.contract_years);
            if let Some(wage) = body.annual_wage {
                terms.annual_wage = Some(wage);
            }
            negotiation.counter_offer(offer);
            negotiation.advance_club_negotiation_round(date);
        }
        NegotiationPhase::PersonalTerms { round, .. } => {
            if *round >= 2 {
                return StatusCode::CONFLICT;
            }
            if body.fee.is_some() {
                return StatusCode::BAD_REQUEST;
            }
            let Some(wage) = body.annual_wage else {
                return StatusCode::BAD_REQUEST;
            };
            if negotiation
                .offered_salary
                .is_some_and(|current| wage < current)
            {
                return StatusCode::BAD_REQUEST;
            }
            negotiation.raise_offered_salary(wage);
            negotiation.current_offer.contract_length_years = Some(body.contract_years);
            let terms = negotiation
                .current_offer
                .personal_terms
                .get_or_insert_with(PersonalTermsOffer::default);
            terms.contract_years = Some(body.contract_years);
            negotiation.advance_personal_terms_round(date);
        }
        _ => return StatusCode::CONFLICT,
    }
    StatusCode::ACCEPTED
}

/// Queue the managed seller's accept/reject decision for the next ordinary
/// transfer-resolution tick. The engine still performs player terms and
/// medical/finalisation after an accepted fee.
pub async fn decide_incoming_transfer_offer_action(
    State(state): State<GameAppData>,
    Json(body): Json<TransferSellerDecisionRequest>,
) -> StatusCode {
    let Some(managed_team_id) = managed_team_id(&state).await else {
        return StatusCode::FORBIDDEN;
    };
    let data = Arc::clone(&state.data);
    let mut guard = data.write().await;
    let Some(sim) = guard.as_mut() else {
        return StatusCode::SERVICE_UNAVAILABLE;
    };
    let sim = Arc::make_mut(sim);
    let Some(managed_team) = sim.team(managed_team_id) else {
        return StatusCode::NOT_FOUND;
    };
    if managed_team.team_type != core::TeamType::Main {
        return StatusCode::FORBIDDEN;
    }
    let managed_club_id = managed_team.club_id;
    let Some(country) = sim
        .continents
        .iter_mut()
        .flat_map(|continent| &mut continent.countries)
        .find(|country| {
            country
                .transfer_market
                .negotiations
                .get(&body.negotiation_id)
                .is_some_and(|negotiation| negotiation.selling_club_id == managed_club_id)
        })
    else {
        return StatusCode::NOT_FOUND;
    };
    let Some(negotiation) = country
        .transfer_market
        .negotiations
        .get_mut(&body.negotiation_id)
    else {
        return StatusCode::NOT_FOUND;
    };
    if queue_manager_seller_decision(negotiation, body.accept).is_err() {
        return StatusCode::CONFLICT;
    }
    StatusCode::ACCEPTED
}

#[cfg(test)]
mod manager_offer_validation_tests {
    use super::{
        TransferOfferRequest, queue_manager_seller_decision, validate_transfer_offer_request,
    };
    use axum::http::StatusCode;
    use chrono::NaiveDate;
    use core::shared::currency::{Currency, CurrencyValue};
    use core::transfers::deal::negotiation::{
        NegotiationPhase, NegotiationStatus, TransferNegotiation,
    };
    use core::transfers::deal::offer::TransferOffer;

    fn negotiation_in_club_talks() -> TransferNegotiation {
        let date = NaiveDate::from_ymd_opt(2026, 8, 1).unwrap();
        let offer = TransferOffer::new(
            CurrencyValue::new(1_000_000.0, Currency::Usd),
            20,
            date,
        );
        let mut negotiation = TransferNegotiation::new(
            1, 42, 3, 10, 20, offer, date, 0.5, 0.5, 24, 0.6,
        );
        negotiation.phase = NegotiationPhase::ClubNegotiation {
            started: date,
            round: 1,
        };
        negotiation
    }

    #[test]
    fn manager_seller_accept_and_reject_decisions_are_queued_for_the_tick() {
        for accept in [true, false] {
            let mut negotiation = negotiation_in_club_talks();
            assert_eq!(queue_manager_seller_decision(&mut negotiation, accept), Ok(()));
            assert_eq!(negotiation.manager_seller_decision, Some(accept));
        }
    }

    #[test]
    fn manager_seller_decision_rejects_wrong_phase_final_status_and_duplicate() {
        let mut negotiation = negotiation_in_club_talks();
        negotiation.phase = NegotiationPhase::PersonalTerms {
            started: NaiveDate::from_ymd_opt(2026, 8, 1).unwrap(),
            round: 1,
        };
        assert_eq!(
            queue_manager_seller_decision(&mut negotiation, true),
            Err(StatusCode::CONFLICT)
        );

        let mut negotiation = negotiation_in_club_talks();
        negotiation.status = NegotiationStatus::Rejected;
        assert_eq!(
            queue_manager_seller_decision(&mut negotiation, true),
            Err(StatusCode::CONFLICT)
        );

        let mut negotiation = negotiation_in_club_talks();
        queue_manager_seller_decision(&mut negotiation, true).unwrap();
        assert_eq!(
            queue_manager_seller_decision(&mut negotiation, false),
            Err(StatusCode::CONFLICT)
        );
        assert_eq!(negotiation.manager_seller_decision, Some(true));
    }

    fn request(loan_duration_months: Option<u8>, annual_wage: u32) -> TransferOfferRequest {
        TransferOfferRequest {
            player_id: 42,
            fee: 250_000.0,
            annual_wage,
            contract_years: 3,
            loan_duration_months,
        }
    }

    #[test]
    fn permanent_offer_requires_wage_and_valid_contract_length() {
        assert!(validate_transfer_offer_request(&request(None, 1_000_000)).is_ok());
        assert_eq!(
            validate_transfer_offer_request(&request(None, 0)),
            Err(StatusCode::BAD_REQUEST)
        );

        let mut too_long = request(None, 1_000_000);
        too_long.contract_years = 7;
        assert_eq!(
            validate_transfer_offer_request(&too_long),
            Err(StatusCode::BAD_REQUEST)
        );
    }

    #[test]
    fn loan_offer_accepts_only_supported_durations_without_a_new_wage() {
        for months in [3, 6, 12] {
            assert!(validate_transfer_offer_request(&request(Some(months), 0)).is_ok());
        }

        assert_eq!(
            validate_transfer_offer_request(&request(Some(9), 0)),
            Err(StatusCode::BAD_REQUEST)
        );
    }

    #[test]
    fn offers_reject_non_positive_or_non_finite_fees() {
        for fee in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            let mut invalid = request(None, 1_000_000);
            invalid.fee = fee;
            assert_eq!(
                validate_transfer_offer_request(&invalid),
                Err(StatusCode::BAD_REQUEST)
            );
        }
    }
}
