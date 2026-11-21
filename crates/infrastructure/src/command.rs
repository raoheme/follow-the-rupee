//! P5/P6 command path: the bounded write path (P5: `submitIssue`, `checkDuplicates`, `addEvidence`; P6: `resolveJurisdiction`,
//! `linkWork`).
//!
//! Identity. The API's write pool logs in as `mcl_api_write` (LOGIN, NOINHERIT, no privileges of its own) and every
//! connection runs `SET ROLE mcl_command` (NOLOGIN). `mcl_command` owns nothing and holds exactly the grants listed in
//! [`COMMAND_SELECT_TABLES`], [`COMMAND_INSERT_TABLES`] and the column-level UPDATE lists [`JURISDICTION_UPDATE_COLUMNS`] and
//! [`ISSUE_UPDATE_COLUMNS`] (P6): no table-wide UPDATE, no DELETE, TRUNCATE, TRIGGER or REFERENCES anywhere, no UPDATE on
//! `lifecycle_events`, `corrections` or any other table, no CREATE on the schema, no role administration. The read pool (`mcl_api` -> `mcl_app`, read-only) is a separate pool and
//! is never used here. Credentials come from `APP_WRITE_DATABASE_URL` in the ignored `.env.local` and are never printed.
//!
//! Transactions. Every operation runs in one explicit transaction that first re-proves the effective role, serialises on
//! the Idempotency-Key, validates before it writes, and appends its lifecycle event(s) in the same transaction, so a failure
//! of any insert rolls everything back. The lifecycle log stays insert-only and hash-linked through the existing
//! `lifecycle_chain_guard` trigger; this module computes hashes with the SQL function `lifecycle_event_hash`.
//!
//! Idempotency. `idempotency_records` (key, operation, response hash) is the only schema the contract permits, so:
//! * the stored key is the SHA-256 of `operationId|persona|Idempotency-Key` (scoped by operation and simulated persona);
//! * the stored `response_hash` column holds the SHA-256 request fingerprint (`operationId|path id|canonical body`);
//! * created identifiers are derived from the scoped key, so an exact replay re-reads the committed record instead of
//!   writing again, and the same key with a different fingerprint is a conflict.
use crate::read::{by_key, ReadError, Tx};
use mcl_application::commands::{
    AddEvidencePayload, CheckDuplicatesPayload, DuplicateChoice, LinkWorkPayload,
    ResolveJurisdictionPayload, SubmitIssuePayload,
};
use mcl_application::dedup::{self, CandidateFacts, Subject};
use mcl_domain::jurisdiction::{self, Machine};
use mcl_domain::policy::DuplicatePolicy;
use mcl_domain::records::{Evidence, Geometry, Issue, Jurisdiction, JurisdictionStatus};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions};
use sqlx::Row;
use std::str::FromStr;
use std::time::Duration;
use time::OffsetDateTime;

pub const COMMAND_LOGIN_ROLE: &str = "mcl_api_write";
pub const COMMAND_ROLE: &str = "mcl_command";

/// Tables the command role may read: exactly what validation, scoring and the chain guard need.
pub const COMMAND_SELECT_TABLES: &[&str] = &[
    "assets",
    "departments",
    "evidence",
    "idempotency_records",
    "issues",
    "jurisdictions",
    "lifecycle_events",
    "wards",
    "work_orders",
];
/// Tables the command role may insert into (sorted). Nothing may be updated, deleted or truncated.
pub const COMMAND_INSERT_TABLES: &[&str] = &[
    "evidence",
    "idempotency_records",
    "issues",
    "jurisdictions",
    "lifecycle_events",
];

/// P6 column-level UPDATE grants (the only UPDATE this identity holds). `resolveJurisdiction` rewrites exactly these columns of
/// one `jurisdictions` row; `linkWork` rewrites exactly the issue columns below. `id`, `issue_id`, `established_at`,
/// `distance_to_boundary_meters`, `spatial_match_method`, `candidate_ward_id`, `source_conflict_note` and
/// `legal_ownership_asserted` are not updatable, so the inferred spatial facts and the conflict history stay as recorded.
pub const JURISDICTION_UPDATE_COLUMNS: &[&str] = &[
    "confidence_note",
    "confirmation_basis",
    "external_agency_label",
    "record_version",
    "status",
    "updated_at",
];
pub const ISSUE_UPDATE_COLUMNS: &[&str] = &["record_version", "updated_at", "work_order_id"];

/// Every `table.column` this identity may update, sorted (byte order). The identity check compares the live catalogue to it.
pub fn expected_update_columns() -> Vec<String> {
    let mut v: Vec<String> = JURISDICTION_UPDATE_COLUMNS
        .iter()
        .map(|c| format!("jurisdictions.{c}"))
        .chain(ISSUE_UPDATE_COLUMNS.iter().map(|c| format!("issues.{c}")))
        .collect();
    v.sort();
    v
}

const CITIZEN_EVIDENCE_CAVEAT: &str = "Synthetic fixture reference only. The hash covers the reference string, not any image, and does not establish authenticity, location or time.";

#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("unprocessable: {0}")]
    Unprocessable(String),
    #[error("record not found")]
    NotFound,
    /// The simulated persona is not eligible for the committed workflow step (contract 403; never real authorization).
    #[error("forbidden: {0}")]
    Forbidden(String),
    #[error("the command database is unavailable")]
    Unavailable,
    #[error("internal error: {0}")]
    Internal(String),
}

impl From<sqlx::Error> for CommandError {
    fn from(e: sqlx::Error) -> Self {
        if matches!(
            e,
            sqlx::Error::Io(_)
                | sqlx::Error::Tls(_)
                | sqlx::Error::PoolTimedOut
                | sqlx::Error::PoolClosed
                | sqlx::Error::WorkerCrashed
        ) {
            return CommandError::Unavailable;
        }
        if let Some(db) = e.as_database_error() {
            match db.code().as_deref() {
                // unique violation, serialization failure, deadlock: another writer won; the caller may retry.
                Some("23505") | Some("40001") | Some("40P01") => {
                    return CommandError::Conflict(
                        "the request collided with another write; retry with a new Idempotency-Key"
                            .into(),
                    )
                }
                // foreign key / check / data exception: a stored-record rule rejected the values.
                Some("23503") | Some("23514") | Some("22P02") | Some("22023") => {
                    return CommandError::Unprocessable(
                        "a stored-record rule rejected the submitted values".into(),
                    )
                }
                _ => {}
            }
        }
        // Only the error class is kept: SQL text, constraint names and values never leave this function.
        CommandError::Internal("database error".into())
    }
}

impl From<ReadError> for CommandError {
    fn from(e: ReadError) -> Self {
        match e {
            ReadError::Db(d) => d.into(),
            other => CommandError::Internal(match other {
                ReadError::Shape(_) => "stored record failed strict validation".into(),
                _ => "configuration error".into(),
            }),
        }
    }
}

// --------------------------------------------------------------------------------------------------- connection and identity

/// `APP_WRITE_DATABASE_URL` from the environment, else from `.env.local`. Never printed.
pub fn write_database_url() -> Result<String, ReadError> {
    if let Ok(v) = std::env::var("APP_WRITE_DATABASE_URL") {
        if !v.trim().is_empty() {
            return Ok(v);
        }
    }
    let path = crate::demo::workspace_root().join(".env.local");
    let text = std::fs::read_to_string(path).map_err(|_| {
        ReadError::Config("APP_WRITE_DATABASE_URL is not set and .env.local is not readable".into())
    })?;
    for line in text.lines() {
        if let Some(rest) = line.trim().strip_prefix("APP_WRITE_DATABASE_URL=") {
            if !rest.is_empty() {
                return Ok(rest.to_string());
            }
        }
    }
    Err(ReadError::Config(
        "APP_WRITE_DATABASE_URL is absent in the environment and .env.local".into(),
    ))
}

/// The command pool: a small, separate pool whose every connection is `mcl_api_write` after `SET ROLE mcl_command`.
pub fn connect_command(url: &str) -> Result<PgPool, ReadError> {
    let opts = PgConnectOptions::from_str(url)
        .map_err(|_| {
            ReadError::Config("APP_WRITE_DATABASE_URL is not a valid PostgreSQL URL".into())
        })?
        .options([
            ("statement_timeout", "5000"),
            ("idle_in_transaction_session_timeout", "10000"),
        ]);
    Ok(PgPoolOptions::new()
        .max_connections(3)
        .acquire_timeout(Duration::from_secs(3))
        .after_connect(|conn, _| {
            Box::pin(async move {
                sqlx::query("SET ROLE mcl_command").execute(conn).await?;
                Ok(())
            })
        })
        .connect_lazy_with(opts))
}

