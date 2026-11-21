//! Mumbai Civic Lens API (P3/P4 reads, P5 first writes, P6 authority reads and commands).
//!
//! Read operations (read pool, `mcl_api` -> `mcl_app`, read-only sessions): `GET /health/live`, `GET /health/ready`,
//! `GET /version`, `GET /v1/map/features`, `GET /v1/issues`, `GET /v1/kundalis/{id}`, `GET /v1/works/{id}`,
//! `GET /v1/budget-traces/{id}`. `getIssue` and `getAuditTimeline` are not implemented: the Kundali already carries its issue
//! and a bounded audit preview.
//!
//! P5 write operations (separate command pool, `mcl_api_write` -> `mcl_command`, insert-only grants): `POST /v1/issues`
//! (`submitIssue`), `POST /v1/issues/{id}/duplicate-candidates` (`checkDuplicates`) and `POST /v1/issues/{id}/evidence`
//! (`addEvidence`). P6 adds the authority family under `/v1/authority/`: reads `GET /v1/authority/dashboard`
//! (`getAuthorityDashboard`) and `GET /v1/authority/dlp-exceptions` (`listDlpExceptions`) on the read pool, and commands
//! `POST /v1/authority/issues/{id}/jurisdiction` (`resolveJurisdiction`) and `POST /v1/authority/issues/{id}/work-link`
//! (`linkWork`) on the command pool. The authority family answers 401 for a missing or unrecognised simulated persona and 403
//! for a recognised persona that the committed workflow does not allow. Every other write stays absent. Nothing here resets or authenticates. `X-Demo-Persona` is a simulated
//! presentation header: it selects which committed workflow rule applies and is never read as authentication or
//! authorization.
pub mod config;
pub mod correlation;
pub mod monsoon;
pub mod problem;

