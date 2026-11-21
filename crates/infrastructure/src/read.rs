//! Runtime read path for the P3 API: least-privilege connection, identity proof and the PostGIS read queries.
//!
//! The API never uses the owner (`civic`) credential. It logs in as the dedicated login role `mcl_api` (no privileges of its
//! own, member of `mcl_app` without inheritance) and every connection runs `SET ROLE mcl_app` and is read-only for the whole
//! session (`default_transaction_read_only = on`). Credentials come from `APP_DATABASE_URL` and are never printed.
//!
//! Both read operations build their issue predicate with `push_issue_where`, so the map and the list share one eligibility
//! rule by construction. DLP status is never stored: it is derived with the explicit-instant SQL function
//! `dlp_status_at(work_order, instant)` and the caller supplies one instant per request.
use mcl_application::dto::{FeatureKind, MapFeature, MapFeatureProperties};
use mcl_application::filter::{Bbox, IssueFilter};
use mcl_domain::records::{Geometry, Issue, IssueCategory, RecordNature, SynId};
use serde_json::{json, Value};
use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions, PgRow};
use sqlx::{Postgres, QueryBuilder, Row};
use std::path::Path;
use std::str::FromStr;
use std::time::Duration;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

/// Login role the API connects as, and the application role it assumes for every session.
pub const API_LOGIN_ROLE: &str = "mcl_api";
pub const APP_ROLE: &str = "mcl_app";

#[derive(Debug, thiserror::Error)]
pub enum ReadError {
    #[error("database error")]
    Db(#[source] sqlx::Error),
    #[error("{0}")]
    Config(String),
    #[error("stored record failed strict validation: {0}")]
    Shape(String),
}

impl From<sqlx::Error> for ReadError {
    fn from(e: sqlx::Error) -> Self {
        ReadError::Db(e)
    }
}

impl ReadError {
    /// True when the database could not be reached or did not answer in time (as opposed to a defect).
    pub fn is_unavailable(&self) -> bool {
        matches!(
            self,
            ReadError::Db(
                sqlx::Error::Io(_)
                    | sqlx::Error::Tls(_)
                    | sqlx::Error::PoolTimedOut
                    | sqlx::Error::PoolClosed
                    | sqlx::Error::WorkerCrashed
            )
        )
    }
}

/// `APP_DATABASE_URL` from the environment, else from `.env.local` at the workspace root. Never printed.
pub fn app_database_url() -> Result<String, ReadError> {
    if let Ok(v) = std::env::var("APP_DATABASE_URL") {
        if !v.trim().is_empty() {
            return Ok(v);
        }
    }
    let path = crate::demo::workspace_root().join(".env.local");
    app_database_url_from_file(&path)
}

fn app_database_url_from_file(path: &Path) -> Result<String, ReadError> {
    let text = std::fs::read_to_string(path).map_err(|_| {
        ReadError::Config("APP_DATABASE_URL is not set and .env.local is not readable".into())
    })?;
    for line in text.lines() {
        if let Some(rest) = line.trim().strip_prefix("APP_DATABASE_URL=") {
            if !rest.is_empty() {
                return Ok(rest.to_string());
            }
        }
    }
    Err(ReadError::Config(
        "APP_DATABASE_URL is absent in the environment and .env.local".into(),
    ))
}

/// Non-secret description of a connection target, safe to log and to put in a report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Redacted {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub user: String,
}

pub fn redacted(url: &str) -> Result<Redacted, ReadError> {
    let o = PgConnectOptions::from_str(url)
        .map_err(|_| ReadError::Config("the database URL is not a valid PostgreSQL URL".into()))?;
    Ok(Redacted {
        host: o.get_host().to_string(),
        port: o.get_port(),
        database: o.get_database().unwrap_or_default().to_string(),
        user: o.get_username().to_string(),
    })
}

/// The runtime pool: the login role, then `SET ROLE mcl_app`, read-only sessions, bounded statement time.
pub async fn connect_app(url: &str) -> Result<PgPool, ReadError> {
    let opts = PgConnectOptions::from_str(url)
        .map_err(|_| ReadError::Config("APP_DATABASE_URL is not a valid PostgreSQL URL".into()))?
        .options([
            ("default_transaction_read_only", "on"),
            ("statement_timeout", "5000"),
        ]);
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(3))
        .after_connect(|conn, _| {
            Box::pin(async move {
                sqlx::query("SET ROLE mcl_app").execute(conn).await?;
                Ok(())
            })
        })
        .connect_lazy_with(opts);
    Ok(pool)
}

/// What the live session is actually allowed to be. The API refuses to start unless `is_least_privilege()` holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeIdentity {
    pub session_user: String,
    pub current_user: String,
    pub superuser: bool,
    pub read_only_session: bool,
    pub database: String,
    pub can_create_in_public: bool,
}

impl RuntimeIdentity {
    pub fn is_least_privilege(&self) -> bool {
        self.current_user == APP_ROLE
            && self.session_user == API_LOGIN_ROLE
            && !self.superuser
            && self.read_only_session
            && !self.can_create_in_public
    }
}