/// What the live command session actually is. The API refuses to start unless `is_least_privilege()` holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandIdentity {
    pub session_user: String,
    pub current_user: String,
    pub database: String,
    /// Superuser, CREATEROLE, CREATEDB, REPLICATION or BYPASSRLS on the login role or the effective role.
    pub privileged: bool,
    pub can_create_in_public: bool,
    pub owned_public_relations: i64,
    pub insertable_tables: Vec<String>,
    /// Tables on which UPDATE, DELETE, TRUNCATE, TRIGGER or REFERENCES is held.
    pub destructive_tables: Vec<String>,
    /// Every `table.column` on which UPDATE is held (column-level grants), sorted.
    pub updatable_columns: Vec<String>,
    pub login_memberships: Vec<String>,
    pub effective_memberships: Vec<String>,
}

impl CommandIdentity {
    pub fn is_least_privilege(&self) -> bool {
        self.session_user == COMMAND_LOGIN_ROLE
            && self.current_user == COMMAND_ROLE
            && !self.privileged
            && !self.can_create_in_public
            && self.owned_public_relations == 0
            && self.insertable_tables == COMMAND_INSERT_TABLES
            && self.destructive_tables.is_empty()
            && self.updatable_columns == expected_update_columns()
            && self.login_memberships == [COMMAND_ROLE]
            && self.effective_memberships.is_empty()
    }
}

const PRIV: &str =
    "(r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)";

pub async fn command_identity(pool: &PgPool) -> Result<CommandIdentity, ReadError> {
    let sql = format!(
        "SELECT session_user::text AS su, current_user::text AS cu, current_database()::text AS db, \
           EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname IN (session_user, current_user) AND {PRIV}) AS priv, \
           has_schema_privilege(current_user, 'public', 'CREATE') AS can_create, \
           (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = 'public' AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)) AS owned, \
           COALESCE((SELECT array_agg(c.relname::text ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND has_table_privilege(current_user, c.oid, 'INSERT')), '{{}}') AS ins, \
           COALESCE((SELECT array_agg(c.relname::text ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND (has_table_privilege(current_user, c.oid, 'UPDATE') \
               OR has_table_privilege(current_user, c.oid, 'DELETE') OR has_table_privilege(current_user, c.oid, 'TRUNCATE') \
               OR has_table_privilege(current_user, c.oid, 'TRIGGER') OR has_table_privilege(current_user, c.oid, 'REFERENCES'))), '{{}}') AS destr, \
           COALESCE((SELECT array_agg(c.relname::text || '.' || a.attname::text) FROM pg_attribute a \
             JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND a.attnum > 0 AND NOT a.attisdropped \
               AND has_column_privilege(current_user, c.oid, a.attnum, 'UPDATE')), '{{}}') AS upd, \
           COALESCE((SELECT array_agg(r.rolname::text ORDER BY r.rolname) FROM pg_roles r \
             WHERE r.rolname <> session_user AND pg_has_role(session_user, r.oid, 'MEMBER')), '{{}}') AS login_m, \
           COALESCE((SELECT array_agg(r.rolname::text ORDER BY r.rolname) FROM pg_roles r \
             WHERE r.rolname <> current_user AND pg_has_role(current_user, r.oid, 'MEMBER')), '{{}}') AS eff_m"
    );
    let row = sqlx::query(&sql).fetch_one(pool).await?;
    let mut updatable_columns: Vec<String> = row.try_get("upd")?;
    updatable_columns.sort();
    Ok(CommandIdentity {
        session_user: row.try_get("su")?,
        current_user: row.try_get("cu")?,
        database: row.try_get("db")?,
        privileged: row.try_get("priv")?,
        can_create_in_public: row.try_get("can_create")?,
        owned_public_relations: row.try_get("owned")?,
        insertable_tables: row.try_get("ins")?,
        destructive_tables: row.try_get("destr")?,
        updatable_columns,
        login_memberships: row.try_get("login_m")?,
        effective_memberships: row.try_get("eff_m")?,
    })
}

