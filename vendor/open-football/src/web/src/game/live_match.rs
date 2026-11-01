use crate::GameAppData;
use axum::Json;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use core::r#match::engine::teamplay::coach::instruction::CoachInstruction;
use core::r#match::LiveSubstitutionCommand;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct LiveInstructionRequest {
    pub instruction: String,
}

#[derive(Deserialize)]
pub struct LiveSubstitutionRequest {
    pub outgoing_player_id: u32,
    pub incoming_player_id: u32,
}

#[derive(Deserialize)]
pub struct LiveMatchQuery {
    #[serde(default)]
    pub after_event: u64,
    #[serde(default)]
    pub after_frame: Option<u64>,
}

pub async fn live_match_get_action(
    State(state): State<GameAppData>,
    Query(query): Query<LiveMatchQuery>,
) -> impl IntoResponse {
    let session = state.live_match_session.read().await.clone();
    Json(session.map(|session| {
        session.view_after_frames(query.after_event, query.after_frame.unwrap_or(u64::MAX))
    }))
}

pub async fn live_instruction_action(
    State(state): State<GameAppData>,
    Json(body): Json<LiveInstructionRequest>,
) -> StatusCode {
    let instruction = match body.instruction.as_str() {
        "normal" => CoachInstruction::Normal,
        "slow_down" => CoachInstruction::SlowDown,
        "push_forward" => CoachInstruction::PushForward,
        "all_out_attack" => CoachInstruction::AllOutAttack,
        "waste_time" => CoachInstruction::WasteTime,
        "park_the_bus" => CoachInstruction::ParkTheBus,
        _ => return StatusCode::BAD_REQUEST,
    };
    let session = state.live_match_session.read().await.clone();
    let Some(session) = session else {
        return StatusCode::CONFLICT;
    };
    if session.queue_instruction(instruction) {
        StatusCode::ACCEPTED
    } else {
        StatusCode::CONFLICT
    }
}

pub async fn live_substitution_action(
    State(state): State<GameAppData>,
    Json(body): Json<LiveSubstitutionRequest>,
) -> StatusCode {
    if body.outgoing_player_id == body.incoming_player_id {
        return StatusCode::BAD_REQUEST;
    }
    let session = state.live_match_session.read().await.clone();
    let Some(session) = session else {
        return StatusCode::CONFLICT;
    };
    if session.queue_substitution(LiveSubstitutionCommand {
        outgoing_player_id: body.outgoing_player_id,
        incoming_player_id: body.incoming_player_id,
    }) {
        StatusCode::ACCEPTED
    } else {
        StatusCode::CONFLICT
    }
}