pub async fn runtime_identity(pool: &PgPool) -> Result<RuntimeIdentity, ReadError> {
    let row = sqlx::query(
        "SELECT session_user::text AS session_user_name, current_user::text AS current_user_name, \
                (SELECT rolsuper FROM pg_roles WHERE rolname = session_user) AS su, \
                current_setting('default_transaction_read_only') = 'on' AS ro, \
                current_database()::text AS db, \
                has_schema_privilege(current_user, 'public', 'CREATE') AS can_create",
    )
    .fetch_one(pool)
    .await?;
    Ok(RuntimeIdentity {
        session_user: row.try_get("session_user_name")?,
        current_user: row.try_get("current_user_name")?,
        superuser: row.try_get("su")?,
        read_only_session: row.try_get("ro")?,
        database: row.try_get("db")?,
        can_create_in_public: row.try_get("can_create")?,
    })
}

/// Readiness probe: proves a live database connection and PostGIS. Returns the PostGIS library version.
pub async fn readiness(pool: &PgPool) -> Result<String, ReadError> {
    let v: String = sqlx::query_scalar("SELECT postgis_lib_version()")
        .fetch_one(pool)
        .await?;
    Ok(v)
}

fn push_dlp_active_for_issue(qb: &mut QueryBuilder<'_, Postgres>, at: OffsetDateTime) {
    qb.push("COALESCE(i.work_order_id IS NOT NULL AND dlp_status_at(i.work_order_id, ")
        .push_bind(at)
        .push(") = 'ACTIVE', false)");
}

/// The single issue eligibility rule used by both endpoints (alias `i`).
fn push_issue_where(qb: &mut QueryBuilder<'_, Postgres>, f: &IssueFilter, at: OffsetDateTime) {
    qb.push(" WHERE TRUE");
    if let Some(w) = &f.ward {
        qb.push(" AND i.ward_candidate_id IN (SELECT w.id FROM wards w WHERE w.code = ")
            .push_bind(w.clone())
            .push(")");
    }
    if let Some(c) = f.category_wire() {
        qb.push(" AND i.category = ").push_bind(c);
    }
    if let Some(s) = f.status_wire() {
        qb.push(" AND i.status = ").push_bind(s);
    }
    if f.dlp_only {
        qb.push(" AND ");
        push_dlp_active_for_issue(qb, at);
    }
}

fn ts(row: &PgRow, col: &str) -> Result<String, ReadError> {
    let t: OffsetDateTime = row.try_get(col)?;
    t.to_offset(time::UtcOffset::UTC)
        .format(&Rfc3339)
        .map_err(|e| ReadError::Shape(e.to_string()))
}

fn geometry(row: &PgRow, col: &str) -> Result<Value, ReadError> {
    let text: String = row.try_get(col)?;
    serde_json::from_str(&text).map_err(|e| ReadError::Shape(e.to_string()))
}

/// Every issue that satisfies the filter, ordered by id. `at` is the one evaluation instant of the request.
pub async fn list_issues(
    pool: &PgPool,
    filter: &IssueFilter,
    at: OffsetDateTime,
) -> Result<Vec<Issue>, ReadError> {
    let mut qb = QueryBuilder::<Postgres>::new(
        "SELECT i.id::text AS id, i.record_nature, i.source_tier, i.record_version, i.updated_at, i.title, \
                i.public_description, i.category, i.status, i.public_status_explanation, i.reported_at, i.street_name, \
                i.nearby_landmark, ST_AsGeoJSON(i.geometry)::text AS geometry, i.asset_id::text AS asset_id, \
                i.work_order_id::text AS work_order_id, i.ward_candidate_id::text AS ward_candidate_id, \
                i.responsible_department_id::text AS responsible_department_id, i.responsible_post_title, \
                i.escalation_post_title, i.parent_recurrence_id::text AS parent_recurrence_id, i.journeys \
         FROM issues i",
    );
    push_issue_where(&mut qb, filter, at);
    qb.push(" ORDER BY i.id");
    let rows = qb.build().fetch_all(pool).await?;
    rows.iter().map(issue_from_row).collect()
}

fn issue_from_row(row: &PgRow) -> Result<Issue, ReadError> {
    let v = json!({
        "id": row.try_get::<String, _>("id")?,
        "recordNature": row.try_get::<String, _>("record_nature")?,
        "sourceTier": row.try_get::<String, _>("source_tier")?,
        "recordVersion": row.try_get::<i32, _>("record_version")?,
        "updatedAt": ts(row, "updated_at")?,
        "title": row.try_get::<String, _>("title")?,
        "publicDescription": row.try_get::<String, _>("public_description")?,
        "category": row.try_get::<String, _>("category")?,
        "status": row.try_get::<String, _>("status")?,
        "publicStatusExplanation": row.try_get::<String, _>("public_status_explanation")?,
        "reportedAt": ts(row, "reported_at")?,
        "streetName": row.try_get::<String, _>("street_name")?,
        "nearbyLandmark": row.try_get::<String, _>("nearby_landmark")?,
        "geometry": geometry(row, "geometry")?,
        "assetId": row.try_get::<Option<String>, _>("asset_id")?,
        "workOrderId": row.try_get::<Option<String>, _>("work_order_id")?,
        "wardCandidateId": row.try_get::<Option<String>, _>("ward_candidate_id")?,
        "responsibleDepartmentId": row.try_get::<String, _>("responsible_department_id")?,
        "responsiblePostTitle": row.try_get::<String, _>("responsible_post_title")?,
        "escalationPostTitle": row.try_get::<String, _>("escalation_post_title")?,
        "parentRecurrenceId": row.try_get::<Option<String>, _>("parent_recurrence_id")?,
        "journeys": row.try_get::<Vec<String>, _>("journeys")?,
    });
    serde_json::from_value(v).map_err(|e| ReadError::Shape(e.to_string()))
}