use axum::body::Body;
use axum::extract::rejection::PathRejection;
use axum::extract::{Path, RawQuery, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{middleware, Extension, Json, Router};
use correlation::CorrelationId;
use mcl_application::{
    commands::{
        AddEvidenceCommand, CheckDuplicatesCommand, Command, LinkWorkCommand,
        ResolveJurisdictionCommand, SubmitIssueCommand,
    },
    dedup,
    dto::{Envelope, IssueList, MapFeatureCollection},
    filter::{parse_query, Endpoint},
};
use mcl_domain::jurisdiction::Machine;
use mcl_domain::policy::DuplicatePolicy;
use mcl_domain::records::SynId;
use mcl_infrastructure::command::{self, CommandError, Operation, Persona, Scope};
use mcl_infrastructure::read;
use problem::Problem;
use serde::de::DeserializeOwned;
use serde::Serialize;
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Duration;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use tower_http::cors::{AllowOrigin, CorsLayer};

/// Source of the single evaluation instant used for DLP derivation. Production reads the clock; tests inject a fixed value.
pub type Clock = Arc<dyn Fn() -> OffsetDateTime + Send + Sync>;

#[derive(Clone)]
pub struct AppState {
    /// Read pool (`mcl_api` -> `mcl_app`, read-only sessions). Used by every GET.
    pub pool: PgPool,
    pub clock: Clock,
    /// Command pool (`mcl_api_write` -> `mcl_command`). Used only by the three confirmed P5 mutation handlers.
    pub command_pool: Option<PgPool>,
    /// Read-only pool over the separate `civic_lens_monsoon` database (Follow the Rupee, H2).
    pub monsoon_pool: Option<PgPool>,
    /// The committed duplicate policy (`config/duplicate-policy.json`), parsed and validated once.
    pub policy: Arc<DuplicatePolicy>,
    /// The committed jurisdiction state machine (`config/jurisdiction-state-machine.json`), parsed and validated once.
    pub machine: Arc<Machine>,
}

fn committed_machine() -> Arc<Machine> {
    Arc::new(
        Machine::load()
            .expect("config/jurisdiction-state-machine.json must be a valid committed machine"),
    )
}

fn committed_policy() -> Arc<DuplicatePolicy> {
    Arc::new(
        dedup::load_policy()
            .expect("config/duplicate-policy.json must be a valid committed policy"),
    )
}

impl AppState {
    pub fn new(pool: PgPool) -> Self {
        AppState {
            pool,
            clock: Arc::new(OffsetDateTime::now_utc),
            command_pool: None,
            monsoon_pool: None,
            policy: committed_policy(),
            machine: committed_machine(),
        }
    }
    pub fn with_clock(pool: PgPool, clock: Clock) -> Self {
        AppState {
            pool,
            clock,
            command_pool: None,
            monsoon_pool: None,
            policy: committed_policy(),
            machine: committed_machine(),
        }
    }
    pub fn with_monsoon_pool(mut self, pool: PgPool) -> Self {
        self.monsoon_pool = Some(pool);
        self
    }
    pub fn with_command_pool(mut self, pool: PgPool) -> Self {
        self.command_pool = Some(pool);
        self
    }
}

const READY_TIMEOUT: Duration = Duration::from_secs(3);

pub fn router(state: AppState, cors_origins: &[String]) -> Router {
    let origins: Vec<HeaderValue> = cors_origins
        .iter()
        .filter_map(|o| HeaderValue::from_str(o).ok())
        .collect();
    // Exact-origin allowlist, never a wildcard. GET, plus POST for the three confirmed P5 commands, and only the headers the
    // client sends. If-Match is allowed because `resolveJurisdiction` declares it (it must equal the quoted recordVersion).
    // ETag is exposed for the record version.
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([
            header::CONTENT_TYPE,
            header::IF_MATCH,
            HeaderName::from_static("x-correlation-id"),
            HeaderName::from_static("x-demo-persona"),
            HeaderName::from_static("idempotency-key"),
        ])
        .expose_headers([HeaderName::from_static("x-correlation-id"), header::ETAG])
        .max_age(Duration::from_secs(600));

    Router::new()
        .route("/health/live", get(health_live))
        .route("/health/ready", get(health_ready))
        .route("/health/capabilities", get(monsoon::capabilities))
        .route("/version", get(version))
        .route("/v1/map/features", get(map_features))
        .route("/v1/issues", get(list_issues).post(submit_issue))
        .route(
            "/v1/issues/{id}/duplicate-candidates",
            post(check_duplicates),
        )
        .route("/v1/issues/{id}/evidence", post(add_evidence))
        .route("/v1/kundalis/{id}", get(get_kundali))
        .route("/v1/works/{id}", get(get_work_order))
        .route("/v1/budget-traces/{id}", get(get_budget_trace))
        .route("/v1/monsoon/overview", get(monsoon::overview))
        .route("/v1/monsoon/wards", get(monsoon::wards))
        .route("/v1/monsoon/wards/{*code}", get(monsoon::ward_path))
        .route("/v1/monsoon/ward-detail", get(monsoon::ward_detail))
        .route("/v1/monsoon/map-triage", get(monsoon::map_triage))
        .route("/v1/monsoon/audit/flags", get(monsoon::audit_flags))
        .route("/v1/monsoon/contractors", get(monsoon::contractors))
        .route("/v1/monsoon/next-rupee", get(monsoon::next_rupee))
        .route("/v1/monsoon/kundali/{id}", get(monsoon::kundali))
        .route("/v1/authority/dashboard", get(authority_dashboard))
        .route("/v1/authority/dlp-exceptions", get(dlp_exceptions))
        .route(
            "/v1/authority/issues/{id}/jurisdiction",
            post(resolve_jurisdiction),
        )
        .route("/v1/authority/issues/{id}/work-link", post(link_work))
        .fallback(not_found)
        .method_not_allowed_fallback(method_not_allowed)
        .layer(cors)
        .layer(middleware::from_fn(correlation::correlation))
        .with_state(state)
}

#[derive(Serialize)]
struct HealthLive {
    status: &'static str,
}

/// Liveness only: the process answers. It deliberately says nothing about the database.
async fn health_live() -> Json<HealthLive> {
    Json(HealthLive { status: "UP" })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthReady {
    status: &'static str,
    database: &'static str,
    postgis_version: Option<String>,
}

/// Readiness: a live round trip to PostgreSQL and PostGIS within a bounded time. Failure is 503 with the contract's
/// `NOT_READY` / `DOWN` body; the contract documents no 503 entry, which is recorded as a finding.
async fn health_ready(State(state): State<AppState>) -> Response {
    let probe = tokio::time::timeout(READY_TIMEOUT, read::readiness(&state.pool)).await;
    match probe {
        Ok(Ok(v)) => Json(HealthReady {
            status: "READY",
            database: "UP",
            postgis_version: Some(v),
        })
        .into_response(),
        _ => {
            tracing::warn!("readiness probe failed: database unavailable");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(HealthReady {
                    status: "NOT_READY",
                    database: "DOWN",
                    postgis_version: None,
                }),
            )
                .into_response()
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VersionInfo {
    api_version: &'static str,
    package_version: &'static str,
    record_nature: &'static str,
}

/// Only the three fields the contract defines. No commit, path, user, compiler or environment data.
async fn version() -> Json<VersionInfo> {
    Json(VersionInfo {
        api_version: "v1",
        package_version: mcl_domain::PACKAGE_VERSION,
        record_nature: "SYNTHETIC_DEMONSTRATION",
    })
}

fn no_store<T: IntoResponse>(body: T) -> Response {
    let mut r = body.into_response();
    r.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    r
}

fn read_failure(e: &read::ReadError, cid: &str) -> Response {
    if e.is_unavailable() {
        tracing::warn!(correlation_id = cid, "read failed: database unavailable");
        Problem::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Data source unavailable",
            Some("The synthetic demonstration database could not be reached. Try again shortly."),
            cid,
        )
        .into_response()
    } else {
        // Never leak SQL, paths or internals; the kind is logged, not returned.
        tracing::error!(correlation_id = cid, error_kind = %e, "read failed");
        Problem::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Internal error",
            None,
            cid,
        )
        .into_response()
    }
}

async fn map_features(
    State(state): State<AppState>,
    Extension(CorrelationId(cid)): Extension<CorrelationId>,
    RawQuery(q): RawQuery,
) -> Response {
    let parsed = match parse_query(q.as_deref(), Endpoint::MapFeatures) {
        Ok(p) => p,
        Err(e) => return Problem::bad_request(&e.0, &cid).into_response(),
    };
    let Some(bbox) = parsed.bbox else {
        return Problem::bad_request("bbox is required", &cid).into_response();
    };
    // One evaluation instant for the whole request.
    let at = (state.clock)();
    match read::map_features(&state.pool, &parsed.filter, &bbox, at).await {
        Ok(features) => no_store(Json(Envelope {
            data: MapFeatureCollection::new(features),
            correlation_id: cid,
        })),
        Err(e) => read_failure(&e, &cid),
    }
}

async fn list_issues(
    State(state): State<AppState>,
    Extension(CorrelationId(cid)): Extension<CorrelationId>,
    RawQuery(q): RawQuery,
) -> Response {
    let parsed = match parse_query(q.as_deref(), Endpoint::IssueList) {
        Ok(p) => p,
        Err(e) => return Problem::bad_request(&e.0, &cid).into_response(),
    };
    let at = (state.clock)();
    match read::list_issues(&state.pool, &parsed.filter, at).await {
        Ok(items) => no_store(Json(Envelope {
            data: IssueList::new(items),
            correlation_id: cid,
        })),
        Err(e) => read_failure(&e, &cid),
    }
}

/// A path identifier must match the contract pattern `^SYN-DEMO-[A-Z0-9][A-Z0-9-]*$` and stay short. Anything else is a 400
/// that never echoes the caller's text. These three operations declare no query parameters, so any query is rejected too.
fn path_id(
    id: Result<Path<String>, PathRejection>,
    query: Option<&str>,
    cid: &str,
) -> Result<String, Response> {
    if query.is_some_and(|q| !q.is_empty()) {
        return Err(
            Problem::bad_request("this operation takes no query parameters", cid).into_response(),
        );
    }
    let bad = || {
        Problem::bad_request(
            "the identifier must match SYN-DEMO-<UPPERCASE-LETTERS-DIGITS-HYPHENS>",
            cid,
        )
        .into_response()
    };
    let Path(raw) = id.map_err(|_| bad())?;
    if raw.len() > 128 {
        return Err(bad());
    }
    SynId::try_from(raw)
        .map(|v| v.as_str().to_string())
        .map_err(|_| bad())
}

fn record_not_found(cid: &str) -> Response {
    Problem::new(
        StatusCode::NOT_FOUND,
        "Record not found",
        Some("No synthetic demonstration record has that identifier."),
        cid,
    )
    .into_response()
}

/// 200 with the `{ data, correlationId }` envelope and the contract's `ETag` (the quoted `recordVersion`).
fn ok_with_etag<T: Serialize>(data: T, record_version: u32, cid: String) -> Response {
    let mut r = no_store(Json(Envelope {
        data,
        correlation_id: cid,
    }));
    if let Ok(v) = HeaderValue::from_str(&format!("\"{record_version}\"")) {
        r.headers_mut().insert(header::ETAG, v);
    }
    r
}

async fn get_kundali(
    State(state): State<AppState>,
    Extension(CorrelationId(cid)): Extension<CorrelationId>,
    id: Result<Path<String>, PathRejection>,
    RawQuery(q): RawQuery,
) -> Response {
    let id = match path_id(id, q.as_deref(), &cid) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let at = (state.clock)();
    match read::kundali(&state.pool, &id, at).await {
        Ok(Some(k)) => {
            let version = k.issue.record_version;
            ok_with_etag(k, version, cid)
        }
        Ok(None) => record_not_found(&cid),
        Err(e) => read_failure(&e, &cid),
    }
}

async fn get_work_order(
    State(state): State<AppState>,
    Extension(CorrelationId(cid)): Extension<CorrelationId>,
    id: Result<Path<String>, PathRejection>,
    RawQuery(q): RawQuery,
) -> Response {
    let id = match path_id(id, q.as_deref(), &cid) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let at = (state.clock)();
    match read::work_order_detail(&state.pool, &id, at).await {
        Ok(Some(w)) => {
            let version = w.work_order.record_version;
            ok_with_etag(w, version, cid)
        }
        Ok(None) => record_not_found(&cid),
        Err(e) => read_failure(&e, &cid),
    }
}

async fn get_budget_trace(
    State(state): State<AppState>,
    Extension(CorrelationId(cid)): Extension<CorrelationId>,
    id: Result<Path<String>, PathRejection>,
    RawQuery(q): RawQuery,
) -> Response {
    let id = match path_id(id, q.as_deref(), &cid) {
        Ok(v) => v,
        Err(r) => return r,
    };
    match read::budget_trace(&state.pool, &id).await {
        Ok(Some(t)) => {
            let version = t.budget.record_version;
            ok_with_etag(t, version, cid)
        }
        Ok(None) => record_not_found(&cid),
        Err(e) => read_failure(&e, &cid),
    }
}

async fn not_found(Extension(CorrelationId(cid)): Extension<CorrelationId>) -> Response {
    Problem::new(
        StatusCode::NOT_FOUND,
        "Not found",
        Some("No such operation."),
        &cid,
    )
    .into_response()
}

async fn method_not_allowed(Extension(CorrelationId(cid)): Extension<CorrelationId>) -> Response {
    Problem::new(
        StatusCode::METHOD_NOT_ALLOWED,
        "Method not allowed",
        Some("This method is not supported for this operation."),
        &cid,
    )
    .into_response()
}

// ------------------------------------------------------------------------------------------------ P5 command operations

/// Upper bound on a command body. The largest legitimate body (a 400-character description plus a polygon) is far smaller.
const MAX_COMMAND_BODY: usize = 16 * 1024;

fn ok_json<T: Serialize>(data: T, cid: String) -> Response {
    no_store(Json(Envelope {
        data,
        correlation_id: cid,
    }))
}

/// Maps a command failure to the contract's client errors. Details are fixed wording; nothing from the request, the SQL or the
/// connection is ever included.
fn command_failure(e: &CommandError, cid: &str) -> Response {
    match e {
        CommandError::Conflict(d) => {
            Problem::new(StatusCode::CONFLICT, "Conflict", Some(d), cid).into_response()
        }
        CommandError::Unprocessable(d) => unprocessable(d, cid),
        CommandError::NotFound => record_not_found(cid),
        CommandError::Forbidden(d) => forbidden(d, cid),
        CommandError::Unavailable => {
            tracing::warn!(correlation_id = cid, "command failed: database unavailable");
            Problem::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "Data source unavailable",
                Some(
                    "The synthetic demonstration database could not be reached. Try again shortly.",
                ),
                cid,
            )
            .into_response()
        }
        CommandError::Internal(kind) => {
            tracing::error!(correlation_id = cid, error_kind = %kind, "command failed");
            Problem::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Internal error",
                None,
                cid,
            )
            .into_response()
        }
    }
}

