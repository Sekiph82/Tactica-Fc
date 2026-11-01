pub mod routes;

use crate::common::default_handler::{COMPUTER_NAME, CPU_BRAND, CPU_CORES, CSS_VERSION};
use crate::views::{MenuSection, SubTitleFlag, manager_career_menu};
use crate::worker::WorkerStatus;
use crate::{ApiError, ApiResult, GameAppData, I18n, LlmSettings};
use askama::Template;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::http::header::HOST;
use axum::response::IntoResponse;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct CountryListRequest {
    lang: String,
}

#[derive(Template, askama_web::WebTemplate)]
#[template(path = "countries/list/index.html")]
pub struct CountryListTemplate {
    pub css_version: &'static str,
    pub computer_name: &'static str,
    pub cpu_brand: &'static str,
    pub cores_count: usize,
    pub title: String,
    pub sub_title_prefix: String,
    pub sub_title_suffix: String,
    pub sub_title: String,
    pub sub_title_link: String,
    pub sub_title_flag: Option<SubTitleFlag>,
    pub header_color: String,
    pub foreground_color: String,
    pub menu_sections: Vec<MenuSection>,
    pub i18n: I18n,
    pub lang: String,
    pub continents: Vec<ContinentDto>,
    pub manager_career: Option<ManagerCareerHome>,
    pub manager_teams: Vec<ManagerClubChoice>,
    pub version: &'static str,
    pub total_countries: usize,
    pub total_clubs: usize,
    pub total_players: usize,
    pub show_download: bool,
    /// Total configured distributed match workers (regardless of
    /// status). Drives the Machine-card badge that links to the
    /// dedicated workers page; zero hides the badge entirely.
    pub workers_count: usize,
    /// Workers currently in `Ready` state — surfaced alongside the
    /// total so the badge can read "3/4 ready" at a glance.
    pub workers_ready: usize,
    /// True once an OpenAI-compatible LLM contract has been saved — the
    /// "AI" badge renders ON when set, OFF otherwise.
    pub ai_enabled: bool,
    /// Values pre-filled into the AI settings dialog: the saved contract
    /// when configured, otherwise the built-in defaults.
    pub ai_base_url: String,
    pub ai_model: String,
    pub ai_api_key: String,
}

pub struct ManagerCareerHome {
    pub team_slug: String,
    pub club_name: String,
    pub league_name: String,
}

pub struct ManagerClubChoice {
    pub team_id: u32,
    pub team_slug: String,
    pub label: String,
}

pub struct ContinentDto {
    pub name: String,
    pub countries: Vec<CountryDto>,
}

/// Build the i18n key for a continent's display name. Lowercases, then
/// folds non-alphanumeric runs into a single `_` (so "North America"
/// becomes `continent_north_america`). The handler uses this with a
/// fall-through to the raw English name when no translation exists,
/// so an unrecognised continent never renders the bare key.
fn continent_i18n_key(name: &str) -> String {
    let mut out = String::from("continent_");
    let mut prev_underscore = true;
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            for lc in c.to_lowercase() {
                out.push(lc);
            }
            prev_underscore = false;
        } else if !prev_underscore {
            out.push('_');
            prev_underscore = true;
        }
    }
    out.trim_end_matches('_').to_string()
}

pub struct CountryDto {
    pub slug: String,
    pub code: String,
    pub name: String,
}