/// Owner-authority, idempotent provisioning of `mcl_command` and `mcl_api_write` (`mcl-seed provision-command-roles`).
/// Runs on the owner connection only, refuses anything but the marked local `civic_lens` database, applies the password
/// from a session setting with `format(%L)` so it never appears in SQL text or output, and grants no ownership, migration
/// or reset authority. No migration is involved: migrations 0001 to 0003 stay untouched.
pub async fn provision_command_roles(
    owner: &PgPool,
    write_url: &str,
) -> Result<crate::read::Redacted, ReadError> {
    let target = crate::read::redacted(write_url)?;
    if target.user != COMMAND_LOGIN_ROLE {
        return Err(ReadError::Config(format!(
            "APP_WRITE_DATABASE_URL must use the {COMMAND_LOGIN_ROLE} role"
        )));
    }
    if !crate::demo::host_is_local(&target.host) {
        return Err(ReadError::Config(
            "APP_WRITE_DATABASE_URL host is not local".into(),
        ));
    }
    if target.database != crate::demo::DEMO_DATABASE {
        return Err(ReadError::Config(format!(
            "APP_WRITE_DATABASE_URL must name the {} database",
            crate::demo::DEMO_DATABASE
        )));
    }
    let password = crate::read::url_password(write_url).unwrap_or_default();
    if password.len() < 16 || password.starts_with("replace-with") {
        return Err(ReadError::Config(
            "the command role password must be a real local secret of at least 16 characters"
                .into(),
        ));
    }

    let mut conn = owner.acquire().await?;
    let guard: (String, i64) = sqlx::query_as(
        "SELECT current_database()::text, (SELECT count(*) FROM synthetic_demo_marker WHERE database_name = current_database())",
    )
    .fetch_one(&mut *conn)
    .await?;
    if guard.0 != crate::demo::DEMO_DATABASE || guard.1 != 1 {
        return Err(ReadError::Config(
            "refusing: not the marked civic_lens demonstration database".into(),
        ));
    }
    sqlx::query(
        "DO $$ BEGIN \
           IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcl_command') THEN \
             CREATE ROLE mcl_command NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT; \
           END IF; \
           IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcl_api_write') THEN \
             CREATE ROLE mcl_api_write LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 6; \
           END IF; \
         END $$",
    )
    .execute(&mut *conn)
    .await?;
    // Restate the grant set from scratch so the result is the same however many times this runs.
    sqlx::query("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM mcl_command")
        .execute(&mut *conn)
        .await?;
    sqlx::query("REVOKE CREATE ON SCHEMA public FROM mcl_command")
        .execute(&mut *conn)
        .await?;
    sqlx::query("GRANT USAGE ON SCHEMA public TO mcl_command")
        .execute(&mut *conn)
        .await?;
    sqlx::query(&format!(
        "GRANT SELECT ON {} TO mcl_command",
        COMMAND_SELECT_TABLES.join(", ")
    ))
    .execute(&mut *conn)
    .await?;
    sqlx::query(&format!(
        "GRANT INSERT ON {} TO mcl_command",
        COMMAND_INSERT_TABLES.join(", ")
    ))
    .execute(&mut *conn)
    .await?;
    // P6: the only UPDATE this identity holds, at column level (see JURISDICTION_UPDATE_COLUMNS / ISSUE_UPDATE_COLUMNS).
    sqlx::query(&format!(
        "GRANT UPDATE ({}) ON jurisdictions TO mcl_command",
        JURISDICTION_UPDATE_COLUMNS.join(", ")
    ))
    .execute(&mut *conn)
    .await?;
    sqlx::query(&format!(
        "GRANT UPDATE ({}) ON issues TO mcl_command",
        ISSUE_UPDATE_COLUMNS.join(", ")
    ))
    .execute(&mut *conn)
    .await?;
    // The login role may become mcl_command (SET) but inherits nothing, and holds no other membership.
    sqlx::query(
        "DO $$ DECLARE r record; BEGIN \
           FOR r IN SELECT roleid::regrole::text AS role FROM pg_auth_members \
                    WHERE member = 'mcl_api_write'::regrole AND roleid <> 'mcl_command'::regrole LOOP \
             EXECUTE format('REVOKE %s FROM mcl_api_write', r.role); \
           END LOOP; \
         END $$",
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query("GRANT mcl_command TO mcl_api_write WITH INHERIT FALSE, SET TRUE")
        .execute(&mut *conn)
        .await?;
    sqlx::query("SELECT set_config('mcl.write_secret', $1, false)")
        .bind(&password)
        .execute(&mut *conn)
        .await?;
    sqlx::query(
        "DO $$ BEGIN EXECUTE format('ALTER ROLE mcl_api_write WITH LOGIN PASSWORD %L', current_setting('mcl.write_secret')); END $$",
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query("SELECT set_config('mcl.write_secret', '', false)")
        .execute(&mut *conn)
        .await?;
    Ok(target)
}

// ------------------------------------------------------------------------------------------------- shared transaction pieces

/// The simulated persona's wire value (`X-Demo-Persona`). It is a presentation lens, never authentication; it only selects
/// which committed workflow rule applies and which `actorRole` the lifecycle event carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Persona {
    Public,
    Citizen,
    Authority,
    Moderator,
    IndependentReviewer,
    DemoAdmin,
}

impl Persona {
    pub fn parse(s: &str) -> Option<Persona> {
        Some(match s {
            "public" => Persona::Public,
            "citizen" => Persona::Citizen,
            "authority" => Persona::Authority,
            "moderator" => Persona::Moderator,
            "independent_reviewer" => Persona::IndependentReviewer,
            "demo_admin" => Persona::DemoAdmin,
            _ => return None,
        })
    }
    pub fn wire(self) -> &'static str {
        match self {
            Persona::Public => "public",
            Persona::Citizen => "citizen",
            Persona::Authority => "authority",
            Persona::Moderator => "moderator",
            Persona::IndependentReviewer => "independent_reviewer",
            Persona::DemoAdmin => "demo_admin",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Operation {
    SubmitIssue,
    CheckDuplicates,
    AddEvidence,
    ResolveJurisdiction,
    LinkWork,
}

impl Operation {
    pub fn id(self) -> &'static str {
        match self {
            Operation::SubmitIssue => "submitIssue",
            Operation::CheckDuplicates => "checkDuplicates",
            Operation::AddEvidence => "addEvidence",
            Operation::ResolveJurisdiction => "resolveJurisdiction",
            Operation::LinkWork => "linkWork",
        }
    }
}

/// Simulated workflow eligibility from the committed ISSUE machine (DRAFT_LOCAL -> SUBMITTED_UNVERIFIED allows citizen and
/// authority). Evidence creation is limited here to a citizen adding a citizen fixture reference; authority and independent
/// evidence belong to the later completion and verification phases.
fn eligible(op: Operation, persona: Persona) -> Result<(), CommandError> {
    // P6: the committed JURISDICTION machine allows only the `authority` role, and the contract declares 403 for any other
    // recognised persona. Work linkage is an authority operation too (it is in the `/v1/authority/` family).
    if matches!(op, Operation::ResolveJurisdiction | Operation::LinkWork) {
        return if persona == Persona::Authority {
            Ok(())
        } else {
            Err(CommandError::Forbidden(
                "the selected demonstration persona is not eligible for this authority step (a simulated workflow rule, not authentication)".into(),
            ))
        };
    }
    let ok = match op {
        Operation::SubmitIssue | Operation::CheckDuplicates => {
            matches!(persona, Persona::Citizen | Persona::Authority)
        }
        Operation::AddEvidence => persona == Persona::Citizen,
        Operation::ResolveJurisdiction | Operation::LinkWork => false,
    };
    if ok {
        Ok(())
    } else {
        Err(CommandError::Unprocessable(
            "the selected demonstration persona is not eligible for this operation (a simulated workflow rule, not authentication)".into(),
        ))
    }
}

pub fn sha256_hex(input: &str) -> String {
    let d = Sha256::digest(input.as_bytes());
    crate::demo::to_hex(&d)
}

/// One request's idempotency identity.
#[derive(Debug, Clone)]
pub struct Scope {
    pub operation: Operation,
    pub persona: Persona,
    pub idempotency_key: String,
}

impl Scope {
    /// Stored key: scoped by operation and simulated persona, hashed so the stored value is bounded.
    pub fn key_hash(&self) -> String {
        sha256_hex(&format!(
            "{}|{}|{}",
            self.operation.id(),
            self.persona.wire(),
            self.idempotency_key
        ))
    }
    /// 8 upper-case hex characters used to derive identifiers created by this request.
    pub fn suffix(&self) -> String {
        self.key_hash()[..8].to_uppercase()
    }
    pub fn fingerprint(&self, path_id: &str, canonical_body: &str) -> String {
        sha256_hex(&format!(
            "{}|{}|{}",
            self.operation.id(),
            path_id,
            canonical_body
        ))
    }
}

pub fn derived_issue_id(suffix: &str) -> String {
    format!("SYN-DEMO-KND-R{suffix}")
}
pub fn derived_evidence_id(suffix: &str) -> String {
    format!("SYN-DEMO-EVD-R{suffix}")
}
fn derived_jurisdiction_id(suffix: &str) -> String {
    format!("SYN-DEMO-JUR-R{suffix}")
}

/// Whole-second UTC instant: the chain hash is defined over second precision, so stored and rendered times agree.
fn whole_second(t: OffsetDateTime) -> OffsetDateTime {
    t.to_offset(time::UtcOffset::UTC)
        .replace_nanosecond(0)
        .unwrap_or(t)
}

async fn begin(pool: &PgPool) -> Result<Tx<'_>, CommandError> {
    let mut tx = pool.begin().await?;
    let (cu, ro): (String, bool) = sqlx::query_as(
        "SELECT current_user::text, current_setting('transaction_read_only') = 'on'",
    )
    .fetch_one(&mut *tx)
    .await?;
    if cu != COMMAND_ROLE || ro {
        return Err(CommandError::Internal(
            "the command session is not mcl_command".into(),
        ));
    }
    Ok(tx)
}

enum Seen {
    Fresh,
    Replay,
}

/// Serialise on the scoped key, then classify the request: first time, exact replay, or key reuse with another body.
async fn claim(tx: &mut Tx<'_>, scope: &Scope, fingerprint: &str) -> Result<Seen, CommandError> {
    let key = scope.key_hash();
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(&key)
        .execute(&mut **tx)
        .await?;
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT operation_id, response_hash FROM idempotency_records WHERE idempotency_key = $1",
    )
    .bind(&key)
    .fetch_optional(&mut **tx)
    .await?;
    match row {
        None => Ok(Seen::Fresh),
        Some((op, fp)) if op == scope.operation.id() && fp == fingerprint => Ok(Seen::Replay),
        Some(_) => Err(CommandError::Conflict(
            "the Idempotency-Key was already used for a different request".into(),
        )),
    }
}

async fn record_key(tx: &mut Tx<'_>, scope: &Scope, fingerprint: &str) -> Result<(), CommandError> {
    sqlx::query("INSERT INTO idempotency_records (idempotency_key, operation_id, response_hash) VALUES ($1, $2, $3)")
        .bind(scope.key_hash())
        .bind(scope.operation.id())
        .bind(fingerprint)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// Append one hash-linked event to `entity`'s chain. Serialised per entity; the database trigger re-verifies the link.
async fn append_event(
    tx: &mut Tx<'_>,
    entity: &str,
    event_type: &str,
    actor: &str,
    summary: &str,
    at: OffsetDateTime,
) -> Result<(), CommandError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("chain:{entity}"))
        .execute(&mut **tx)
        .await?;
    let last: Option<(i32, String)> = sqlx::query_as(
        "SELECT sequence, payload_hash FROM lifecycle_events WHERE entity_id = $1 ORDER BY sequence DESC LIMIT 1",
    )
    .bind(entity)
    .fetch_optional(&mut **tx)
    .await?;
    let (seq, previous) = match last {
        Some((s, h)) => (s + 1, Some(h)),
        None => (1, None),
    };
    let event_id = format!(
        "SYN-DEMO-EVT-{}-{:03}",
        entity.strip_prefix("SYN-DEMO-").unwrap_or(entity),
        seq
    );
    sqlx::query(
        "INSERT INTO lifecycle_events (id, record_nature, source_tier, record_version, updated_at, entity_id, sequence, \
            event_type, actor_role, occurred_at, summary, previous_hash, payload_hash) \
         VALUES ($1, 'SYNTHETIC_DEMONSTRATION', 'SYNTHETIC_DEMO', 1, $2::timestamptz, $3::text, $4::int4, $5::text, $6::text, \
            $2::timestamptz, $7::text, $8::text, \
            lifecycle_event_hash($3::text, $4::int4, $5::text, $2::timestamptz, $6::text, $7::text, $8::text))",
    )
    .bind(event_id)
    .bind(at)
    .bind(entity)
    .bind(seq)
    .bind(event_type)
    .bind(actor)
    .bind(summary)
    .bind(previous)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn geojson(g: &Geometry) -> Result<String, CommandError> {
    serde_json::to_string(g)
        .map_err(|_| CommandError::Internal("geometry could not be serialised".into()))
}