fn unprocessable(detail: &str, cid: &str) -> Response {
    Problem::new(
        StatusCode::UNPROCESSABLE_ENTITY,
        "Unprocessable request",
        Some(detail),
        cid,
    )
    .into_response()
}

fn command_pool<'a>(state: &'a AppState, cid: &str) -> Result<&'a PgPool, Response> {
    state.command_pool.as_ref().ok_or_else(|| {
        Problem::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Command path unavailable",
            Some("This server was started without the command identity."),
            cid,
        )
        .into_response()
    })
}

/// `Idempotency-Key`: required, 8 to 128 visible ASCII characters (contract bound), never echoed.
fn idempotency_key(h: &HeaderMap, cid: &str) -> Result<String, Response> {
    let bad = || {
        Problem::bad_request(
            "the Idempotency-Key header is required and must be 8 to 128 visible ASCII characters",
            cid,
        )
        .into_response()
    };
    let v = h.get("idempotency-key").ok_or_else(bad)?;
    let b = v.as_bytes();
    if b.len() < 8 || b.len() > 128 || !b.iter().all(|c| (0x21..=0x7E).contains(c)) {
        return Err(bad());
    }
    String::from_utf8(b.to_vec()).map_err(|_| bad())
}

/// The simulated persona. Absent means `public`; an unknown value is a malformed request. Never authentication.
fn persona(h: &HeaderMap, cid: &str) -> Result<Persona, Response> {
    match h.get("x-demo-persona") {
        None => Ok(Persona::Public),
        Some(v) => v.to_str().ok().and_then(Persona::parse).ok_or_else(|| {
            Problem::bad_request(
                "X-Demo-Persona must be one of the demonstration persona names",
                cid,
            )
            .into_response()
        }),
    }
}