fn push_ward_for_asset(qb: &mut QueryBuilder<'_, Postgres>, f: &IssueFilter) {
    if let Some(w) = &f.ward {
        qb.push(" AND a.ward_candidate_id IN (SELECT w.id FROM wards w WHERE w.code = ")
            .push_bind(w.clone())
            .push(")");
    }
}

/// Map features intersecting `bbox` (SRID 4326, boundary inclusive), ordered by kind then id.
///
/// * `ISSUE`: exactly the issues `list_issues` returns for the same filter (same predicate), within the box.
/// * `ASSET` and `PUBLIC_WORK`: only when no `category`/`status` filter is set, because those filters are issue enums and
///   assets (category/status null) and work orders (work status, not an issue status) cannot satisfy them. A public work
///   is drawn on the geometry of the asset it is recorded against; no geometry is ever invented.
pub async fn map_features(
    pool: &PgPool,
    filter: &IssueFilter,
    bbox: &Bbox,
    at: OffsetDateTime,
) -> Result<Vec<MapFeature>, ReadError> {
    let mut qb = QueryBuilder::<Postgres>::new(
        "SELECT f.kind, f.record_id, f.title, f.category, f.status, f.ward_id, f.dlp_active, \
                ST_AsGeoJSON(f.geom)::text AS geometry FROM ( \
         SELECT 1 AS ord, 'ISSUE'::text AS kind, i.id::text AS record_id, i.title::text AS title, i.category::text AS category, \
                i.status::text AS status, i.ward_candidate_id::text AS ward_id, ",
    );
    push_dlp_active_for_issue(&mut qb, at);
    qb.push(" AS dlp_active, i.geometry AS geom FROM issues i");
    push_issue_where(&mut qb, filter, at);

    if filter.category.is_none() && filter.status.is_none() {
        qb.push(
            " UNION ALL SELECT 2, 'ASSET'::text, a.id::text, a.display_name::text, NULL::text, NULL::text, \
                    a.ward_candidate_id::text, EXISTS (SELECT 1 FROM work_orders w WHERE w.asset_id = a.id AND \
                    COALESCE(dlp_status_at(w.id, ",
        );
        qb.push_bind(at);
        qb.push(") = 'ACTIVE', false)), a.geometry FROM assets a WHERE TRUE");
        push_ward_for_asset(&mut qb, filter);
        if filter.dlp_only {
            qb.push(
                " AND EXISTS (SELECT 1 FROM work_orders w WHERE w.asset_id = a.id AND COALESCE(dlp_status_at(w.id, ",
            );
            qb.push_bind(at);
            qb.push(") = 'ACTIVE', false))");
        }
        qb.push(
            " UNION ALL SELECT 3, 'PUBLIC_WORK'::text, w.id::text, w.display_title::text, NULL::text, w.status::text, \
                    a.ward_candidate_id::text, COALESCE(dlp_status_at(w.id, ",
        );
        qb.push_bind(at);
        qb.push(") = 'ACTIVE', false), a.geometry FROM work_orders w JOIN assets a ON a.id = w.asset_id WHERE TRUE");
        push_ward_for_asset(&mut qb, filter);
        if filter.dlp_only {
            qb.push(" AND COALESCE(dlp_status_at(w.id, ");
            qb.push_bind(at);
            qb.push(") = 'ACTIVE', false)");
        }
    }
    qb.push(" ) f WHERE ST_Intersects(f.geom, ST_MakeEnvelope(");
    qb.push_bind(bbox.min_lon).push(", ");
    qb.push_bind(bbox.min_lat).push(", ");
    qb.push_bind(bbox.max_lon).push(", ");
    qb.push_bind(bbox.max_lat)
        .push(", 4326)) ORDER BY f.ord, f.record_id");

    let rows = qb.build().fetch_all(pool).await?;
    rows.iter().map(feature_from_row).collect()
}

fn feature_from_row(row: &PgRow) -> Result<MapFeature, ReadError> {
    let shape = |e: String| ReadError::Shape(e);
    let kind = match row.try_get::<String, _>("kind")?.as_str() {
        "ISSUE" => FeatureKind::Issue,
        "ASSET" => FeatureKind::Asset,
        "PUBLIC_WORK" => FeatureKind::PublicWork,
        other => return Err(shape(format!("unknown feature kind {other}"))),
    };
    let record_id = SynId::try_from(row.try_get::<String, _>("record_id")?).map_err(shape)?;
    let category: Option<String> = row.try_get("category")?;
    let category = category
        .map(|c| serde_json::from_value::<IssueCategory>(Value::String(c)))
        .transpose()
        .map_err(|e| shape(e.to_string()))?;
    let ward_id = row
        .try_get::<Option<String>, _>("ward_id")?
        .map(SynId::try_from)
        .transpose()
        .map_err(shape)?;
    let geom: Geometry =
        serde_json::from_value(geometry(row, "geometry")?).map_err(|e| shape(e.to_string()))?;
    Ok(MapFeature::new(
        record_id.clone(),
        geom,
        MapFeatureProperties {
            kind,
            record_id,
            title: row.try_get("title")?,
            category,
            status: row.try_get("status")?,
            ward_id,
            dlp_active: row.try_get("dlp_active")?,
            record_nature: RecordNature::SyntheticDemonstration,
        },
    ))
}

