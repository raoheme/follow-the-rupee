//! Deterministic synthetic demonstration baseline (checkpoint CP-00).
//!
//! `reset_and_seed` is guarded: it refuses to run unless the connection is local, the database name matches the
//! policy, the `synthetic_demo_marker` row names this database and the connected role owns the audit tables.
//! It then empties every demonstration table with one non-CASCADE `TRUNCATE` (reverse dependency order) and
//! reloads `data/demo/*.json` in dependency order. No network access and no wall-clock value is involved.
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use sqlx::postgres::{PgPool, PgPoolOptions};
use std::path::{Path, PathBuf};

pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("../../migrations");

#[derive(Debug, thiserror::Error)]
pub enum DemoError {
    #[error("database error: {0}")]
    Sqlx(#[from] sqlx::Error),
    #[error("migration error: {0}")]
    Migrate(#[from] sqlx::migrate::MigrateError),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Msg(String),
}

/// One seed file and the table it loads into. `geometry` lists table columns holding GeoJSON seed values.
pub struct SeedSpec {
    pub stem: &'static str,
    pub table: &'static str,
    pub geometry: &'static [&'static str],
}

/// Dependency order: parents before children.
pub const SEED_ORDER: &[SeedSpec] = &[
    SeedSpec {
        stem: "wards",
        table: "wards",
        geometry: &["boundary"],
    },
    SeedSpec {
        stem: "departments",
        table: "departments",
        geometry: &[],
    },
    SeedSpec {
        stem: "assets",
        table: "assets",
        geometry: &["geometry"],
    },
    SeedSpec {
        stem: "contractors",
        table: "contractors",
        geometry: &[],
    },
    SeedSpec {
        stem: "budgets",
        table: "budgets",
        geometry: &[],
    },
    SeedSpec {
        stem: "tenders",
        table: "tenders",
        geometry: &[],
    },
    SeedSpec {
        stem: "contracts",
        table: "contracts",
        geometry: &[],
    },
    SeedSpec {
        stem: "work-orders",
        table: "work_orders",
        geometry: &[],
    },
    SeedSpec {
        stem: "dlp-status",
        table: "dlp_status",
        geometry: &[],
    },
    SeedSpec {
        stem: "issues",
        table: "issues",
        geometry: &["geometry"],
    },
    SeedSpec {
        stem: "jurisdictions",
        table: "jurisdictions",
        geometry: &[],
    },
    SeedSpec {
        stem: "evidence",
        table: "evidence",
        geometry: &[],
    },
    SeedSpec {
        stem: "completion-claims",
        table: "completion_claims",
        geometry: &[],
    },
    SeedSpec {
        stem: "verifications",
        table: "verifications",
        geometry: &[],
    },
    SeedSpec {
        stem: "corrections",
        table: "corrections",
        geometry: &[],
    },
    SeedSpec {
        stem: "lifecycle-events",
        table: "lifecycle_events",
        geometry: &[],
    },
];

/// Tables in the baseline digest, in the fixed alphabetical order the digest specification requires.
/// Excluded as volatile or non-baseline: idempotency_records, synthetic_demo_marker, _sqlx_migrations.
pub const DIGEST_TABLES: &[&str] = &[
    "assets",
    "budgets",
    "completion_claims",
    "contractors",
    "contracts",
    "corrections",
    "departments",
    "dlp_status",
    "evidence",
    "issues",
    "jurisdictions",
    "lifecycle_events",
    "tenders",
    "verifications",
    "wards",
    "work_orders",
];

/// Reset scope: the database that may be reset, and the hosts it may be reset from.
pub const DEMO_DATABASE: &str = "civic_lens";
pub const SCRATCH_PREFIX: &str = "mcl_p1_";
pub const LOCAL_HOSTS: &[&str] = &["127.0.0.1", "localhost", "::1"];

#[derive(Debug, Clone)]
pub struct ResetPolicy {
    database_name: String,
}

impl ResetPolicy {
    /// The only policy the CLI and the future reset endpoint use: the `civic_lens` demonstration database.
    pub fn demo() -> Self {
        ResetPolicy {
            database_name: DEMO_DATABASE.to_string(),
        }
    }

