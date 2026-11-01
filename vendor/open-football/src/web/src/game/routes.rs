use crate::GameAppData;
use crate::game::{
    decide_incoming_transfer_offer_action, game_cancel_action, game_create_action,
    game_process_action, game_processing_status_action, live_instruction_action, live_match_get_action,
    live_substitution_action,
    make_transfer_offer_action, manager_mark_league_news_read_action, manager_mark_news_read_action,
    manager_toggle_follow_league_action, set_lineup_action, set_tactics_action, set_team_training_focus_action,
    set_training_action,
    toggle_match_selection_action, toggle_transfer_list_action,
    update_transfer_negotiation_action,
};
use axum::Router;
use axum::routing::{get, post};

pub fn game_routes() -> Router<GameAppData> {
    Router::new()
        .route("/api/game/create", post(game_create_action))
        .route("/api/manager/tactics", post(set_tactics_action))
        .route("/api/manager/news/read", post(manager_mark_news_read_action))
        .route("/api/manager/news/league/{league_id}/read", post(manager_mark_league_news_read_action))
        .route("/api/manager/followed-league/{league_id}", post(manager_toggle_follow_league_action))
        .route("/api/manager/lineup", post(set_lineup_action))
        .route("/api/manager/training/{player_id}", post(set_training_action))
        .route("/api/manager/training-focus", post(set_team_training_focus_action))
        .route("/api/manager/match-selection/{player_id}", post(toggle_match_selection_action))
        .route("/api/manager/transfer-offer", post(make_transfer_offer_action))
        .route(
            "/api/manager/transfer-negotiation",
            post(update_transfer_negotiation_action),
        )
        .route(
            "/api/manager/transfer-response",
            post(decide_incoming_transfer_offer_action),
        )
        .route(
            "/api/manager/transfer-list/{player_id}",
            post(toggle_transfer_list_action),
        )
        .route("/api/game/process", post(game_process_action))
        .route("/api/game/processing", get(game_processing_status_action))
        .route("/api/game/live-match", get(live_match_get_action))
        .route("/api/manager/live-instruction", post(live_instruction_action))
        .route("/api/manager/live-substitution", post(live_substitution_action))
        .route("/api/game/cancel", post(game_cancel_action))
}