// ------------------------------------------------------------------------------------------------------- P4 dossier reads
//
// Three read-only operations (`getKundali`, `getWorkOrder`, `getBudgetTrace`). Each runs inside one REPEATABLE READ,
// read-only transaction so every section comes from the same snapshot, and each section is a bounded query keyed by an
// identifier already read (no per-row follow-up queries). Rows are read as `to_jsonb` documents, converted to the
// contract's camelCase names and RFC 3339 UTC timestamps, then deserialized into the strict domain records, so a stored
// record that violates the contract fails loudly instead of being served.
use mcl_application::dto::{
    AuthorityDashboardView, BudgetTraceView, DlpExceptionItem, DlpExceptionList, DlpView,
    KundaliView, WorkOrderDetailView, SYNTHETIC_BANNER,
};
use mcl_domain::dlp::DlpStatus;
use mcl_domain::records::{
    Budget, CivicAsset, CompletionClaim, Contract, Contractor, Correction, Department, DlpRecord,
    Evidence, Jurisdiction, LifecycleEvent, PotentialSpendLabel, Tender, Verification, Ward,
    WorkOrder,
};
use serde::de::DeserializeOwned;
use sqlx::Transaction;

pub(crate) type Tx<'a> = Transaction<'a, Postgres>;

fn camel(key: &str) -> String {
    let mut out = String::with_capacity(key.len());
    let mut up = false;
    for c in key.chars() {
        if c == '_' {
            up = true;
        } else if up {
            out.extend(c.to_uppercase());
            up = false;
        } else {
            out.push(c);
        }
    }
    out
}

/// `to_jsonb` row -> contract JSON: top-level keys in camelCase; `*_at` timestamps re-rendered as RFC 3339 UTC. Nested JSON
/// (for example a correction's `prior_value`) is left exactly as stored.
fn contract_json(doc: Value) -> Result<Value, ReadError> {
    let Value::Object(map) = doc else {
        return Err(ReadError::Shape("a row document was not an object".into()));
    };
    let mut out = serde_json::Map::with_capacity(map.len());
    for (k, v) in map {
        let v = match (&v, k.ends_with("_at")) {
            (Value::String(t), true) => {
                let parsed = OffsetDateTime::parse(t, &Rfc3339)
                    .map_err(|e| ReadError::Shape(format!("{k}: {e}")))?;
                Value::String(
                    parsed
                        .to_offset(time::UtcOffset::UTC)
                        .format(&Rfc3339)
                        .map_err(|e| ReadError::Shape(e.to_string()))?,
                )
            }
            _ => v,
        };
        out.insert(camel(&k), v);
    }
    Ok(Value::Object(out))
}

fn strict<T: DeserializeOwned>(text: &str) -> Result<T, ReadError> {
    let doc: Value = serde_json::from_str(text).map_err(|e| ReadError::Shape(e.to_string()))?;
    serde_json::from_value(contract_json(doc)?).map_err(|e| ReadError::Shape(e.to_string()))
}

/// The document selector for a table; tables with a geometry column render it as GeoJSON.
fn doc(geometry_column: Option<&str>) -> String {
    match geometry_column {
        None => "(to_jsonb(t))".to_string(),
        Some(g) => format!(
            "((to_jsonb(t) - '{g}') || jsonb_build_object('{g}', ST_AsGeoJSON(t.{g})::jsonb))"
        ),
    }
}

/// One record by a key column. `table`, `column` and `geometry_column` are fixed literals chosen in this module, never
/// request data; the key itself is always a bound parameter.
pub(crate) async fn by_key<T: DeserializeOwned>(
    tx: &mut Tx<'_>,
    table: &str,
    geometry_column: Option<&str>,
    column: &str,
    key: &str,
) -> Result<Option<T>, ReadError> {
    let sql = format!(
        "SELECT {}::text FROM {table} t WHERE t.{column} = $1 ORDER BY t.id LIMIT 1",
        doc(geometry_column)
    );
    let row: Option<String> = sqlx::query_scalar(&sql)
        .bind(key)
        .fetch_optional(&mut **tx)
        .await?;
    row.map(|text| strict(&text)).transpose()
}

async fn all_by<T: DeserializeOwned>(
    tx: &mut Tx<'_>,
    table: &str,
    column: &str,
    key: &str,
    order: &str,
) -> Result<Vec<T>, ReadError> {
    let sql =
        format!("SELECT to_jsonb(t)::text FROM {table} t WHERE t.{column} = $1 ORDER BY {order}");
    let rows: Vec<String> = sqlx::query_scalar(&sql)
        .bind(key)
        .fetch_all(&mut **tx)
        .await?;
    rows.iter().map(|text| strict(text)).collect()
}

async fn begin_snapshot(pool: &PgPool) -> Result<Tx<'_>, ReadError> {
    let mut tx = pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .execute(&mut *tx)
        .await?;
    Ok(tx)
}

fn missing(what: &str) -> ReadError {
    ReadError::Shape(format!("a required linked record is absent: {what}"))
}

