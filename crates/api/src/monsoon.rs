//! Follow the Rupee read API over the separate `civic_lens_monsoon` database (H2).
//!
//! Read-only by construction: a second pool (`mcl_api` -> `SET ROLE mcl_app`, `default_transaction_read_only = on`,
//! `statement_timeout = 5000ms`). Every number, label, caveat and narrative served here is read from the database that the
//! H1V pipeline loaded; this module adds no analytical rules. All SQL is parameterised; sort/mode/class/format values are
//! whitelisted and numeric limits are clamped integers.
use crate::correlation::CorrelationId;
use crate::problem::Problem;
use crate::AppState;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use serde_json::{json, Value};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::PgPool;
use std::collections::HashMap;
use std::str::FromStr;
use std::time::Duration;

pub const MONSOON_DB: &str = "civic_lens_monsoon";
const NEW_LANE: &str = "NEW_BUDGET_CANDIDATE_LANE";
const DLP_LANE: &str = "DLP_REVIEW_FIRST_LANE";
const FLAG_CLASSES: [&str; 4] = [
    "PRIMARY_REVIEW_FLAG",
    "TRACEABILITY_GAP",
    "CONTEXT_INDICATOR",
    "OUTCOME_INDICATOR",
];
const FLAG_TYPES: [&str; 8] = [
    "RATE_CARD_VARIANCE_REVIEW",
    "HIGH_CONFIDENCE_DUPLICATE_CANDIDATE",
    "DLP_SURFACE_REPAIR_REVIEW",
    "UNLINKED_WORK_ORDER",
    "DLP_CONTEXT_ONLY",
    "REPEATED_WORK_REVIEW",
    "REOPENED_WITHIN_30D",
    "SLA_MISSED",
];
const VARIANCE_BANDS: [&str; 3] = [
    "REVIEW",
    "HIGH_VARIANCE_REVIEW",
    "VERY_HIGH_VARIANCE_REVIEW",
];
const MODES: [&str; 3] = ["trail", "audit", "next_rupee"];

// ------------------------------------------------------------------------------------------------------- connection

/// `MONSOON_DATABASE_URL`, else `APP_DATABASE_URL` (env or `.env.local`) with the database swapped. Never printed.
pub fn connect_monsoon() -> Result<PgPool, String> {
    let opts = match std::env::var("MONSOON_DATABASE_URL")
        .ok()
        .filter(|v| !v.trim().is_empty())
    {
        Some(u) => PgConnectOptions::from_str(&u)
            .map_err(|_| "MONSOON_DATABASE_URL is not a valid PostgreSQL URL".to_string())?,
        None => {
            let app = mcl_infrastructure::read::app_database_url().map_err(|e| e.to_string())?;
            PgConnectOptions::from_str(&app)
                .map_err(|_| "APP_DATABASE_URL is not a valid PostgreSQL URL".to_string())?
                .database(MONSOON_DB)
        }
    }
    .options([
        ("default_transaction_read_only", "on"),
        ("statement_timeout", "5000"),
    ]);
    Ok(PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(3))
        .after_connect(|conn, _| {
            Box::pin(async move {
                sqlx::query("SET ROLE mcl_app").execute(conn).await?;
                Ok(())
            })
        })
        .connect_lazy_with(opts))
}

/// (session_user, current_user, database, read_only) of the live monsoon session; used for the startup identity check.
pub async fn identity(pool: &PgPool) -> Result<(String, String, String, bool), sqlx::Error> {
    let r: (String, String, String, String) = sqlx::query_as(
        "SELECT session_user::text, current_user::text, current_database()::text, current_setting('transaction_read_only')",
    )
    .fetch_one(pool)
    .await?;
    Ok((r.0, r.1, r.2, r.3 == "on"))
}

// ------------------------------------------------------------------------------------------------------- helpers

struct MErr(StatusCode, &'static str, &'static str);

fn respond(cid: &str, r: Result<Value, MErr>) -> Response {
    match r {
        Ok(v) => {
            let mut resp = Json(v).into_response();
            resp.headers_mut()
                .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            resp
        }
        Err(MErr(s, t, d)) => Problem::new(s, t, Some(d), cid).into_response(),
    }
}

fn db_err(e: sqlx::Error) -> MErr {
    tracing::warn!(error = %e, "monsoon query failed");
    MErr(
        StatusCode::SERVICE_UNAVAILABLE,
        "Monsoon data unavailable",
        "The Follow the Rupee database could not answer this read.",
    )
}

fn pool(state: &AppState) -> Result<&PgPool, MErr> {
    state.monsoon_pool.as_ref().ok_or(MErr(
        StatusCode::SERVICE_UNAVAILABLE,
        "Monsoon data unavailable",
        "The Follow the Rupee database is not configured.",
    ))
}

async fn jq(pool: &PgPool, sql: &str, binds: &[Option<String>]) -> Result<Value, MErr> {
    let mut q = sqlx::query_scalar::<_, Option<Value>>(sql);
    for b in binds {
        q = q.bind(b.clone());
    }
    Ok(q.fetch_one(pool)
        .await
        .map_err(db_err)?
        .unwrap_or(Value::Null))
}

async fn jq_ids(pool: &PgPool, sql: &str, ids: Vec<String>) -> Result<Value, MErr> {
    Ok(sqlx::query_scalar::<_, Option<Value>>(sql)
        .bind(ids)
        .fetch_one(pool)
        .await
        .map_err(db_err)?
        .unwrap_or(Value::Null))
}

type Q = HashMap<String, String>;

fn qs(q: &Q, k: &str) -> Option<String> {
    q.get(k)
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty() && v.len() <= 120)
}

fn qs_in(q: &Q, k: &str, allowed: &[&str]) -> Result<Option<String>, MErr> {
    match qs(q, k) {
        None => Ok(None),
        Some(v) if allowed.contains(&v.as_str()) => Ok(Some(v)),
        Some(_) => Err(MErr(
            StatusCode::BAD_REQUEST,
            "Invalid request",
            "A query parameter value is not one of the allowed values.",
        )),
    }
}

fn qint(q: &Q, k: &str, min: i64, max: i64, default: i64) -> Result<i64, MErr> {
    match qs(q, k) {
        None => Ok(default),
        Some(v) => v.parse::<i64>().map(|n| n.clamp(min, max)).map_err(|_| {
            MErr(
                StatusCode::BAD_REQUEST,
                "Invalid request",
                "A numeric query parameter is not an integer.",
            )
        }),
    }
}

