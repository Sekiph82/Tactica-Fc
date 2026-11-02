//! Append-only persistence for manager-owned settings in the local career.
//!
//! This settings overlay is not a serialized simulator world: the calendar,
//! results, negotiations, and world state still need their own save format.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const SCHEMA_VERSION: u32 = 9;
const FILE_NAME: &str = "manager-career.jsonl";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct ManagerCareerRecord {
    schema_version: u32,
    team_id: u32,
    #[serde(default)]
    snapshot: Option<ManagerCareerSnapshot>,
}

/// Manager-owned choices that can be reapplied to the generated base world.
/// This is a settings overlay, not a serialized simulator world or match history.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ManagerCareerSnapshot {
    #[serde(default)]
    pub formation: Option<String>,
    #[serde(default)]
    pub style: Option<String>,
    #[serde(default)]
    pub pressing: Option<u8>,
    #[serde(default)]
    pub defensive_line: Option<u8>,
    #[serde(default)]
    pub lineup: Vec<Option<u32>>,
    #[serde(default)]
    pub pinned_player_ids: Vec<u32>,
    #[serde(default)]
    pub team_training_focus: Option<String>,
    #[serde(default)]
    pub player_training: HashMap<u32, String>,
    #[serde(default)]
    pub listed_player_ids: Vec<u32>,
    /// Durable manager answers that must be replayed if the full world save
    /// has not yet captured the corresponding transfer decision.
    #[serde(default)]
    pub pending_transfer_responses: HashMap<u32, bool>,
    /// Highest club-newspaper edition the manager has explicitly read.
    #[serde(default)]
    pub last_read_newspaper_issue: u32,
    /// League IDs whose monthly newspapers the manager follows.
    #[serde(default)]
    pub followed_league_ids: Vec<u32>,
    /// Highest monthly edition read for each followed league.
    #[serde(default)]
    pub last_read_league_issues: HashMap<u32, u32>,
    /// Recent managed-team match reports captured from completed simulation ticks.
    #[serde(default)]
    pub match_reports: Vec<ManagerMatchReport>,
    /// Number of match reports the manager has explicitly read.
    #[serde(default)]
    pub last_read_match_reports: usize,
    /// Actual managed-team training outcomes captured from daily engine ticks.
    #[serde(default)]
    pub training_reports: Vec<ManagerTrainingReport>,
    /// Number of stored training reports the manager has explicitly read.
    #[serde(default)]
    pub last_read_training_reports: usize,
    /// Optional manager-planned first-team camp, advanced by normal world days.
    #[serde(default)]
    pub training_camp: Option<ManagerTrainingCamp>,
    /// Completed training-camp reports shown in the manager inbox.
    #[serde(default)]
    pub training_camp_reports: Vec<ManagerTrainingCampReport>,
    /// Number of completed camp reports the manager has explicitly read.
    #[serde(default)]
    pub last_read_training_camp_reports: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ManagerMatchReport {
    pub match_id: String,
    pub date: String,
    pub opponent: String,
    /// Score in the managed team's home/away orientation.
    pub score: String,
    pub is_home: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ManagerTrainingReport {
    pub date: String,
    pub trained_players: u8,
    pub focus: String,
    #[serde(default)]
    pub best_player_id: u32,
    pub best_player: String,
    /// Rolling engine training performance, in tenths on a 1.0–20.0 scale.
    pub best_performance_tenths: u8,
    pub lowest_player: String,
    /// Rolling engine training performance, in tenths on a 1.0–20.0 scale.
    pub lowest_performance_tenths: u8,
    /// True after the manager has praised this report's best performer.
    #[serde(default)]
    pub manager_praised: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ManagerTrainingCamp {
    pub destination: String,
    pub start_date: String,
    pub status: String,
    #[serde(default)]
    pub days_completed: u8,
    pub cost: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ManagerTrainingCampReport {
    pub date: String,
    pub destination: String,
    pub players: u8,
    pub condition_gain: i16,
    pub morale_gain_tenths: u8,
    pub cost: i64,
}

#[derive(Debug, Clone)]
pub struct ManagerCareerStore {
    path: PathBuf,
    append_lock: Arc<Mutex<()>>,
}

impl ManagerCareerStore {
    pub fn for_current_user() -> Self {
        Self::new(user_data_directory().join(FILE_NAME))
    }

    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into(), append_lock: Arc::new(Mutex::new(())) }
    }

    /// Returns the latest valid versioned selection. Invalid or partial lines
    /// are ignored, so an interrupted append cannot hide the prior record.
    pub fn load_team_id(&self) -> Option<u32> {
        self.latest_record().map(|record| record.team_id)
    }

    pub fn load_snapshot(&self, team_id: u32) -> Option<ManagerCareerSnapshot> {
        let record = self.latest_record()?;
        (record.team_id == team_id).then_some(record.snapshot).flatten()
    }

    /// Appends and flushes a single record. Keeping history append-only avoids
    /// truncating a previous selection if the process stops during a write.
    pub fn save_team_id(&self, team_id: u32) -> io::Result<()> {
        let _guard = self.append_lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        self.append_record(ManagerCareerRecord {
            schema_version: SCHEMA_VERSION,
            team_id,
            snapshot: None,
        })
    }

    /// Atomically reads the latest settings for this team, applies one manager
    /// change, and appends a complete versioned record. This prevents concurrent
    /// web actions from losing each other's saved fields.
    pub fn update_snapshot<F>(&self, team_id: u32, update: F) -> io::Result<ManagerCareerSnapshot>
    where
        F: FnOnce(&mut ManagerCareerSnapshot),
    {
        let _guard = self.append_lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut snapshot = self
            .latest_record_unlocked()
            .filter(|record| record.team_id == team_id)
            .and_then(|record| record.snapshot)
            .unwrap_or_default();
        update(&mut snapshot);
        self.append_record(ManagerCareerRecord {
            schema_version: SCHEMA_VERSION,
            team_id,
            snapshot: Some(snapshot.clone()),
        })?;
        Ok(snapshot)
    }

    pub fn queue_transfer_response(
        &self,
        team_id: u32,
        negotiation_id: u32,
        accept: bool,
    ) -> io::Result<()> {
        self.update_snapshot(team_id, |snapshot| {
            snapshot
                .pending_transfer_responses
                .insert(negotiation_id, accept);
        })?;
        Ok(())
    }

    pub fn clear_pending_transfer_responses(&self, team_id: u32) -> io::Result<()> {
        self.update_snapshot(team_id, |snapshot| {
            snapshot.pending_transfer_responses.clear();
        })?;
        Ok(())
    }

    fn latest_record(&self) -> Option<ManagerCareerRecord> {
        let _guard = self.append_lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        self.latest_record_unlocked()
    }

    fn latest_record_unlocked(&self) -> Option<ManagerCareerRecord> {
        let contents = fs::read_to_string(&self.path).ok()?;
        contents.lines().rev().find_map(|line| {
            let record: ManagerCareerRecord = serde_json::from_str(line).ok()?;
            (1..=SCHEMA_VERSION).contains(&record.schema_version).then_some(record)
        })
    }

    fn append_record(&self, record: ManagerCareerRecord) -> io::Result<()> {
        let parent = self.path.parent().unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(parent)?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        serde_json::to_writer(&mut file, &record).map_err(io::Error::other)?;
        file.write_all(b"\n")?;
        file.sync_data()
    }
}

impl ManagerCareerSnapshot {
    /// Replay durable manager answers after loading the last full world save.
    /// Responses already present or resolved in that save are left untouched.
    pub fn apply_pending_transfer_responses(
        &self,
        sim: &mut core::SimulatorData,
        team_id: u32,
    ) -> usize {
        let Some(team) = sim
            .team(team_id)
            .filter(|team| team.team_type == core::TeamType::Main)
        else {
            return 0;
        };
        let managed_club_id = team.club_id;
        let mut applied = 0;
        for (negotiation_id, accept) in &self.pending_transfer_responses {
            let Some(negotiation) = sim
                .continents
                .iter_mut()
                .flat_map(|continent| &mut continent.countries)
                .find_map(|country| {
                    country
                        .transfer_market
                        .negotiations
                        .get_mut(negotiation_id)
                        .filter(|negotiation| {
                            negotiation.selling_club_id == managed_club_id
                                || negotiation.buying_club_id == managed_club_id
                        })
                })
            else {
                continue;
            };
            if negotiation.manager_decision.is_some()
                || !matches!(
                    negotiation.phase,
                    core::transfers::deal::negotiation::NegotiationPhase::ClubNegotiation { .. }
                )
            {
                continue;
            }
            let is_seller = negotiation.selling_club_id == managed_club_id
                && matches!(
                    negotiation.status,
                    core::transfers::deal::negotiation::NegotiationStatus::Pending
                        | core::transfers::deal::negotiation::NegotiationStatus::Countered
                );
            let is_buyer = negotiation.buying_club_id == managed_club_id
                && negotiation.status
                    == core::transfers::deal::negotiation::NegotiationStatus::Countered;
            if is_seller || is_buyer {
                negotiation.manager_decision = Some(*accept);
                applied += 1;
            }
        }
        applied
    }

    pub fn record_match_report(&mut self, report: ManagerMatchReport) {
        if self.match_reports.iter().any(|existing| existing.match_id == report.match_id) {
            return;
        }
        self.match_reports.push(report);
        if self.match_reports.len() > 100 {
            let remove_count = self.match_reports.len() - 100;
            self.match_reports.drain(0..remove_count);
            self.last_read_match_reports = self.last_read_match_reports.saturating_sub(remove_count);
        }
    }

    pub fn record_training_report(&mut self, report: ManagerTrainingReport) {
        if self.training_reports.iter().any(|existing| existing.date == report.date) {
            return;
        }
        self.training_reports.push(report);
        if self.training_reports.len() > 100 {
            let remove_count = self.training_reports.len() - 100;
            self.training_reports.drain(0..remove_count);
            self.last_read_training_reports = self.last_read_training_reports.saturating_sub(remove_count);
        }
    }

    pub fn record_training_camp_report(&mut self, report: ManagerTrainingCampReport) {
        if self.training_camp_reports.iter().any(|existing| existing.date == report.date) {
            return;
        }
        self.training_camp_reports.push(report);
        if self.training_camp_reports.len() > 30 {
            let remove_count = self.training_camp_reports.len() - 30;
            self.training_camp_reports.drain(0..remove_count);
            self.last_read_training_camp_reports = self.last_read_training_camp_reports.saturating_sub(remove_count);
        }
    }

    /// Reapply manager-owned choices to a freshly generated base world.
    /// Match history, calendar progress, and other clubs remain outside this overlay.
    pub fn apply_to_simulation(&self, sim: &mut core::SimulatorData, team_id: u32) -> bool {
        let date = sim.date.date();
        let Some(team) = sim.team_mut(team_id) else { return false; };
        if team.team_type != core::TeamType::Main { return false; }

        let mut tactics = team
            .tactics
            .clone()
            .unwrap_or_else(|| core::Tactics::new(core::MatchTacticType::T442));
        let mut has_manager_tactics = false;
        if let Some(key) = self.formation.as_deref().and_then(tactic_type_from_key) {
            tactics = core::Tactics::new(key);
            has_manager_tactics = true;
        }
        if let Some(style) = self.style.as_deref().and_then(tactical_style_from_key) {
            tactics.manager_tactical_style = Some(style);
            has_manager_tactics = true;
        }
        if let Some(value) = self.pressing.filter(|value| *value <= 10) {
            tactics.manager_pressing_override = Some(value as f32 / 10.0);
            has_manager_tactics = true;
        }
        if let Some(value) = self.defensive_line.filter(|value| *value <= 10) {
            tactics.manager_line_override = Some(value as f32 / 10.0);
            has_manager_tactics = true;
        }

        let mut manager_selected = std::collections::HashSet::new();
        for player_id in &self.pinned_player_ids {
            if team.players.players.iter().any(|player| {
                player.id == *player_id
                    && !player.is_loaned_out_from(team.club_id)
                    && player.is_ready_for_match()
            }) {
                manager_selected.insert(*player_id);
            }
        }
        if self.lineup.len() == tactics.positions().len() {
            let mut seen = std::collections::HashSet::new();
            tactics.manager_lineup = self.lineup.iter().map(|pick| {
                pick.filter(|id| seen.insert(*id) && team.players.players.iter().any(|player| {
                    player.id == *id && !player.is_loaned_out_from(team.club_id) && player.is_ready_for_match()
                }))
            }).collect();
            has_manager_tactics = true;
            manager_selected.extend(tactics.manager_lineup.iter().flatten().copied());
        }
        if !self.pinned_player_ids.is_empty() || self.lineup.len() == tactics.positions().len() {
            for player in &mut team.players.players {
                player.is_force_match_selection = manager_selected.contains(&player.id);
            }
        }
        if has_manager_tactics {
            tactics.manager_controlled = true;
            team.tactics = Some(tactics);
        }

        if let Some(focus) = self.team_training_focus.as_deref().and_then(team_training_focus_from_key) {
            team.training_schedule.manager_focus = focus;
        }
        for (player_id, focus_key) in &self.player_training {
            if let Some(player) = team.players.players.iter_mut().find(|player| player.id == *player_id) {
                let focus = player_training_focus_from_key(focus_key).filter(|focus| match focus {
                    core::TrainingFocus::InjuryRecovery => player.player_attributes.is_in_recovery(),
                    core::TrainingFocus::PositionRetraining(target) => {
                        *target != player.position()
                            && player.positions.positions.iter().any(|entry| {
                                entry.position == *target && (10..15).contains(&entry.level)
                            })
                    }
                    _ => true,
                });
                player.individual_training = focus.map(|focus| core::IndividualTrainingPlan {
                    player_id: *player_id,
                    focus_areas: vec![focus],
                    intensity_modifier: 1.0,
                    special_instructions: Vec::new(),
                    started: Some(date),
                });
            }
        }

        let club_score = team.reputation.market_value_score();
        let league_reputation = team.league_reputation;
        let listings: Vec<_> = self.listed_player_ids.iter().filter_map(|id| {
            team.players.players.iter().find(|player| player.id == *id && !player.is_on_loan())
                .map(|player| (*id, player.value(date, league_reputation, club_score)))
        }).collect();
        for (id, asking_price) in listings {
            if let Some(player) = team.players.players.iter_mut().find(|player| player.id == id) {
                player.statuses.add(date, core::PlayerStatusType::Lst);
                if let Some(contract) = player.contract.as_mut() {
                    contract.is_transfer_listed = true;
                }
            }
            team.add_player_to_transfer_list(
                id,
                core::shared::currency::CurrencyValue::new(
                    asking_price,
                    core::shared::currency::Currency::Usd,
                ),
            );
        }
        true
    }
}

fn tactic_type_from_key(key: &str) -> Option<core::MatchTacticType> {
    Some(match key {
        "T442" => core::MatchTacticType::T442,
        "T433" => core::MatchTacticType::T433,
        "T451" => core::MatchTacticType::T451,
        "T4231" => core::MatchTacticType::T4231,
        "T352" => core::MatchTacticType::T352,
        "T442Diamond" => core::MatchTacticType::T442Diamond,
        "T442DiamondWide" => core::MatchTacticType::T442DiamondWide,
        "T442Narrow" => core::MatchTacticType::T442Narrow,
        "T4141" => core::MatchTacticType::T4141,
        "T4411" => core::MatchTacticType::T4411,
        "T343" => core::MatchTacticType::T343,
        "T1333" => core::MatchTacticType::T1333,
        "T4312" => core::MatchTacticType::T4312,
        "T4222" => core::MatchTacticType::T4222,
        _ => return None,
    })
}

fn tactical_style_from_key(key: &str) -> Option<core::TacticalStyle> {
    Some(match key {
        "attacking" => core::TacticalStyle::Attacking,
        "defensive" => core::TacticalStyle::Defensive,
        "balanced" => core::TacticalStyle::Balanced,
        "possession" => core::TacticalStyle::Possession,
        "counterattack" => core::TacticalStyle::Counterattack,
        "wing_play" => core::TacticalStyle::WingPlay,
        "wide_play" => core::TacticalStyle::WidePlay,
        "compact" => core::TacticalStyle::Compact,
        "experimental" => core::TacticalStyle::Experimental,
        _ => return None,
    })
}

fn team_training_focus_from_key(key: &str) -> Option<core::ManagerTrainingFocus> {
    Some(match key {
        "balanced" => core::ManagerTrainingFocus::Balanced,
        "fitness" => core::ManagerTrainingFocus::Fitness,
        "technical" => core::ManagerTrainingFocus::Technical,
        "tactical" => core::ManagerTrainingFocus::Tactical,
        "set_pieces" => core::ManagerTrainingFocus::SetPieces,
        "recovery" => core::ManagerTrainingFocus::Recovery,
        _ => return None,
    })
}

fn player_training_focus_from_key(key: &str) -> Option<core::TrainingFocus> {
    if let Some(position_key) = key.strip_prefix("position:") {
        let target = core::PlayerPositionType::ALL
            .iter()
            .copied()
            .find(|position| position.as_i18n_key() == position_key)?;
        return Some(core::TrainingFocus::PositionRetraining(target));
    }
    Some(match key {
        "fitness" => core::TrainingFocus::FitnessBuilding,
        "mental" => core::TrainingFocus::MentalDevelopment,
        "injury_recovery" => core::TrainingFocus::InjuryRecovery,
        "free_kicks" => core::TrainingFocus::SpecificSkill(core::SkillType::FreeKicks),
        "penalties" => core::TrainingFocus::SpecificSkill(core::SkillType::Penalties),
        "long_shots" => core::TrainingFocus::SpecificSkill(core::SkillType::LongShots),
        "heading" => core::TrainingFocus::SpecificSkill(core::SkillType::Heading),
        "tackling" => core::TrainingFocus::SpecificSkill(core::SkillType::Tackling),
        "crossing" => core::TrainingFocus::SpecificSkill(core::SkillType::Crossing),
        "dribbling" => core::TrainingFocus::SpecificSkill(core::SkillType::Dribbling),
        "weak_foot" => core::TrainingFocus::WeakFootImprovement,
        "none" => return None,
        _ => return None,
    })
}

pub(crate) fn user_data_directory() -> PathBuf {
    if let Some(path) = std::env::var_os("TACTICA_DATA_DIR") {
        return PathBuf::from(path);
    }

    #[cfg(target_os = "windows")]
    if let Some(path) = std::env::var_os("APPDATA") {
        return PathBuf::from(path).join("Tactica FC");
    }

    #[cfg(not(target_os = "windows"))]
    if let Some(path) = std::env::var_os("XDG_DATA_HOME") {
        return PathBuf::from(path).join("tactica-fc");
    }

    if let Some(home) = std::env::var_os("HOME") {
        #[cfg(target_os = "macos")]
        return PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("Tactica FC");

        #[cfg(not(target_os = "macos"))]
        return PathBuf::from(home).join(".local").join("share").join("tactica-fc");
    }

    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".tactica-fc")
}

#[cfg(test)]
mod tests {
    use super::ManagerCareerStore;
    use std::fs;
    use std::io::Write;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_store() -> (ManagerCareerStore, PathBuf) {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("tactica-career-{nonce}"));
        let path = directory.join("manager-career.jsonl");
        (ManagerCareerStore::new(path), directory)
    }

    #[test]
    fn selected_team_survives_reopening_the_store() {
        let (store, directory) = temp_store();
        store.save_team_id(42).unwrap();

        let reopened = ManagerCareerStore::new(directory.join("manager-career.jsonl"));
        assert_eq!(reopened.load_team_id(), Some(42));

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn latest_valid_selection_wins_and_partial_tail_is_ignored() {
        let (store, directory) = temp_store();
        store.save_team_id(42).unwrap();
        store.save_team_id(84).unwrap();
        fs::OpenOptions::new()
            .append(true)
            .open(directory.join("manager-career.jsonl"))
            .unwrap()
            .write_all(b"{partial")
            .unwrap();

        assert_eq!(store.load_team_id(), Some(84));

        fs::remove_dir_all(directory).unwrap();
    }
}