struct Parsed<P> {
    scope: Scope,
    command: Command<P>,
}

/// Headers, content type, bounded body and strict JSON shape. Failures here are 400 and never echo the caller's text.
async fn parse_command<P: DeserializeOwned>(
    op: Operation,
    headers: &HeaderMap,
    body: Body,
    cid: &str,
) -> Result<Parsed<P>, Response> {
    let persona = persona(headers, cid)?;
    let key = idempotency_key(headers, cid)?;
    let json_ct = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| {
            v.trim()
                .to_ascii_lowercase()
                .starts_with("application/json")
        });
    if !json_ct {
        return Err(
            Problem::bad_request("the request body must be application/json", cid).into_response(),
        );
    }
    let bytes = axum::body::to_bytes(body, MAX_COMMAND_BODY)
        .await
        .map_err(|_| {
            Problem::bad_request(
                "the request body is unreadable or larger than the allowed size",
                cid,
            )
            .into_response()
        })?;
    let command: Command<P> = serde_json::from_slice(&bytes).map_err(|_| {
        Problem::bad_request(
            "the request body does not match the operation's command schema",
            cid,
        )
        .into_response()
    })?;
    Ok(Parsed {
        scope: Scope {
            operation: op,
            persona,
            idempotency_key: key,
        },
        command,
    })
}