/// Ward codes are one or two letters with an optional `/` suffix letter; anything else is rejected before SQL.
fn ward_param(q: &Q) -> Result<Option<String>, MErr> {
    match qs(q, "ward") {
        None => Ok(None),
        Some(w) if w.eq_ignore_ascii_case("all") => Ok(None),
        Some(w) => {
            let u = w.to_uppercase();
            let ok = u.len() <= 3
                && !u.is_empty()
                && u.chars().all(|c| c.is_ascii_uppercase() || c == '/');
            if ok {
                Ok(Some(u))
            } else {
                Err(MErr(
                    StatusCode::BAD_REQUEST,
                    "Invalid request",
                    "ward must be a BMC ward code such as A, L or F/S.",
                ))
            }
        }
    }
}

fn csv_cell(v: &Value) -> String {
    let s = match v {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        Value::Array(a) => a
            .iter()
            .map(|x| {
                x.as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| x.to_string())
            })
            .collect::<Vec<_>>()
            .join("; "),
        other => other.to_string(),
    };
    // Spreadsheet formula-injection guard for text cells.
    let s = if matches!(v, Value::String(_)) && s.starts_with(['=', '+', '@', '-']) {
        format!("'{s}")
    } else {
        s
    };
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s
    }
}

fn csv_response(cols: &[&str], rows: &[Value], filename: &str) -> Response {
    let mut out = String::from("\u{feff}");
    out.push_str(&cols.join(","));
    out.push('\n');
    for r in rows {
        let line: Vec<String> = cols.iter().map(|c| csv_cell(&r[*c])).collect();
        out.push_str(&line.join(","));
        out.push('\n');
    }
    let mut resp = (StatusCode::OK, out).into_response();
    let h = resp.headers_mut();
    h.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/csv; charset=utf-8"),
    );
    h.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{filename}\""))
            .unwrap_or_else(|_| HeaderValue::from_static("attachment")),
    );
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    resp
}

// ---------------------------------------------------------------------------------------------- road projection (SQL)

/// CTE `rxc`: monsoon_roads plus ward rank within lane (presentation of the stored risk score), the open-backlog and
/// primary-flag counts, and `aff` (stored `affordable_now`, or a what-if comparison against `budget_override_inr`).
fn rxc(ov: Option<i64>) -> String {
    let aff = match ov {
        None => "r.affordable_now".to_string(),
        Some(v) => format!(
            "CASE WHEN r.lane = '{NEW_LANE}' AND r.estimated_candidate_cost_inr IS NOT NULL \
             THEN r.estimated_candidate_cost_inr <= {v} ELSE NULL END"
        ),
    };
    format!(
        "rxc AS (SELECT r.*, \
         rank() OVER (PARTITION BY r.ward_code, r.lane ORDER BY r.risk_score DESC NULLS LAST, r.road_id) AS ward_rank_calc, \
         (SELECT count(*) FROM monsoon_audit_flags f WHERE f.road_id = r.road_id AND f.flag_class = 'PRIMARY_REVIEW_FLAG') AS primary_flag_count, \
         (SELECT count(*) FROM monsoon_complaints c WHERE c.nearest_road_id = r.road_id AND c.linkage_bucket = 'ACTIONABLE_UNLINKED_BACKLOG') AS open_backlog_count, \
         {aff} AS aff FROM monsoon_roads r)"
    )
}

/// jsonb object for one `rxc` row aliased `rx`.
const ROAD_JSON: &str = "(jsonb_build_object(\
 'road_id',rx.road_id,'road_name',rx.road_name,'ward_code',rx.ward_code,'road_type',rx.road_type,'surface',rx.surface,\
 'under_dlp',rx.under_dlp,'last_resurfaced',rx.last_resurfaced,'length_m',rx.length_m,\
 'risk_score',rx.risk_score,'evidence_coverage_pct',rx.evidence_coverage_pct,'lane',rx.lane,\
 'ward_rank',rx.ward_rank_calc,'citywide_lane_rank',rx.lane_rank,'top10_profile_count',rx.top10_profile_count,\
 'dominant_issue_type',rx.dominant_issue_type,'candidate_treatment',rx.candidate_treatment_method,\
 'candidate_treatment_label',rx.candidate_treatment,'candidate_unit_group',rx.candidate_unit_group,\
 'candidate_30d_reopen_pct',rx.candidate_30d_reopen_pct,'estimated_candidate_cost_inr',rx.estimated_candidate_cost_inr,\
 'affordable_now',rx.aff,'allocation_action',rx.allocation_action,'allocation_note',rx.allocation_note,\
 'dlp_caveat',rx.dlp_caveat,'potential_spend_avoided_label',rx.potential_spend_avoided_label,\
 'potential_spend_avoided_inr',rx.potential_spend_avoided_inr,'top_factors',rx.top_factors,\
 'rank_status',rx.rank_status,'methodology_status',rx.methodology_status) || jsonb_build_object(\
 'factors',jsonb_build_object('C',rx.\"C_norm\",'R',rx.\"R_norm\",'F',rx.\"F_norm\",'A',rx.\"A_norm\",'V',rx.\"V_norm\",'D',rx.\"D_norm\",'T',rx.\"T_norm\"),\
 'ward_remaining_budget_inr',rx.ward_remaining_budget_inr,'mid_lat',rx.mid_lat,'mid_lon',rx.mid_lon,\
 'primary_flag_count',rx.primary_flag_count,'reopen_count',rx.reopen_n::bigint,'open_backlog_count',rx.open_backlog_count,\
 'narrative',rx.narrative,'narrative_author',rx.narrative_author,'complaints_any_nearby',rx.complaints_any_nearby,\
 'accidents_surface_cause',rx.accidents_surface_cause,'hotspots_within_radius',rx.hotspots_within_radius,\
 'emergency_hospitals',rx.emergency_hospitals,'schools',rx.schools))";

/// Ward rows as jsonb. `$1` is the optional ward filter.
const WARDS_SQL: &str = "SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.ward_code), '[]'::jsonb) FROM (\
 SELECT w.ward_code, w.ward_name, w.zone, w.low_lying_index, w.engineering_crews, w.population_est, \
 w.monsoon_repair_budget_inr_2025, w.actual_spend_inr, w.remaining_inr, w.utilization_pct, w.wo_count, \
 w.reopened_30d_spend_inr, w.reopened_30d_jobs, w.rate_variance_count, w.rate_variance_inr, w.duplicate_candidate_count, \
 w.dlp_surface_review_count, w.dlp_surface_review_spend_inr, w.dlp_context_only_count, w.dlp_context_only_spend_inr, \
 w.unlinked_wo_count, w.unique_touched_wo_count, w.touched_billed_inr, w.open_complaints, w.ambulance_urgent_posts, \
 (w.actual_spend_inr > w.monsoon_repair_budget_inr_2025) AS over_budget, \
 w.top_new_budget_road_id, w.top_dlp_road_id, w.narrative, w.narrative_author, \
 ST_AsGeoJSON(w.geom, 5)::jsonb AS geometry, \
 (SELECT coalesce(jsonb_agg(x ORDER BY x.spend_inr DESC), '[]'::jsonb) FROM (SELECT o.contractor_id, max(o.contractor_name) AS contractor_name, \
   sum(o.cost_inr) AS spend_inr, count(*) AS jobs FROM monsoon_work_orders o WHERE o.ward_code = w.ward_code GROUP BY o.contractor_id) x) AS contractor_breakdown, \
 (SELECT coalesce(jsonb_agg(x ORDER BY x.spend_inr DESC), '[]'::jsonb) FROM (SELECT o.repair_method, sum(o.cost_inr) AS spend_inr, count(*) AS jobs \
   FROM monsoon_work_orders o WHERE o.ward_code = w.ward_code GROUP BY o.repair_method) x) AS method_breakdown \
 FROM monsoon_wards w WHERE ($1::text IS NULL OR w.ward_code = $1)) t";

