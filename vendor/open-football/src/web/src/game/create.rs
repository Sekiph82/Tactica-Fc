use crate::{ApiError, ApiResult, GameAppData};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct ManagerCareerRequest {
    pub team_id: u32,
}

#[derive(Serialize)]
pub struct ManagerCareerResponse {
    pub team_id: u32,
    pub club_name: String,
    pub team_name: String,
}

pub async fn game_create_action(
    State(state): State<GameAppData>,
    Json(body): Json<ManagerCareerRequest>,
) -> ApiResult<impl IntoResponse> {
    let guard = state.data.read().await;
    let simulator_data = guard
        .as_ref()
        .ok_or_else(|| ApiError::InternalError("Simulator data not loaded".to_string()))?;
    let team = simulator_data
        .team(body.team_id)
        .filter(|team| team.team_type == core::TeamType::Main)
        .ok_or_else(|| ApiError::NotFound("A first team was not found".to_string()))?;
    let club_name = simulator_data
        .club(team.club_id)
        .map(|club| club.name.clone())
        .ok_or_else(|| ApiError::NotFound("The club was not found".to_string()))?;
    let response = ManagerCareerResponse {
        team_id: team.id,
        club_name,
        team_name: team.name.clone(),
    };
    drop(guard);
    if let Err(error) = state.manager_career_store.save_team_id(body.team_id) {
        log::error!("failed to persist manager team selection: {error}");
        return Err(ApiError::InternalError(
            "Could not save the manager career selection".to_string(),
        ));
    }
    *state.manager_team_id.write().await = Some(body.team_id);
    Ok((StatusCode::OK, Json(response)))
}