/// The derived DLP view for a work order, or `None` when no DLP record exists for it. `at` is the request's one instant.
async fn dlp_view(
    tx: &mut Tx<'_>,
    work: &WorkOrder,
    at: OffsetDateTime,
) -> Result<Option<DlpView>, ReadError> {
    let Some(rec) =
        by_key::<DlpRecord>(tx, "dlp_status", None, "work_order_id", work.id.as_str()).await?
    else {
        return Ok(None);
    };
    let status: Option<String> = sqlx::query_scalar("SELECT dlp_status_at($1, $2)")
        .bind(work.id.as_str())
        .bind(at)
        .fetch_one(&mut **tx)
        .await?;
    let status: DlpStatus = serde_json::from_value(Value::String(
        status.ok_or_else(|| ReadError::Shape("dlp status could not be derived".into()))?,
    ))
    .map_err(|e| ReadError::Shape(e.to_string()))?;
    Ok(Some(DlpView {
        id: rec.id,
        record_nature: rec.record_nature,
        source_tier: rec.source_tier,
        record_version: rec.record_version,
        updated_at: rec.updated_at,
        work_order_id: rec.work_order_id,
        dlp_starts_on: rec.dlp_starts_on,
        explanation: rec.explanation,
        warranty_path_note: rec.warranty_path_note,
        synthetic_fresh_repair_estimate_paise: rec.synthetic_fresh_repair_estimate_paise,
        potential_spend_label: rec.potential_spend_label,
        dlp_ends_at: work.dlp_ends_at.clone(),
        evaluated_at: at
            .to_offset(time::UtcOffset::UTC)
            .format(&Rfc3339)
            .map_err(|e| ReadError::Shape(e.to_string()))?,
        status,
    }))
}

async fn asset_by_id(tx: &mut Tx<'_>, id: &str) -> Result<Option<CivicAsset>, ReadError> {
    by_key(tx, "assets", Some("geometry"), "id", id).await
}

/// Budget-to-street chain for one budget line. Links that do not exist stay `null`; the status, last proven link, missing
/// next link and explanation are the stored budget fields, never recomputed or invented here.
async fn trace_for_budget(tx: &mut Tx<'_>, budget: Budget) -> Result<BudgetTraceView, ReadError> {
    let id = budget.id.as_str().to_string();
    let tender: Option<Tender> = by_key(tx, "tenders", None, "budget_id", &id).await?;
    let contract: Option<Contract> = by_key(tx, "contracts", None, "budget_id", &id).await?;
    let (contractor, work_order, asset) = match &contract {
        None => (None, None, None),
        Some(c) => {
            let contractor: Option<Contractor> =
                by_key(tx, "contractors", None, "id", c.vendor_id.as_str()).await?;
            let work_order: Option<WorkOrder> =
                by_key(tx, "work_orders", None, "contract_id", c.id.as_str()).await?;
            let asset = match &work_order {
                Some(w) => asset_by_id(tx, w.asset_id.as_str()).await?,
                None => None,
            };
            (contractor, work_order, asset)
        }
    };
    Ok(BudgetTraceView {
        traceability_status: budget.traceability_status,
        last_proven_link: budget.last_proven_link,
        missing_next_link: budget.missing_next_link,
        explanation: budget.traceability_explanation.clone(),
        budget,
        tender,
        contract,
        contractor,
        work_order,
        asset,
    })
}

/// `getBudgetTrace`. `None` when the budget id is unknown.
pub async fn budget_trace(pool: &PgPool, id: &str) -> Result<Option<BudgetTraceView>, ReadError> {
    let mut tx = begin_snapshot(pool).await?;
    let Some(budget) = by_key::<Budget>(&mut tx, "budgets", None, "id", id).await? else {
        return Ok(None);
    };
    Ok(Some(trace_for_budget(&mut tx, budget).await?))
}

/// `getWorkOrder`. `at` is the request's single evaluation instant for the derived DLP status.
pub async fn work_order_detail(
    pool: &PgPool,
    id: &str,
    at: OffsetDateTime,
) -> Result<Option<WorkOrderDetailView>, ReadError> {
    let mut tx = begin_snapshot(pool).await?;
    let Some(work) = by_key::<WorkOrder>(&mut tx, "work_orders", None, "id", id).await? else {
        return Ok(None);
    };
    let contract: Contract = by_key(&mut tx, "contracts", None, "id", work.contract_id.as_str())
        .await?
        .ok_or_else(|| missing("contract"))?;
    let contractor: Contractor = by_key(
        &mut tx,
        "contractors",
        None,
        "id",
        contract.vendor_id.as_str(),
    )
    .await?
    .ok_or_else(|| missing("contractor"))?;
    let asset = asset_by_id(&mut tx, work.asset_id.as_str())
        .await?
        .ok_or_else(|| missing("asset"))?;
    let dlp_status = dlp_view(&mut tx, &work, at).await?;
    let linked: Vec<String> = sqlx::query_scalar(
        "SELECT i.id::text FROM issues i WHERE i.work_order_id = $1 ORDER BY i.id",
    )
    .bind(work.id.as_str())
    .fetch_all(&mut *tx)
    .await?;
    let linked_issue_ids = linked
        .into_iter()
        .map(SynId::try_from)
        .collect::<Result<Vec<_>, _>>()
        .map_err(ReadError::Shape)?;
    Ok(Some(WorkOrderDetailView {
        work_order: work,
        contract,
        contractor,
        asset,
        dlp_status,
        linked_issue_ids,
    }))
}