const CONTRACTORS_SQL: &str = "SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.reopen_delta_pts ASC, t.contractor_id), '[]'::jsonb) FROM (\
 SELECT contractor_id, contractor_name, jobs_count, total_spend_inr, reopened_jobs, observed_reopen_pct, expected_reopen_method_mix_pct, \
 reopen_delta_pts, sla_met_pct, low_lying_exposure_pct, sla_vs_low_lying_benchmark_pts, sla_non_causal_note, reopen_context_note, \
 avg_cost_ratio, rate_variance_count, rate_variance_inr, duplicate_candidate_count, dlp_surface_review_count, unlinked_wo_count, \
 unique_primary_flagged_wo, touched_billed_inr, reopened_30d_spend_inr, active_wards, empanelled_since, narrative, narrative_author, \
 jsonb_build_object('Primary', idx_primary, 'Reopen-Dominant', idx_reopen_dominant, 'SLA-Dominant', idx_sla_dominant, \
   'Billing-Dominant', idx_billing_dominant, 'Equal-Balanced', idx_equal_balanced) AS idx \
 FROM monsoon_contractors WHERE ($1::text IS NULL OR contractor_id = $1)) t";

// ------------------------------------------------------------------------------------------------------- overview

pub async fn overview(
    State(st): State<AppState>,
    Extension(CorrelationId(cid)): Extension<CorrelationId>,
) -> Response {
    respond(&cid, overview_inner(&st).await)
}

async fn overview_inner(st: &AppState) -> Result<Value, MErr> {
    let p = pool(st)?;
    let m = jq(
        p,
        "SELECT jsonb_object_agg(key, value) FROM monsoon_meta",
        &[],
    )
    .await?;
    let hero = jq(
        p,
        "SELECT jsonb_build_object('ward_count', count(*), 'wo_count', sum(wo_count), 'spend_inr', sum(actual_spend_inr), \
         'budget_inr', sum(monsoon_repair_budget_inr_2025), 'remaining_inr', sum(remaining_inr), \
         'over_budget_wards', coalesce(jsonb_agg(jsonb_build_object('ward_code', ward_code, 'utilization_pct', utilization_pct) \
            ORDER BY utilization_pct DESC) FILTER (WHERE actual_spend_inr > monsoon_repair_budget_inr_2025), '[]'::jsonb), \
         'reopened_30d_spend_inr', sum(reopened_30d_spend_inr), 'reopened_30d_jobs', sum(reopened_30d_jobs), \
         'sla_missed_count', (SELECT count(*) FROM monsoon_audit_flags WHERE flag_type = 'SLA_MISSED'), \
         'open_backlog_count', (SELECT count(*) FROM monsoon_complaints WHERE linkage_bucket = 'ACTIONABLE_UNLINKED_BACKLOG')) FROM monsoon_wards",
        &[],
    )
    .await?;
    let bands = jq(
        p,
        "SELECT coalesce(jsonb_object_agg(variance_band, n), '{}'::jsonb) FROM (SELECT variance_band, count(*) n FROM monsoon_audit_flags \
         WHERE flag_type = 'RATE_CARD_VARIANCE_REVIEW' GROUP BY 1) x",
        &[],
    )
    .await?;
    let trail = jq(
        p,
        "SELECT jsonb_build_object('complaints', (SELECT count(*) FROM monsoon_complaints), 'issues', (SELECT count(*) FROM monsoon_issues), \
         'social_posts', (SELECT count(*) FROM monsoon_social_posts), \
         'ambulance_urgent_posts', (SELECT count(*) FROM monsoon_social_posts WHERE social_class = 'AMBULANCE_URGENT'), \
         'repair_failed_posts', (SELECT count(*) FROM monsoon_social_posts WHERE social_class = 'REPAIR_FAILED'), \
         'ward_border_review', (SELECT count(*) FROM monsoon_complaints WHERE ward_border_review), \
         'category_unverified', (SELECT count(*) FROM monsoon_complaints WHERE category_status = 'CATEGORY_UNVERIFIED'), \
         'coord_provenance_counts', (SELECT jsonb_object_agg(coord_provenance, n) FROM (SELECT coord_provenance, count(*) n FROM monsoon_complaints GROUP BY 1) x))",
        &[],
    )
    .await?;
    let h = &m["hero_amounts"];
    let touched = &m["unique_touched"];
    let fc = &m["flag_class_counts"];
    Ok(json!({
        "meta": {
            "disclosure": m["disclosure"],
            "config_version": m["config_version"],
            "methodology_status": m["methodology_status"],
            "model_contribution_disclosure": m["model_contribution_disclosure"],
            "narrative_authorship": m["narrative_authorship"],
        },
        "hero": hero,
        "primary": {
            "finding_count": fc["PRIMARY_REVIEW_FLAG"],
            "unique_wo_count": touched["unique_primary_review_wo_count"],
            "unique_billed_inr": touched["unique_billed_value_touched_inr"],
            "label": touched["label"],
            "qualification": "Categories overlap and are not an estimate of confirmed loss.",
            "rate_variance": {
                "count": h["rate_card_variance_wo_count"],
                "calculated_variance_inr": h["rate_card_calculated_variance_inr"],
                "recorded_billed_inr": h["rate_card_recorded_billed_inr"],
                "bands": bands,
            },
            "duplicate": {
                "count": h["duplicate_candidate_wo_count"],
                "billed_inr": h["duplicate_candidate_billed_inr"],
                "also_unlinked": h["duplicate_candidates_also_unlinked"],
            },
            "dlp_surface": {
                "count": h["dlp_surface_wo_count"],
                "billed_inr": h["dlp_surface_billed_inr"],
            },
            "overlap_matrix": m["overlap_matrix"],
        },
        "flag_class_counts": fc,
        "false_positive_shields": m["false_positive_shields"],
        "spotlight_examples": m["spotlight_examples"],
        "flag_display_labels": m["flag_display_labels"],
        "dlp_lane": m["dlp_lane"],
        "trail": {
            "complaints": trail["complaints"], "issues": trail["issues"],
            "linkage_bucket_counts": m["linkage_bucket_counts"],
            "social_posts": trail["social_posts"],
            "ambulance_urgent_posts": trail["ambulance_urgent_posts"],
            "repair_failed_posts": trail["repair_failed_posts"],
            "ward_border_review": trail["ward_border_review"],
            "category_unverified": trail["category_unverified"],
            "coord_provenance_counts": trail["coord_provenance_counts"],
        },
    }))
}