pub async fn country_list_action(
    State(state): State<GameAppData>,
    headers: HeaderMap,
    Path(route_params): Path<CountryListRequest>,
) -> ApiResult<impl IntoResponse> {
    let i18n = state.i18n.for_lang(&route_params.lang);
    let guard = state.data.read().await;

    let simulator_data = guard
        .as_ref()
        .ok_or_else(|| ApiError::InternalError("Simulator data not loaded".to_string()))?;

    let continents: Vec<ContinentDto> = simulator_data
        .continents
        .iter()
        .map(|continent| {
            let mut countries: Vec<CountryDto> = continent
                .countries
                .iter()
                .filter(|c| !c.leagues.leagues.is_empty())
                .map(|country| CountryDto {
                    slug: country.slug.clone(),
                    code: country.code.clone(),
                    name: country.name.clone(),
                })
                .collect();
            countries.sort_by(|a, b| a.slug.cmp(&b.slug));
            let key = continent_i18n_key(&continent.name);
            let translated = i18n.t(&key);
            let localized = if translated == key {
                continent.name.clone()
            } else {
                translated.to_string()
            };
            ContinentDto {
                name: localized,
                countries,
            }
        })
        .collect();

    let total_countries = continents.iter().map(|c| c.countries.len()).sum();
    let manager_team_id = *state.manager_team_id.read().await;
    let manager_career = manager_team_id
        .and_then(|team_id| simulator_data.team(team_id))
        .filter(|team| team.team_type == core::TeamType::Main)
        .map(|team| ManagerCareerHome {
            team_slug: team.slug.clone(),
            club_name: simulator_data
                .club(team.club_id)
                .map(|club| club.name.clone())
                .unwrap_or_else(|| team.name.clone()),
            league_name: team
                .league_id
                .and_then(|league_id| simulator_data.league(league_id))
                .map(|league| league.name.clone())
                .unwrap_or_default(),
        });
    let current_path = format!("/{}", route_params.lang);
    let menu_sections = manager_career
        .as_ref()
        .map(|career| manager_career_menu(&i18n, &route_params.lang, &career.team_slug, &current_path))
        .unwrap_or_default();
    let sub_title = manager_career
        .as_ref()
        .map(|career| {
            if career.league_name.is_empty() {
                career.club_name.clone()
            } else {
                format!("{} · {}", career.club_name, career.league_name)
            }
        })
        .unwrap_or_else(|| i18n.t("select_country_sub").to_string());
    let mut manager_teams = Vec::new();
    for continent in &simulator_data.continents {
        for country in &continent.countries {
            for club in &country.clubs {
                for team in &club.teams.teams {
                    if team.team_type != core::TeamType::Main || team.league_id.is_none() {
                        continue;
                    }
                    let league_name = team
                        .league_id
                        .and_then(|league_id| simulator_data.league(league_id))
                        .map(|league| league.name.as_str())
                        .unwrap_or("");
                    manager_teams.push(ManagerClubChoice {
                        team_id: team.id,
                        team_slug: team.slug.clone(),
                        label: format!("{} · {} · {}", club.name, league_name, country.name),
                    });
                }
            }
        }
    }
    manager_teams.sort_by(|a, b| a.label.cmp(&b.label));
    let mut total_clubs = 0usize;
    let mut total_players = 0usize;
    for continent in &simulator_data.continents {
        for country in &continent.countries {
            total_clubs += country.clubs.len();
            for club in &country.clubs {
                for team in &club.teams.teams {
                    total_players += team.players.players.len();
                }
            }
        }
    }

    let show_download = headers
        .get(HOST)
        .and_then(|v| v.to_str().ok())
        .map(|h| h.starts_with("open-football.org") || h.starts_with("www.open-football.org"))
        .unwrap_or(false);

    let workers_snapshot = state.workers.snapshot().await;
    let workers_count = workers_snapshot.len();
    let workers_ready = workers_snapshot
        .iter()
        .filter(|w| matches!(w.status, WorkerStatus::Ready))
        .count();

    let ai_saved = state.ai.get().await;
    let ai_enabled = ai_saved.is_some();
    let ai_settings = ai_saved.unwrap_or_else(LlmSettings::defaults);

    Ok(CountryListTemplate {
        css_version: CSS_VERSION,
        computer_name: &COMPUTER_NAME,
        cpu_brand: &CPU_BRAND,
        cores_count: *CPU_CORES,
        title: format!("TACTICA FC v{}", env!("CARGO_PKG_VERSION")),
        sub_title_prefix: String::new(),
        sub_title_suffix: String::new(),
        sub_title,
        sub_title_link: format!("/{}", route_params.lang),
        sub_title_flag: None,
        header_color: String::new(),
        foreground_color: String::new(),
        menu_sections,
        lang: route_params.lang,
        i18n,
        continents,
        manager_career,
        manager_teams,
        version: env!("CARGO_PKG_VERSION"),
        total_countries,
        total_clubs,
        total_players,
        show_download,
        workers_count,
        workers_ready,
        ai_enabled,
        ai_base_url: ai_settings.base_url,
        ai_model: ai_settings.model,
        ai_api_key: ai_settings.api_key,
    })
}