/// `getKundali`. `at` is the request's single evaluation instant for the derived DLP status.
pub async fn kundali(
    pool: &PgPool,
    id: &str,
    at: OffsetDateTime,
) -> Result<Option<KundaliView>, ReadError> {
    let mut tx = begin_snapshot(pool).await?;
    let Some(issue) = by_key::<Issue>(&mut tx, "issues", Some("geometry"), "id", id).await? else {
        return Ok(None);
    };
    let ward = match &issue.ward_candidate_id {
        Some(w) => by_key::<Ward>(&mut tx, "wards", Some("boundary"), "id", w.as_str()).await?,
        None => None,
    };
    let asset = match &issue.asset_id {
        Some(a) => asset_by_id(&mut tx, a.as_str()).await?,
        None => None,
    };
    let responsible_department: Department = by_key(
        &mut tx,
        "departments",
        None,
        "id",
        issue.responsible_department_id.as_str(),
    )
    .await?
    .ok_or_else(|| missing("responsible department"))?;
    let jurisdiction: Jurisdiction = by_key(
        &mut tx,
        "jurisdictions",
        None,
        "issue_id",
        issue.id.as_str(),
    )
    .await?
    .ok_or_else(|| missing("jurisdiction"))?;
    let work_order = match &issue.work_order_id {
        Some(w) => by_key::<WorkOrder>(&mut tx, "work_orders", None, "id", w.as_str()).await?,
        None => None,
    };
    let (dlp_status, budget_trace) = match &work_order {
        None => (None, None),
        Some(w) => {
            let dlp = dlp_view(&mut tx, w, at).await?;
            let contract: Contract =
                by_key(&mut tx, "contracts", None, "id", w.contract_id.as_str())
                    .await?
                    .ok_or_else(|| missing("contract"))?;
            let budget: Budget =
                by_key(&mut tx, "budgets", None, "id", contract.budget_id.as_str())
                    .await?
                    .ok_or_else(|| missing("budget"))?;
            (dlp, Some(trace_for_budget(&mut tx, budget).await?))
        }
    };
    let evidence: Vec<Evidence> = all_by(
        &mut tx,
        "evidence",
        "issue_id",
        issue.id.as_str(),
        "t.captured_at, t.id",
    )
    .await?;
    let mut claims: Vec<CompletionClaim> = all_by(
        &mut tx,
        "completion_claims",
        "issue_id",
        issue.id.as_str(),
        "t.claimed_at DESC, t.id",
    )
    .await?;
    let mut verifications: Vec<Verification> = all_by(
        &mut tx,
        "verifications",
        "issue_id",
        issue.id.as_str(),
        "t.window_opens_at DESC, t.id",
    )
    .await?;
    let corrections: Vec<Correction> = all_by(
        &mut tx,
        "corrections",
        "entity_id",
        issue.id.as_str(),
        "t.submitted_at, t.id",
    )
    .await?;
    let audit_events: Vec<LifecycleEvent> = all_by(
        &mut tx,
        "lifecycle_events",
        "entity_id",
        issue.id.as_str(),
        "t.sequence",
    )
    .await?;
    Ok(Some(KundaliView {
        synthetic_banner: SYNTHETIC_BANNER,
        canonical_demo_path: format!("/demo/kundali/{}", issue.id.as_str()),
        ward,
        asset,
        responsible_department,
        jurisdiction,
        work_order,
        dlp_status,
        budget_trace,
        evidence,
        completion_claim: (!claims.is_empty()).then(|| claims.remove(0)),
        verification: (!verifications.is_empty()).then(|| verifications.remove(0)),
        corrections,
        audit_events,
        issue,
    }))
}

// ------------------------------------------------------------------------------------------------ P6 authority reads
//
// `getAuthorityDashboard` and `listDlpExceptions`: read-only, one REPEATABLE READ snapshot per request and one evaluation
// instant. DLP status is derived with `dlp_status_at(work_order, instant)` and never stored. A DLP exception is a potential
// warranty path (temporal overlap of an unlinked open defect with a certified work order on the same asset); it does not
// establish contractual applicability or liability.

/// Upper bound on each queue returned by the authority reads. The synthetic data set is far smaller; the bound keeps a
/// request cheap if demonstration reports accumulate.
pub const AUTHORITY_QUEUE_LIMIT: i64 = 500;

const OPEN_ISSUE: &str = "i.status NOT IN ('DRAFT_LOCAL', 'VERIFIED_COMPLETE')";

fn rfc3339(t: OffsetDateTime) -> Result<String, ReadError> {
    t.to_offset(time::UtcOffset::UTC)
        .format(&Rfc3339)
        .map_err(|e| ReadError::Shape(e.to_string()))
}

async fn syn_ids(tx: &mut Tx<'_>, sql: &str) -> Result<Vec<SynId>, ReadError> {
    let rows: Vec<String> = sqlx::query_scalar(sql).fetch_all(&mut **tx).await?;
    rows.into_iter()
        .map(SynId::try_from)
        .collect::<Result<Vec<_>, _>>()
        .map_err(ReadError::Shape)
}