fn reject_query(q: Option<&str>, cid: &str) -> Result<(), Response> {
    if q.is_some_and(|q| !q.is_empty()) {
        return Err(
            Problem::bad_request("this operation takes no query parameters", cid).into_response(),
        );
    }
    Ok(())
}

fn canonical<P: Serialize>(c: &Command<P>, cid: &str) -> Result<String, Response> {
    serde_json::to_string(c).map_err(|_| {
        Problem::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Internal error",
            None,
            cid,
        )
        .into_response()
    })
}

async fn submit_issue(
    State(state): State<AppState>,
    Extension(CorrelationId(cid)): Extension<CorrelationId>,
    headers: HeaderMap,
    RawQuery(q): RawQuery,
    body: Body,
) -> Response {
    let run = async {
        reject_query(q.as_deref(), &cid)?;
        let Parsed { scope, command } = parse_command::<
            mcl_application::commands::SubmitIssuePayload,
        >(Operation::SubmitIssue, &headers, body, &cid)
        .await?;
        let record_version = command
            .check_version()
            .map_err(|e| unprocessable(&e.0, &cid))?;
        let payload = command
            .payload
            .validated()
            .map_err(|e| unprocessable(&e.0, &cid))?;
        let cmd: SubmitIssueCommand = Command {
            record_version: i64::from(record_version),
            payload,
        };
        let canonical_body = canonical(&cmd, &cid)?;
        let pool = command_pool(&state, &cid)?;
        let issue = command::submit_issue(
            pool,
            command::SubmitRequest {
                scope,
                record_version,
                payload: cmd.payload,
                canonical_body,
                now: (state.clock)(),
            },
        )
        .await
        .map_err(|e| command_failure(&e, &cid))?;
        let version = issue.record_version;
        Ok::<Response, Response>(ok_with_etag(issue, version, cid.clone()))
    };
    run.await.unwrap_or_else(|r| r)
}