// ---------------------------------------------------------------------------------------------------------- wards

pub async fn wards(
    State(st): State<AppState>,
    Extension(CorrelationId(cid)): Extension<CorrelationId>,
) -> Response {
    respond(
        &cid,
        async {
            let p = pool(&st)?;
            Ok(json!({"wards": jq(p, WARDS_SQL, &[None]).await?}))
        }
        .await,
    )
}

pub async fn ward_detail(
    State(st): State<AppState>,
    Extension(CorrelationId(cid)): Extension<CorrelationId>,
    Query(q): Query<Q>,
) -> Response {
    respond(&cid, ward_detail_inner(&st, ward_param(&q)).await)
}

/// Path fallback: `/v1/monsoon/wards/{*code}` accepts `F%2FS` (decoded by the extractor) and a literal `F/S`.
pub async fn ward_path(
    State(st): State<AppState>,
    Extension(CorrelationId(cid)): Extension<CorrelationId>,
    Path(code): Path<String>,
) -> Response {
    let mut q = Q::new();
    q.insert("ward".into(), code);
    respond(&cid, ward_detail_inner(&st, ward_param(&q)).await)
}

async fn ward_detail_inner(
    st: &AppState,
    ward: Result<Option<String>, MErr>,
) -> Result<Value, MErr> {
    let ward = ward?.ok_or(MErr(
        StatusCode::BAD_REQUEST,
        "Invalid request",
        "ward is required.",
    ))?;
    let p = pool(st)?;
    let w = jq(p, WARDS_SQL, &[Some(ward.clone())]).await?;
    let Some(wrow) = w.as_array().and_then(|a| a.first()).cloned() else {
        return Err(MErr(StatusCode::NOT_FOUND, "Not found", "No such ward."));
    };
    let top = jq(
        p,
        "SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (SELECT f.work_order_id, array_agg(f.flag_type ORDER BY f.flag_type) AS flag_types, \
         array_agg(f.display_label ORDER BY f.flag_type) AS display_labels, max(f.variance_band) AS variance_band, wo.cost_inr, wo.cost_ratio, \
         (array_agg(f.public_reason ORDER BY f.flag_type))[1] AS one_line_reason \
         FROM monsoon_audit_flags f JOIN monsoon_work_orders wo ON wo.work_order_id = f.work_order_id \
         WHERE f.flag_class = 'PRIMARY_REVIEW_FLAG' AND f.ward_code = $1 GROUP BY f.work_order_id, wo.cost_inr, wo.cost_ratio \
         ORDER BY wo.cost_inr DESC LIMIT 15) t",
        &[Some(ward.clone())],
    )
    .await?;
    let roads = |lane: &'static str| {
        format!(
            "WITH {} SELECT coalesce(jsonb_agg({ROAD_JSON} ORDER BY rx.lane_rank), '[]'::jsonb) FROM (SELECT * FROM rxc WHERE ward_code = $1              AND lane = '{lane}' ORDER BY lane_rank LIMIT 10) rx",
            rxc(None)
        )
    };
    let newr = jq(p, &roads(NEW_LANE), &[Some(ward.clone())]).await?;
    let dlpr = jq(p, &roads(DLP_LANE), &[Some(ward)]).await?;
    Ok(json!({"ward": wrow, "top_primary_wos": top, "new_budget_roads": newr, "dlp_roads": dlpr}))
}

// ------------------------------------------------------------------------------------------------------ map-triage

pub async fn map_triage(
    State(st): State<AppState>,
    Extension(CorrelationId(cid)): Extension<CorrelationId>,
    Query(q): Query<Q>,
) -> Response {
    respond(&cid, map_triage_inner(&st, &q).await)
}

