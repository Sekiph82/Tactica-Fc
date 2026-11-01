pub mod routes;

use crate::common::default_handler::{COMPUTER_NAME, CPU_BRAND, CPU_CORES, CSS_VERSION};
use crate::common::slug::player_history_slug;
use crate::leagues::address::LeagueAddress;
use crate::teams::newspaper::NewspaperCounter;
use crate::views::{self, MenuSection, NeighborMenus, SubTitleFlag};
use crate::{ApiError, ApiResult, GameAppData, I18n};
use askama::Template;
use axum::extract::{Path, Query, State};
use axum::response::IntoResponse;
use chrono::Datelike;
use core::SimulatorData;
use core::transfers::TransferType;
use core::utils::FormattingUtils;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct TeamTransfersRequest {
    lang: String,
    team_slug: String,
}

#[derive(Deserialize)]
pub struct SeasonQuery {
    pub season: Option<u16>,
}

pub struct SeasonOption {
    pub year: u16,
    pub display: String,
    pub selected: bool,
}

#[derive(Template, askama_web::WebTemplate)]
#[template(path = "teams/transfers/index.html")]
pub struct TeamTransfersTemplate {
    pub css_version: &'static str,
    pub computer_name: &'static str,
    pub cpu_brand: &'static str,
    pub cores_count: usize,
    pub i18n: I18n,
    pub lang: String,
    pub title: String,
    pub sub_title_prefix: String,
    pub sub_title_suffix: String,
    pub sub_title: String,
    pub sub_title_link: String,
    pub sub_title_flag: Option<SubTitleFlag>,
    pub header_color: String,
    pub foreground_color: String,
    pub menu_sections: Vec<MenuSection>,
    pub team_slug: String,
    pub is_managed: bool,
    pub transfer_budget: String,
    pub market_opportunities: Vec<MarketOpportunity>,
    pub manager_negotiations: Vec<ManagerNegotiation>,
    pub active_tab: &'static str,
    pub show_finances_tab: bool,
    pub show_academy_tab: bool,
    /// Printed items waiting on the newspaper tab, for the tabbar badge.
    pub newspaper_count: usize,
    pub items: Vec<TransferListItem>,
    pub incoming_transfers: Vec<TransferHistoryItem>,
    pub outgoing_transfers: Vec<TransferHistoryItem>,
    pub incoming_loans: Vec<LoanHistoryItem>,
    pub outgoing_loans: Vec<LoanHistoryItem>,
    pub seasons: Vec<SeasonOption>,
}

pub struct TransferListItem {
    pub player_slug: String,
    pub player_name: String,
    pub position: String,
    pub value: String,
}

pub struct TransferHistoryItem {
    pub player_slug: String,
    pub player_name: String,
    pub other_team: String,
    pub other_team_slug: String,
    pub fee: String,
    pub date: String,
}

pub struct LoanHistoryItem {
    pub player_slug: String,
    pub player_name: String,
    pub other_team: String,
    pub other_team_slug: String,
    pub date: String,
    pub end_date: String,
}

pub struct MarketOpportunity {
    pub player_id: u32,
    pub player_slug: String,
    pub player_name: String,
    pub position: String,
    pub selling_club: String,
    pub asking_price: String,
    pub asking_price_raw: String,
    pub is_loan: bool,
}

pub struct ManagerNegotiation {
    pub negotiation_id: u32,
    pub player_name: String,
    pub direction: String,
    pub fee: String,
    pub fee_raw: String,
    pub annual_wage_raw: u32,
    pub contract_years: u8,
    pub status: String,
    pub phase: String,
    pub expires: String,
    pub can_update_fee: bool,
    pub can_update_wage: bool,
    pub can_respond_as_seller: bool,
}

