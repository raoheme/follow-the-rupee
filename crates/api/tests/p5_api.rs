//! P5 integration tests: the real Axum router on a real loopback socket, writing the real `civic_lens` PostGIS database
//! through the separate command identity (`mcl_api_write` -> `mcl_command`) and reading through the read identity
//! (`mcl_api` -> `mcl_app`).
//!
//! These tests mutate the synthetic demonstration database, so they are serialised behind one lock and restore the accepted CP-00
//! baseline at the start of every test and again when each test ends (even on panic). The restore uses the guarded
//! `demo::reset_and_seed` (marked `civic_lens` on a local host only) with the owner credential from `.env.local`; that
//! credential exists only in this test process and is never available to the API under test. Expected results come from the
//! committed JSON policy and seeds, not from the server's own output.
use mcl_api::{router, AppState, Clock};
use mcl_infrastructure::command::{self, Operation, Persona, Scope};
use mcl_infrastructure::{demo, read};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

const ORIGIN: &str = "http://localhost:5173";
const CLOCK: &str = "2026-11-21T04:30:00Z";

fn lock() -> &'static tokio::sync::Mutex<()> {
    static L: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();
    L.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn fixed(s: &str) -> Clock {
    let t = OffsetDateTime::parse(s, &Rfc3339).unwrap();
    Arc::new(move || t)
}

// ---------------------------------------------------------------------------------------------------------------- harness

