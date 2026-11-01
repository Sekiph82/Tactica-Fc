//! A single manager's live match feed and command queue.
//!
//! The engine remains authoritative: frames are sampled from the actual field
//! state and accepted instructions flow through the coach decision path.

use crate::r#match::engine::teamplay::coach::instruction::CoachInstruction;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

static NEXT_LIVE_SESSION_ID: AtomicU64 = AtomicU64::new(0);
// Live frames are sampled every 500ms of match time. Keep a full regulation
// match plus stoppage-time headroom so a temporarily backgrounded/throttled
// manager tab can resume without silently losing the movement stream.
const LIVE_FRAME_HISTORY_LIMIT: usize = 16_384;

fn next_live_session_id() -> u64 {
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    NEXT_LIVE_SESSION_ID.fetch_max(timestamp_ms, Ordering::Relaxed);
    NEXT_LIVE_SESSION_ID.fetch_add(1, Ordering::Relaxed)
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LiveMatchStatus { Waiting, Playing, Finished, NoMatch }

#[derive(Debug, Clone, Serialize)]
pub struct LivePlayerFrame {
    pub id: u32,
    pub team_id: u32,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub shirt_number: u8,
    pub x: f32,
    pub y: f32,
    pub goalkeeper: bool,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct LiveGoalFrame {
    pub player_id: u32,
    pub time: f64,
    pub is_auto_goal: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct LiveMatchEventFrame {
    pub sequence: u64,
    pub timestamp: u64,
    pub category: String,
    pub description: String,
    pub actor_player_id: Option<u32>,
    pub related_player_id: Option<u32>,
    pub actor_name: Option<String>,
    pub related_player_name: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct LiveSubstitutionCommand { pub outgoing_player_id: u32, pub incoming_player_id: u32 }

#[derive(Debug, Clone, Serialize)]
pub struct LiveSubstitutionUpdate {
    pub outgoing_player_id: u32,
    pub incoming_player_id: u32,
    pub status: String,
    pub minute: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct LiveMatchFrame {
    pub sequence: u64,
    pub home_team_id: u32,
    pub away_team_id: u32,
    pub elapsed_ms: u64,
    pub minute: u32,
    pub home_score: u8,
    pub away_score: u8,
    pub ball_x: f32,
    pub ball_y: f32,
    pub ball_z: f32,
    pub instruction: String,
    pub events: Vec<LiveMatchEventFrame>,
    pub goals: Vec<LiveGoalFrame>,
    pub players: Vec<LivePlayerFrame>,
    pub substitutes: Vec<LivePlayerFrame>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LiveMatchView {
    pub session_id: u64,
    pub manager_team_id: u32,
    pub status: LiveMatchStatus,
    pub frame: Option<LiveMatchFrame>,
    pub frames: Vec<LiveMatchFrame>,
    pub events: Vec<LiveMatchEventFrame>,
    pub pending_substitution: Option<LiveSubstitutionCommand>,
    pub last_substitution: Option<LiveSubstitutionUpdate>,
}

#[derive(Debug, Default)]
struct LiveFrameBuffer {
    latest: Option<LiveMatchFrame>,
    history: VecDeque<LiveMatchFrame>,
}

#[derive(Debug)]
pub struct LiveMatchSession {
    session_id: u64,
    next_frame_sequence: AtomicU64,
    next_event_sequence: AtomicU64,
    manager_team_id: u32,
    player_names: HashMap<u32, String>,
    player_shirt_numbers: HashMap<u32, u8>,
    claimed: AtomicBool,
    status: Mutex<LiveMatchStatus>,
    frames: Mutex<LiveFrameBuffer>,
    events: Mutex<Vec<LiveMatchEventFrame>>,
    pending_instruction: Mutex<Option<CoachInstruction>>,
    pending_substitution: Mutex<Option<LiveSubstitutionCommand>>,
    last_substitution: Mutex<Option<LiveSubstitutionUpdate>>,
}

impl LiveMatchSession {
    pub fn new(manager_team_id: u32) -> Self {
        Self::with_player_names(manager_team_id, HashMap::new())
    }
    pub fn with_player_names(manager_team_id: u32, player_names: HashMap<u32, String>) -> Self {
        Self::with_player_details(manager_team_id, player_names, HashMap::new())
    }
    pub fn with_player_details(
        manager_team_id: u32,
        player_names: HashMap<u32, String>,
        player_shirt_numbers: HashMap<u32, u8>,
    ) -> Self {
        Self {
            session_id: next_live_session_id(),
            next_frame_sequence: AtomicU64::new(1),
            next_event_sequence: AtomicU64::new(1),
            manager_team_id,
            player_names,
            player_shirt_numbers,
            claimed: AtomicBool::new(false),
            status: Mutex::new(LiveMatchStatus::Waiting),
            frames: Mutex::new(LiveFrameBuffer::default()),
            events: Mutex::new(Vec::new()),
            pending_instruction: Mutex::new(None),
            pending_substitution: Mutex::new(None),
            last_substitution: Mutex::new(None),
        }
    }
    pub fn manager_team_id(&self) -> u32 { self.manager_team_id }
    pub fn claim_for_fixture(&self, home_team_id: u32, away_team_id: u32) -> bool {
        if self.manager_team_id != home_team_id && self.manager_team_id != away_team_id { return false; }
        if self.claimed.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() { return false; }
        *lock(&self.status) = LiveMatchStatus::Playing;
        true
    }
    pub fn queue_instruction(&self, instruction: CoachInstruction) -> bool {
        if *lock(&self.status) != LiveMatchStatus::Playing { return false; }
        *lock(&self.pending_instruction) = Some(instruction);
        true
    }
    pub fn take_instruction(&self) -> Option<CoachInstruction> { lock(&self.pending_instruction).take() }
    pub fn queue_substitution(&self, command: LiveSubstitutionCommand) -> bool {
        if *lock(&self.status) != LiveMatchStatus::Playing { return false; }
        let mut pending = lock(&self.pending_substitution);
        if pending.is_some()
            || lock(&self.last_substitution).as_ref().is_some_and(|update| update.status == "queued")
            || command.outgoing_player_id == command.incoming_player_id
        { return false; }
        *pending = Some(command);
        *lock(&self.last_substitution) = Some(LiveSubstitutionUpdate {
            outgoing_player_id: command.outgoing_player_id,
            incoming_player_id: command.incoming_player_id,
            status: "queued".to_string(),
            minute: lock(&self.frames).latest.as_ref().map_or(0, |frame| frame.minute),
        });
        true
    }
    pub fn take_substitution(&self) -> Option<LiveSubstitutionCommand> { lock(&self.pending_substitution).take() }
    pub fn resolve_substitution(&self, command: LiveSubstitutionCommand, applied: bool, minute: u32) {
        *lock(&self.last_substitution) = Some(LiveSubstitutionUpdate {
            outgoing_player_id: command.outgoing_player_id,
            incoming_player_id: command.incoming_player_id,
            status: if applied { "applied" } else { "rejected" }.to_string(),
            minute,
        });
    }
    pub fn publish(&self, mut frame: LiveMatchFrame) {
        frame.sequence = self.next_frame_sequence.fetch_add(1, Ordering::Relaxed);
        for player in frame.players.iter_mut().chain(frame.substitutes.iter_mut()) {
            if player.name.is_empty() {
                player.name = self.player_names.get(&player.id).cloned().unwrap_or_default();
            }
            if player.shirt_number == 0 {
                player.shirt_number = self.player_shirt_numbers.get(&player.id).copied().unwrap_or(0);
            }
        }
        for event in &mut frame.events {
            event.sequence = self.next_event_sequence.fetch_add(1, Ordering::Relaxed);
            let kind = event
                .description
                .trim_start_matches("REFUSED ")
                .split(['(', '{'])
                .next()
                .unwrap_or_default()
                .trim();
            if matches!(
                kind,
                "Goal"
                    | "Assist"
                    | "Shoot"
                    | "RequestShot"
                    | "CaughtBall"
                    | "ParriedBall"
                    | "Howler"
                    | "Blocked"
                    | "HitFrame"
                    | "Offside"
                    | "Foul"
                    | "Handball"
                    | "Caution"
                    | "PassTo"
                    | "PassCompleted"
                    | "TacklingBall"
                    | "Dispossessed"
                    | "HeadedClear"
                    | "ClearBall"
                    | "Intercepted"
            ) {
                event.actor_name = event
                    .actor_player_id
                    .and_then(|player_id| self.player_names.get(&player_id).cloned());
                event.related_player_name = event
                    .related_player_id
                    .and_then(|player_id| self.player_names.get(&player_id).cloned());
            }
        }
        lock(&self.events).extend(frame.events.iter().cloned());
        frame.events.clear();
        let mut frames = lock(&self.frames);
        if frames.history.len() == LIVE_FRAME_HISTORY_LIMIT {
            frames.history.pop_front();
        }
        frames.history.push_back(frame.clone());
        frames.latest = Some(frame);
    }
    pub fn finish(&self) {
        if let Some(command) = lock(&self.pending_substitution).take() {
            let minute = lock(&self.frames).latest.as_ref().map_or(0, |frame| frame.minute);
            *lock(&self.last_substitution) = Some(LiveSubstitutionUpdate {
                outgoing_player_id: command.outgoing_player_id,
                incoming_player_id: command.incoming_player_id,
                status: "rejected".to_string(),
                minute,
            });
        }
        let mut status = lock(&self.status);
        *status = match *status { LiveMatchStatus::Playing => LiveMatchStatus::Finished, LiveMatchStatus::Waiting => LiveMatchStatus::NoMatch, other => other };
    }
    pub fn view(&self) -> LiveMatchView {
        self.view_after(0)
    }
    pub fn view_after(&self, after_event_sequence: u64) -> LiveMatchView {
        self.view_after_frames(after_event_sequence, u64::MAX)
    }
    pub fn view_after_frames(&self, after_event_sequence: u64, after_frame_sequence: u64) -> LiveMatchView {
        let frame_buffer = lock(&self.frames);
        let frame = frame_buffer.latest.clone();
        let frames = frame_buffer
            .history
            .iter()
            .filter(|frame| frame.sequence > after_frame_sequence)
            .cloned()
            .collect();
        drop(frame_buffer);
        let events = lock(&self.events)
            .iter()
            .filter(|event| event.sequence > after_event_sequence)
            .cloned()
            .collect();
        LiveMatchView {
            session_id: self.session_id,
            manager_team_id: self.manager_team_id,
            status: *lock(&self.status),
            frame,
            frames,
            events,
            pending_substitution: *lock(&self.pending_substitution),
            last_substitution: lock(&self.last_substitution).clone(),
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> { mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) }

pub fn instruction_key(instruction: CoachInstruction) -> &'static str {
    match instruction {
        CoachInstruction::Normal => "normal", CoachInstruction::SlowDown => "slow_down",
        CoachInstruction::PushForward => "push_forward", CoachInstruction::AllOutAttack => "all_out_attack",
        CoachInstruction::WasteTime => "waste_time", CoachInstruction::ParkTheBus => "park_the_bus",
    }
}

#[cfg(test)]
mod tests {
    use super::{LiveMatchFrame, LiveMatchSession, LiveMatchStatus, LiveSubstitutionCommand};
    use crate::r#match::engine::teamplay::coach::instruction::CoachInstruction;
    #[test]
    fn only_managed_fixture_is_claimed_and_instruction_is_queued() {
        let session = LiveMatchSession::new(17);
        assert!(!session.claim_for_fixture(21, 22));
        assert!(session.claim_for_fixture(17, 22));
        assert!(!session.claim_for_fixture(23, 17));
        assert_eq!(session.view().status, LiveMatchStatus::Playing);
        assert!(session.queue_instruction(CoachInstruction::PushForward));
        assert_eq!(session.take_instruction(), Some(CoachInstruction::PushForward));
        session.finish();
        assert_eq!(session.view().status, LiveMatchStatus::Finished);
    }
    #[test]
    fn no_match_is_reported_when_the_day_has_no_manager_fixture() {
        let session = LiveMatchSession::new(17);
        session.finish();
        assert_eq!(session.view().status, LiveMatchStatus::NoMatch);
    }

    #[test]
    fn delayed_poll_can_recover_every_frame_from_a_full_regulation_match() {
        const REGULATION_FRAMES: usize = 90 * 60 * 2;
        let session = LiveMatchSession::new(17);

        for index in 0..REGULATION_FRAMES {
            session.publish(LiveMatchFrame {
                sequence: 0,
                home_team_id: 17,
                away_team_id: 22,
                elapsed_ms: index as u64 * 500,
                minute: (index / 120) as u32,
                home_score: 0,
                away_score: 0,
                ball_x: 0.5,
                ball_y: 0.5,
                ball_z: 0.0,
                instruction: "normal".to_string(),
                events: Vec::new(),
                goals: Vec::new(),
                players: Vec::new(),
                substitutes: Vec::new(),
            });
        }

        let recovered = session.view_after_frames(0, 0);
        assert_eq!(recovered.frames.len(), REGULATION_FRAMES);
        assert_eq!(recovered.frames.first().map(|frame| frame.sequence), Some(1));
        assert_eq!(
            recovered.frames.last().map(|frame| frame.sequence),
            Some(REGULATION_FRAMES as u64)
        );
    }

    #[test]
    fn live_substitution_command_is_single_pending_and_resolved_or_rejected_at_finish() {
        let session = LiveMatchSession::new(17);
        assert!(session.claim_for_fixture(17, 22));

        let first = LiveSubstitutionCommand {
            outgoing_player_id: 101,
            incoming_player_id: 111,
        };
        let second = LiveSubstitutionCommand {
            outgoing_player_id: 102,
            incoming_player_id: 112,
        };

        assert!(session.queue_substitution(first));
        assert!(!session.queue_substitution(second));
        assert_eq!(session.view().pending_substitution.map(|s| s.outgoing_player_id), Some(101));
        assert_eq!(session.take_substitution().map(|s| s.incoming_player_id), Some(111));
        // Do not accept a second request until the engine resolves the first.
        assert!(!session.queue_substitution(second));

        session.resolve_substitution(first, true, 67);
        let resolved = session.view().last_substitution.unwrap();
        assert_eq!(resolved.status, "applied");
        assert_eq!(resolved.minute, 67);

        assert!(session.queue_substitution(second));
        session.finish();
        let finished = session.view();
        assert_eq!(finished.status, LiveMatchStatus::Finished);
        assert!(finished.pending_substitution.is_none());
        let rejected = finished.last_substitution.unwrap();
        assert_eq!(rejected.outgoing_player_id, 102);
        assert_eq!(rejected.status, "rejected");
        assert!(!session.queue_substitution(first));
    }
}