async fn map_triage_inner(st: &AppState, q: &Q) -> Result<Value, MErr> {
    let ward = ward_param(q)?;
    let mode = qs_in(q, "mode", &MODES)?.unwrap_or_else(|| "trail".into());
    let flag_type = qs_in(q, "flag_type", &FLAG_TYPES)?;
    let triage_bucket = qs(q, "triage_bucket");
    let category = qs(q, "category");
    let overlays = qs(q, "include_overlays").as_deref() == Some("true");
    let p = pool(st)?;

    let roads = jq(
        p,
        &format!(
            "WITH {} SELECT coalesce(jsonb_agg({ROAD_JSON} || jsonb_build_object('geometry', ST_AsGeoJSON(rx.geom, 5)::jsonb) ORDER BY rx.lane_rank), '[]'::jsonb) \
             FROM rxc rx WHERE ($1::text IS NULL OR rx.ward_code = $1)",
            rxc(None)
        ),
        &[ward.clone()],
    )
    .await?;

    // Complaint pins only once a ward is selected; never a pin for UNRESOLVED coordinates.
    let issue_filter = "FROM monsoon_issues i JOIN LATERAL (SELECT \
        (array_agg(c.linkage_bucket ORDER BY (c.linkage_bucket = 'ACTIONABLE_UNLINKED_BACKLOG') DESC, c.complaint_id))[1] AS triage_bucket, \
        coalesce(sum(c.upvotes), 0) AS total_upvotes, bool_or(coalesce(c.ward_border_review, false)) AS ward_border_review, \
        (array_agg(c.source_ward_code ORDER BY c.complaint_id))[1] AS source_ward_code, \
        (array_agg(c.ward_provenance ORDER BY c.complaint_id))[1] AS ward_provenance, min(c.gps_accuracy_m) AS gps_accuracy_m, \
        (array_agg(left(c.description, 240) ORDER BY c.complaint_id))[1] AS sample_description \
        FROM monsoon_complaints c WHERE c.issue_id = i.issue_id) c ON true \
        WHERE i.ward_code = $1 AND i.coord_provenance IN ('SOURCE_GPS', 'LOCALITY_CENTROID') \
        AND ($2::text IS NULL OR c.triage_bucket = $2) AND ($3::text IS NULL OR i.category = $3)";
    let (issues, issues_total) = if let Some(w) = ward.clone() {
        let binds = [Some(w), triage_bucket, category];
        let list = jq(
            p,
            &format!(
                "SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (SELECT i.issue_id, i.lat, i.lon, i.coord_provenance, i.ward_code, i.category, \
                 i.complaint_count, i.open_count, i.languages, i.channels, i.issue_status, i.nearest_road_id AS road_id, c.triage_bucket, c.total_upvotes, \
                 c.ward_border_review, c.source_ward_code, c.ward_provenance, c.gps_accuracy_m, c.sample_description, \
                 (i.nearest_road_id IS NOT NULL AND EXISTS (SELECT 1 FROM monsoon_social_posts s WHERE s.matched_road_id = i.nearest_road_id AND s.social_class = 'AMBULANCE_URGENT')) AS has_ambulance_urgent_social, \
                 CASE WHEN coalesce(i.linked_work_order_ids, '') = '' THEN '[]'::jsonb ELSE to_jsonb(string_to_array(i.linked_work_order_ids, '|')) END AS linked_wo_ids \
                 {issue_filter} ORDER BY i.open_count DESC, i.complaint_count DESC, i.issue_id LIMIT 1500) t"
            ),
            &binds,
        )
        .await?;
        let total = jq(
            p,
            &format!("SELECT to_jsonb(count(*)) {issue_filter}"),
            &binds,
        )
        .await?;
        (list, total)
    } else {
        let total = jq(
            p,
            "SELECT to_jsonb(count(*)) FROM monsoon_issues WHERE coord_provenance IN ('SOURCE_GPS', 'LOCALITY_CENTROID')",
            &[],
        )
        .await?;
        (json!([]), total)
    };
    let unresolved = jq(
        p,
        "SELECT to_jsonb(count(*)) FROM monsoon_complaints WHERE coord_provenance = 'UNRESOLVED' AND ($1::text IS NULL OR ward_final = $1)",
        &[ward.clone()],
    )
    .await?;
    let flagged = jq(
        p,
        "SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (SELECT f.work_order_id, r.mid_lat AS lat, r.mid_lon AS lon, wo.ward_code, wo.road_id, \
         array_agg(f.flag_type ORDER BY f.flag_type) AS flag_types, array_agg(f.display_label ORDER BY f.flag_type) AS display_labels, \
         max(f.variance_band) AS variance_band, wo.cost_inr AS billed_inr, (array_agg(f.public_reason ORDER BY f.flag_type))[1] AS one_line_reason \
         FROM monsoon_audit_flags f JOIN monsoon_work_orders wo ON wo.work_order_id = f.work_order_id JOIN monsoon_roads r ON r.road_id = wo.road_id \
         WHERE f.flag_class = 'PRIMARY_REVIEW_FLAG' AND ($1::text IS NULL OR wo.ward_code = $1) AND ($2::text IS NULL OR f.flag_type = $2) \
         GROUP BY f.work_order_id, r.mid_lat, r.mid_lon, wo.ward_code, wo.road_id, wo.cost_inr ORDER BY wo.cost_inr DESC LIMIT 400) t",
        &[ward.clone(), flag_type],
    )
    .await?;
    let returned = issues.as_array().map(|a| a.len()).unwrap_or(0);
    let mut out = json!({
        "mode": mode, "ward": ward, "roads": roads, "issues": issues,
        "issues_total": issues_total, "issues_returned": returned,
        "unresolved_count": unresolved, "flagged_work_orders": flagged,
    });
    if overlays {
        out["overlays"] = jq(
            p,
            "SELECT jsonb_build_object(\
             'flood_hotspots', (SELECT coalesce(jsonb_agg(jsonb_build_object('hotspot_id', hotspot_id, 'name', name, 'ward_code', ward_code, 'lat', lat, 'lon', lon, 'avg_water_depth_cm', avg_water_depth_cm, 'years_flagged_last_5', years_flagged_last_5)), '[]'::jsonb) FROM monsoon_flood_hotspots WHERE ($1::text IS NULL OR ward_code = $1)), \
             'facilities', (SELECT coalesce(jsonb_agg(jsonb_build_object('facility_id', facility_id, 'type', type, 'name', name, 'ward_code', ward_code, 'lat', lat, 'lon', lon, 'emergency_services', emergency_services, 'ambulance_entry_road', ambulance_entry_road)), '[]'::jsonb) FROM monsoon_facilities WHERE ($1::text IS NULL OR ward_code = $1)), \
             'accidents', (SELECT coalesce(jsonb_agg(jsonb_build_object('accident_id', accident_id, 'ward_code', ward_code, 'lat', lat, 'lon', lon, 'severity', severity, 'probable_cause', probable_cause)), '[]'::jsonb) FROM monsoon_accidents WHERE ($1::text IS NULL OR ward_code = $1)))",
            &[ward_param(q)?],
        )
        .await?;
    }
    Ok(out)
}

// ---------------------------------------------------------------------------------------------------------- audit

const AUDIT_CSV_COLS: [&str; 17] = [
    "flag_id",
    "work_order_id",
    "flag_type",
    "display_label",
    "flag_class",
    "tier",
    "variance_band",
    "billed_cost_inr",
    "expected_cost_inr",
    "flag_amount_inr",
    "amount_basis",
    "cost_ratio",
    "ward_code",
    "road_id",
    "contractor_id",
    "contractor_name",
    "public_reason",
];

pub async fn audit_flags(
    State(st): State<AppState>,
    Extension(CorrelationId(cid)): Extension<CorrelationId>,
    Query(q): Query<Q>,
) -> Response {
    match audit_inner(&st, &q).await {
        Ok((v, true)) => {
            let rows = v["rows"].as_array().cloned().unwrap_or_default();
            csv_response(&AUDIT_CSV_COLS, &rows, "mumbai_civic_lens_audit_flags.csv")
        }
        Ok((v, false)) => respond(&cid, Ok(v)),
        Err(e) => respond(&cid, Err(e)),
    }
}