pub async fn team_transfers_action(
    State(state): State<GameAppData>,
    Path(route_params): Path<TeamTransfersRequest>,
    Query(query): Query<SeasonQuery>,
) -> ApiResult<impl IntoResponse> {
    let guard = state.data.read().await;

    let simulator_data = guard
        .as_ref()
        .ok_or_else(|| ApiError::InternalError("Simulator data not loaded".to_string()))?;

    let i18n = state.i18n.for_lang(&route_params.lang);
    let managed_team_id = *state.manager_team_id.read().await;

    let indexes = simulator_data
        .indexes
        .as_ref()
        .ok_or_else(|| ApiError::InternalError("Indexes not available".to_string()))?;

    let team_id = indexes
        .slug_indexes
        .get_team_by_slug(&route_params.team_slug)
        .ok_or_else(|| {
            ApiError::NotFound(format!("Team '{}' not found", route_params.team_slug))
        })?;
    let is_managed = managed_team_id == Some(team_id);

    let team = simulator_data
        .team(team_id)
        .ok_or_else(|| ApiError::NotFound(format!("Team with ID {} not found", team_id)))?;

    let league = team.league_id.and_then(|id| simulator_data.league(id));

    let now = simulator_data.date.date();
    let (neighbor_teams, country_leagues) =
        get_neighbor_teams(team.club_id, simulator_data, &i18n)?;
    let neighbor_refs: Vec<(&str, &str)> = neighbor_teams
        .iter()
        .map(|(n, s)| (n.as_str(), s.as_str()))
        .collect();
    let league_refs: Vec<(&str, &str)> = country_leagues
        .iter()
        .map(|(n, s)| (n.as_str(), s.as_str()))
        .collect();

    let club_id = team.club_id;

    // Compute season options
    let sim_date = simulator_data.date.date();
    let current_season_year = if sim_date.month() >= 8 {
        sim_date.year() as u16
    } else {
        (sim_date.year() - 1) as u16
    };

    let selected_season = query.season.unwrap_or(current_season_year);

    // Find earliest season that has any transfer involving this club (across all countries)
    let min_season_year = simulator_data
        .continents
        .iter()
        .flat_map(|cont| cont.countries.iter())
        .flat_map(|c| c.transfer_market.transfer_history.iter())
        .filter(|t| t.from_club_id == club_id || t.to_club_id == club_id)
        .map(|t| t.season_year)
        .min()
        .unwrap_or(current_season_year);

    let seasons: Vec<SeasonOption> = (min_season_year..=current_season_year)
        .rev()
        .map(|y| SeasonOption {
            year: y,
            display: format!("{}/{}", y, (y + 1) % 100),
            selected: y == selected_season,
        })
        .collect();

    // Current transfer list items
    let items: Vec<TransferListItem> = team
        .transfer_list
        .items()
        .iter()
        .filter_map(|ti| {
            let player = team.players().into_iter().find(|p| p.id == ti.player_id)?;
            Some(TransferListItem {
                player_slug: player.slug(),
                player_name: format!(
                    "{} {}",
                    player.full_name.display_first_name(),
                    player.full_name.display_last_name()
                ),
                position: player.position().get_short_name().to_string(),
                value: FormattingUtils::format_money(player.value(
                    now,
                    league.map(|l| l.reputation).unwrap_or(0),
                    team.reputation.market_value_score(),
                )),
            })
        })
        .collect();

    let transfer_budget = simulator_data
        .club(team.club_id)
        .and_then(|club| club.finance.transfer_budget.as_ref())
        .map(|budget| FormattingUtils::format_money(budget.amount))
        .unwrap_or_else(|| "—".to_string());
    let mut manager_negotiations = Vec::new();
    if is_managed {
        for continent in &simulator_data.continents {
            for country in &continent.countries {
                for negotiation in country
                    .transfer_market
                    .negotiations
                    .values()
                {
                    let is_buyer_offer = negotiation.buying_club_id == team.club_id;
                    let is_seller_offer = negotiation.selling_club_id == team.club_id;
                    if !is_buyer_offer && !is_seller_offer {
                        continue;
                    }
                    let status = match (is_seller_offer, negotiation.manager_seller_decision, &negotiation.status) {
                        (true, Some(true), _) => i18n.t("mgr_transfer_accept_queued"),
                        (true, Some(false), _) => i18n.t("mgr_transfer_reject_queued"),
                        (_, _, core::transfers::deal::negotiation::NegotiationStatus::Pending) => i18n.t("mgr_transfer_pending"),
                        (_, _, core::transfers::deal::negotiation::NegotiationStatus::Countered) => i18n.t("mgr_transfer_countered"),
                        (_, _, core::transfers::deal::negotiation::NegotiationStatus::Accepted) => i18n.t("mgr_transfer_accepted"),
                        (_, _, core::transfers::deal::negotiation::NegotiationStatus::Rejected) => i18n.t("mgr_transfer_rejected"),
                        (_, _, core::transfers::deal::negotiation::NegotiationStatus::Expired) => i18n.t("mgr_transfer_expired"),
                    };
                    let phase = match &negotiation.phase {
                        core::transfers::deal::negotiation::NegotiationPhase::InitialApproach { .. } => i18n.t("mgr_transfer_phase_approach"),
                        core::transfers::deal::negotiation::NegotiationPhase::ClubNegotiation { .. } => i18n.t("mgr_transfer_phase_clubs"),
                        core::transfers::deal::negotiation::NegotiationPhase::PersonalTerms { .. } => i18n.t("mgr_transfer_phase_personal"),
                        core::transfers::deal::negotiation::NegotiationPhase::MedicalAndFinalization { .. } => i18n.t("mgr_transfer_phase_medical"),
                    };
                    manager_negotiations.push(ManagerNegotiation {
                        negotiation_id: negotiation.id,
                        player_name: negotiation.player_name.clone(),
                        direction: if is_seller_offer {
                            i18n.t("mgr_transfer_incoming").to_string()
                        } else {
                            i18n.t("mgr_transfer_our_offer").to_string()
                        },
                        fee: FormattingUtils::format_money(negotiation.current_offer.base_fee.amount),
                        fee_raw: format!("{:.0}", negotiation.current_offer.base_fee.amount.max(1.0)),
                        annual_wage_raw: negotiation.current_offer.resolved_annual_wage()
                            .or(negotiation.offered_salary)
                            .unwrap_or(1),
                        contract_years: negotiation.current_offer.resolved_contract_years().unwrap_or(4),
                        status: status.to_string(),
                        phase: phase.to_string(),
                        expires: negotiation.expiry_date.format("%d.%m.%Y").to_string(),
                        can_update_fee: is_buyer_offer && matches!(
                            &negotiation.phase,
                            core::transfers::deal::negotiation::NegotiationPhase::ClubNegotiation { round, .. } if *round < 3
                        ) && matches!(
                            &negotiation.status,
                            core::transfers::deal::negotiation::NegotiationStatus::Pending
                                | core::transfers::deal::negotiation::NegotiationStatus::Countered
                        ),
                        can_update_wage: is_buyer_offer && !negotiation.is_loan && matches!(
                            &negotiation.phase,
                            core::transfers::deal::negotiation::NegotiationPhase::PersonalTerms { round, .. } if *round < 2
                        ) && matches!(
                            &negotiation.status,
                            core::transfers::deal::negotiation::NegotiationStatus::Pending
                                | core::transfers::deal::negotiation::NegotiationStatus::Countered
                        ),
                        can_respond_as_seller: is_seller_offer && matches!(
                            &negotiation.phase,
                            core::transfers::deal::negotiation::NegotiationPhase::ClubNegotiation { .. }
                        ) && matches!(
                            &negotiation.status,
                            core::transfers::deal::negotiation::NegotiationStatus::Pending
                                | core::transfers::deal::negotiation::NegotiationStatus::Countered
                        ) && negotiation.manager_seller_decision.is_none(),
                    });
                }
            }
        }
        manager_negotiations.sort_by(|a, b| a.player_name.cmp(&b.player_name));
    }
    let mut market_opportunities = Vec::new();
    if is_managed {
        for continent in &simulator_data.continents {
            for country in &continent.countries {
                for listing in &country.transfer_market.listings {
                    if !matches!(
                        listing.status,
                        core::transfers::market::TransferListingStatus::Available
                            | core::transfers::market::TransferListingStatus::InNegotiation
                    ) || listing.club_id == team.club_id
                    {
                        continue;
                    }
                    let Some(player) = simulator_data.player(listing.player_id) else {
                        continue;
                    };
                    let selling_club = simulator_data
                        .club(listing.club_id)
                        .map(|club| club.name.clone())
                        .unwrap_or_else(|| "Unknown club".to_string());
                    market_opportunities.push(MarketOpportunity {
                        player_id: player.id,
                        player_slug: player.slug(),
                        player_name: player.full_name.to_string(),
                        position: player.position().get_short_name().to_string(),
                        selling_club,
                        asking_price: FormattingUtils::format_money(listing.asking_price.amount),
                        asking_price_raw: format!("{:.0}", listing.asking_price.amount.max(1.0)),
                        is_loan: matches!(
                            &listing.listing_type,
                            core::transfers::market::TransferListingType::Loan
                        ),
                    });
                }
            }
        }
        market_opportunities.sort_by(|a, b| {
            // Surface permanent-transfer targets before the usually cheaper
            // loan listings, otherwise the 30-row cap can hide every player
            // that accepts a wage and contract offer.
            a.is_loan.cmp(&b.is_loan).then_with(|| {
                let a_price = a.asking_price_raw.parse::<f64>().unwrap_or(f64::MAX);
                let b_price = b.asking_price_raw.parse::<f64>().unwrap_or(f64::MAX);
                a_price.total_cmp(&b_price)
            })
        });
        market_opportunities.truncate(30);
    }

    // Incoming/outgoing transfers: scan ALL countries because cross-country
    // transfers are recorded in the buying country's transfer_market, not the
    // selling country's. Without this, foreign sales/purchases are invisible.
    // Transfers and loans both come from transfer_history so they are season-
    // filterable. Loans are distinguished by TransferType::Loan, whose payload
    // carries the loan end date.
    let mut incoming_transfers: Vec<TransferHistoryItem> = Vec::new();
    let mut outgoing_transfers: Vec<TransferHistoryItem> = Vec::new();
    let mut incoming_loans: Vec<LoanHistoryItem> = Vec::new();
    let mut outgoing_loans: Vec<LoanHistoryItem> = Vec::new();

    for continent in &simulator_data.continents {
        for c in &continent.countries {
            for t in &c.transfer_market.transfer_history {
                if t.season_year != selected_season {
                    continue;
                }
                let is_incoming = t.to_club_id == club_id;
                let is_outgoing = t.from_club_id == club_id;
                if !is_incoming && !is_outgoing {
                    continue;
                }

                match &t.transfer_type {
                    TransferType::Loan(end_date) => {
                        let end_date = end_date.format("%d.%m.%Y").to_string();
                        if is_incoming {
                            incoming_loans.push(LoanHistoryItem {
                                player_slug: player_history_slug(
                                    simulator_data,
                                    t.player_id,
                                    &t.player_name,
                                ),
                                player_name: t.player_name.clone(),
                                other_team: if t.from_club_id == 0 {
                                    i18n.t("free_agent").to_string()
                                } else {
                                    t.from_team_name.clone()
                                },
                                other_team_slug: find_team_slug(simulator_data, t.from_club_id),
                                date: t.transfer_date.format("%d.%m.%Y").to_string(),
                                end_date: end_date.clone(),
                            });
                        }
                        if is_outgoing {
                            outgoing_loans.push(LoanHistoryItem {
                                player_slug: player_history_slug(
                                    simulator_data,
                                    t.player_id,
                                    &t.player_name,
                                ),
                                player_name: t.player_name.clone(),
                                other_team: if t.to_club_id == 0 {
                                    i18n.t("free_agent").to_string()
                                } else {
                                    t.to_team_name.clone()
                                },
                                other_team_slug: find_team_slug(simulator_data, t.to_club_id),
                                date: t.transfer_date.format("%d.%m.%Y").to_string(),
                                end_date,
                            });
                        }
                    }
                    TransferType::Permanent | TransferType::Free => {
                        let fee = if t.fee.amount > 0.0 {
                            FormattingUtils::format_money(t.fee.amount)
                        } else {
                            i18n.t("fee_free").to_string()
                        };
                        if is_incoming {
                            incoming_transfers.push(TransferHistoryItem {
                                player_slug: player_history_slug(
                                    simulator_data,
                                    t.player_id,
                                    &t.player_name,
                                ),
                                player_name: t.player_name.clone(),
                                other_team: if t.from_club_id == 0 {
                                    i18n.t("free_agent").to_string()
                                } else {
                                    t.from_team_name.clone()
                                },
                                other_team_slug: find_team_slug(simulator_data, t.from_club_id),
                                fee: fee.clone(),
                                date: t.transfer_date.format("%d.%m.%Y").to_string(),
                            });
                        }
                        if is_outgoing {
                            outgoing_transfers.push(TransferHistoryItem {
                                player_slug: player_history_slug(
                                    simulator_data,
                                    t.player_id,
                                    &t.player_name,
                                ),
                                player_name: t.player_name.clone(),
                                other_team: if t.to_club_id == 0 {
                                    i18n.t("free_agent").to_string()
                                } else {
                                    t.to_team_name.clone()
                                },
                                other_team_slug: find_team_slug(simulator_data, t.to_club_id),
                                fee,
                                date: t.transfer_date.format("%d.%m.%Y").to_string(),
                            });
                        }
                    }
                }
            }
        }
    }

    let (cn, cs) = views::club_country_info(simulator_data, team.club_id);
    let current_path = format!("/{}/teams/{}/transfers", route_params.lang, team.slug);
    let menu_params = views::MenuParams {
        i18n: &i18n,
        lang: &route_params.lang,
        current_path: &current_path,
        country_name: cn,
        country_slug: cs,
    };
    let menu_sections = views::team_menu(&menu_params, &neighbor_refs, &league_refs);
    let title = team.name.clone();
    let league_title = league
        .map(|l| views::league_display_name(l, &i18n, simulator_data))
        .unwrap_or_default();

    Ok(TeamTransfersTemplate {
        css_version: CSS_VERSION,
        computer_name: &COMPUTER_NAME,
        cpu_brand: &CPU_BRAND,
        cores_count: *CPU_CORES,
        i18n,
        lang: route_params.lang.clone(),
        title,
        sub_title_prefix: String::new(),
        sub_title_suffix: String::new(),
        sub_title: league_title,
        sub_title_link: league
            .map(|l| LeagueAddress::of(simulator_data, l).url(&route_params.lang))
            .unwrap_or_default(),
        sub_title_flag: None,
        header_color: simulator_data
            .club(team.club_id)
            .map(|c| c.colors.background.clone())
            .unwrap_or_default(),
        foreground_color: simulator_data
            .club(team.club_id)
            .map(|c| c.colors.foreground.clone())
            .unwrap_or_default(),
        menu_sections,
        team_slug: team.slug.clone(),
        is_managed,
        transfer_budget,
        market_opportunities,
        manager_negotiations,
        active_tab: "transfers",
        show_finances_tab: team.team_type.is_own_team(),
        show_academy_tab: team.team_type == core::TeamType::Main
            || team.team_type == core::TeamType::U18,
        newspaper_count: NewspaperCounter::for_team_page(&state, simulator_data, team).await,
        items,
        incoming_transfers,
        outgoing_transfers,
        incoming_loans,
        outgoing_loans,
        seasons,
    })
}