/// The DLP exception rows for one instant, inside an open snapshot. One query, no per-row follow-up.
async fn dlp_exception_items(
    tx: &mut Tx<'_>,
    at: OffsetDateTime,
) -> Result<Vec<DlpExceptionItem>, ReadError> {
    let rows = sqlx::query(&format!(
        "SELECT i.id::text AS issue_id, w.id::text AS work_id, w.dlp_ends_at AS dlp_ends_at, to_jsonb(d)::text AS dlp, \
                dlp_status_at(w.id::text, $1) AS status \
         FROM issues i \
         JOIN work_orders w ON w.asset_id = i.asset_id \
         JOIN dlp_status d ON d.work_order_id = w.id \
         WHERE i.work_order_id IS NULL AND {OPEN_ISSUE} \
           AND dlp_status_at(w.id::text, $1) = 'ACTIVE' \
           AND i.reported_at >= (d.dlp_starts_on::timestamp AT TIME ZONE 'UTC') AND i.reported_at <= w.dlp_ends_at \
           AND d.synthetic_fresh_repair_estimate_paise IS NOT NULL \
         ORDER BY i.id, w.id LIMIT $2"
    ))
    .bind(at)
    .bind(AUTHORITY_QUEUE_LIMIT)
    .fetch_all(&mut **tx)
    .await?;
    let evaluated_at = rfc3339(at)?;
    rows.iter()
        .map(|r| {
            let rec: DlpRecord = strict(&r.try_get::<String, _>("dlp")?)?;
            let status: String = r.try_get("status")?;
            let status: DlpStatus = serde_json::from_value(Value::String(status))
                .map_err(|e| ReadError::Shape(e.to_string()))?;
            let estimate = rec
                .synthetic_fresh_repair_estimate_paise
                .ok_or_else(|| ReadError::Shape("estimate is absent".into()))?;
            let issue_id =
                SynId::try_from(r.try_get::<String, _>("issue_id")?).map_err(ReadError::Shape)?;
            let work_id =
                SynId::try_from(r.try_get::<String, _>("work_id")?).map_err(ReadError::Shape)?;
            Ok(DlpExceptionItem {
                issue_id,
                candidate_work_order_id: work_id,
                warranty_path_note: rec.warranty_path_note.clone(),
                potential_spend_label: PotentialSpendLabel::SyntheticPotentialNotRealizedSavings,
                synthetic_fresh_repair_estimate_paise: estimate,
                dlp_status: DlpView {
                    id: rec.id,
                    record_nature: rec.record_nature,
                    source_tier: rec.source_tier,
                    record_version: rec.record_version,
                    updated_at: rec.updated_at,
                    work_order_id: rec.work_order_id,
                    dlp_starts_on: rec.dlp_starts_on,
                    explanation: rec.explanation,
                    warranty_path_note: rec.warranty_path_note,
                    synthetic_fresh_repair_estimate_paise: rec
                        .synthetic_fresh_repair_estimate_paise,
                    potential_spend_label: rec.potential_spend_label,
                    dlp_ends_at: ts(r, "dlp_ends_at")?,
                    evaluated_at: evaluated_at.clone(),
                    status,
                },
            })
        })
        .collect()
}

/// `listDlpExceptions`. `at` is the request's single evaluation instant.
pub async fn dlp_exceptions(
    pool: &PgPool,
    at: OffsetDateTime,
) -> Result<DlpExceptionList, ReadError> {
    let mut tx = begin_snapshot(pool).await?;
    Ok(DlpExceptionList {
        items: dlp_exception_items(&mut tx, at).await?,
    })
}

/// `getAuthorityDashboard`. Every queue comes from the same snapshot and the same instant as the DLP derivation.
pub async fn authority_dashboard(
    pool: &PgPool,
    at: OffsetDateTime,
) -> Result<AuthorityDashboardView, ReadError> {
    let mut tx = begin_snapshot(pool).await?;
    let open: i64 =
        sqlx::query_scalar(&format!("SELECT count(*) FROM issues i WHERE {OPEN_ISSUE}"))
            .fetch_one(&mut *tx)
            .await?;
    let awaiting = syn_ids(
        &mut tx,
        &format!(
            "SELECT i.id::text FROM issues i WHERE i.status = 'CLOSURE_CLAIMED_PENDING_VERIFICATION' \
             ORDER BY i.id LIMIT {AUTHORITY_QUEUE_LIMIT}"
        ),
    )
    .await?;
    let uncertain = syn_ids(
        &mut tx,
        &format!(
            "SELECT i.id::text FROM issues i JOIN jurisdictions j ON j.issue_id = i.id \
             WHERE {OPEN_ISSUE} AND j.status IN ('UNKNOWN', 'SPATIALLY_INFERRED_PROVISIONAL', 'CONFLICT_DISPUTED') \
             ORDER BY i.id LIMIT {AUTHORITY_QUEUE_LIMIT}"
        ),
    )
    .await?;
    let mut dlp_ids: Vec<SynId> = Vec::new();
    for item in dlp_exception_items(&mut tx, at).await? {
        if dlp_ids.last() != Some(&item.issue_id) {
            dlp_ids.push(item.issue_id);
        }
    }
    let gaps = syn_ids(
        &mut tx,
        &format!(
            "SELECT b.id::text FROM budgets b WHERE b.traceability_status = 'GAP_BEFORE_STREET_GEOMETRY' \
             ORDER BY b.id LIMIT {AUTHORITY_QUEUE_LIMIT}"
        ),
    )
    .await?;
    Ok(AuthorityDashboardView {
        as_of: rfc3339(at)?,
        open_issue_count: u32::try_from(open).map_err(|e| ReadError::Shape(e.to_string()))?,
        awaiting_verification_issue_ids: awaiting,
        uncertain_jurisdiction_issue_ids: uncertain,
        dlp_exception_issue_ids: dlp_ids,
        traceability_gap_budget_ids: gaps,
    })
}