async fn audit_inner(st: &AppState, q: &Q) -> Result<(Value, bool), MErr> {
    let ward = ward_param(q)?;
    let contractor = qs(q, "contractor");
    let class_raw = qs(q, "flag_class").unwrap_or_else(|| "PRIMARY_REVIEW_FLAG".into());
    let flag_class = if class_raw == "ALL" {
        None
    } else if FLAG_CLASSES.contains(&class_raw.as_str()) {
        Some(class_raw)
    } else {
        return Err(MErr(
            StatusCode::BAD_REQUEST,
            "Invalid request",
            "flag_class is not an allowed value.",
        ));
    };
    let flag_type = qs_in(q, "flag_type", &FLAG_TYPES)?;
    let band = qs_in(q, "variance_band", &VARIANCE_BANDS)?;
    let search = qs(q, "q");
    let csv = match qs_in(q, "format", &["json", "csv"])?.as_deref() {
        Some("csv") => true,
        _ => false,
    };
    let limit = qint(q, "limit", 1, 3000, if csv { 3000 } else { 100 })?;
    let offset = qint(q, "offset", 0, 100_000, 0)?;
    let p = pool(st)?;
    let filter = "FROM monsoon_audit_flags f JOIN monsoon_work_orders wo ON wo.work_order_id = f.work_order_id \
        WHERE ($1::text IS NULL OR f.ward_code = $1) AND ($2::text IS NULL OR f.contractor_id = $2) AND ($3::text IS NULL OR f.flag_class = $3) \
        AND ($4::text IS NULL OR f.flag_type = $4) AND ($5::text IS NULL OR f.variance_band = $5) \
        AND ($6::text IS NULL OR f.work_order_id ILIKE '%' || $6 || '%' OR f.road_id ILIKE '%' || $6 || '%' OR f.display_label ILIKE '%' || $6 || '%' \
             OR f.public_reason ILIKE '%' || $6 || '%' OR wo.contractor_name ILIKE '%' || $6 || '%')";
    let binds = [ward, contractor, flag_class, flag_type, band, search];
    let rows = jq(
        p,
        &format!(
            "SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (SELECT f.flag_id, f.work_order_id, f.flag_type, f.display_label, f.flag_class, f.tier, \
             f.public_reason, f.billed_cost_inr, f.expected_cost_inr, f.flag_amount_inr, f.amount_basis, f.variance_band, f.ward_code, f.road_id, \
             f.contractor_id, wo.contractor_name, wo.cost_ratio {filter} ORDER BY (f.flag_class = 'PRIMARY_REVIEW_FLAG') DESC, f.billed_cost_inr DESC NULLS LAST, f.flag_id \
             LIMIT {limit} OFFSET {offset}) t"
        ),
        &binds,
    )
    .await?;
    if csv {
        return Ok((json!({"rows": rows}), true));
    }
    let total = jq(p, &format!("SELECT to_jsonb(count(*)) {filter}"), &binds).await?;
    let m = jq(
        p,
        "SELECT jsonb_object_agg(key, value) FROM monsoon_meta WHERE key IN ('flag_class_counts', 'false_positive_shields', 'overlap_matrix')",
        &[],
    )
    .await?;
    Ok((
        json!({
            "rows": rows, "total": total, "limit": limit, "offset": offset,
            "class_counts": m["flag_class_counts"], "false_positive_shields": m["false_positive_shields"],
            "overlap_matrix": m["overlap_matrix"],
            "qualification": "Categories overlap and are not an estimate of confirmed loss.",
        }),
        false,
    ))
}

// ------------------------------------------------------------------------------------------------------ contractors

pub async fn contractors(
    State(st): State<AppState>,
    Extension(CorrelationId(cid)): Extension<CorrelationId>,
    Query(q): Query<Q>,
) -> Response {
    respond(&cid, async {
        let p = pool(&st)?;
        let sort = qs_in(&q, "sort", &["reopen_delta_pts", "jobs_count", "sla_met_pct", "avg_cost_ratio", "unique_primary_flagged_wo"])?
            .unwrap_or_else(|| "reopen_delta_pts".into());
        let dir = if sort == "reopen_delta_pts" { "ASC" } else { "DESC" };
        let sql = CONTRACTORS_SQL.replace(
            "ORDER BY t.reopen_delta_pts ASC, t.contractor_id",
            &format!("ORDER BY t.{sort} {dir}, t.contractor_id"),
        );
        let rows = jq(p, &sql, &[None]).await?;
        let m = jq(
            p,
            "SELECT jsonb_build_object('index', (SELECT value FROM monsoon_meta WHERE key = 'experimental_accountability_index'), \
             'sensitivity', (SELECT value FROM monsoon_meta WHERE key = 'contractor_sensitivity'))",
            &[],
        )
        .await?;
        let idx = &m["index"];
        Ok(json!({
            "sort": sort,
            "sla_note": rows[0]["sla_non_causal_note"],
            "contractors": rows,
            "methodology": {
                "name": idx["name"], "status": idx["status"], "formula": idx["formula"], "weights": idx["weights"],
                "profiles": m["sensitivity"]["profiles"],
            },
        }))
    }.await)
}

// ------------------------------------------------------------------------------------------------------ next-rupee

const PLAN_CSV_COLS: [&str; 18] = [
    "lane",
    "citywide_lane_rank",
    "ward_rank",
    "road_id",
    "road_name",
    "ward_code",
    "risk_score",
    "evidence_coverage_pct",
    "top10_profile_count",
    "dominant_issue_type",
    "candidate_treatment",
    "estimated_candidate_cost_inr",
    "affordable_now",
    "allocation_action",
    "under_dlp",
    "potential_spend_avoided_label",
    "dlp_caveat",
    "allocation_note",
];

pub async fn next_rupee(
    State(st): State<AppState>,
    Extension(CorrelationId(cid)): Extension<CorrelationId>,
    Query(q): Query<Q>,
) -> Response {
    match next_rupee_inner(&st, &q).await {
        Ok((v, true)) => {
            let mut rows = v["new_budget_lane"].as_array().cloned().unwrap_or_default();
            rows.extend(v["dlp_review_lane"].as_array().cloned().unwrap_or_default());
            csv_response(
                &PLAN_CSV_COLS,
                &rows,
                "mumbai_civic_lens_next_rupee_plan.csv",
            )
        }
        Ok((v, false)) => respond(&cid, Ok(v)),
        Err(e) => respond(&cid, Err(e)),
    }
}