async fn check_duplicates(
    State(state): State<AppState>,
    Extension(CorrelationId(cid)): Extension<CorrelationId>,
    headers: HeaderMap,
    id: Result<Path<String>, PathRejection>,
    RawQuery(q): RawQuery,
    body: Body,
) -> Response {
    let run = async {
        let issue_id = path_id(id, q.as_deref(), &cid)?;
        let Parsed { scope, command } = parse_command::<
            mcl_application::commands::CheckDuplicatesPayload,
        >(Operation::CheckDuplicates, &headers, body, &cid)
        .await?;
        let record_version = command
            .check_version()
            .map_err(|e| unprocessable(&e.0, &cid))?;
        let payload = command
            .payload
            .validated()
            .map_err(|e| unprocessable(&e.0, &cid))?;
        let cmd: CheckDuplicatesCommand = Command {
            record_version: i64::from(record_version),
            payload,
        };
        let canonical_body = canonical(&cmd, &cid)?;
        let pool = command_pool(&state, &cid)?;
        let view = command::check_duplicates(
            pool,
            &state.policy,
            command::CheckRequest {
                scope,
                issue_id,
                record_version,
                payload: cmd.payload,
                canonical_body,
                now: (state.clock)(),
            },
        )
        .await
        .map_err(|e| command_failure(&e, &cid))?;
        Ok::<Response, Response>(ok_json(view, cid.clone()))
    };
    run.await.unwrap_or_else(|r| r)
}