/// The password component of a PostgreSQL URL, percent-decoded. Used only to provision the role; never logged.
pub(crate) fn url_password(url: &str) -> Option<String> {
    let rest = url.split_once("://")?.1;
    let authority = rest.split(['/', '?']).next()?;
    let userinfo = authority.rsplit_once('@')?.0;
    let raw = userinfo.split_once(':')?.1;
    let b = raw.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            out.push(u8::from_str_radix(raw.get(i + 1..i + 3)?, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Owner-authority provisioning of the API login role (`mcl-seed provision-api-role`). Runs on the owner connection only,
/// refuses anything but the local `civic_lens` demonstration database, and never prints the credential.
///
/// The login role is created without privileges of its own and is granted `mcl_app` with `SET` but without inheritance; the
/// password comes from `APP_DATABASE_URL` and is applied with `format(%L)` from a session setting, so it never appears in
/// SQL text, a migration or a log line.
pub async fn provision_api_role(owner: &PgPool, app_url: &str) -> Result<Redacted, ReadError> {
    let target = redacted(app_url)?;
    if target.user != API_LOGIN_ROLE {
        return Err(ReadError::Config(format!(
            "APP_DATABASE_URL must use the {API_LOGIN_ROLE} role"
        )));
    }
    if !crate::demo::host_is_local(&target.host) {
        return Err(ReadError::Config(
            "APP_DATABASE_URL host is not local".into(),
        ));
    }
    if target.database != crate::demo::DEMO_DATABASE {
        return Err(ReadError::Config(format!(
            "APP_DATABASE_URL must name the {} database",
            crate::demo::DEMO_DATABASE
        )));
    }
    let password = url_password(app_url).unwrap_or_default();
    if password.len() < 16 || password.starts_with("replace-with") {
        return Err(ReadError::Config(
            "the API role password must be a real local secret of at least 16 characters".into(),
        ));
    }

    let mut conn = owner.acquire().await?;
    let guard: (String, i64, bool) = sqlx::query_as(
        "SELECT current_database()::text, (SELECT count(*) FROM synthetic_demo_marker \
         WHERE database_name = current_database()), EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcl_app')",
    )
    .fetch_one(&mut *conn)
    .await?;
    if guard.0 != crate::demo::DEMO_DATABASE || guard.1 != 1 || !guard.2 {
        return Err(ReadError::Config(
            "refusing: not the marked civic_lens demonstration database with the mcl_app role"
                .into(),
        ));
    }
    sqlx::query(
        "DO $$ BEGIN \
           IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcl_api') THEN \
             CREATE ROLE mcl_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT CONNECTION LIMIT 10; \
           END IF; \
         END $$",
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query("GRANT mcl_app TO mcl_api WITH INHERIT FALSE, SET TRUE")
        .execute(&mut *conn)
        .await?;
    sqlx::query("SELECT set_config('mcl.api_secret', $1, false)")
        .bind(&password)
        .execute(&mut *conn)
        .await?;
    sqlx::query(
        "DO $$ BEGIN EXECUTE format('ALTER ROLE mcl_api WITH LOGIN PASSWORD %L', current_setting('mcl.api_secret')); END $$",
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query("SELECT set_config('mcl.api_secret', '', false)")
        .execute(&mut *conn)
        .await?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redaction_keeps_only_non_secret_parts() {
        let r =
            redacted("postgresql://mcl_api:super-secret-value@127.0.0.1:5432/civic_lens").unwrap();
        assert_eq!(
            r,
            Redacted {
                host: "127.0.0.1".into(),
                port: 5432,
                database: "civic_lens".into(),
                user: "mcl_api".into()
            }
        );
        assert!(!format!("{r:?}").contains("super-secret-value"));
    }

    #[test]
    fn row_documents_become_contract_json_with_utc_timestamps_and_untouched_nested_json() {
        assert_eq!(
            camel("synthetic_fresh_repair_estimate_paise"),
            "syntheticFreshRepairEstimatePaise"
        );
        assert_eq!(camel("id"), "id");
        let out = contract_json(json!({
            "updated_at": "2026-11-20T14:00:00+05:30",
            "dlp_starts_on": "2026-04-01",
            "prior_value": { "inner_key": "2026-11-20T14:00:00+05:30" },
            "record_version": 1
        }))
        .unwrap();
        assert_eq!(out["updatedAt"], "2026-11-20T08:30:00Z");
        assert_eq!(out["dlpStartsOn"], "2026-04-01");
        assert_eq!(out["priorValue"]["inner_key"], "2026-11-20T14:00:00+05:30");
        assert!(contract_json(json!(["not an object"])).is_err());
        assert!(contract_json(json!({"updated_at": "yesterday"})).is_err());
    }

    #[test]
    fn password_is_extracted_and_percent_decoded() {
        assert_eq!(
            url_password("postgresql://u:p%40ss-word@127.0.0.1:5432/d?x=1").as_deref(),
            Some("p@ss-word")
        );
        assert_eq!(url_password("postgresql://u@127.0.0.1/d"), None);
    }

    #[test]
    fn identity_must_be_the_app_role_through_the_login_role() {
        let ok = RuntimeIdentity {
            session_user: "mcl_api".into(),
            current_user: "mcl_app".into(),
            superuser: false,
            read_only_session: true,
            database: "civic_lens".into(),
            can_create_in_public: false,
        };
        assert!(ok.is_least_privilege());
        for bad in [
            RuntimeIdentity {
                current_user: "civic".into(),
                ..ok.clone()
            },
            RuntimeIdentity {
                session_user: "civic".into(),
                ..ok.clone()
            },
            RuntimeIdentity {
                superuser: true,
                ..ok.clone()
            },
            RuntimeIdentity {
                read_only_session: false,
                ..ok.clone()
            },
            RuntimeIdentity {
                can_create_in_public: true,
                ..ok.clone()
            },
        ] {
            assert!(!bad.is_least_privilege());
        }
    }
}