/// Find the main team slug for a club across all countries.
fn find_team_slug(data: &SimulatorData, club_id: u32) -> String {
    data.club(club_id)
        .and_then(|c| {
            c.teams
                .teams
                .iter()
                .find(|t| t.team_type == core::TeamType::Main)
        })
        .map(|t| t.slug.clone())
        .unwrap_or_default()
}

fn get_neighbor_teams(
    club_id: u32,
    data: &SimulatorData,
    i18n: &I18n,
) -> Result<NeighborMenus, ApiError> {
    let club = data
        .club(club_id)
        .ok_or_else(|| ApiError::InternalError(format!("Club with ID {} not found", club_id)))?;

    let teams = views::neighbor_teams(club, i18n);

    let mut country_leagues: Vec<(u32, String, String)> = data
        .country_by_club(club_id)
        .map(|country| {
            country
                .leagues
                .leagues
                .iter()
                .filter(|l| !l.friendly)
                .map(|l| (l.id, l.name.clone(), l.slug.clone()))
                .collect()
        })
        .unwrap_or_default();
    country_leagues.sort_by_key(|(id, _, _)| *id);

    Ok((
        teams,
        country_leagues
            .into_iter()
            .map(|(_, name, slug)| (name, slug))
            .collect(),
    ))
}