async fn next_rupee_inner(st: &AppState, q: &Q) -> Result<(Value, bool), MErr> {
    let ward = ward_param(q)?;
    let ov = match qs(q, "budget_override_inr") {
        None => None,
        Some(_) => Some(qint(q, "budget_override_inr", 0, 100_000_000_000, 0)?),
    };
    let csv = qs_in(q, "format", &["json", "csv"])?.as_deref() == Some("csv");
    let (n_new, n_dlp) = if ward.is_some() { (500, 500) } else { (25, 15) };
    let p = pool(st)?;
    let lane = |l: &str, n: i64| {
        format!(
            "WITH {} SELECT coalesce(jsonb_agg({ROAD_JSON} ORDER BY rx.lane_rank), '[]'::jsonb) FROM (SELECT * FROM rxc WHERE lane = '{l}' \
             AND ($1::text IS NULL OR ward_code = $1) ORDER BY lane_rank LIMIT {n}) rx",
            rxc(ov)
        )
    };
    let newl = jq(p, &lane(NEW_LANE, n_new), &[ward.clone()]).await?;
    let dlpl = jq(p, &lane(DLP_LANE, n_dlp), &[ward.clone()]).await?;
    if csv {
        return Ok((
            json!({"new_budget_lane": newl, "dlp_review_lane": dlpl}),
            true,
        ));
    }
    let wards = jq(
        p,
        "SELECT coalesce(jsonb_agg(jsonb_build_object('ward_code', ward_code, 'remaining_inr', remaining_inr, 'utilization_pct', utilization_pct, \
         'over_budget', actual_spend_inr > monsoon_repair_budget_inr_2025) ORDER BY ward_code), '[]'::jsonb) FROM monsoon_wards",
        &[],
    )
    .await?;
    let rc = jq(
        p,
        "SELECT jsonb_build_object('label', (SELECT value FROM monsoon_meta WHERE key = 'durability_labels')->'display_label', \
         'caveat', to_jsonb('Illustrative reference only. Not a long-term durability claim; per-sqm and per-job methods are never ranked together.'::text), \
         'per_sqm_surface', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.survival_adjusted_30d_rate_inr), '[]'::jsonb) FROM \
            (SELECT repair_method, wo_jobs, wo_reopened, standard_rate_inr, rate_unit, reopen_30d_pct, non_reopen_30d_pct, survival_adjusted_30d_rate_inr, unit_group, display_label \
             FROM monsoon_rate_card WHERE unit_group = 'PER_SQM_SURFACE') t), \
         'per_job_intervention', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.survival_adjusted_30d_rate_inr), '[]'::jsonb) FROM \
            (SELECT repair_method, wo_jobs, wo_reopened, standard_rate_inr, rate_unit, reopen_30d_pct, non_reopen_30d_pct, survival_adjusted_30d_rate_inr, unit_group, display_label \
             FROM monsoon_rate_card WHERE unit_group = 'PER_JOB_INTERVENTION') t))",
        &[],
    )
    .await?;
    let m = jq(
        p,
        "SELECT jsonb_build_object('dlp_lane', (SELECT value FROM monsoon_meta WHERE key = 'dlp_lane'), \
         'stability', (SELECT value FROM monsoon_meta WHERE key = 'next_rupee_stability'), \
         'weights', (SELECT value FROM monsoon_meta WHERE key = 'next_rupee_weights'), \
         'ward_remaining', (SELECT remaining_inr FROM monsoon_wards WHERE ward_code = $1))",
        &[ward.clone()],
    )
    .await?;
    Ok((
        json!({
            "ward": ward, "budget_override_inr": ov, "ward_remaining_budget_inr": m["ward_remaining"],
            "budget_note": "Risk rank is read from the stored ranking and never changes with budget. The budget only changes Affordable Now.",
            "new_budget_lane": newl, "dlp_review_lane": dlpl, "wards": wards,
            "dlp_caveat": m["dlp_lane"]["caveat"], "allocation_note": m["dlp_lane"]["allocation_note"],
            "potential_spend_label": m["dlp_lane"]["potential_spend_label"],
            "rate_card": rc, "stability": m["stability"], "weights": m["weights"],
        }),
        false,
    ))
}

// ------------------------------------------------------------------------------------------------------- kundali

fn split_ids(v: &Value) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    if let Some(a) = v.as_array() {
        for x in a {
            if let Some(s) = x.as_str() {
                if !s.is_empty() && !out.contains(&s.to_string()) {
                    out.push(s.to_string());
                }
            }
        }
    }
    out
}

pub async fn kundali(
    State(st): State<AppState>,
    Extension(CorrelationId(cid)): Extension<CorrelationId>,
    Path(id): Path<String>,
) -> Response {
    respond(&cid, kundali_inner(&st, &id).await)
}

const COMPLAINT_COLS: &str = "c.complaint_id, c.received_at, c.channel, c.language, c.description, c.photo_description, c.category_reported, \
    c.resolved_category, c.category_status, c.status, c.linkage_bucket, c.ward_final, c.source_ward_code, c.ward_provenance, c.ward_border_review, \
    c.coord_provenance, c.lat_final, c.lon_final, c.gps_accuracy_m, c.locality_text, c.upvotes, c.issue_id, c.nearest_road_id, c.resolved_at, \
    CASE WHEN coalesce(c.linked_work_order_ids, '') = '' THEN '[]'::jsonb ELSE to_jsonb(string_to_array(c.linked_work_order_ids, '|')) END AS linked_wo_ids";