/// The geometry must be valid under PostGIS and inside the Greater Mumbai envelope the schema enforces.
async fn check_geometry_in_db(tx: &mut Tx<'_>, gj: &str) -> Result<(), CommandError> {
    let (valid, inside): (bool, bool) = sqlx::query_as(
        "SELECT ST_IsValid(g), ST_Within(g, ST_MakeEnvelope(72.77, 18.89, 72.99, 19.275, 4326)) \
         FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1::text), 4326) AS g) s",
    )
    .bind(gj)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| match CommandError::from(e) {
        CommandError::Internal(_) => {
            CommandError::Unprocessable("geometry is not a readable GeoJSON shape".into())
        }
        other => other,
    })?;
    if !valid || !inside {
        return Err(CommandError::Unprocessable(
            "geometry must be a valid shape inside Greater Mumbai".into(),
        ));
    }
    Ok(())
}

// ------------------------------------------------------------------------------------------------------------- submitIssue

pub struct SubmitRequest {
    pub scope: Scope,
    pub record_version: u32,
    pub payload: SubmitIssuePayload,
    pub canonical_body: String,
    pub now: OffsetDateTime,
}

struct AssetFacts {
    street: String,
    landmark: String,
    department: String,
}

struct Posts {
    responsible: String,
    escalation: String,
}

/// The discipline named in a post title, for example "Roads" in "Executive Engineer (Roads)".
fn discipline(title: &str) -> Option<&str> {
    let s = title.find('(')? + 1;
    let e = title[s..].find(')')? + s;
    Some(&title[s..e])
}

fn pick_posts(central: &[String], ward_office: &[String]) -> Option<Posts> {
    let escalation = central
        .first()
        .cloned()
        .or_else(|| ward_office.first().cloned())?;
    let wanted = central.first().and_then(|t| discipline(t));
    let responsible = ward_office
        .iter()
        .find(|t| wanted.is_some() && discipline(t) == wanted)
        .or_else(|| ward_office.first())
        .cloned()
        .unwrap_or_else(|| escalation.clone());
    Some(Posts {
        responsible,
        escalation,
    })
}

/// `submitIssue`: validate, derive ward/department/posts from the committed synthetic records, insert the issue, its
/// provisional jurisdiction and the lifecycle events, and record the idempotency key, all in one transaction.
pub async fn submit_issue(pool: &PgPool, req: SubmitRequest) -> Result<Issue, CommandError> {
    eligible(Operation::SubmitIssue, req.scope.persona)?;
    let at = whole_second(req.now);
    let fp = req.scope.fingerprint("-", &req.canonical_body);
    let id = derived_issue_id(&req.scope.suffix());
    let mut tx = begin(pool).await?;
    if let Seen::Replay = claim(&mut tx, &req.scope, &fp).await? {
        let issue = by_key::<Issue>(&mut tx, "issues", Some("geometry"), "id", &id)
            .await?
            .ok_or_else(|| CommandError::Internal("replayed record is missing".into()))?;
        tx.commit().await?;
        return Ok(issue);
    }
    if req.record_version != 1 {
        return Err(CommandError::Conflict(
            "recordVersion must be 1 for a new report".into(),
        ));
    }
    let p = &req.payload;
    let gj = geojson(&p.geometry)?;
    check_geometry_in_db(&mut tx, &gj).await?;

    let asset: Option<AssetFacts> = match &p.asset_id {
        None => None,
        Some(a) => {
            let row = sqlx::query(
                "SELECT street_name, nearby_landmark, responsible_department_id::text AS dept FROM assets WHERE id = $1",
            )
            .bind(a.as_str())
            .fetch_optional(&mut *tx)
            .await?;
            Some(match row {
                None => {
                    return Err(CommandError::Unprocessable(
                        "assetId does not name a known synthetic asset".into(),
                    ))
                }
                Some(r) => AssetFacts {
                    street: r.try_get("street_name")?,
                    landmark: r.try_get("nearby_landmark")?,
                    department: r.try_get("dept")?,
                },
            })
        }
    };

    // Provisional spatial inference only: containment in a synthetic illustrative box, never legal jurisdiction.
    let ward: Option<(String, String, f64)> = sqlx::query_as(
        "SELECT w.id::text, w.display_name, \
                round(ST_Distance(ST_Boundary(w.boundary)::geography, s.g::geography)::numeric, 1)::float8 \
         FROM wards w, (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1::text), 4326) AS g) s \
         WHERE ST_Covers(w.boundary, s.g) ORDER BY w.id LIMIT 1",
    )
    .bind(&gj)
    .fetch_optional(&mut *tx)
    .await?;

    let ward_office: Option<(String, Vec<String>)> = match &ward {
        None => None,
        Some((wid, _, _)) => {
            sqlx::query_as(
                "SELECT id::text, post_titles FROM departments WHERE kind = 'WARD_OFFICE' AND ward_id = $1 ORDER BY id LIMIT 1",
            )
            .bind(wid)
            .fetch_optional(&mut *tx)
            .await?
        }
    };
    let department = match (&asset, &ward_office) {
        (Some(a), _) => a.department.clone(),
        (None, Some((d, _))) => d.clone(),
        (None, None) => {
            return Err(CommandError::Unprocessable(
                "the location is outside the synthetic demonstration wards; choose a location inside one or name a known asset".into(),
            ))
        }
    };
    let central_posts: Vec<String> =
        sqlx::query_scalar("SELECT post_titles FROM departments WHERE id = $1")
            .bind(&department)
            .fetch_optional(&mut *tx)
            .await?
            .unwrap_or_default();
    let office_posts = ward_office
        .as_ref()
        .map(|(_, p)| p.clone())
        .unwrap_or_default();
    let posts = pick_posts(&central_posts, &office_posts).ok_or_else(|| {
        CommandError::Internal("the responsible department has no post titles".into())
    })?;

    let street = asset
        .as_ref()
        .map(|a| a.street.clone())
        .unwrap_or_else(|| "Street not named (location chosen on the map)".into());
    let landmark = p
        .nearby_landmark
        .clone()
        .or_else(|| asset.as_ref().map(|a| a.landmark.clone()))
        .unwrap_or_else(|| "Landmark not provided (synthetic report)".into());
    let explanation = "Submitted and unverified. The responsible post shown is provisional until an authority triages the report; a duplicate check may follow.";

    sqlx::query(
        "INSERT INTO issues (id, record_nature, source_tier, record_version, updated_at, title, public_description, category, \
            status, public_status_explanation, reported_at, street_name, nearby_landmark, geometry, asset_id, work_order_id, \
            ward_candidate_id, responsible_department_id, responsible_post_title, escalation_post_title, parent_recurrence_id, journeys) \
         VALUES ($1, 'SYNTHETIC_DEMONSTRATION', 'SYNTHETIC_DEMO', 1, $2, $3, $4, $5, 'SUBMITTED_UNVERIFIED', $6, $2, $7, $8, \
            ST_SetSRID(ST_GeomFromGeoJSON($9::text), 4326), $10, NULL, $11, $12, $13, $14, NULL, ARRAY['J2'])",
    )
    .bind(&id)
    .bind(at)
    .bind(&p.title)
    .bind(&p.public_description)
    .bind(serde_json::to_value(p.category).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default())
    .bind(explanation)
    .bind(&street)
    .bind(&landmark)
    .bind(&gj)
    .bind(p.asset_id.as_ref().map(|a| a.as_str().to_string()))
    .bind(ward.as_ref().map(|w| w.0.clone()))
    .bind(&department)
    .bind(&posts.responsible)
    .bind(&posts.escalation)
    .execute(&mut *tx)
    .await?;

    let (jstatus, method, dist, ward_id, note) = match &ward {
        Some((wid, _, d)) => (
            "SPATIALLY_INFERRED_PROVISIONAL",
            "ST_COVERS",
            Some(*d),
            Some(wid.clone()),
            "Spatial matching is provisional evidence of proximity, not legal ownership.",
        ),
        None => (
            "UNKNOWN",
            "NONE",
            None,
            None,
            "No synthetic ward covers this location, so jurisdiction is unknown; this is not a legal determination.",
        ),
    };
    sqlx::query(
        "INSERT INTO jurisdictions (id, record_nature, source_tier, record_version, updated_at, issue_id, status, \
            spatial_match_method, distance_to_boundary_meters, candidate_ward_id, external_agency_label, confirmation_basis, \
            source_conflict_note, legal_ownership_asserted, confidence_note, established_at) \
         VALUES ($1, 'SYNTHETIC_DEMONSTRATION', 'SYNTHETIC_DEMO', 1, $2, $3, $4, $5, $6::float8::numeric, $7, NULL, NULL, NULL, false, $8, $2)",
    )
    .bind(derived_jurisdiction_id(&req.scope.suffix()))
    .bind(at)
    .bind(&id)
    .bind(jstatus)
    .bind(method)
    .bind(dist)
    .bind(ward_id)
    .bind(note)
    .execute(&mut *tx)
    .await?;

    let actor = req.scope.persona.wire();
    append_event(
        &mut tx,
        &id,
        "ISSUE_SUBMITTED_UNVERIFIED",
        actor,
        "Synthetic report submitted and unverified; it has not been triaged or accepted by any authority.",
        at,
    )
    .await?;
    let (etype, esummary) = match &ward {
        Some((_, name, _)) => (
            "JURISDICTION_SPATIALLY_INFERRED_PROVISIONAL",
            format!("Spatial inference suggests the {name}; provisional, not legal ownership."),
        ),
        None => (
            "JURISDICTION_UNKNOWN",
            "No synthetic ward covers the location; jurisdiction is unknown.".to_string(),
        ),
    };
    append_event(&mut tx, &id, etype, "system", &esummary, at).await?;
    record_key(&mut tx, &req.scope, &fp).await?;

    let issue = by_key::<Issue>(&mut tx, "issues", Some("geometry"), "id", &id)
        .await?
        .ok_or_else(|| CommandError::Internal("created record is missing".into()))?;
    tx.commit().await?;
    Ok(issue)
}