async fn add_evidence(
    State(state): State<AppState>,
    Extension(CorrelationId(cid)): Extension<CorrelationId>,
    headers: HeaderMap,
    id: Result<Path<String>, PathRejection>,
    RawQuery(q): RawQuery,
    body: Body,
) -> Response {
    let run = async {
        let issue_id = path_id(id, q.as_deref(), &cid)?;
        let Parsed { scope, command } = parse_command::<
            mcl_application::commands::AddEvidencePayload,
        >(Operation::AddEvidence, &headers, body, &cid)
        .await?;
        let record_version = command
            .check_version()
            .map_err(|e| unprocessable(&e.0, &cid))?;
        let payload = command
            .payload
            .validated()
            .map_err(|e| unprocessable(&e.0, &cid))?;
        let captured_at = OffsetDateTime::parse(&payload.captured_at, &Rfc3339)
            .map_err(|_| unprocessable("capturedAt must be an RFC 3339 date-time", &cid))?;
        let cmd: AddEvidenceCommand = Command {
            record_version: i64::from(record_version),
            payload,
        };
        let canonical_body = canonical(&cmd, &cid)?;
        let pool = command_pool(&state, &cid)?;
        let evidence = command::add_evidence(
            pool,
            command::EvidenceRequest {
                scope,
                issue_id,
                record_version,
                payload: cmd.payload,
                captured_at,
                canonical_body,
                now: (state.clock)(),
            },
        )
        .await
        .map_err(|e| command_failure(&e, &cid))?;
        let version = evidence.record_version;
        Ok::<Response, Response>(ok_with_etag(evidence, version, cid.clone()))
    };
    run.await.unwrap_or_else(|r| r)
}

// ---------------------------------------------------------------------------------------------- P6 authority operations

fn forbidden(detail: &str, cid: &str) -> Response {
    Problem::new(StatusCode::FORBIDDEN, "Not eligible", Some(detail), cid).into_response()
}

fn unauthorized(detail: &str, cid: &str) -> Response {
    Problem::new(
        StatusCode::UNAUTHORIZED,
        "Persona required",
        Some(detail),
        cid,
    )
    .into_response()
}

/// The authority family's persona gate. Contract: a missing or unrecognised `X-Demo-Persona` is 401; a recognised persona
/// that the committed workflow does not allow is 403. This is a simulated workflow rule, never authentication: the header is
/// self-asserted by the caller and nothing here proves identity.
fn authority_gate(h: &HeaderMap, cid: &str) -> Result<Persona, Response> {
    let Some(v) = h.get("x-demo-persona") else {
        return Err(unauthorized(
            "the X-Demo-Persona header is required for authority operations (a simulated persona, not authentication)",
            cid,
        ));
    };
    let Some(p) = v.to_str().ok().and_then(Persona::parse) else {
        return Err(unauthorized(
            "X-Demo-Persona is not a recognised demonstration persona",
            cid,
        ));
    };
    if p != Persona::Authority {
        return Err(forbidden(
            "the selected demonstration persona is not eligible for the authority workflow (a simulated rule, not authorization)",
            cid,
        ));
    }
    Ok(p)
}

async fn authority_dashboard(
    State(state): State<AppState>,
    Extension(CorrelationId(cid)): Extension<CorrelationId>,
    headers: HeaderMap,
    RawQuery(q): RawQuery,
) -> Response {
    let run = async {
        authority_gate(&headers, &cid)?;
        reject_query(q.as_deref(), &cid)?;
        // One evaluation instant for the whole request.
        let at = (state.clock)();
        let view = read::authority_dashboard(&state.pool, at)
            .await
            .map_err(|e| read_failure(&e, &cid))?;
        Ok::<Response, Response>(ok_json(view, cid.clone()))
    };
    run.await.unwrap_or_else(|r| r)
}

async fn dlp_exceptions(
    State(state): State<AppState>,
    Extension(CorrelationId(cid)): Extension<CorrelationId>,
    headers: HeaderMap,
    RawQuery(q): RawQuery,
) -> Response {
    let run = async {
        authority_gate(&headers, &cid)?;
        reject_query(q.as_deref(), &cid)?;
        let at = (state.clock)();
        let list = read::dlp_exceptions(&state.pool, at)
            .await
            .map_err(|e| read_failure(&e, &cid))?;
        Ok::<Response, Response>(ok_json(list, cid.clone()))
    };
    run.await.unwrap_or_else(|r| r)
}