async fn kundali_inner(st: &AppState, raw: &str) -> Result<Value, MErr> {
    let not_found = || {
        MErr(
            StatusCode::NOT_FOUND,
            "Record not found",
            "No Follow the Rupee record matches that identifier.",
        )
    };
    let id = raw.trim().to_uppercase();
    if id.is_empty() || id.len() > 40 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(not_found());
    }
    let kind = if id.starts_with("BMC25-") {
        "complaint"
    } else if id.starts_with("WO25-") {
        "work_order"
    } else if id.starts_with("RD") {
        "road"
    } else if id.starts_with("ISS-") {
        "issue"
    } else {
        return Err(not_found());
    };
    let p = pool(st)?;
    let by = match kind {
        "complaint" => "c.complaint_id = $1",
        "work_order" => "$1 = ANY(string_to_array(c.linked_work_order_ids, '|'))",
        "issue" => "c.issue_id = $1",
        _ => "c.nearest_road_id = $1",
    };
    let complaints = jq(
        p,
        &format!(
            "SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (SELECT {COMPLAINT_COLS} FROM monsoon_complaints c WHERE {by} \
             ORDER BY (c.linkage_bucket = 'ACTIONABLE_UNLINKED_BACKLOG') DESC, c.received_at DESC, c.complaint_id LIMIT 12) t"
        ),
        &[Some(id.clone())],
    )
    .await?;
    let carr = complaints.as_array().cloned().unwrap_or_default();

    let issue = if kind == "issue" {
        jq(
            p,
            "SELECT to_jsonb(i) - 'geom' FROM monsoon_issues i WHERE i.issue_id = $1",
            &[Some(id.clone())],
        )
        .await?
    } else if let Some(iid) = carr
        .iter()
        .find_map(|c| c["issue_id"].as_str().map(str::to_string))
    {
        jq(
            p,
            "SELECT to_jsonb(i) - 'geom' FROM monsoon_issues i WHERE i.issue_id = $1",
            &[Some(iid)],
        )
        .await?
    } else {
        Value::Null
    };

    let mut wo_ids: Vec<String> = vec![];
    match kind {
        "work_order" => wo_ids.push(id.clone()),
        "complaint" => {
            for c in &carr {
                wo_ids.extend(split_ids(&c["linked_wo_ids"]));
            }
        }
        "issue" => {
            if let Some(s) = issue["linked_work_order_ids"].as_str() {
                wo_ids.extend(
                    s.split('|')
                        .filter(|x| x.starts_with("WO25-"))
                        .map(str::to_string),
                );
            }
        }
        _ => {
            let v = jq(
                p,
                "SELECT coalesce(jsonb_agg(work_order_id ORDER BY primary_review_flag_count DESC, cost_inr DESC), '[]'::jsonb) FROM \
                 (SELECT work_order_id, primary_review_flag_count, cost_inr FROM monsoon_work_orders WHERE road_id = $1 \
                  ORDER BY primary_review_flag_count DESC, cost_inr DESC LIMIT 12) x",
                &[Some(id.clone())],
            )
            .await?;
            wo_ids.extend(split_ids(&v));
        }
    }
    wo_ids.dedup();
    wo_ids.truncate(12);
    let work_orders = if wo_ids.is_empty() {
        json!([])
    } else {
        jq_ids(
            p,
            "SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.work_order_id), '[]'::jsonb) FROM (SELECT wo.work_order_id, wo.work_type, wo.repair_method, \
             wo.contractor_id, wo.contractor_name, wo.ward_code, wo.road_id, wo.road_name, wo.assigned_at, wo.work_started_at, wo.completed_at, wo.area_sqm, \
             wo.cost_inr, wo.unit, wo.standard_rate_inr, wo.expected_cost_inr, wo.cost_ratio, wo.rate_variance_inr, wo.variance_band, wo.sla_hours, wo.sla_met, \
             wo.reopened_within_30d, wo.engineer_remark, wo.engineer_remark_audit_weight, wo.under_dlp, wo.last_resurfaced, wo.unlinked, wo.linked_complaint_ids, \
             (SELECT coalesce(jsonb_agg(jsonb_build_object('flag_id', f.flag_id, 'flag_type', f.flag_type, 'display_label', f.display_label, 'flag_class', f.flag_class, \
               'public_reason', f.public_reason, 'flag_amount_inr', f.flag_amount_inr, 'amount_basis', f.amount_basis, 'variance_band', f.variance_band) \
               ORDER BY f.flag_class, f.flag_type), '[]'::jsonb) FROM monsoon_audit_flags f WHERE f.work_order_id = wo.work_order_id) AS flags \
             FROM monsoon_work_orders wo WHERE wo.work_order_id = ANY($1)) t",
            wo_ids.clone(),
        )
        .await?
    };
    let warr = work_orders.as_array().cloned().unwrap_or_default();

    let road_id = if kind == "road" {
        Some(id.clone())
    } else {
        warr.iter()
            .find_map(|w| w["road_id"].as_str().map(str::to_string))
            .or_else(|| {
                carr.iter()
                    .find_map(|c| c["nearest_road_id"].as_str().map(str::to_string))
            })
            .or_else(|| issue["nearest_road_id"].as_str().map(str::to_string))
    };
    if carr.is_empty() && warr.is_empty() && issue.is_null() && kind != "road" {
        return Err(not_found());
    }
    let mut road = Value::Null;
    let mut social = json!([]);
    if let Some(rid) = road_id.clone() {
        road = jq(
            p,
            &format!(
                "WITH {} SELECT {ROAD_JSON} FROM rxc rx WHERE rx.road_id = $1",
                rxc(None)
            ),
            &[Some(rid.clone())],
        )
        .await?;
        if road.is_null() && kind == "road" {
            return Err(not_found());
        }
        if !road.is_null() {
            road["accidents"] = jq(
                p,
                "SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (SELECT accident_id, occurred_at, severity, probable_cause, vehicle_type \
                 FROM monsoon_accidents WHERE road_id = $1 ORDER BY occurred_at DESC LIMIT 8) t",
                &[Some(rid.clone())],
            )
            .await?;
            road["facilities"] = jq(
                p,
                "SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (SELECT facility_id, type, name, emergency_services, ambulance_entry_road \
                 FROM monsoon_facilities f WHERE f.ambulance_entry_road = $1 OR f.ambulance_entry_road = (SELECT road_name FROM monsoon_roads WHERE road_id = $1) LIMIT 6) t",
                &[Some(rid.clone())],
            )
            .await?;
        }
        social = jq(
            p,
            "SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM (SELECT post_id, source, text, likes_or_forwards, social_class, posted_at \
             FROM monsoon_social_posts WHERE matched_road_id = $1 ORDER BY (social_class = 'AMBULANCE_URGENT') DESC, likes_or_forwards DESC LIMIT 5) t",
            &[Some(rid)],
        )
        .await?;
    }
    let contractor = match warr
        .iter()
        .find_map(|w| w["contractor_id"].as_str().map(str::to_string))
    {
        Some(cid2) => jq(p, CONTRACTORS_SQL, &[Some(cid2)])
            .await?
            .get(0)
            .cloned()
            .unwrap_or(Value::Null),
        None => Value::Null,
    };
    let ward_code = road["ward_code"]
        .as_str()
        .map(str::to_string)
        .or_else(|| {
            warr.iter()
                .find_map(|w| w["ward_code"].as_str().map(str::to_string))
        })
        .or_else(|| {
            carr.iter()
                .find_map(|c| c["ward_final"].as_str().map(str::to_string))
        });
    let ward = match ward_code {
        Some(w) => {
            let mut v = jq(p, WARDS_SQL, &[Some(w)])
                .await?
                .get(0)
                .cloned()
                .unwrap_or(Value::Null);
            if let Some(o) = v.as_object_mut() {
                o.remove("geometry");
            }
            v
        }
        None => Value::Null,
    };
    let mut notes = vec![
        "Community social posts are corroborating context only and carry zero audit or risk weight.".to_string(),
        "Engineer remarks are shown as context and carry zero analytical weight.".to_string(),
        "Categories overlap and are not an estimate of confirmed loss.".to_string(),
    ];
    if warr.iter().any(|w| w["under_dlp"].as_str() == Some("Y"))
        || road["under_dlp"].as_str() == Some("Y")
    {
        notes.push("DLP status is temporal/contextual evidence and does not prove contractual applicability or liability.".to_string());
    }
    Ok(json!({
        "id": id, "kind": kind, "complaints": complaints, "social_posts": social, "issue": issue,
        "work_orders": work_orders, "road": road, "contractor": contractor, "ward": ward, "notes": notes,
    }))
}

// ------------------------------------------------------------------------------------------------------ capabilities

/// `GET /health/capabilities`: truthful split between the read-only Follow the Rupee capability and the original command
/// (write) capability. On the hackathon branch commands may be disabled at startup (OF-H2-CMD-ROLE); this says so plainly.
pub async fn capabilities(State(st): State<AppState>) -> Response {
    let monsoon_up = match st.monsoon_pool.as_ref() {
        Some(p) => matches!(
            tokio::time::timeout(
                Duration::from_secs(3),
                sqlx::query_scalar::<_, i32>("SELECT 1").fetch_one(p)
            )
            .await,
            Ok(Ok(_))
        ),
        None => false,
    };
    let commands = st.command_pool.is_some();
    let status = if monsoon_up {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (
        status,
        Json(json!({
            "status": if monsoon_up { "READY" } else { "NOT_READY" },
            "monsoonReads": if monsoon_up { "AVAILABLE" } else { "UNAVAILABLE" },
            "commands": if commands { "ENABLED" } else { "DISABLED" },
        })),
    )
        .into_response()
}