// -------------------------------------------------------------------------------------------------------- checkDuplicates

pub struct CheckRequest {
    pub scope: Scope,
    pub issue_id: String,
    pub record_version: u32,
    pub payload: CheckDuplicatesPayload,
    pub canonical_body: String,
    pub now: OffsetDateTime,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateCandidatesView {
    pub policy_label: String,
    pub choices: Vec<String>,
    pub silent_rejection: bool,
    pub candidates: Vec<dedup::Candidate>,
}

/// Upper bound on spatial candidates fetched from PostGIS (ordered by distance, then id) before deterministic ranking.
pub const CANDIDATE_FETCH_LIMIT: i64 = 50;

/// The spatial candidate query. Candidates are earlier reports (strictly before the subject by `(reportedAt, id)`) that lie
/// within the category's committed radius (PostGIS geography metres) or share the subject's asset. The subject itself is never
/// a candidate. Nothing is loaded into memory beyond the bounded result.
pub async fn candidate_facts(
    tx: &mut Tx<'_>,
    geometry_geojson: &str,
    subject_id: &str,
    subject_reported_at: OffsetDateTime,
    radius_meters: Option<f64>,
    subject_asset: Option<&str>,
) -> Result<Vec<CandidateFacts>, CommandError> {
    let rows = sqlx::query(
        "SELECT i.id::text AS id, i.category::text AS category, i.status::text AS status, i.asset_id::text AS asset_id, \
                ST_Distance(i.geometry::geography, s.g::geography)::float8 AS distance_m, \
                (abs(extract(epoch FROM (i.reported_at - s.reported)) / 3600.0))::float8 AS hours_apart, \
                (i.title || ' ' || i.public_description) AS text \
         FROM issues i, \
              (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1::text), 4326) AS g, $3::timestamptz AS reported) s \
         WHERE i.id::text <> $2 \
           AND (i.reported_at, i.id::text) < (s.reported, $2) \
           AND (($4::float8 IS NOT NULL AND ST_DWithin(i.geometry::geography, s.g::geography, $4::float8)) \
                OR ($5::text IS NOT NULL AND i.asset_id::text = $5)) \
         ORDER BY ST_Distance(i.geometry::geography, s.g::geography), i.id \
         LIMIT $6",
    )
    .bind(geometry_geojson)
    .bind(subject_id)
    .bind(subject_reported_at)
    .bind(radius_meters)
    .bind(subject_asset)
    .bind(CANDIDATE_FETCH_LIMIT)
    .fetch_all(&mut **tx)
    .await?;
    rows.iter()
        .map(|r| {
            Ok(CandidateFacts {
                id: r.try_get("id")?,
                category: r.try_get("category")?,
                status: r.try_get("status")?,
                asset_id: r.try_get("asset_id")?,
                distance_meters: r.try_get("distance_m")?,
                hours_apart: r.try_get("hours_apart")?,
                text: r.try_get("text")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map_err(Into::into)
}

/// `checkDuplicates`: score earlier reports with the committed policy and append one `DUPLICATE_CHECK_EVALUATED` event to the
/// subject's chain. An exact replay recomputes the same result (it depends only on stored earlier records) and writes nothing.
pub async fn check_duplicates(
    pool: &PgPool,
    policy: &DuplicatePolicy,
    req: CheckRequest,
) -> Result<DuplicateCandidatesView, CommandError> {
    eligible(Operation::CheckDuplicates, req.scope.persona)?;
    let at = whole_second(req.now);
    let fp = req.scope.fingerprint(&req.issue_id, &req.canonical_body);
    let mut tx = begin(pool).await?;
    let seen = claim(&mut tx, &req.scope, &fp).await?;

    let subject: Option<(i32, Option<String>, OffsetDateTime)> = sqlx::query_as(
        "SELECT record_version, asset_id::text, reported_at FROM issues WHERE id = $1",
    )
    .bind(&req.issue_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((version, asset, reported_at)) = subject else {
        return Err(CommandError::NotFound);
    };
    if matches!(seen, Seen::Fresh) && i64::from(version) != i64::from(req.record_version) {
        return Err(CommandError::Conflict(
            "recordVersion is stale: the issue has a different current version".into(),
        ));
    }

    let category = serde_json::to_value(req.payload.category)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default();
    let gj = geojson(&req.payload.geometry)?;
    check_geometry_in_db(&mut tx, &gj).await?;
    let radius = policy.radius_meters(&category);
    let facts = candidate_facts(
        &mut tx,
        &gj,
        &req.issue_id,
        reported_at,
        radius,
        asset.as_deref(),
    )
    .await?;

    let subject = Subject {
        category,
        asset_id: asset,
        keywords: dedup::keyword_tokens(
            req.payload.description_keywords.iter().map(String::as_str),
        ),
    };
    let candidates = dedup::rank(
        facts
            .iter()
            .filter_map(|f| dedup::score_candidate(policy, &subject, f))
            .collect(),
    );

    if matches!(seen, Seen::Fresh) {
        let summary = format!(
            "Deterministic duplicate check ({}) evaluated {} earlier report(s); no report was merged or rejected.",
            policy.label,
            candidates.len()
        );
        append_event(
            &mut tx,
            &req.issue_id,
            "DUPLICATE_CHECK_EVALUATED",
            req.scope.persona.wire(),
            &summary,
            at,
        )
        .await?;
        record_key(&mut tx, &req.scope, &fp).await?;
    }
    tx.commit().await?;
    Ok(DuplicateCandidatesView {
        policy_label: policy.label.clone(),
        choices: policy.choices.clone(),
        silent_rejection: false,
        candidates,
    })
}

// ------------------------------------------------------------------------------------------------------------- addEvidence

pub struct EvidenceRequest {
    pub scope: Scope,
    pub issue_id: String,
    pub record_version: u32,
    pub payload: AddEvidencePayload,
    pub captured_at: OffsetDateTime,
    pub canonical_body: String,
    pub now: OffsetDateTime,
}

fn wire<T: Serialize>(v: &T) -> String {
    serde_json::to_value(v)
        .ok()
        .and_then(|x| x.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// `addEvidence`: attach one synthetic fixture-reference record (metadata only) to the issue in the path, record the citizen's
/// duplicate decision as a lifecycle event on that issue, and remember the key, all in one transaction. The sha256 must be the
/// hash of the reference string itself (`hashBasis = FIXTURE_REFERENCE_STRING`); it says nothing about any image.
pub async fn add_evidence(pool: &PgPool, req: EvidenceRequest) -> Result<Evidence, CommandError> {
    eligible(Operation::AddEvidence, req.scope.persona)?;
    let p = &req.payload;
    let source = wire(&p.source_type);
    let stage = wire(&p.stage);
    if source != "CITIZEN_FIXTURE" || stage == "CLAIMED_AFTER" {
        return Err(CommandError::Unprocessable(
            "this phase accepts citizen fixture evidence at stage BEFORE or DISPUTED_OR_RECURRING only".into(),
        ));
    }
    if sha256_hex(&p.media_ref) != p.sha256 {
        return Err(CommandError::Unprocessable(
            "sha256 must be the SHA-256 of the mediaRef string (hashBasis FIXTURE_REFERENCE_STRING)".into(),
        ));
    }
    let at = whole_second(req.now);
    let fp = req.scope.fingerprint(&req.issue_id, &req.canonical_body);
    let id = derived_evidence_id(&req.scope.suffix());
    let mut tx = begin(pool).await?;
    let seen = claim(&mut tx, &req.scope, &fp).await?;
    let version: Option<i32> =
        sqlx::query_scalar("SELECT record_version FROM issues WHERE id = $1")
            .bind(&req.issue_id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some(version) = version else {
        return Err(CommandError::NotFound);
    };
    if let Seen::Replay = seen {
        let ev = by_key::<Evidence>(&mut tx, "evidence", None, "id", &id)
            .await?
            .ok_or_else(|| CommandError::Internal("replayed record is missing".into()))?;
        tx.commit().await?;
        return Ok(ev);
    }
    if i64::from(version) != i64::from(req.record_version) {
        return Err(CommandError::Conflict(
            "recordVersion is stale: the issue has a different current version".into(),
        ));
    }
    let taken: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM evidence WHERE media_ref = $1)")
            .bind(&p.media_ref)
            .fetch_one(&mut *tx)
            .await?;
    if taken {
        return Err(CommandError::Conflict(
            "that mediaRef is already registered".into(),
        ));
    }

    sqlx::query(
        "INSERT INTO evidence (id, record_nature, source_tier, record_version, updated_at, issue_id, stage, caption, confidence, \
            source_type, captured_at, location_confidence, distance_to_asset_meters, media_status, media_ref, sha256, hash_basis, \
            verification_state, processing_state, caveat) \
         VALUES ($1, 'SYNTHETIC_DEMONSTRATION', 'SYNTHETIC_DEMO', 1, $2, $3, $4, $5, 'CITIZEN_SUBMITTED', 'CITIZEN_FIXTURE', $6, \
            'LOCATION_UNVERIFIED', NULL, 'SYNTHETIC_FIXTURE_REFERENCE_ONLY', $7, $8, 'FIXTURE_REFERENCE_STRING', 'NOT_VERIFIED', \
            'UPLOADED_QUARANTINE', $9)",
    )
    .bind(&id)
    .bind(at)
    .bind(&req.issue_id)
    .bind(&stage)
    .bind(&p.caption)
    .bind(req.captured_at)
    .bind(&p.media_ref)
    .bind(&p.sha256)
    .bind(CITIZEN_EVIDENCE_CAVEAT)
    .execute(&mut *tx)
    .await?;

    let (etype, summary) = match p.duplicate_choice {
        None => (
            "EVIDENCE_SUBMITTED_UNVERIFIED",
            format!("Synthetic evidence {id} submitted as a fixture reference; it is not verified."),
        ),
        Some(c) => (
            match c {
                DuplicateChoice::EndorseExisting => "DUPLICATE_ENDORSED_EXISTING",
                DuplicateChoice::AddEvidenceToExisting => "DUPLICATE_EVIDENCE_ADDED_TO_EXISTING",
                DuplicateChoice::CreateSeparateIssue => "DUPLICATE_DECISION_CREATE_SEPARATE",
            },
            format!(
                "Citizen choice {}: synthetic evidence {id} recorded as a fixture reference, not verified. No reports were merged.",
                c.wire()
            ),
        ),
    };
    append_event(
        &mut tx,
        &req.issue_id,
        etype,
        req.scope.persona.wire(),
        &summary,
        at,
    )
    .await?;
    record_key(&mut tx, &req.scope, &fp).await?;
    let ev = by_key::<Evidence>(&mut tx, "evidence", None, "id", &id)
        .await?
        .ok_or_else(|| CommandError::Internal("created record is missing".into()))?;
    tx.commit().await?;
    Ok(ev)
}

// ------------------------------------------------------------------------------------------------------ P6 authority commands
//
// Both commands are state changes on an existing record, so they differ from the P5 inserts in three ways: the target record is
// locked for the transaction (an advisory lock keyed on the record, taken after the idempotency-key lock and before the audit
// chain lock, always in that order), `recordVersion` is compared before the write and enforced again in the UPDATE's WHERE
// clause (zero rows updated is a conflict), and the version is incremented by the UPDATE itself. No identifier is derived from
// the Idempotency-Key: nothing new is created except the lifecycle event, whose id comes from the entity's chain sequence.

/// Serialise writers of one record for the rest of the transaction.
async fn lock_record(tx: &mut Tx<'_>, entity: &str) -> Result<(), CommandError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("record:{entity}"))
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// The audit-event text limit (`lifecycle_events.summary`, 400 characters). Longer text is refused, never truncated.
const EVENT_SUMMARY_MAX: usize = 400;
/// `jurisdictions.confirmation_basis` limit (300 characters).
const CONFIRMATION_BASIS_MAX: usize = 300;

fn fits_summary(text: String) -> Result<String, CommandError> {
    let n = text.chars().count();
    if n > EVENT_SUMMARY_MAX {
        let over = n - EVENT_SUMMARY_MAX;
        return Err(CommandError::Unprocessable(format!(
            "rationale is {over} character(s) too long to be stored in the audit event for this step; shorten it"
        )));
    }
    Ok(text)
}

/// Fixed, non-accusatory confidence wording stored with each resolved state. None of it claims legal ownership.
fn confidence_note_for(target: JurisdictionStatus) -> &'static str {
    match target {
        JurisdictionStatus::ConfirmedBmcWard => "Confirmed in demonstration data by a simulated authority command. Not a legal determination of ownership.",
        JurisdictionStatus::ExternalAgencyAssigned => "Assigned to an external agency by a simulated authority command; the handoff is not yet recorded. Not a legal determination.",
        JurisdictionStatus::HandoffLogged => "External-agency handoff recorded by a simulated authority command. Not a legal determination.",
        _ => "Not a legal determination of ownership.",
    }
}

/// The audit-event text for one jurisdiction step. It names the previous and the new state, the workflow post role, and the
/// bounded rationale; it never asserts legal ownership or fault.
pub fn jurisdiction_summary(
    previous: JurisdictionStatus,
    target: JurisdictionStatus,
    agency_label: Option<&str>,
    withdrawn_label: Option<&str>,
    rationale: &str,
) -> String {
    let prev = jurisdiction::wire(previous);
    let new = jurisdiction::wire(target);
    match target {
        JurisdictionStatus::ConfirmedBmcWard => {
            let withdrawn = withdrawn_label
                .map(|l| format!(" Candidate agency label withdrawn: {l}."))
                .unwrap_or_default();
            format!(
                "Jurisdiction {prev} to {new} in demonstration data; not a legal determination.{withdrawn} Rationale: {rationale}"
            )
        }
        JurisdictionStatus::ExternalAgencyAssigned => format!(
            "Jurisdiction {prev} to {new} ({}); handoff not yet recorded; not a legal determination. Rationale: {rationale}",
            agency_label.unwrap_or("agency label not given")
        ),
        _ => format!(
            "External-agency handoff recorded to {} (jurisdiction {prev} to {new}); not a legal determination. Rationale: {rationale}",
            agency_label.unwrap_or("the assigned agency")
        ),
    }
}

pub fn link_summary(work_order_id: &str, rationale: &str) -> String {
    format!(
        "Work order {work_order_id} linked to this issue by an authority command (same asset). The link records a relationship only: not a finding of liability, contractual applicability or any cost outcome. Rationale: {rationale}"
    )
}

pub struct ResolveRequest {
    pub scope: Scope,
    pub issue_id: String,
    pub record_version: u32,
    pub payload: ResolveJurisdictionPayload,
    pub canonical_body: String,
    pub now: OffsetDateTime,
}

/// `resolveJurisdiction`: move the issue's jurisdiction record along a transition of the committed JURISDICTION machine,
/// record the previous and new state in one lifecycle event, and remember the key, all in one transaction. `recordVersion` is
/// the jurisdiction record's version. Spatial facts (`spatialMatchMethod`, distance, candidate ward) and the source-conflict
/// note are not rewritable by this identity, so the provisional inference and the dispute remain visible in the record.
pub async fn resolve_jurisdiction(
    pool: &PgPool,
    machine: &Machine,
    req: ResolveRequest,
) -> Result<Jurisdiction, CommandError> {
    eligible(Operation::ResolveJurisdiction, req.scope.persona)?;
    let at = whole_second(req.now);
    let fp = req.scope.fingerprint(&req.issue_id, &req.canonical_body);
    let mut tx = begin(pool).await?;
    let seen = claim(&mut tx, &req.scope, &fp).await?;
    lock_record(&mut tx, &req.issue_id).await?;
    let current = by_key::<Jurisdiction>(&mut tx, "jurisdictions", None, "issue_id", &req.issue_id)
        .await?
        .ok_or(CommandError::NotFound)?;
    if let Seen::Replay = seen {
        tx.commit().await?;
        return Ok(current);
    }
    if i64::from(current.record_version) != i64::from(req.record_version) {
        return Err(CommandError::Conflict(
            "recordVersion is stale: the jurisdiction record has a different current version"
                .into(),
        ));
    }
    let target = req.payload.target_status.status();
    let Some(transition) = machine.find(current.status, target) else {
        return Err(CommandError::Conflict(format!(
            "the committed jurisdiction state machine does not allow {} to {}",
            jurisdiction::wire(current.status),
            jurisdiction::wire(target)
        )));
    };
    if !transition
        .allowed_roles
        .iter()
        .any(|r| r == req.scope.persona.wire())
    {
        return Err(CommandError::Forbidden(
            "the selected demonstration persona is not eligible for this transition (a simulated workflow rule, not authentication)".into(),
        ));
    }

    let rationale = req.payload.rationale.as_str();
    let (new_label, basis, withdrawn): (Option<String>, Option<String>, Option<String>) =
        match target {
            JurisdictionStatus::ConfirmedBmcWard => {
                if rationale.chars().count() > CONFIRMATION_BASIS_MAX {
                    return Err(CommandError::Unprocessable(format!(
                    "rationale must be at most {CONFIRMATION_BASIS_MAX} characters when confirming a ward (it becomes the confirmation basis)"
                )));
                }
                (
                    None,
                    Some(rationale.to_string()),
                    current.external_agency_label.clone(),
                )
            }
            JurisdictionStatus::ExternalAgencyAssigned => {
                (req.payload.external_agency_label.clone(), None, None)
            }
            _ => {
                let stored = current.external_agency_label.clone().ok_or_else(|| {
                    CommandError::Conflict("no external agency is recorded for this handoff".into())
                })?;
                if req
                    .payload
                    .external_agency_label
                    .as_deref()
                    .is_some_and(|l| l != stored)
                {
                    return Err(CommandError::Unprocessable(
                    "externalAgencyLabel must be null or equal the agency already assigned; reassignment is not part of a handoff".into(),
                ));
                }
                (Some(stored), None, None)
            }
        };
    let summary = fits_summary(jurisdiction_summary(
        current.status,
        target,
        new_label.as_deref(),
        withdrawn.as_deref(),
        rationale,
    ))?;

    let updated = sqlx::query(
        "UPDATE jurisdictions SET status = $3, external_agency_label = $4, confirmation_basis = $5, confidence_note = $6, \
            record_version = record_version + 1, updated_at = $7 \
         WHERE id = $1 AND record_version = $2",
    )
    .bind(current.id.as_str())
    .bind(req.record_version as i32)
    .bind(jurisdiction::wire(target))
    .bind(new_label)
    .bind(basis)
    .bind(confidence_note_for(target))
    .bind(at)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() != 1 {
        return Err(CommandError::Conflict(
            "recordVersion is stale: the jurisdiction record changed during the request".into(),
        ));
    }
    append_event(
        &mut tx,
        &req.issue_id,
        &transition.emitted_event,
        req.scope.persona.wire(),
        &summary,
        at,
    )
    .await?;
    record_key(&mut tx, &req.scope, &fp).await?;
    let after = by_key::<Jurisdiction>(&mut tx, "jurisdictions", None, "issue_id", &req.issue_id)
        .await?
        .ok_or_else(|| CommandError::Internal("updated record is missing".into()))?;
    tx.commit().await?;
    Ok(after)
}

pub struct LinkRequest {
    pub scope: Scope,
    pub issue_id: String,
    pub record_version: u32,
    pub payload: LinkWorkPayload,
    pub canonical_body: String,
    pub now: OffsetDateTime,
}

/// `linkWork`: attach one existing work order to an unlinked open issue on the same asset, record one lifecycle event and the
/// idempotency key, all in one transaction. `recordVersion` is the issue's version. It records a relationship only: the DLP
/// state is derived elsewhere at read time and is neither evaluated nor stored here, and no liability or cost claim is made.
pub async fn link_work(pool: &PgPool, req: LinkRequest) -> Result<Issue, CommandError> {
    eligible(Operation::LinkWork, req.scope.persona)?;
    let at = whole_second(req.now);
    let fp = req.scope.fingerprint(&req.issue_id, &req.canonical_body);
    let mut tx = begin(pool).await?;
    let seen = claim(&mut tx, &req.scope, &fp).await?;
    lock_record(&mut tx, &req.issue_id).await?;
    let row: Option<(i32, String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT record_version, status, asset_id::text, work_order_id::text FROM issues WHERE id = $1",
    )
    .bind(&req.issue_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((version, status, asset, linked)) = row else {
        return Err(CommandError::NotFound);
    };
    if let Seen::Replay = seen {
        let issue = by_key::<Issue>(&mut tx, "issues", Some("geometry"), "id", &req.issue_id)
            .await?
            .ok_or_else(|| CommandError::Internal("replayed record is missing".into()))?;
        tx.commit().await?;
        return Ok(issue);
    }
    if i64::from(version) != i64::from(req.record_version) {
        return Err(CommandError::Conflict(
            "recordVersion is stale: the issue has a different current version".into(),
        ));
    }
    if linked.is_some() {
        return Err(CommandError::Conflict(
            "the issue is already linked to a work order; an existing link is never replaced"
                .into(),
        ));
    }
    if status == "VERIFIED_COMPLETE" || status == "DRAFT_LOCAL" {
        return Err(CommandError::Conflict(
            "only an open issue can be linked to a work order".into(),
        ));
    }
    let work_id = req.payload.work_order_id.as_str().to_string();
    let work_asset: Option<String> =
        sqlx::query_scalar("SELECT asset_id::text FROM work_orders WHERE id = $1")
            .bind(&work_id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some(work_asset) = work_asset else {
        return Err(CommandError::Unprocessable(
            "workOrderId does not name a known synthetic work order".into(),
        ));
    };
    if asset.as_deref() != Some(work_asset.as_str()) {
        return Err(CommandError::Unprocessable(
            "the work order is not on the asset named by the issue; linkage requires the same asset".into(),
        ));
    }
    let summary = fits_summary(link_summary(&work_id, &req.payload.rationale))?;
    let updated = sqlx::query(
        "UPDATE issues SET work_order_id = $3, record_version = record_version + 1, updated_at = $4 \
         WHERE id = $1 AND record_version = $2 AND work_order_id IS NULL",
    )
    .bind(&req.issue_id)
    .bind(req.record_version as i32)
    .bind(&work_id)
    .bind(at)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() != 1 {
        return Err(CommandError::Conflict(
            "recordVersion is stale: the issue changed during the request".into(),
        ));
    }
    append_event(
        &mut tx,
        &req.issue_id,
        "ISSUE_WORK_LINKED",
        req.scope.persona.wire(),
        &summary,
        at,
    )
    .await?;
    record_key(&mut tx, &req.scope, &fp).await?;
    let issue = by_key::<Issue>(&mut tx, "issues", Some("geometry"), "id", &req.issue_id)
        .await?
        .ok_or_else(|| CommandError::Internal("updated record is missing".into()))?;
    tx.commit().await?;
    Ok(issue)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_scope_is_bounded_and_depends_on_operation_persona_and_key() {
        let s = |op, persona, key: &str| Scope {
            operation: op,
            persona,
            idempotency_key: key.into(),
        };
        let a = s(Operation::SubmitIssue, Persona::Citizen, "key-12345678");
        assert_eq!(a.key_hash().len(), 64);
        assert_eq!(a.suffix().len(), 8);
        assert_ne!(
            a.key_hash(),
            s(Operation::SubmitIssue, Persona::Authority, "key-12345678").key_hash()
        );
        assert_ne!(
            a.key_hash(),
            s(Operation::AddEvidence, Persona::Citizen, "key-12345678").key_hash()
        );
        assert_eq!(
            a.key_hash(),
            s(Operation::SubmitIssue, Persona::Citizen, "key-12345678").key_hash()
        );
        assert!(!a.key_hash().contains("key-12345678"));
        assert_ne!(a.fingerprint("-", "{}"), a.fingerprint("-", "{ }"));
    }

    #[test]
    fn derived_identifiers_match_the_contract_pattern() {
        let re = |s: &str| mcl_domain::records::SynId::try_from(s.to_string()).is_ok();
        assert!(re(&derived_issue_id("A1B2C3D4")));
        assert!(re(&derived_evidence_id("A1B2C3D4")));
        assert!(re(&derived_jurisdiction_id("A1B2C3D4")));
    }

    #[test]
    fn persona_eligibility_follows_the_committed_machine() {
        assert!(eligible(Operation::SubmitIssue, Persona::Citizen).is_ok());
        assert!(eligible(Operation::SubmitIssue, Persona::Authority).is_ok());
        assert!(eligible(Operation::SubmitIssue, Persona::Public).is_err());
        assert!(eligible(Operation::CheckDuplicates, Persona::Moderator).is_err());
        assert!(eligible(Operation::AddEvidence, Persona::Citizen).is_ok());
        assert!(eligible(Operation::AddEvidence, Persona::Authority).is_err());
        assert!(Persona::parse("root").is_none());
    }

    #[test]
    fn post_selection_prefers_the_ward_office_post_of_the_same_discipline() {
        let central = vec!["Executive Engineer (Roads)".to_string()];
        let office = vec![
            "Assistant Engineer (Storm Water Drains), K/West Ward".to_string(),
            "Assistant Engineer (Roads), K/West Ward".to_string(),
        ];
        let p = pick_posts(&central, &office).unwrap();
        assert_eq!(p.responsible, "Assistant Engineer (Roads), K/West Ward");
        assert_eq!(p.escalation, "Executive Engineer (Roads)");
        let only_central = pick_posts(&central, &[]).unwrap();
        assert_eq!(only_central.responsible, "Executive Engineer (Roads)");
    }

    #[test]
    fn identity_requires_the_exact_least_privilege_posture() {
        let ok = CommandIdentity {
            session_user: COMMAND_LOGIN_ROLE.into(),
            current_user: COMMAND_ROLE.into(),
            database: "civic_lens".into(),
            privileged: false,
            can_create_in_public: false,
            owned_public_relations: 0,
            insertable_tables: COMMAND_INSERT_TABLES
                .iter()
                .map(|s| s.to_string())
                .collect(),
            destructive_tables: vec![],
            updatable_columns: expected_update_columns(),
            login_memberships: vec![COMMAND_ROLE.into()],
            effective_memberships: vec![],
        };
        assert!(ok.is_least_privilege());
        let mut c = ok.clone();
        c.destructive_tables = vec!["lifecycle_events".into()];
        assert!(!c.is_least_privilege());
        let mut c = ok.clone();
        c.insertable_tables.push("wards".into());
        assert!(!c.is_least_privilege());
        let mut c = ok.clone();
        c.privileged = true;
        assert!(!c.is_least_privilege());
        let mut c = ok.clone();
        c.login_memberships.push("mcl_app".into());
        assert!(!c.is_least_privilege());
        let mut c = ok.clone();
        c.current_user = "civic".into();
        assert!(!c.is_least_privilege());
        let mut c = ok.clone();
        c.can_create_in_public = true;
        assert!(!c.is_least_privilege());
        // column-level UPDATE must be exactly the committed P6 list: an extra column, a missing one, or none at all fails
        let mut c = ok.clone();
        c.updatable_columns.push("issues.title".into());
        assert!(!c.is_least_privilege());
        let mut c = ok.clone();
        c.updatable_columns.retain(|x| x != "issues.work_order_id");
        assert!(!c.is_least_privilege());
        let mut c = ok;
        c.updatable_columns.clear();
        assert!(!c.is_least_privilege());
    }

    #[test]
    fn the_update_column_list_is_the_committed_minimum() {
        let cols = expected_update_columns();
        assert_eq!(cols.len(), 9);
        assert!(cols.windows(2).all(|w| w[0] < w[1]), "sorted and unique");
        for forbidden in [
            "jurisdictions.spatial_match_method",
            "jurisdictions.candidate_ward_id",
            "jurisdictions.source_conflict_note",
            "jurisdictions.legal_ownership_asserted",
            "jurisdictions.established_at",
            "issues.status",
            "issues.title",
            "issues.asset_id",
            "issues.geometry",
        ] {
            assert!(!cols.iter().any(|c| c == forbidden), "{forbidden}");
        }
    }

    #[test]
    fn authority_operations_are_forbidden_to_every_other_persona() {
        for op in [Operation::ResolveJurisdiction, Operation::LinkWork] {
            assert!(eligible(op, Persona::Authority).is_ok());
            for p in [
                Persona::Public,
                Persona::Citizen,
                Persona::Moderator,
                Persona::IndependentReviewer,
                Persona::DemoAdmin,
            ] {
                assert!(
                    matches!(eligible(op, p), Err(CommandError::Forbidden(_))),
                    "{op:?} {p:?}"
                );
            }
        }
    }

    #[test]
    fn jurisdiction_summaries_state_both_states_and_never_claim_legal_ownership() {
        use JurisdictionStatus as S;
        let s = jurisdiction_summary(
            S::ConflictDisputed,
            S::ConfirmedBmcWard,
            None,
            Some("Agency X"),
            "Ward record reviewed.",
        );
        assert!(s.contains("CONFLICT_DISPUTED to CONFIRMED_BMC_WARD"));
        assert!(s.contains("not a legal determination") && s.contains("Agency X"));
        let s = jurisdiction_summary(
            S::SpatiallyInferredProvisional,
            S::ExternalAgencyAssigned,
            Some("Agency X"),
            None,
            "r",
        );
        assert!(
            s.contains("EXTERNAL_AGENCY_ASSIGNED (Agency X)")
                && s.contains("handoff not yet recorded")
        );
        let s = jurisdiction_summary(
            S::ExternalAgencyAssigned,
            S::HandoffLogged,
            Some("Agency X"),
            None,
            "r",
        );
        assert!(s.starts_with("External-agency handoff recorded to Agency X"));
        for t in [
            S::ConfirmedBmcWard,
            S::ExternalAgencyAssigned,
            S::HandoffLogged,
        ] {
            let n = confidence_note_for(t);
            assert!(n.contains("Not a legal determination") || n.contains("Not a legal"));
        }
        let l = link_summary("SYN-DEMO-WO-001", "Same segment.");
        assert!(l.contains("not a finding of liability") && l.contains("any cost outcome"));
    }

    #[test]
    fn an_over_long_event_text_is_refused_not_truncated() {
        assert!(fits_summary("x".repeat(400)).is_ok());
        let e = fits_summary("x".repeat(401)).unwrap_err();
        assert!(matches!(e, CommandError::Unprocessable(m) if m.contains("1 character")));
        // the longest legal rationale (400) cannot fit any step's wording, which must be reported, not clipped
        let s = link_summary("SYN-DEMO-WO-001", &"r".repeat(400));
        assert!(fits_summary(s).is_err());
    }
}