/// `If-Match` for `resolveJurisdiction`: required, and the quoted decimal form of the version, for example `"3"`. A missing
/// or malformed header is 400; a well-formed value that differs from the body's `recordVersion` is a 409 conflict.
fn if_match_version(h: &HeaderMap, cid: &str) -> Result<i64, Response> {
    let bad = || {
        Problem::bad_request(
            "the If-Match header is required and must be the quoted recordVersion, for example \"3\"",
            cid,
        )
        .into_response()
    };
    let raw = h
        .get(header::IF_MATCH)
        .ok_or_else(bad)?
        .to_str()
        .map_err(|_| bad())?;
    let inner = raw
        .strip_prefix('"')
        .and_then(|r| r.strip_suffix('"'))
        .ok_or_else(bad)?;
    if inner.is_empty() || inner.len() > 10 || !inner.bytes().all(|b| b.is_ascii_digit()) {
        return Err(bad());
    }
    inner.parse::<i64>().map_err(|_| bad())
}

async fn resolve_jurisdiction(
    State(state): State<AppState>,
    Extension(CorrelationId(cid)): Extension<CorrelationId>,
    headers: HeaderMap,
    id: Result<Path<String>, PathRejection>,
    RawQuery(q): RawQuery,
    body: Body,
) -> Response {
    let run = async {
        authority_gate(&headers, &cid)?;
        let issue_id = path_id(id, q.as_deref(), &cid)?;
        let if_match = if_match_version(&headers, &cid)?;
        let Parsed { scope, command } = parse_command::<
            mcl_application::commands::ResolveJurisdictionPayload,
        >(
            Operation::ResolveJurisdiction, &headers, body, &cid
        )
        .await?;
        let record_version = command
            .check_version()
            .map_err(|e| unprocessable(&e.0, &cid))?;
        let payload = command
            .payload
            .validated()
            .map_err(|e| unprocessable(&e.0, &cid))?;
        if if_match != i64::from(record_version) {
            return Err(Problem::new(
                StatusCode::CONFLICT,
                "Conflict",
                Some("If-Match must equal the quoted recordVersion in the command body"),
                &cid,
            )
            .into_response());
        }
        let cmd: ResolveJurisdictionCommand = Command {
            record_version: i64::from(record_version),
            payload,
        };
        let canonical_body = canonical(&cmd, &cid)?;
        let pool = command_pool(&state, &cid)?;
        let jurisdiction = command::resolve_jurisdiction(
            pool,
            &state.machine,
            command::ResolveRequest {
                scope,
                issue_id,
                record_version,
                payload: cmd.payload,
                canonical_body,
                now: (state.clock)(),
            },
        )
        .await
        .map_err(|e| command_failure(&e, &cid))?;
        let version = jurisdiction.record_version;
        Ok::<Response, Response>(ok_with_etag(jurisdiction, version, cid.clone()))
    };
    run.await.unwrap_or_else(|r| r)
}

async fn link_work(
    State(state): State<AppState>,
    Extension(CorrelationId(cid)): Extension<CorrelationId>,
    headers: HeaderMap,
    id: Result<Path<String>, PathRejection>,
    RawQuery(q): RawQuery,
    body: Body,
) -> Response {
    let run =
        async {
            authority_gate(&headers, &cid)?;
            let issue_id = path_id(id, q.as_deref(), &cid)?;
            let Parsed { scope, command } = parse_command::<
                mcl_application::commands::LinkWorkPayload,
            >(Operation::LinkWork, &headers, body, &cid)
            .await?;
            let record_version = command
                .check_version()
                .map_err(|e| unprocessable(&e.0, &cid))?;
            let payload = command
                .payload
                .validated()
                .map_err(|e| unprocessable(&e.0, &cid))?;
            let cmd: LinkWorkCommand = Command {
                record_version: i64::from(record_version),
                payload,
            };
            let canonical_body = canonical(&cmd, &cid)?;
            let pool = command_pool(&state, &cid)?;
            let issue = command::link_work(
                pool,
                command::LinkRequest {
                    scope,
                    issue_id,
                    record_version,
                    payload: cmd.payload,
                    canonical_body,
                    now: (state.clock)(),
                },
            )
            .await
            .map_err(|e| command_failure(&e, &cid))?;
            let version = issue.record_version;
            Ok::<Response, Response>(ok_with_etag(issue, version, cid.clone()))
        };
    run.await.unwrap_or_else(|r| r)
}