    /// For tests only: a throwaway database whose name starts with `mcl_p1_`.
    pub fn scratch(name: &str) -> Result<Self, DemoError> {
        if name.starts_with(SCRATCH_PREFIX) && name.len() > SCRATCH_PREFIX.len() {
            Ok(ResetPolicy {
                database_name: name.to_string(),
            })
        } else {
            Err(DemoError::Msg(format!(
                "scratch databases must start with {SCRATCH_PREFIX}"
            )))
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BaselineReport {
    pub counts: Vec<(String, i64)>,
    pub digest: String,
}

pub fn camel_to_snake(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 4);
    for ch in s.chars() {
        if ch.is_ascii_uppercase() {
            out.push('_');
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

/// Workspace root, derived from this crate's manifest directory.
pub fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

pub fn default_seed_dir() -> PathBuf {
    workspace_root().join("data").join("demo")
}

/// DATABASE_URL from the environment, else from `.env.local` at the workspace root. The value is never printed.
pub fn database_url() -> Result<String, DemoError> {
    if let Ok(v) = std::env::var("DATABASE_URL") {
        if !v.trim().is_empty() {
            return Ok(v);
        }
    }
    let path = workspace_root().join(".env.local");
    let text = std::fs::read_to_string(&path).map_err(|_| {
        DemoError::Msg("DATABASE_URL is not set and .env.local is not readable".into())
    })?;
    for line in text.lines() {
        if let Some(rest) = line.trim().strip_prefix("DATABASE_URL=") {
            if !rest.is_empty() {
                return Ok(rest.to_string());
            }
        }
    }
    Err(DemoError::Msg(
        "DATABASE_URL is absent in the environment and .env.local".into(),
    ))
}

/// Replace the database name in a postgres URL (the part after the last '/', before any '?').
pub fn with_database_name(url: &str, name: &str) -> String {
    let (base, query) = match url.find('?') {
        Some(i) => (&url[..i], &url[i..]),
        None => (url, ""),
    };
    let cut = base.rfind('/').unwrap_or(base.len());
    format!("{}/{}{}", &base[..cut], name, query)
}

pub fn host_is_local(host: &str) -> bool {
    LOCAL_HOSTS.contains(&host)
}

pub async fn connect(url: &str) -> Result<PgPool, DemoError> {
    Ok(PgPoolOptions::new().max_connections(2).connect(url).await?)
}

pub async fn migrate(pool: &PgPool) -> Result<(), DemoError> {
    MIGRATOR.run(pool).await?;
    Ok(())
}

fn read_seed(dir: &Path, stem: &str) -> Result<Vec<Value>, DemoError> {
    let text = std::fs::read_to_string(dir.join(format!("{stem}.json")))?;
    match serde_json::from_str::<Value>(&text)? {
        Value::Array(a) => Ok(a),
        _ => Err(DemoError::Msg(format!("{stem}.json must be a JSON array"))),
    }
}

/// Top-level keys to snake_case. Nested values (for example correction values) are preserved verbatim.
fn snake_records(rows: &[Value]) -> Result<Value, DemoError> {
    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let obj = r
            .as_object()
            .ok_or_else(|| DemoError::Msg("seed record is not an object".into()))?;
        let mut m = Map::new();
        for (k, v) in obj {
            m.insert(camel_to_snake(k), v.clone());
        }
        out.push(Value::Object(m));
    }
    Ok(Value::Array(out))
}

/// Fail closed: every seed key must map to a table column, so no value is silently dropped.
pub async fn check_seed_columns(pool: &PgPool, dir: &Path) -> Result<(), DemoError> {
    for spec in SEED_ORDER {
        let cols: Vec<String> = sqlx::query_scalar(
            "SELECT column_name::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
        )
        .bind(spec.table)
        .fetch_all(pool)
        .await?;
        for rec in read_seed(dir, spec.stem)? {
            for key in rec.as_object().into_iter().flat_map(|o| o.keys()) {
                let snake = camel_to_snake(key);
                if !cols.contains(&snake) {
                    return Err(DemoError::Msg(format!(
                        "seed key {}.{} has no column {}",
                        spec.stem, key, snake
                    )));
                }
            }
        }
    }
    Ok(())
}

fn insert_sql(spec: &SeedSpec) -> String {
    let mut expr = String::from("r.j");
    for col in spec.geometry {
        expr.push_str(&format!(
            " || jsonb_build_object('{col}', ST_AsEWKT(ST_SetSRID(ST_GeomFromGeoJSON((r.j->'{col}')::text), 4326)))"
        ));
    }
    format!(
        "INSERT INTO {t} SELECT (jsonb_populate_record(NULL::{t}, {expr})).* \
         FROM (SELECT j, ord FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS a(j, ord)) r ORDER BY r.ord",
        t = spec.table,
        expr = expr
    )
}

pub async fn record_counts(pool: &PgPool) -> Result<Vec<(String, i64)>, DemoError> {
    let mut out = Vec::new();
    for spec in SEED_ORDER {
        let n: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {}", spec.table))
            .fetch_one(pool)
            .await?;
        out.push((spec.table.to_string(), n));
    }
    Ok(out)
}

/// Canonical JSON: object keys sorted bytewise at every depth, arrays in order, compact, UTF-8.
pub fn canonical_json(v: &Value) -> String {
    match v {
        Value::Object(m) => {
            let mut keys: Vec<&String> = m.keys().collect();
            keys.sort();
            let body: Vec<String> = keys
                .into_iter()
                .map(|k| format!("{}:{}", Value::String(k.clone()), canonical_json(&m[k])))
                .collect();
            format!("{{{}}}", body.join(","))
        }
        Value::Array(a) => format!(
            "[{}]",
            a.iter().map(canonical_json).collect::<Vec<_>>().join(",")
        ),
        other => other.to_string(),
    }
}

/// SQL building one canonical row object for a table: columns sorted by name, timestamptz normalised to
/// UTC ISO-8601 with microseconds and a Z suffix, geometry as GeoJSON with 6 decimals, NULL kept as JSON null.
fn row_object_sql(columns: &[(String, String)]) -> String {
    let parts: Vec<String> = columns
        .iter()
        .map(|(name, udt)| {
            let expr = match udt.as_str() {
                "timestamptz" => format!(
                    "to_char(x.{name} AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')"
                ),
                "geometry" => format!("ST_AsGeoJSON(x.{name}, 6)::jsonb"),
                _ => format!("x.{name}"),
            };
            format!("'{name}', {expr}")
        })
        .collect();
    format!("jsonb_build_object({})", parts.join(", "))
}

/// The canonical byte stream hashed by `baseline_digest`: for each table in `DIGEST_TABLES`,
/// `"<table>\n" + canonical_json(rows ordered by id) + "\n"`.
pub async fn baseline_canonical_text(pool: &PgPool) -> Result<String, DemoError> {
    let mut all = String::new();
    for table in DIGEST_TABLES {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT column_name::text, udt_name::text FROM information_schema.columns \
             WHERE table_schema = 'public' AND table_name = $1 ORDER BY column_name COLLATE \"C\"",
        )
        .bind(table)
        .fetch_all(pool)
        .await?;
        if rows.is_empty() {
            return Err(DemoError::Msg(format!(
                "digest table {table} does not exist"
            )));
        }
        let sql = format!(
            "SELECT coalesce(jsonb_agg({} ORDER BY x.id COLLATE \"C\"), '[]'::jsonb)::text FROM {table} x",
            row_object_sql(&rows)
        );
        let body: String = sqlx::query_scalar(&sql).fetch_one(pool).await?;
        let value: Value = serde_json::from_str(&body)?;
        all.push_str(table);
        all.push('\n');
        all.push_str(&canonical_json(&value));
        all.push('\n');
    }
    Ok(all)
}

/// Lower-case hexadecimal text of a byte slice.
pub fn to_hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        // writing to a String cannot fail
        let _ = write!(out, "{b:02x}");
    }
    out
}

/// SHA-256 (lower-case hex) over `baseline_canonical_text`.
pub async fn baseline_digest(pool: &PgPool) -> Result<String, DemoError> {
    let text = baseline_canonical_text(pool).await?;
    let hash = Sha256::digest(text.as_bytes());
    Ok(to_hex(&hash))
}

/// Refuse a reset unless every guard passes. Nothing is modified by this check.
pub async fn assert_reset_allowed(pool: &PgPool, policy: &ResetPolicy) -> Result<(), DemoError> {
    let host = pool.connect_options().get_host().to_string();
    if !host_is_local(&host) {
        return Err(DemoError::Msg(format!(
            "reset refused: host {host} is not local"
        )));
    }
    let db: String = sqlx::query_scalar("SELECT current_database()::text")
        .fetch_one(pool)
        .await?;
    if db != policy.database_name {
        return Err(DemoError::Msg(format!(
            "reset refused: database {db} is not {}",
            policy.database_name
        )));
    }
    let marker: Option<String> = sqlx::query_scalar(
        "SELECT database_name FROM synthetic_demo_marker \
         WHERE id = 'SYN-DEMO-MARKER' AND record_nature = 'SYNTHETIC_DEMONSTRATION' AND checkpoint = 'CP-00'",
    )
    .fetch_optional(pool)
    .await?;
    match marker {
        Some(m) if m == db => {}
        Some(m) => {
            return Err(DemoError::Msg(format!(
                "reset refused: marker names database {m}, not {db}"
            )))
        }
        None => {
            return Err(DemoError::Msg(
                "reset refused: synthetic demonstration marker is missing".into(),
            ))
        }
    }
    let owner_ok: bool = sqlx::query_scalar(
        "SELECT pg_get_userbyid(c.relowner) = current_user FROM pg_class c \
         WHERE c.relname = 'lifecycle_events' AND c.relnamespace = 'public'::regnamespace",
    )
    .fetch_one(pool)
    .await?;
    if !owner_ok {
        return Err(DemoError::Msg(
            "reset refused: the connected role does not own the audit tables".into(),
        ));
    }
    Ok(())
}

/// Reset to CP-00 under the demo policy (database `civic_lens`).
pub async fn reset_and_seed(pool: &PgPool, dir: &Path) -> Result<BaselineReport, DemoError> {
    reset_and_seed_with(pool, dir, &ResetPolicy::demo()).await
}

/// Guarded reset and reseed. Atomic: any failure rolls the transaction back. Never uses `TRUNCATE ... CASCADE`.
pub async fn reset_and_seed_with(
    pool: &PgPool,
    dir: &Path,
    policy: &ResetPolicy,
) -> Result<BaselineReport, DemoError> {
    assert_reset_allowed(pool, policy).await?;
    check_seed_columns(pool, dir).await?;
    let mut tx = pool.begin().await?;
    let mut tables: Vec<&str> = SEED_ORDER.iter().rev().map(|s| s.table).collect();
    tables.push("idempotency_records");
    sqlx::query(&format!("TRUNCATE {}", tables.join(", ")))
        .execute(&mut *tx)
        .await?;
    for spec in SEED_ORDER {
        let rows = snake_records(&read_seed(dir, spec.stem)?)?;
        sqlx::query(&insert_sql(spec))
            .bind(rows.to_string())
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(BaselineReport {
        counts: record_counts(pool).await?,
        digest: baseline_digest(pool).await?,
    })
}

/// `expectedDigest` from data/demo/reset-manifest.json.
pub fn manifest_expected_digest(dir: &Path) -> Result<String, DemoError> {
    let v: Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("reset-manifest.json"))?)?;
    v.get("expectedDigest")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| DemoError::Msg("reset-manifest.json has no expectedDigest".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digest_tables_are_the_alphabetical_seed_tables() {
        let mut seed: Vec<&str> = SEED_ORDER.iter().map(|s| s.table).collect();
        seed.sort_unstable();
        assert_eq!(seed, DIGEST_TABLES);
    }

    #[test]
    fn canonical_json_sorts_keys_and_keeps_nulls() {
        let v: Value = serde_json::from_str(r#"{"b":[{"z":1,"a":null}],"a":"x","c":1.5}"#).unwrap();
        assert_eq!(
            canonical_json(&v),
            r#"{"a":"x","b":[{"a":null,"z":1}],"c":1.5}"#
        );
    }

    #[test]
    fn only_local_hosts_pass_and_scratch_names_are_restricted() {
        assert!(host_is_local("127.0.0.1") && host_is_local("localhost") && host_is_local("::1"));
        assert!(!host_is_local("db.example.com") && !host_is_local("10.0.0.5"));
        assert!(ResetPolicy::scratch("mcl_p1_x").is_ok());
        assert!(ResetPolicy::scratch("civic_lens").is_err());
        assert!(ResetPolicy::scratch("mcl_p1_").is_err());
        assert_eq!(
            with_database_name(
                "postgresql://u:p@127.0.0.1:5432/civic_lens?sslmode=disable",
                "x"
            ),
            "postgresql://u:p@127.0.0.1:5432/x?sslmode=disable"
        );
    }
}