async fn owner_pool() -> PgPool {
    let url = demo::database_url()
        .expect("DATABASE_URL in the environment or .env.local (test process only)");
    let pool = demo::connect(&url).await.unwrap();
    let (db, marker, host_ok): (String, i64, bool) = sqlx::query_as(
        "SELECT current_database()::text, (SELECT count(*) FROM synthetic_demo_marker \
         WHERE id = 'SYN-DEMO-MARKER' AND database_name = current_database()), true",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(host_ok);
    assert_eq!(
        (db.as_str(), marker),
        ("civic_lens", 1),
        "tests only touch the marked civic_lens database"
    );
    assert!(demo::host_is_local(&read::redacted(&url).unwrap().host));
    pool
}

async fn reset_baseline() {
    let pool = owner_pool().await;
    let r = demo::reset_and_seed(&pool, &demo::default_seed_dir())
        .await
        .unwrap();
    let expected = demo::manifest_expected_digest(&demo::default_seed_dir()).unwrap();
    assert_eq!(r.digest, expected, "the CP-00 baseline digest is restored");
}

/// Holds the global lock and restores the baseline at the start and, via Drop, at the end (also when a test panics).
struct Fixture {
    _guard: tokio::sync::MutexGuard<'static, ()>,
}

impl Fixture {
    async fn new() -> Fixture {
        let guard = lock().lock().await;
        reset_baseline().await;
        Fixture { _guard: guard }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::thread::spawn(|| {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(reset_baseline());
        })
        .join();
    }
}

fn command_pool() -> PgPool {
    let url = command::write_database_url()
        .expect("APP_WRITE_DATABASE_URL in the environment or .env.local");
    let t = read::redacted(&url).unwrap();
    assert_eq!(
        (t.database.as_str(), t.user.as_str()),
        ("civic_lens", "mcl_api_write")
    );
    assert!(demo::host_is_local(&t.host));
    command::connect_command(&url).unwrap()
}

async fn read_pool() -> PgPool {
    read::connect_app(&read::app_database_url().unwrap())
        .await
        .unwrap()
}

struct Server {
    addr: SocketAddr,
}

async fn serve(state: AppState) -> Server {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = router(state, &[ORIGIN.to_string()]);
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Server { addr }
}

async fn start() -> Server {
    serve(AppState::with_clock(read_pool().await, fixed(CLOCK)).with_command_pool(command_pool()))
        .await
}

#[derive(Debug)]
struct Resp {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

impl Resp {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
    fn json(&self) -> Value {
        serde_json::from_str(&self.body).unwrap_or_else(|e| panic!("not JSON ({e}): {}", self.body))
    }
}

async fn request(
    addr: SocketAddr,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: Option<&str>,
) -> Resp {
    let mut req = format!("{method} {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n");
    for (k, v) in headers {
        req.push_str(&format!("{k}: {v}\r\n"));
    }
    if let Some(b) = body {
        req.push_str(&format!("Content-Length: {}\r\n", b.len()));
    }
    req.push_str("\r\n");
    if let Some(b) = body {
        req.push_str(b);
    }
    let mut s = TcpStream::connect(addr).await.unwrap();
    s.write_all(req.as_bytes()).await.unwrap();
    let mut buf = Vec::new();
    let _ = tokio::time::timeout(Duration::from_secs(20), s.read_to_end(&mut buf)).await;
    let text = String::from_utf8_lossy(&buf).to_string();
    let (head, body) = text.split_once("\r\n\r\n").unwrap_or((text.as_str(), ""));
    let mut lines = head.lines();
    let status = lines
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|c| c.parse().ok())
        .unwrap_or(0);
    let headers = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        .collect();
    Resp {
        status,
        headers,
        body: body.to_string(),
    }
}

async fn post(s: &Server, path: &str, persona: &str, key: &str, body: &Value) -> Resp {
    let b = body.to_string();
    request(
        s.addr,
        "POST",
        path,
        &[
            ("Content-Type", "application/json"),
            ("X-Demo-Persona", persona),
            ("Idempotency-Key", key),
            ("X-Correlation-Id", "p5-test-corr-0001"),
        ],
        Some(&b),
    )
    .await
}

async fn get(s: &Server, path: &str) -> Resp {
    request(s.addr, "GET", path, &[], None).await
}

fn submit_body(title: &str) -> Value {
    json!({"recordVersion": 1, "payload": {
        "category": "POTHOLE",
        "geometry": {"type": "Point", "coordinates": [72.83158, 19.11974]},
        "title": title,
        "publicDescription": "Synthetic pothole report near the S.V. Road Junction approach on Paliram Road.",
        "nearbyLandmark": "near S.V. Road Junction approach (synthetic label)",
        "assetId": "SYN-DEMO-AST-ROAD-001"
    }})
}

fn check_body(version: u32, keywords: &[&str]) -> Value {
    json!({"recordVersion": version, "payload": {
        "category": "POTHOLE",
        "geometry": {"type": "Point", "coordinates": [72.83158, 19.11974]},
        "descriptionKeywords": keywords
    }})
}

fn sha(s: &str) -> String {
    command::sha256_hex(s)
}

fn evidence_body(version: u32, media_ref: &str, choice: Value) -> Value {
    json!({"recordVersion": version, "payload": {
        "stage": "BEFORE",
        "caption": "Synthetic citizen note: the same surface break is visible here.",
        "sourceType": "CITIZEN_FIXTURE",
        "capturedAt": "2026-11-21T04:20:00Z",
        "mediaRef": media_ref,
        "sha256": sha(media_ref),
        "duplicateChoice": choice
    }})
}

async fn count(pool: &PgPool, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

fn assert_problem(r: &Resp, status: u16) -> Value {
    assert_eq!(r.status, status, "{}", r.body);
    assert_eq!(r.header("content-type"), Some("application/problem+json"));
    let p = r.json();
    assert_eq!(p["status"], status);
    assert_eq!(p["correlationId"], r.header("x-correlation-id").unwrap());
    for leak in [
        "select ",
        "insert into",
        "sqlx",
        "postgres",
        "mcl_api_write",
        "panicked",
        "c:\\",
        "src/",
    ] {
        assert!(
            !r.body.to_lowercase().contains(leak),
            "leak {leak}: {}",
            r.body
        );
    }
    p
}

fn policy() -> Value {
    let p = demo::workspace_root()
        .join("config")
        .join("duplicate-policy.json");
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

// ------------------------------------------------------------------------------------ database roles and privileges

#[tokio::test]
async fn the_read_pool_stays_read_only_and_cannot_write() {
    let _f = Fixture::new().await;
    let pool = read_pool().await;
    let ro: String = sqlx::query_scalar("SELECT current_setting('default_transaction_read_only')")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(ro, "on");
    let id = read::runtime_identity(&pool).await.unwrap();
    assert!(id.is_least_privilege());
    let e = sqlx::query("INSERT INTO idempotency_records (idempotency_key, operation_id, response_hash) VALUES ('x','y','z')")
        .execute(&pool)
        .await
        .unwrap_err();
    assert_eq!(
        e.as_database_error().unwrap().code().as_deref(),
        Some("25006")
    );
}

#[tokio::test]
async fn the_command_pool_is_a_non_owner_non_superuser_least_privilege_identity() {
    let _f = Fixture::new().await;
    let pool = command_pool();
    let id = command::command_identity(&pool).await.unwrap();
    assert!(id.is_least_privilege(), "{id:?}");
    assert_eq!(
        (id.session_user.as_str(), id.current_user.as_str()),
        ("mcl_api_write", "mcl_command")
    );
    assert_eq!(id.insertable_tables, command::COMMAND_INSERT_TABLES);
    assert!(id.destructive_tables.is_empty() && !id.privileged && !id.can_create_in_public);
    // The command pool is a different identity from the read pool.
    let r = read::runtime_identity(&read_pool().await).await.unwrap();
    assert_ne!(r.session_user, id.session_user);
    assert_ne!(r.current_user, id.current_user);
    // Role attributes straight from the catalog.
    let (login, cmd_login, super_, inherit, limit): (bool, bool, bool, bool, i32) = sqlx::query_as(
        "SELECT (SELECT rolcanlogin FROM pg_roles WHERE rolname='mcl_api_write'), \
                (SELECT rolcanlogin FROM pg_roles WHERE rolname='mcl_command'), \
                (SELECT rolsuper OR rolcreaterole OR rolcreatedb FROM pg_roles WHERE rolname IN ('mcl_api_write','mcl_command') ORDER BY rolsuper DESC LIMIT 1), \
                (SELECT rolinherit FROM pg_roles WHERE rolname='mcl_api_write'), \
                (SELECT rolconnlimit FROM pg_roles WHERE rolname='mcl_api_write')",
    )
    .fetch_one(&owner_pool().await)
    .await
    .unwrap();
    assert!(
        login && !cmd_login && !super_ && !inherit,
        "mcl_api_write LOGIN NOINHERIT; mcl_command NOLOGIN"
    );
    assert!(limit > 0 && limit <= 10, "bounded connection limit");
}

async fn denied(pool: &PgPool, sql: &str) -> String {
    let e = sqlx::query(sql).execute(pool).await.expect_err(sql);
    e.as_database_error()
        .and_then(|d| d.code().map(|c| c.to_string()))
        .unwrap_or_default()
}

#[tokio::test]
async fn forbidden_writes_ddl_role_changes_and_reset_are_refused_at_the_database() {
    let _f = Fixture::new().await;
    let pool = command_pool();
    let before = demo::baseline_digest(&owner_pool().await).await.unwrap();
    // unapproved INSERT targets
    for t in [
        "INSERT INTO wards (id) VALUES ('SYN-DEMO-WARD-X')",
        "INSERT INTO assets (id) VALUES ('SYN-DEMO-AST-X')",
        "INSERT INTO synthetic_demo_marker (id) VALUES ('SYN-DEMO-MARKER')",
        "INSERT INTO corrections (id) VALUES ('SYN-DEMO-COR-X')",
        "INSERT INTO _sqlx_migrations (version) VALUES (99)",
        "INSERT INTO work_orders (id) VALUES ('SYN-DEMO-WO-X')",
    ] {
        assert_eq!(denied(&pool, t).await, "42501", "{t}");
    }
    // arbitrary UPDATE, DELETE, TRUNCATE
    for t in [
        "UPDATE issues SET title = 'x'",
        "UPDATE evidence SET caption = 'x'",
        "UPDATE idempotency_records SET operation_id = 'x'",
        "DELETE FROM issues",
        "DELETE FROM evidence",
        "TRUNCATE issues",
        "TRUNCATE idempotency_records",
    ] {
        assert_eq!(denied(&pool, t).await, "42501", "{t}");
    }
    // lifecycle history and correction history can never be altered or removed through this identity
    for t in [
        "UPDATE lifecycle_events SET summary = 'x'",
        "DELETE FROM lifecycle_events",
        "TRUNCATE lifecycle_events",
        "UPDATE corrections SET reason = 'x'",
        "DELETE FROM corrections",
        "TRUNCATE corrections",
    ] {
        assert_eq!(denied(&pool, t).await, "42501", "{t}");
    }
    // DDL, role administration, migration and reset authority
    for t in [
        "CREATE TABLE p5_probe (x int)",
        "DROP TABLE issues",
        "ALTER TABLE issues ADD COLUMN x int",
        "CREATE ROLE p5_probe_role",
        "ALTER ROLE mcl_command SUPERUSER",
        "GRANT mcl_app TO mcl_command",
        "DROP TABLE _sqlx_migrations",
        "CREATE SCHEMA p5_probe",
    ] {
        assert_eq!(denied(&pool, t).await, "42501", "{t}");
    }
    // SET ROLE to any unapproved role
    for role in [
        "mcl_app",
        "mcl_api",
        "civic",
        "postgres",
        "pg_write_all_data",
    ] {
        let c = denied(&pool, &format!("SET ROLE {role}")).await;
        assert!(
            c == "42501" || c == "22023" || c == "42704",
            "SET ROLE {role}: {c}"
        );
    }
    // the guarded reset cannot run as this identity and changes nothing
    assert!(demo::reset_and_seed(&pool, &demo::default_seed_dir())
        .await
        .is_err());
    // even a permitted-table INSERT cannot forge a broken lifecycle chain
    let forged = "INSERT INTO lifecycle_events (id, record_nature, source_tier, record_version, updated_at, entity_id, sequence, \
        event_type, actor_role, occurred_at, summary, previous_hash, payload_hash) VALUES ('SYN-DEMO-EVT-FORGED-001', \
        'SYNTHETIC_DEMONSTRATION', 'SYNTHETIC_DEMO', 1, now(), 'SYN-DEMO-KND-001', 99, 'FORGED_EVENT', 'citizen', now(), 'x', \
        NULL, repeat('a', 64))";
    assert_eq!(denied(&pool, forged).await, "23514");
    assert_eq!(
        demo::baseline_digest(&owner_pool().await).await.unwrap(),
        before
    );
}

#[tokio::test]
async fn the_api_process_sources_never_reference_the_owner_credential() {
    let root = demo::workspace_root();
    for f in [
        "crates/api/src/main.rs",
        "crates/api/src/lib.rs",
        "crates/api/src/config.rs",
    ] {
        let text = std::fs::read_to_string(root.join(f)).unwrap();
        assert!(
            !text.contains("\"DATABASE_URL\""),
            "{f} must not read the owner DATABASE_URL"
        );
        assert!(!text.contains("POSTGRES_PASSWORD"), "{f}");
        assert!(!text.contains("demo::database_url"), "{f}");
        assert!(!text.contains("reset_and_seed"), "{f}");
    }
}

// -------------------------------------------------------------------------------------- submitIssue and idempotency

#[tokio::test]
async fn a_report_commits_with_its_jurisdiction_and_lifecycle_events_atomically_and_replays_exactly(
) {
    let _f = Fixture::new().await;
    let s = start().await;
    let owner = owner_pool().await;
    let issues0 = count(&owner, "SELECT count(*) FROM issues").await;
    let events0 = count(&owner, "SELECT count(*) FROM lifecycle_events").await;

    let body = submit_body("Pothole near the junction approach");
    let r = post(&s, "/v1/issues", "citizen", "idem-submit-0001", &body).await;
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(r.header("etag"), Some("\"1\""));
    assert_eq!(r.header("x-correlation-id"), Some("p5-test-corr-0001"));
    let j = r.json();
    assert_eq!(j["correlationId"], "p5-test-corr-0001");
    let d = &j["data"];
    let id = d["id"].as_str().unwrap().to_string();
    assert!(id.starts_with("SYN-DEMO-KND-R"));
    assert_eq!(d["status"], "SUBMITTED_UNVERIFIED");
    assert_eq!(d["recordVersion"], 1);
    assert_eq!(d["recordNature"], "SYNTHETIC_DEMONSTRATION");
    assert_eq!(d["category"], "POTHOLE");
    assert_eq!(d["assetId"], "SYN-DEMO-AST-ROAD-001");
    assert_eq!(d["wardCandidateId"], "SYN-DEMO-WARD-KW");
    assert_eq!(d["workOrderId"], Value::Null);
    assert_eq!(d["reportedAt"], CLOCK);
    assert_eq!(d["journeys"], json!(["J2"]));
    assert!(d["responsiblePostTitle"]
        .as_str()
        .unwrap()
        .contains("Roads"));

    // committed together: the issue, its provisional jurisdiction, two chained events and the idempotency record
    assert_eq!(
        count(&owner, "SELECT count(*) FROM issues").await,
        issues0 + 1
    );
    assert_eq!(
        count(&owner, "SELECT count(*) FROM lifecycle_events").await,
        events0 + 2
    );
    let juris: (String, bool) = sqlx::query_as(
        "SELECT status, legal_ownership_asserted FROM jurisdictions WHERE issue_id = $1",
    )
    .bind(&id)
    .fetch_one(&owner)
    .await
    .unwrap();
    assert_eq!(juris, ("SPATIALLY_INFERRED_PROVISIONAL".to_string(), false));
    let types: Vec<(i32, String, String)> = sqlx::query_as(
        "SELECT sequence, event_type, actor_role FROM lifecycle_events WHERE entity_id = $1 ORDER BY sequence",
    )
    .bind(&id)
    .fetch_all(&owner)
    .await
    .unwrap();
    assert_eq!(
        types,
        vec![
            (
                1,
                "ISSUE_SUBMITTED_UNVERIFIED".to_string(),
                "citizen".to_string()
            ),
            (
                2,
                "JURISDICTION_SPATIALLY_INFERRED_PROVISIONAL".to_string(),
                "system".to_string()
            )
        ]
    );
    assert!(count_valid_chain(&owner, &id).await);
    assert_eq!(
        count(&owner, "SELECT count(*) FROM idempotency_records").await,
        1
    );

    // the new record is readable through the read pool and its dossier opens (PAGE-02 link)
    let k = get(&s, &format!("/v1/kundalis/{id}")).await;
    assert_eq!(k.status, 200, "{}", k.body);
    assert_eq!(k.header("etag"), Some("\"1\""));

    // exact replay: same committed response, nothing written
    let again = post(&s, "/v1/issues", "citizen", "idem-submit-0001", &body).await;
    assert_eq!(again.status, 200);
    assert_eq!(again.json()["data"], *d);
    assert_eq!(
        count(&owner, "SELECT count(*) FROM issues").await,
        issues0 + 1
    );
    assert_eq!(
        count(&owner, "SELECT count(*) FROM lifecycle_events").await,
        events0 + 2
    );
    assert_eq!(
        count(&owner, "SELECT count(*) FROM idempotency_records").await,
        1
    );

    // same key, changed payload: a conflict, and still nothing written
    let changed = submit_body("A different title for the same key");
    let c = post(&s, "/v1/issues", "citizen", "idem-submit-0001", &changed).await;
    let p = assert_problem(&c, 409);
    assert!(p["detail"].as_str().unwrap().contains("Idempotency-Key"));
    assert_eq!(
        count(&owner, "SELECT count(*) FROM issues").await,
        issues0 + 1
    );

    // the key is scoped by simulated persona: the same key as another eligible persona is a separate request
    let other = post(&s, "/v1/issues", "authority", "idem-submit-0001", &body).await;
    assert_eq!(other.status, 200);
    assert_ne!(other.json()["data"]["id"], d["id"]);
}

async fn count_valid_chain(owner: &PgPool, id: &str) -> bool {
    sqlx::query_scalar("SELECT lifecycle_chain_is_valid($1)")
        .bind(id)
        .fetch_one(owner)
        .await
        .unwrap()
}

#[tokio::test]
async fn concurrent_requests_with_one_key_produce_one_logical_mutation() {
    let _f = Fixture::new().await;
    let s = Arc::new(start().await);
    let owner = owner_pool().await;
    let issues0 = count(&owner, "SELECT count(*) FROM issues").await;
    let body = submit_body("Concurrent replay probe");
    let mut handles = Vec::new();
    for _ in 0..6 {
        let s = s.clone();
        let body = body.clone();
        handles.push(tokio::spawn(async move {
            post(&s, "/v1/issues", "citizen", "idem-concurrent-1", &body).await
        }));
    }
    let mut ids = std::collections::BTreeSet::new();
    for h in handles {
        let r = h.await.unwrap();
        assert_eq!(r.status, 200, "{}", r.body);
        ids.insert(r.json()["data"]["id"].as_str().unwrap().to_string());
    }
    assert_eq!(
        ids.len(),
        1,
        "every concurrent request returns the same committed record"
    );
    assert_eq!(
        count(&owner, "SELECT count(*) FROM issues").await,
        issues0 + 1
    );
    assert_eq!(
        count(&owner, "SELECT count(*) FROM idempotency_records").await,
        1
    );
    assert_eq!(
        count(
            &owner,
            "SELECT count(*) FROM lifecycle_events WHERE entity_id LIKE 'SYN-DEMO-KND-R%'"
        )
        .await,
        2
    );
}

#[tokio::test]
async fn a_failed_event_insert_rolls_back_the_whole_report() {
    let _f = Fixture::new().await;
    let s = start().await;
    let owner = owner_pool().await;
    // Pre-occupy the event id the command is about to use, under an unrelated entity, so the event insert fails.
    let scope = Scope {
        operation: Operation::SubmitIssue,
        persona: Persona::Citizen,
        idempotency_key: "idem-rollback-01".into(),
    };
    let suffix = scope.suffix();
    sqlx::query(
        "INSERT INTO lifecycle_events (id, record_nature, source_tier, record_version, updated_at, entity_id, sequence, \
            event_type, actor_role, occurred_at, summary, previous_hash, payload_hash) \
         VALUES ($1, 'SYNTHETIC_DEMONSTRATION', 'SYNTHETIC_DEMO', 1, now(), 'SYN-DEMO-TEST-BLOCKER', 1, 'TEST_BLOCKER', 'system', \
            '2026-11-20T00:00:00Z', 'blocker', NULL, lifecycle_event_hash('SYN-DEMO-TEST-BLOCKER', 1, 'TEST_BLOCKER', \
            '2026-11-20T00:00:00Z'::timestamptz, 'system', 'blocker', NULL))",
    )
    .bind(format!("SYN-DEMO-EVT-KND-R{suffix}-001"))
    .execute(&owner)
    .await
    .unwrap();
    let issues0 = count(&owner, "SELECT count(*) FROM issues").await;
    let r = post(
        &s,
        "/v1/issues",
        "citizen",
        "idem-rollback-01",
        &submit_body("Rollback probe"),
    )
    .await;
    assert_problem(&r, 409);
    assert_eq!(
        count(&owner, "SELECT count(*) FROM issues").await,
        issues0,
        "the report rolled back"
    );
    assert_eq!(
        count(
            &owner,
            "SELECT count(*) FROM jurisdictions WHERE id LIKE 'SYN-DEMO-JUR-R%'"
        )
        .await,
        0
    );
    assert_eq!(
        count(&owner, "SELECT count(*) FROM idempotency_records").await,
        0
    );
}

#[tokio::test]
async fn malformed_and_invalid_submissions_return_contract_problems_without_writing() {
    let _f = Fixture::new().await;
    let s = start().await;
    let owner = owner_pool().await;
    let issues0 = count(&owner, "SELECT count(*) FROM issues").await;
    let good = submit_body("Validation probe");
    let hdr = |key: &'static str| -> Vec<(&'static str, &'static str)> {
        vec![
            ("Content-Type", "application/json"),
            ("X-Demo-Persona", "citizen"),
            ("Idempotency-Key", key),
            ("X-Correlation-Id", "p5-test-corr-0002"),
        ]
    };
    // 400: malformed
    for (name, mut h, b) in [
        ("not json", hdr("idem-bad-0001"), "{not json".to_string()),
        (
            "missing member",
            hdr("idem-bad-0002"),
            json!({"recordVersion": 1}).to_string(),
        ),
        ("unknown member", hdr("idem-bad-0003"), {
            let mut v = good.clone();
            v["payload"]["secretField"] = json!("x");
            v.to_string()
        }),
        ("bad enum", hdr("idem-bad-0004"), {
            let mut v = good.clone();
            v["payload"]["category"] = json!("ROADWORKS");
            v.to_string()
        }),
        ("swapped coordinates", hdr("idem-bad-0005"), {
            let mut v = good.clone();
            v["payload"]["geometry"]["coordinates"] = json!([19.11974, 72.83158]);
            v.to_string()
        }),
        ("oversize body", hdr("idem-bad-0006"), "x".repeat(40_000)),
    ] {
        let _ = &mut h;
        let r = request(s.addr, "POST", "/v1/issues", &h, Some(&b)).await;
        assert_problem(&r, 400);
        let _ = name;
    }
    let no_key = request(
        s.addr,
        "POST",
        "/v1/issues",
        &[
            ("Content-Type", "application/json"),
            ("X-Demo-Persona", "citizen"),
        ],
        Some(&good.to_string()),
    )
    .await;
    assert_problem(&no_key, 400);
    let short_key = post(&s, "/v1/issues", "citizen", "short", &good).await;
    assert_problem(&short_key, 400);
    let bad_persona = post(&s, "/v1/issues", "root", "idem-bad-persona", &good).await;
    assert_problem(&bad_persona, 400);
    let text = request(
        s.addr,
        "POST",
        "/v1/issues",
        &[
            ("Content-Type", "text/plain"),
            ("X-Demo-Persona", "citizen"),
            ("Idempotency-Key", "idem-bad-0007"),
        ],
        Some("hello"),
    )
    .await;
    assert_problem(&text, 400);
    let with_query = request(
        s.addr,
        "POST",
        "/v1/issues?x=1",
        &[
            ("Content-Type", "application/json"),
            ("X-Demo-Persona", "citizen"),
            ("Idempotency-Key", "idem-bad-0008"),
        ],
        Some(&good.to_string()),
    )
    .await;
    assert_problem(&with_query, 400);

    // 422: value rules and workflow eligibility
    let mut long = good.clone();
    long["payload"]["title"] = json!("t".repeat(161));
    assert_problem(
        &post(&s, "/v1/issues", "citizen", "idem-422-0001", &long).await,
        422,
    );
    let mut ctrl = good.clone();
    ctrl["payload"]["publicDescription"] = json!("bell\u{7}char");
    assert_problem(
        &post(&s, "/v1/issues", "citizen", "idem-422-0002", &ctrl).await,
        422,
    );
    let mut empty = good.clone();
    empty["payload"]["title"] = json!("   ");
    assert_problem(
        &post(&s, "/v1/issues", "citizen", "idem-422-0003", &empty).await,
        422,
    );
    let mut asset = good.clone();
    asset["payload"]["assetId"] = json!("SYN-DEMO-AST-NOPE");
    assert_problem(
        &post(&s, "/v1/issues", "citizen", "idem-422-0004", &asset).await,
        422,
    );
    let mut outside = good.clone();
    outside["payload"]["assetId"] = Value::Null;
    outside["payload"]["geometry"]["coordinates"] = json!([72.80, 19.20]);
    assert_problem(
        &post(&s, "/v1/issues", "citizen", "idem-422-0005", &outside).await,
        422,
    );
    let mut bowtie = good.clone();
    bowtie["payload"]["geometry"] = json!({"type": "Polygon", "coordinates": [[[72.831, 19.119], [72.833, 19.121], [72.833, 19.119], [72.831, 19.121], [72.831, 19.119]]]});
    assert_problem(
        &post(&s, "/v1/issues", "citizen", "idem-422-0006", &bowtie).await,
        422,
    );
    let mut zero = good.clone();
    zero["recordVersion"] = json!(0);
    assert_problem(
        &post(&s, "/v1/issues", "citizen", "idem-422-0007", &zero).await,
        422,
    );
    for persona in ["public", "moderator", "independent_reviewer", "demo_admin"] {
        assert_problem(
            &post(&s, "/v1/issues", persona, "idem-422-0008", &good).await,
            422,
        );
    }
    // 409: stale record version for a new report
    let mut stale = good.clone();
    stale["recordVersion"] = json!(2);
    assert_problem(
        &post(&s, "/v1/issues", "citizen", "idem-409-0001", &stale).await,
        409,
    );

    assert_eq!(
        count(&owner, "SELECT count(*) FROM issues").await,
        issues0,
        "no invalid request wrote anything"
    );
    assert_eq!(
        count(&owner, "SELECT count(*) FROM idempotency_records").await,
        0
    );

    // sanitized correlation id: an unsafe caller value is replaced by a generated one, and that one is returned
    let r = request(
        s.addr,
        "POST",
        "/v1/issues",
        &[
            ("Content-Type", "application/json"),
            ("X-Demo-Persona", "citizen"),
            ("Idempotency-Key", "idem-corr-0001"),
            ("X-Correlation-Id", "bad id with spaces"),
        ],
        Some("{}"),
    )
    .await;
    let p = assert_problem(&r, 400);
    assert_eq!(p["correlationId"].as_str().unwrap().len(), 36);
}

#[tokio::test]
async fn without_a_command_pool_writes_are_unavailable_but_reads_work() {
    let _f = Fixture::new().await;
    let s = serve(AppState::with_clock(read_pool().await, fixed(CLOCK))).await;
    let r = post(
        &s,
        "/v1/issues",
        "citizen",
        "idem-nocmd-001",
        &submit_body("No command pool"),
    )
    .await;
    assert_problem(&r, 503);
    assert_eq!(get(&s, "/v1/issues").await.status, 200);
}

// ------------------------------------------------------------------------------------------------ checkDuplicates

fn expected_scores(keywords: &[&str]) -> Vec<(String, u64, u64, u64, u64, u64)> {
    // Independent oracle for the seeded J2 subject SYN-DEMO-KND-002 (asset ROAD-001, POTHOLE), computed from the committed
    // policy JSON and the committed seed JSON (earlier reports only; KND-003, 005 and 006 are neither in radius nor on the asset).
    let p = policy();
    let w = &p["weights"];
    let wt = |k: &str| w[k].as_u64().unwrap();
    let window = p["categoryPolicies"]["POTHOLE"]["windowHours"]
        .as_f64()
        .unwrap();
    let radius = p["categoryPolicies"]["POTHOLE"]["radiusMeters"]
        .as_f64()
        .unwrap();
    let issues: Vec<Value> = serde_json::from_str(
        &std::fs::read_to_string(demo::default_seed_dir().join("issues.json")).unwrap(),
    )
    .unwrap();
    let subject = issues
        .iter()
        .find(|i| i["id"] == "SYN-DEMO-KND-002")
        .unwrap();
    let t = |v: &Value| OffsetDateTime::parse(v["reportedAt"].as_str().unwrap(), &Rfc3339).unwrap();
    let kw: std::collections::BTreeSet<String> =
        keywords.iter().map(|k| k.to_lowercase()).collect();
    let mut out = Vec::new();
    for c in issues.iter().filter(|i| i["id"] != "SYN-DEMO-KND-002") {
        if t(c) >= t(subject) {
            continue;
        }
        let same_asset = c["assetId"] == subject["assetId"];
        // distances (metres) for the two in-scope candidates are measured independently by PostGIS in a separate test;
        // here only radius membership matters: KND-001 is ~9.5 m away, KND-004 ~68 m away.
        let in_radius = c["id"] == "SYN-DEMO-KND-001";
        assert!(in_radius || c["id"] == "SYN-DEMO-KND-004" || !same_asset);
        if !(same_asset || in_radius) {
            continue;
        }
        let hours = (t(subject) - t(c)).as_seconds_f64().abs() / 3600.0;
        let text = format!(
            "{} {}",
            c["title"].as_str().unwrap(),
            c["publicDescription"].as_str().unwrap()
        )
        .to_lowercase();
        let tokens: std::collections::BTreeSet<String> = text
            .split(|ch: char| !ch.is_alphanumeric())
            .filter(|x| !x.is_empty())
            .map(str::to_string)
            .collect();
        let matched = kw.intersection(&tokens).count() as u64;
        let kp = if kw.is_empty() {
            0
        } else {
            wt("keywordOverlap") * matched / kw.len() as u64
        };
        let _ = radius;
        out.push((
            c["id"].as_str().unwrap().to_string(),
            if same_asset {
                wt("sameAssetOrSegment")
            } else {
                0
            },
            if c["category"] == "POTHOLE" {
                wt("sameCategory")
            } else {
                0
            },
            if in_radius {
                wt("withinConfiguredRadius")
            } else {
                0
            },
            if hours <= window {
                wt("withinConfiguredWindow")
            } else {
                0
            },
            kp,
        ));
    }
    out.sort_by(|a, b| {
        let sa = a.1 + a.2 + a.3 + a.4 + a.5;
        let sb = b.1 + b.2 + b.3 + b.4 + b.5;
        sb.cmp(&sa).then(a.0.cmp(&b.0))
    });
    out
}

#[tokio::test]
async fn the_seeded_k_west_candidate_is_measured_by_postgis_and_scored_deterministically_from_the_policy(
) {
    let _f = Fixture::new().await;
    let s = start().await;
    let owner = owner_pool().await;

    // PostGIS geography distance between the two seeded potholes, against the committed POTHOLE radius.
    let d: f64 = sqlx::query_scalar(
        "SELECT ST_Distance(a.geometry::geography, b.geometry::geography)::float8 FROM issues a, issues b \
         WHERE a.id = 'SYN-DEMO-KND-001' AND b.id = 'SYN-DEMO-KND-002'",
    )
    .fetch_one(&owner)
    .await
    .unwrap();
    assert!((d - 9.513).abs() < 0.01, "measured {d} m");
    let radius = policy()["categoryPolicies"]["POTHOLE"]["radiusMeters"]
        .as_f64()
        .unwrap();
    assert!(d <= radius);
    let d4: f64 = sqlx::query_scalar(
        "SELECT ST_Distance(a.geometry::geography, b.geometry::geography)::float8 FROM issues a, issues b \
         WHERE a.id = 'SYN-DEMO-KND-004' AND b.id = 'SYN-DEMO-KND-002'",
    )
    .fetch_one(&owner)
    .await
    .unwrap();
    assert!(
        d4 > radius,
        "KND-004 is outside the radius ({d4} m) and only matches by asset"
    );

    let kws = ["pothole", "paliram", "junction"];
    let r = post(
        &s,
        "/v1/issues/SYN-DEMO-KND-002/duplicate-candidates",
        "citizen",
        "idem-check-0001",
        &check_body(1, &kws),
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.body);
    assert!(
        r.header("etag").is_none(),
        "DuplicateCandidatesOk declares no ETag"
    );
    let j = r.json();
    let data = &j["data"];
    assert_eq!(data["policyLabel"], "DEMONSTRATION_HEURISTIC_V1");
    assert_eq!(data["silentRejection"], false);
    assert_eq!(data["choices"], policy()["choices"]);
    let expected = expected_scores(&kws);
    assert_eq!(
        expected.len(),
        2,
        "KND-001 (9.5 m, same asset) and KND-004 (same asset)"
    );
    let cands = data["candidates"].as_array().unwrap();
    assert_eq!(cands.len(), expected.len());
    let bands = &policy()["thresholds"];
    for (c, e) in cands.iter().zip(&expected) {
        assert_eq!(c["issueId"], e.0.as_str());
        let b = &c["breakdown"];
        assert_eq!(
            (
                b["sameAssetOrSegment"].as_u64().unwrap(),
                b["sameCategory"].as_u64().unwrap(),
                b["withinConfiguredRadius"].as_u64().unwrap(),
                b["withinConfiguredWindow"].as_u64().unwrap(),
                b["keywordOverlap"].as_u64().unwrap()
            ),
            (e.1, e.2, e.3, e.4, e.5),
            "{}",
            e.0
        );
        let total = e.1 + e.2 + e.3 + e.4 + e.5;
        assert_eq!(c["score"], total);
        let lo = bands["likelySame"][0].as_u64().unwrap();
        let mid = bands["possible"][0].as_u64().unwrap();
        let band = if total >= lo {
            "LIKELY_SAME"
        } else if total >= mid {
            "POSSIBLE_MATCH"
        } else {
            "PROBABLY_DISTINCT"
        };
        assert_eq!(c["band"], band);
        assert_eq!(c["possibleRecurrence"], false);
    }
    // the subject never appears among its own candidates, and the out-of-radius scale-preview issues are excluded
    let ids: Vec<&str> = cands
        .iter()
        .map(|c| c["issueId"].as_str().unwrap())
        .collect();
    assert!(
        !ids.contains(&"SYN-DEMO-KND-002")
            && !ids.contains(&"SYN-DEMO-KND-005")
            && !ids.contains(&"SYN-DEMO-KND-006")
    );
    assert_eq!(ids[0], "SYN-DEMO-KND-001");

    // identical baseline and clock -> identical output (a second key appends its own event but the result is the same)
    let again = post(
        &s,
        "/v1/issues/SYN-DEMO-KND-002/duplicate-candidates",
        "citizen",
        "idem-check-0002",
        &check_body(1, &kws),
    )
    .await;
    assert_eq!(again.json()["data"], *data);
    // one DUPLICATE_CHECK_EVALUATED event per fresh check, none for the exact replay
    let evt0 = count(&owner, "SELECT count(*) FROM lifecycle_events WHERE entity_id='SYN-DEMO-KND-002' AND event_type='DUPLICATE_CHECK_EVALUATED'").await;
    assert_eq!(evt0, 2);
    let replay = post(
        &s,
        "/v1/issues/SYN-DEMO-KND-002/duplicate-candidates",
        "citizen",
        "idem-check-0001",
        &check_body(1, &kws),
    )
    .await;
    assert_eq!(replay.json()["data"], *data);
    assert_eq!(
        count(&owner, "SELECT count(*) FROM lifecycle_events WHERE entity_id='SYN-DEMO-KND-002' AND event_type='DUPLICATE_CHECK_EVALUATED'").await,
        evt0
    );
    assert!(count_valid_chain(&owner, "SYN-DEMO-KND-002").await);
    // same key with a different body is a conflict
    let conflict = post(
        &s,
        "/v1/issues/SYN-DEMO-KND-002/duplicate-candidates",
        "citizen",
        "idem-check-0001",
        &check_body(1, &["other"]),
    )
    .await;
    assert_problem(&conflict, 409);
    // keyword order and case do not change the canonical request, so they replay
    let reordered = post(
        &s,
        "/v1/issues/SYN-DEMO-KND-002/duplicate-candidates",
        "citizen",
        "idem-check-0001",
        &check_body(1, &["JUNCTION", "Pothole", "paliram"]),
    )
    .await;
    assert_eq!(reordered.status, 200);
}

#[tokio::test]
async fn ineligible_and_missing_subjects_and_resolved_matches_are_handled() {
    let _f = Fixture::new().await;
    let s = start().await;
    let owner = owner_pool().await;
    // a resolved match is surfaced as a possible recurrence, still scored, never merged
    sqlx::query("UPDATE issues SET status = 'VERIFIED_COMPLETE' WHERE id = 'SYN-DEMO-KND-004'")
        .execute(&owner)
        .await
        .unwrap();
    let r = post(
        &s,
        "/v1/issues/SYN-DEMO-KND-002/duplicate-candidates",
        "citizen",
        "idem-recur-0001",
        &check_body(1, &[]),
    )
    .await;
    let cands = r.json()["data"]["candidates"].clone();
    let kn4 = cands
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["issueId"] == "SYN-DEMO-KND-004")
        .unwrap();
    assert_eq!(kn4["possibleRecurrence"], true);
    assert_eq!(
        cands
            .as_array()
            .unwrap()
            .iter()
            .filter(|c| c["possibleRecurrence"] == true)
            .count(),
        1
    );
    // missing subject
    let nf = post(
        &s,
        "/v1/issues/SYN-DEMO-KND-999/duplicate-candidates",
        "citizen",
        "idem-missing-01",
        &check_body(1, &[]),
    )
    .await;
    assert_problem(&nf, 404);
    // stale version
    let stale = post(
        &s,
        "/v1/issues/SYN-DEMO-KND-002/duplicate-candidates",
        "citizen",
        "idem-stale-0001",
        &check_body(7, &[]),
    )
    .await;
    assert_problem(&stale, 409);
    // malformed identifier
    let bad = post(
        &s,
        "/v1/issues/not-an-id/duplicate-candidates",
        "citizen",
        "idem-badid-0001",
        &check_body(1, &[]),
    )
    .await;
    assert_problem(&bad, 400);
    // a category with no committed radius or window only matches on the shared asset and earns no radius or window points
    let mut drain = check_body(1, &[]);
    drain["payload"]["category"] = json!("DRAIN_BLOCKAGE");
    let r = post(
        &s,
        "/v1/issues/SYN-DEMO-KND-002/duplicate-candidates",
        "citizen",
        "idem-drain-0001",
        &drain,
    )
    .await;
    for c in r.json()["data"]["candidates"].as_array().unwrap() {
        assert_eq!(c["breakdown"]["withinConfiguredRadius"], 0);
        assert_eq!(c["breakdown"]["withinConfiguredWindow"], 0);
        assert_eq!(
            c["breakdown"]["sameCategory"], 0,
            "candidates are POTHOLE, the payload is DRAIN_BLOCKAGE"
        );
    }
    // the check never writes outside lifecycle/idempotency records
    assert_eq!(count(&owner, "SELECT count(*) FROM issues").await, 6);
}

#[tokio::test]
async fn a_new_report_scores_against_the_earlier_reports_and_ties_order_by_issue_id() {
    let _f = Fixture::new().await;
    let s = start().await;
    let a = post(
        &s,
        "/v1/issues",
        "citizen",
        "idem-new-report-A",
        &submit_body("First new report"),
    )
    .await
    .json();
    let id = a["data"]["id"].as_str().unwrap().to_string();
    let body = check_body(1, &["pothole", "paliram"]);
    let r = post(
        &s,
        &format!("/v1/issues/{id}/duplicate-candidates"),
        "citizen",
        "idem-new-check-A",
        &body,
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.body);
    let cands = r.json()["data"]["candidates"].as_array().unwrap().clone();
    let ids: Vec<&str> = cands
        .iter()
        .map(|c| c["issueId"].as_str().unwrap())
        .collect();
    assert!(
        ids.contains(&"SYN-DEMO-KND-002") && ids.contains(&"SYN-DEMO-KND-001"),
        "{ids:?}"
    );
    // deterministic order: score descending, then id ascending
    let mut sorted = cands.clone();
    sorted.sort_by(|x, y| {
        y["score"]
            .as_u64()
            .cmp(&x["score"].as_u64())
            .then(x["issueId"].as_str().cmp(&y["issueId"].as_str()))
    });
    assert_eq!(cands, sorted);
    // a later report never appears as a candidate of an earlier one
    let r2 = post(
        &s,
        "/v1/issues/SYN-DEMO-KND-002/duplicate-candidates",
        "citizen",
        "idem-new-check-B",
        &check_body(1, &["pothole"]),
    )
    .await;
    let later: Vec<String> = r2.json()["data"]["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["issueId"].as_str().unwrap().to_string())
        .collect();
    assert!(!later.contains(&id));
}

// --------------------------------------------------------------------------------------------------------- addEvidence

#[tokio::test]
async fn the_duplicate_decision_is_recorded_as_fixture_evidence_with_a_lifecycle_event_and_replays()
{
    let _f = Fixture::new().await;
    let s = start().await;
    let owner = owner_pool().await;
    let media = "fixtures/evidence/SYN-DEMO-EVD-CITIZEN-P5A1.svg";
    let body = evidence_body(1, media, json!("ENDORSE_EXISTING"));
    let r = post(
        &s,
        "/v1/issues/SYN-DEMO-KND-001/evidence",
        "citizen",
        "idem-evid-0001",
        &body,
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(r.header("etag"), Some("\"1\""));
    let d = r.json()["data"].clone();
    assert_eq!(d["issueId"], "SYN-DEMO-KND-001");
    assert_eq!(d["processingState"], "UPLOADED_QUARANTINE");
    assert_eq!(d["verificationState"], "NOT_VERIFIED");
    assert_eq!(d["confidence"], "CITIZEN_SUBMITTED");
    assert_eq!(d["locationConfidence"], "LOCATION_UNVERIFIED");
    assert_eq!(d["distanceToAssetMeters"], Value::Null);
    assert_eq!(d["mediaStatus"], "SYNTHETIC_FIXTURE_REFERENCE_ONLY");
    assert_eq!(d["hashBasis"], "FIXTURE_REFERENCE_STRING");
    assert!(d["caveat"]
        .as_str()
        .unwrap()
        .contains("does not establish authenticity"));
    let ev: (i32, String) = sqlx::query_as(
        "SELECT sequence, event_type FROM lifecycle_events WHERE entity_id = 'SYN-DEMO-KND-001' ORDER BY sequence DESC LIMIT 1",
    )
    .fetch_one(&owner)
    .await
    .unwrap();
    assert_eq!(ev, (10, "DUPLICATE_ENDORSED_EXISTING".to_string()));
    assert!(count_valid_chain(&owner, "SYN-DEMO-KND-001").await);
    let n = count(&owner, "SELECT count(*) FROM evidence").await;
    assert_eq!(n, 4);
    // exact replay returns the committed record and writes nothing
    let again = post(
        &s,
        "/v1/issues/SYN-DEMO-KND-001/evidence",
        "citizen",
        "idem-evid-0001",
        &body,
    )
    .await;
    assert_eq!(again.json()["data"], d);
    assert_eq!(count(&owner, "SELECT count(*) FROM evidence").await, n);
    // same key, changed payload
    let changed = evidence_body(1, media, json!("ADD_EVIDENCE_TO_EXISTING"));
    assert_problem(
        &post(
            &s,
            "/v1/issues/SYN-DEMO-KND-001/evidence",
            "citizen",
            "idem-evid-0001",
            &changed,
        )
        .await,
        409,
    );
    // the same media reference under another key is a collision, not a second record
    assert_problem(
        &post(
            &s,
            "/v1/issues/SYN-DEMO-KND-001/evidence",
            "citizen",
            "idem-evid-0002",
            &body,
        )
        .await,
        409,
    );
    assert_eq!(count(&owner, "SELECT count(*) FROM evidence").await, n);
    // the Kundali now lists the evidence (PAGE-02 reflects the committed record)
    let k = get(&s, "/v1/kundalis/SYN-DEMO-KND-001").await.json();
    assert!(k["data"]["evidence"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["id"] == d["id"]));
}

#[tokio::test]
async fn evidence_rules_are_validated_and_a_failed_event_insert_rolls_the_evidence_back() {
    let _f = Fixture::new().await;
    let s = start().await;
    let owner = owner_pool().await;
    let media = "fixtures/evidence/SYN-DEMO-EVD-CITIZEN-P5B2.svg";
    let good = evidence_body(1, media, Value::Null);
    let path = "/v1/issues/SYN-DEMO-KND-002/evidence";
    // eligibility
    for persona in [
        "public",
        "authority",
        "moderator",
        "independent_reviewer",
        "demo_admin",
    ] {
        assert_problem(
            &post(&s, path, persona, "idem-evrule-0001", &good).await,
            422,
        );
    }
    // sha256 must be the hash of the reference string; nothing implies the image is authentic
    let mut bad_hash = good.clone();
    bad_hash["payload"]["sha256"] = json!("a".repeat(64));
    assert_problem(
        &post(&s, path, "citizen", "idem-evrule-0002", &bad_hash).await,
        422,
    );
    // only citizen fixtures at BEFORE / DISPUTED_OR_RECURRING
    for (k, v) in [
        ("stage", "CLAIMED_AFTER"),
        ("sourceType", "AUTHORITY_FIXTURE"),
        ("sourceType", "INDEPENDENT_FIXTURE"),
    ] {
        let mut b = good.clone();
        b["payload"][k] = json!(v);
        assert_problem(
            &post(&s, path, "citizen", "idem-evrule-0003", &b).await,
            422,
        );
    }
    // non-fixture media references and malformed hashes are structural/validation errors
    for bad in [
        "https://example.com/a.svg",
        "fixtures/evidence/../x.svg",
        "fixtures/evidence/SYN-DEMO-evd.svg",
    ] {
        let mut b = good.clone();
        b["payload"]["mediaRef"] = json!(bad);
        let r = post(&s, path, "citizen", "idem-evrule-0004", &b).await;
        assert!(r.status == 400 || r.status == 422, "{bad}: {}", r.status);
        assert_eq!(r.header("content-type"), Some("application/problem+json"));
    }
    // unknown issue, stale version, bad identifier
    assert_problem(
        &post(
            &s,
            "/v1/issues/SYN-DEMO-KND-999/evidence",
            "citizen",
            "idem-evrule-0005",
            &good,
        )
        .await,
        404,
    );
    let mut stale = good.clone();
    stale["recordVersion"] = json!(3);
    assert_problem(
        &post(&s, path, "citizen", "idem-evrule-0006", &stale).await,
        409,
    );
    assert_problem(
        &post(
            &s,
            "/v1/issues/lower-case/evidence",
            "citizen",
            "idem-evrule-0007",
            &good,
        )
        .await,
        400,
    );
    assert_eq!(
        count(&owner, "SELECT count(*) FROM evidence").await,
        3,
        "no rejected request wrote evidence"
    );

    // atomicity: occupy the event id the command will use for KND-002's next chain position, then submit
    sqlx::query(
        "INSERT INTO lifecycle_events (id, record_nature, source_tier, record_version, updated_at, entity_id, sequence, \
            event_type, actor_role, occurred_at, summary, previous_hash, payload_hash) \
         VALUES ('SYN-DEMO-EVT-KND-002-002', 'SYNTHETIC_DEMONSTRATION', 'SYNTHETIC_DEMO', 1, now(), 'SYN-DEMO-TEST-BLOCKER', 1, \
            'TEST_BLOCKER', 'system', '2026-11-20T00:00:00Z', 'blocker', NULL, lifecycle_event_hash('SYN-DEMO-TEST-BLOCKER', 1, \
            'TEST_BLOCKER', '2026-11-20T00:00:00Z'::timestamptz, 'system', 'blocker', NULL))",
    )
    .execute(&owner)
    .await
    .unwrap();
    let r = post(&s, path, "citizen", "idem-evrule-0008", &good).await;
    assert_problem(&r, 409);
    assert_eq!(
        count(&owner, "SELECT count(*) FROM evidence").await,
        3,
        "the evidence insert rolled back with the failed event"
    );
    assert_eq!(
        count(&owner, "SELECT count(*) FROM idempotency_records").await,
        0
    );
    assert!(count_valid_chain(&owner, "SYN-DEMO-KND-002").await);
}

// -------------------------------------------------------------------------------------------- contract surface and CORS

#[tokio::test]
async fn only_the_three_confirmed_p5_commands_are_added_and_every_other_write_is_absent() {
    let _f = Fixture::new().await;
    let s = start().await;
    let owner = owner_pool().await;
    let before = demo::baseline_digest(&owner).await.unwrap();
    for (method, path) in [
        ("POST", "/v1/demo/reset"),
        (
            "POST",
            "/v1/authority/issues/SYN-DEMO-KND-001/completion-claim",
        ),
        ("POST", "/v1/issues/SYN-DEMO-KND-001/verification"),
        ("POST", "/v1/records/SYN-DEMO-KND-001/corrections"),
        ("POST", "/v1/corrections/SYN-DEMO-COR-001/decision"),
        ("POST", "/v1/corrections/SYN-DEMO-COR-001/appeal"),
        ("PUT", "/v1/issues"),
        ("DELETE", "/v1/issues/SYN-DEMO-KND-001"),
        ("PATCH", "/v1/issues/SYN-DEMO-KND-001/evidence"),
        ("GET", "/v1/issues/SYN-DEMO-KND-001/evidence"),
        ("GET", "/v1/issues/SYN-DEMO-KND-001/duplicate-candidates"),
    ] {
        let r = request(s.addr, method, path, &[("Content-Length", "0")], None).await;
        assert!(
            r.status == 404 || r.status == 405,
            "{method} {path} -> {}",
            r.status
        );
        assert_eq!(r.header("content-type"), Some("application/problem+json"));
    }
    assert_eq!(demo::baseline_digest(&owner).await.unwrap(), before);
    // the OpenAPI inventory is unchanged: 23 operations, 22 paths
    let yaml =
        std::fs::read_to_string(demo::workspace_root().join("openapi/openapi.yaml")).unwrap();
    assert_eq!(
        yaml.lines()
            .filter(|l| l.trim_start().starts_with("operationId: "))
            .count(),
        23
    );
}

#[tokio::test]
async fn cors_preflight_allows_exactly_the_p5_command_headers_and_exposes_etag() {
    let _f = Fixture::new().await;
    let s = start().await;
    let pre = request(
        s.addr,
        "OPTIONS",
        "/v1/issues",
        &[
            ("Origin", ORIGIN),
            ("Access-Control-Request-Method", "POST"),
            (
                "Access-Control-Request-Headers",
                "content-type,x-correlation-id,x-demo-persona,idempotency-key",
            ),
        ],
        None,
    )
    .await;
    assert!(pre.status == 200 || pre.status == 204);
    assert_eq!(pre.header("access-control-allow-origin"), Some(ORIGIN));
    assert!(pre
        .header("access-control-allow-methods")
        .unwrap()
        .contains("POST"));
    let allowed = pre
        .header("access-control-allow-headers")
        .unwrap()
        .to_lowercase();
    assert!(
        allowed.contains("idempotency-key")
            // P6: If-Match is now allowed because resolveJurisdiction declares it; a wildcard is still refused
            && allowed.contains("if-match")
            && !allowed.contains('*')
    );
    let bad = request(
        s.addr,
        "OPTIONS",
        "/v1/issues",
        &[
            ("Origin", "http://evil.example"),
            ("Access-Control-Request-Method", "POST"),
        ],
        None,
    )
    .await;
    assert!(bad.header("access-control-allow-origin").is_none());
    let ok = request(
        s.addr,
        "POST",
        "/v1/issues",
        &[
            ("Origin", ORIGIN),
            ("Content-Type", "application/json"),
            ("X-Demo-Persona", "citizen"),
            ("Idempotency-Key", "idem-cors-0001"),
        ],
        Some(&submit_body("CORS probe").to_string()),
    )
    .await;
    assert_eq!(ok.status, 200);
    let expose = ok
        .header("access-control-expose-headers")
        .unwrap()
        .to_lowercase();
    assert!(expose.contains("etag") && expose.contains("x-correlation-id"));
}
