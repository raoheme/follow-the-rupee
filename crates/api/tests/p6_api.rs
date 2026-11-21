//! P6 integration tests: the real Axum router on a real loopback socket, using the read identity (`mcl_api` -> `mcl_app`,
//! read-only) for the two authority reads and the command identity (`mcl_api_write` -> `mcl_command`) for the two authority
//! commands, against the real `civic_lens` PostGIS database.
//!
//! The tests mutate the synthetic demonstration database, so they are serialised behind one lock and restore the accepted CP-00
//! baseline at the start of every test and again when each test ends (even on panic), through the guarded
//! `demo::reset_and_seed` (marked `civic_lens` on a local host only) with the owner credential that exists only in this test
//! process. DLP evaluation always uses an explicit, injected instant. Expected results come from the committed seeds and state
//! machine, not from the server's own output.
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
const CID: &str = "p6-test-corr-0001";

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
    let (db, marker): (String, i64) = sqlx::query_as(
        "SELECT current_database()::text, (SELECT count(*) FROM synthetic_demo_marker \
         WHERE id = 'SYN-DEMO-MARKER' AND database_name = current_database())",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
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

async fn start_at(instant: &str) -> Server {
    serve(AppState::with_clock(read_pool().await, fixed(instant)).with_command_pool(command_pool()))
        .await
}

async fn start() -> Server {
    start_at(CLOCK).await
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

/// A simulated-persona GET. `None` sends no persona header at all.
async fn get_as(s: &Server, path: &str, persona: Option<&str>) -> Resp {
    let mut h: Vec<(&str, &str)> = vec![("X-Correlation-Id", CID)];
    if let Some(p) = persona {
        h.push(("X-Demo-Persona", p));
    }
    request(s.addr, "GET", path, &h, None).await
}

async fn get(s: &Server, path: &str) -> Resp {
    request(s.addr, "GET", path, &[], None).await
}

async fn post_raw(
    s: &Server,
    path: &str,
    persona: Option<&str>,
    key: Option<&str>,
    if_match: Option<&str>,
    body: &str,
) -> Resp {
    let mut h: Vec<(&str, &str)> = vec![
        ("Content-Type", "application/json"),
        ("X-Correlation-Id", CID),
    ];
    if let Some(p) = persona {
        h.push(("X-Demo-Persona", p));
    }
    if let Some(k) = key {
        h.push(("Idempotency-Key", k));
    }
    if let Some(m) = if_match {
        h.push(("If-Match", m));
    }
    request(s.addr, "POST", path, &h, Some(body)).await
}

/// `resolveJurisdiction` as the authority persona with the matching quoted `If-Match`.
async fn resolve(s: &Server, issue: &str, key: &str, body: &Value) -> Resp {
    let v = body["recordVersion"].as_i64().unwrap();
    post_raw(
        s,
        &format!("/v1/authority/issues/{issue}/jurisdiction"),
        Some("authority"),
        Some(key),
        Some(&format!("\"{v}\"")),
        &body.to_string(),
    )
    .await
}

async fn link(s: &Server, issue: &str, key: &str, body: &Value) -> Resp {
    post_raw(
        s,
        &format!("/v1/authority/issues/{issue}/work-link"),
        Some("authority"),
        Some(key),
        None,
        &body.to_string(),
    )
    .await
}

fn resolve_body(version: u32, target: &str, label: Value, rationale: &str) -> Value {
    json!({"recordVersion": version, "payload": {
        "targetStatus": target, "externalAgencyLabel": label, "rationale": rationale
    }})
}

fn link_body(version: u32, work: &str, rationale: &str) -> Value {
    json!({"recordVersion": version, "payload": {"workOrderId": work, "rationale": rationale}})
}

const AGENCY: &str = "Synthetic metro-corridor agency placeholder";

async fn count(pool: &PgPool, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

async fn chain_valid(owner: &PgPool, id: &str) -> bool {
    sqlx::query_scalar("SELECT lifecycle_chain_is_valid($1)")
        .bind(id)
        .fetch_one(owner)
        .await
        .unwrap()
}

async fn digest(owner: &PgPool) -> String {
    demo::baseline_digest(owner).await.unwrap()
}

async fn events(owner: &PgPool, entity: &str) -> Vec<(i32, String, String, String, String)> {
    sqlx::query_as(
        "SELECT sequence, event_type, actor_role, summary, payload_hash FROM lifecycle_events \
         WHERE entity_id = $1 ORDER BY sequence",
    )
    .bind(entity)
    .fetch_all(owner)
    .await
    .unwrap()
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
        "update jurisdictions",
        "sqlx",
        "postgres",
        "mcl_api_write",
        "mcl_command",
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

fn ids(v: &Value) -> Vec<String> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_str().unwrap().to_string())
        .collect()
}

// ------------------------------------------------------------------------------------------ contract inventory (unchanged)

#[tokio::test]
async fn the_contract_inventory_is_unchanged_and_the_four_p6_operations_match_it() {
    let yaml =
        std::fs::read_to_string(demo::workspace_root().join("openapi/openapi.yaml")).unwrap();
    let ops: Vec<&str> = yaml
        .lines()
        .filter_map(|l| l.trim_start().strip_prefix("operationId: "))
        .collect();
    assert_eq!(ops.len(), 23, "23 operations");
    let paths = yaml
        .split("\npaths:\n")
        .nth(1)
        .unwrap()
        .lines()
        .filter(|l| l.starts_with("  /") && l.ends_with(':'))
        .count();
    assert_eq!(paths, 22, "22 paths");
    for op in [
        "getAuthorityDashboard",
        "resolveJurisdiction",
        "linkWork",
        "listDlpExceptions",
    ] {
        assert!(ops.contains(&op), "{op}");
    }
    for (path, method, op) in [
        ("/v1/authority/dashboard", "get", "getAuthorityDashboard"),
        (
            "/v1/authority/issues/{id}/jurisdiction",
            "post",
            "resolveJurisdiction",
        ),
        ("/v1/authority/issues/{id}/work-link", "post", "linkWork"),
        ("/v1/authority/dlp-exceptions", "get", "listDlpExceptions"),
    ] {
        let block = yaml
            .split(&format!("\n  {path}:\n"))
            .nth(1)
            .unwrap_or_else(|| panic!("{path} is in the contract"));
        let block = block.split("\n  /").next().unwrap();
        assert!(
            block.contains(&format!("    {method}:\n      operationId: {op}")),
            "{path} {method} {op}"
        );
    }
    // jurisdiction declares If-Match; work-link does not (so the API must not require it there)
    let jur = yaml
        .split("\n  /v1/authority/issues/{id}/jurisdiction:\n")
        .nth(1)
        .unwrap()
        .split("\n  /")
        .next()
        .unwrap();
    assert!(jur.contains("components/parameters/IfMatch"));
    let wl = yaml
        .split("\n  /v1/authority/issues/{id}/work-link:\n")
        .nth(1)
        .unwrap()
        .split("\n  /")
        .next()
        .unwrap();
    assert!(!wl.contains("IfMatch"));
}

// ---------------------------------------------------------------------------------------------------- persona gate (401/403)

#[tokio::test]
async fn the_authority_family_answers_401_for_a_missing_or_unknown_persona_and_403_for_any_other_persona(
) {
    let _f = Fixture::new().await;
    let s = start().await;
    let owner = owner_pool().await;
    let before = digest(&owner).await;
    let jur = "/v1/authority/issues/SYN-DEMO-KND-003/jurisdiction";
    let wl = "/v1/authority/issues/SYN-DEMO-KND-004/work-link";
    let jb = resolve_body(
        1,
        "EXTERNAL_AGENCY_ASSIGNED",
        json!(AGENCY),
        "Corridor review.",
    )
    .to_string();
    let lb = link_body(1, "SYN-DEMO-WO-001", "Same segment.").to_string();

    for path in ["/v1/authority/dashboard", "/v1/authority/dlp-exceptions"] {
        for bad in [
            None,
            Some("root"),
            Some(""),
            Some("AUTHORITY"),
            Some("system"),
        ] {
            let r = get_as(&s, path, bad).await;
            let p = assert_problem(&r, 401);
            assert_eq!(p["correlationId"], CID, "correlation id is echoed: {path}");
        }
        for other in [
            "public",
            "citizen",
            "moderator",
            "independent_reviewer",
            "demo_admin",
        ] {
            assert_problem(&get_as(&s, path, Some(other)).await, 403);
        }
        assert_eq!(get_as(&s, path, Some("authority")).await.status, 200);
    }
    for (path, body, if_match) in [(jur, &jb, Some("\"1\"")), (wl, &lb, None)] {
        for bad in [None, Some("root"), Some("Authority")] {
            let r = post_raw(&s, path, bad, Some("idem-gate-000001"), if_match, body).await;
            assert_problem(&r, 401);
        }
        for other in [
            "public",
            "citizen",
            "moderator",
            "independent_reviewer",
            "demo_admin",
        ] {
            let r = post_raw(
                &s,
                path,
                Some(other),
                Some("idem-gate-000002"),
                if_match,
                body,
            )
            .await;
            assert_problem(&r, 403);
        }
    }
    assert_eq!(digest(&owner).await, before, "no refusal wrote anything");
    assert_eq!(
        count(&owner, "SELECT count(*) FROM idempotency_records").await,
        0
    );
}

// ----------------------------------------------------------------------------------------------- dashboard and DLP reads

#[tokio::test]
async fn the_dashboard_queues_come_from_the_committed_seed_at_one_explicit_instant() {
    let _f = Fixture::new().await;
    let s = start().await;
    let r = get_as(&s, "/v1/authority/dashboard", Some("authority")).await;
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(r.header("cache-control"), Some("no-store"));
    assert_eq!(r.header("x-correlation-id"), Some(CID));
    let j = r.json();
    assert_eq!(j["correlationId"], CID);
    let d = &j["data"];
    assert_eq!(d["asOf"], CLOCK);
    assert_eq!(d["openIssueCount"], 6);
    assert_eq!(
        ids(&d["awaitingVerificationIssueIds"]),
        ["SYN-DEMO-KND-001"]
    );
    // KND-001 is confirmed by linkage; the other five remain provisional or disputed
    assert_eq!(
        ids(&d["uncertainJurisdictionIssueIds"]),
        [
            "SYN-DEMO-KND-002",
            "SYN-DEMO-KND-003",
            "SYN-DEMO-KND-004",
            "SYN-DEMO-KND-005",
            "SYN-DEMO-KND-006"
        ]
    );
    assert_eq!(
        ids(&d["dlpExceptionIssueIds"]),
        ["SYN-DEMO-KND-002", "SYN-DEMO-KND-004"]
    );
    assert_eq!(ids(&d["traceabilityGapBudgetIds"]), ["SYN-DEMO-BUD-002"]);
    assert_eq!(
        d.as_object().unwrap().len(),
        6,
        "no field beyond the contract"
    );
    // a query string is not part of the operation
    assert_problem(
        &get_as(&s, "/v1/authority/dashboard?x=1", Some("authority")).await,
        400,
    );
}

#[tokio::test]
async fn dlp_exceptions_are_derived_at_the_injected_instant_and_never_claim_applicability_or_zero_cost(
) {
    let _f = Fixture::new().await;
    let s = start().await;
    let r = get_as(&s, "/v1/authority/dlp-exceptions", Some("authority")).await;
    assert_eq!(r.status, 200, "{}", r.body);
    let items = r.json()["data"]["items"].as_array().unwrap().clone();
    assert_eq!(items.len(), 2);
    let seeds: Vec<Value> = serde_json::from_str(
        &std::fs::read_to_string(demo::workspace_root().join("data/demo/dlp-status.json")).unwrap(),
    )
    .unwrap();
    for (item, issue) in items.iter().zip(["SYN-DEMO-KND-002", "SYN-DEMO-KND-004"]) {
        assert_eq!(item["issueId"], issue);
        assert_eq!(item["candidateWorkOrderId"], "SYN-DEMO-WO-001");
        assert_eq!(
            item["potentialSpendLabel"],
            "SYNTHETIC_POTENTIAL_NOT_REALIZED_SAVINGS"
        );
        assert_eq!(
            item["syntheticFreshRepairEstimatePaise"],
            seeds[0]["syntheticFreshRepairEstimatePaise"]
        );
        assert_eq!(item["dlpStatus"]["status"], "ACTIVE");
        assert_eq!(item["dlpStatus"]["evaluatedAt"], CLOCK);
        assert_eq!(item["dlpStatus"]["dlpEndsAt"], "2027-03-31T18:29:59Z");
        assert!(item["warrantyPathNote"]
            .as_str()
            .unwrap()
            .contains("pending contractual verification"));
        assert_eq!(
            item.as_object().unwrap().len(),
            6,
            "exactly the contract members"
        );
    }
    // temporal overlap is not contractual applicability and no cost outcome is claimed anywhere in the body
    let lower = r.body.to_lowercase();
    for banned in [
        "zero municipal",
        "no cost",
        "free repair",
        "is liable",
        "guilty",
        "₹0",
        "saved",
    ] {
        assert!(!lower.contains(banned), "{banned}");
    }
    // the DLP status is derived, never stored: no table has a competing status column for it
    let owner = owner_pool().await;
    let cols = count(
        &owner,
        "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' \
         AND column_name IN ('dlp_status', 'dlp_active', 'dlp_state') AND table_name <> 'dlp_status'",
    )
    .await;
    assert_eq!(cols, 0);
}

#[tokio::test]
async fn dlp_membership_follows_the_injected_instant_with_an_inclusive_end() {
    let _f = Fixture::new().await;
    for (instant, expected) in [
        ("2026-03-31T23:59:59Z", 0), // NOT_STARTED
        ("2026-11-21T04:30:00Z", 2), // ACTIVE
        ("2027-03-31T18:29:59Z", 2), // the last active second (inclusive end)
        ("2027-03-31T18:30:00Z", 0), // EXPIRED
        ("2028-01-01T00:00:00Z", 0),
    ] {
        let s = start_at(instant).await;
        let r = get_as(&s, "/v1/authority/dlp-exceptions", Some("authority")).await;
        assert_eq!(r.status, 200);
        assert_eq!(
            r.json()["data"]["items"].as_array().unwrap().len(),
            expected,
            "{instant}"
        );
        let d = get_as(&s, "/v1/authority/dashboard", Some("authority"))
            .await
            .json();
        assert_eq!(d["data"]["asOf"], instant);
        assert_eq!(
            d["data"]["dlpExceptionIssueIds"].as_array().unwrap().len(),
            expected,
            "{instant}"
        );
    }
}

// ------------------------------------------------------------------------------------------------------- linkWork (J3)

#[tokio::test]
async fn linking_an_unlinked_defect_commits_atomically_preserves_history_and_replays_exactly() {
    let _f = Fixture::new().await;
    let s = start().await;
    let owner = owner_pool().await;
    let before_events = events(&owner, "SYN-DEMO-KND-004").await;
    assert_eq!(before_events.len(), 3);
    let issues_before = count(&owner, "SELECT count(*) FROM issues").await;

    let body = link_body(
        1,
        "SYN-DEMO-WO-001",
        "Same road segment, certified work inside its defect liability period.",
    );
    let r = link(&s, "SYN-DEMO-KND-004", "idem-link-0000001", &body).await;
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(
        r.header("etag"),
        Some("\"2\""),
        "ETag is derived from recordVersion"
    );
    assert_eq!(r.header("x-correlation-id"), Some(CID));
    let j = r.json();
    assert_eq!(j["correlationId"], CID);
    let d = &j["data"];
    assert_eq!(d["id"], "SYN-DEMO-KND-004");
    assert_eq!(d["workOrderId"], "SYN-DEMO-WO-001");
    assert_eq!(d["recordVersion"], 2);
    assert_eq!(
        d["status"], "TRIAGED_ASSIGNED",
        "linking is not a state transition of the issue"
    );
    assert_eq!(d["assetId"], "SYN-DEMO-AST-ROAD-001");

    // exactly one new event; the three earlier events are byte-for-byte unchanged and the chain still verifies
    let after_events = events(&owner, "SYN-DEMO-KND-004").await;
    assert_eq!(after_events.len(), 4);
    assert_eq!(&after_events[..3], &before_events[..]);
    let (seq, etype, actor, summary, _) = &after_events[3];
    assert_eq!(
        (*seq, etype.as_str(), actor.as_str()),
        (4, "ISSUE_WORK_LINKED", "authority")
    );
    assert!(summary.contains("SYN-DEMO-WO-001"));
    assert!(summary
        .contains("not a finding of liability, contractual applicability or any cost outcome"));
    let low = summary.to_lowercase();
    assert!(!low.contains("zero") && !low.contains("saving") && !low.contains("liable to"));
    assert!(chain_valid(&owner, "SYN-DEMO-KND-004").await);
    assert_eq!(
        count(&owner, "SELECT count(*) FROM issues").await,
        issues_before,
        "no issue was created"
    );
    assert_eq!(
        count(&owner, "SELECT count(*) FROM idempotency_records").await,
        1
    );

    // the exception queue shrinks by this issue; the other unlinked defect remains
    let dash = get_as(&s, "/v1/authority/dashboard", Some("authority"))
        .await
        .json();
    assert_eq!(
        ids(&dash["data"]["dlpExceptionIssueIds"]),
        ["SYN-DEMO-KND-002"]
    );
    // the Kundali now shows the linked work order with its derived, still-unverified DLP view
    let k = get(&s, "/v1/kundalis/SYN-DEMO-KND-004").await;
    assert_eq!(k.status, 200);
    let kd = &k.json()["data"];
    assert_eq!(kd["workOrder"]["id"], "SYN-DEMO-WO-001");
    assert_eq!(kd["dlpStatus"]["status"], "ACTIVE");
    assert!(kd["dlpStatus"]["warrantyPathNote"]
        .as_str()
        .unwrap()
        .contains("pending contractual verification"));

    // an exact replay returns the committed record and writes nothing
    let again = link(&s, "SYN-DEMO-KND-004", "idem-link-0000001", &body).await;
    assert_eq!(again.status, 200);
    assert_eq!(again.json()["data"], *d);
    assert_eq!(events(&owner, "SYN-DEMO-KND-004").await.len(), 4);
    assert_eq!(
        count(&owner, "SELECT count(*) FROM idempotency_records").await,
        1
    );
    // the same key with a different body is a conflict, not a second mutation
    let other = link_body(1, "SYN-DEMO-WO-001", "A different rationale.");
    assert_problem(
        &link(&s, "SYN-DEMO-KND-004", "idem-link-0000001", &other).await,
        409,
    );
    // a new key with the now-stale version is a conflict too
    assert_problem(
        &link(&s, "SYN-DEMO-KND-004", "idem-link-0000002", &body).await,
        409,
    );
    assert_eq!(events(&owner, "SYN-DEMO-KND-004").await.len(), 4);
}

#[tokio::test]
async fn invalid_linkage_is_rejected_with_contract_problems_and_writes_nothing() {
    let _f = Fixture::new().await;
    let s = start().await;
    let owner = owner_pool().await;
    let before = digest(&owner).await;
    let ok_rationale = "Same road segment.";
    let cases: Vec<(&str, &str, Value, u16)> = vec![
        // stale recordVersion
        (
            "SYN-DEMO-KND-004",
            "idem-bad-link-0001",
            link_body(7, "SYN-DEMO-WO-001", ok_rationale),
            409,
        ),
        // already linked: an existing link is never replaced
        (
            "SYN-DEMO-KND-001",
            "idem-bad-link-0002",
            link_body(1, "SYN-DEMO-WO-001", ok_rationale),
            409,
        ),
        // work order that does not exist
        (
            "SYN-DEMO-KND-004",
            "idem-bad-link-0003",
            link_body(1, "SYN-DEMO-WO-999", ok_rationale),
            422,
        ),
        // asset mismatch: KND-003 is on the drain, WO-001 is on the road segment
        (
            "SYN-DEMO-KND-003",
            "idem-bad-link-0004",
            link_body(1, "SYN-DEMO-WO-001", ok_rationale),
            422,
        ),
        // unknown issue
        (
            "SYN-DEMO-KND-999",
            "idem-bad-link-0005",
            link_body(1, "SYN-DEMO-WO-001", ok_rationale),
            404,
        ),
        // accusatory or unbounded rationale
        (
            "SYN-DEMO-KND-004",
            "idem-bad-link-0006",
            link_body(1, "SYN-DEMO-WO-001", "The contractor is liable for this."),
            422,
        ),
        (
            "SYN-DEMO-KND-004",
            "idem-bad-link-0007",
            link_body(1, "SYN-DEMO-WO-001", ""),
            422,
        ),
        (
            "SYN-DEMO-KND-004",
            "idem-bad-link-0008",
            link_body(1, "SYN-DEMO-WO-001", &"r".repeat(300)),
            422,
        ),
        (
            "SYN-DEMO-KND-004",
            "idem-bad-link-0009",
            link_body(0, "SYN-DEMO-WO-001", ok_rationale),
            422,
        ),
    ];
    for (issue, key, body, status) in cases {
        let r = link(&s, issue, key, &body).await;
        assert_problem(&r, status);
    }
    // structurally malformed: 400
    let path = "/v1/authority/issues/SYN-DEMO-KND-004/work-link";
    for (key, body) in [
        (
            "idem-bad-link-0010",
            json!({"recordVersion": 1, "payload": {"workOrderId": "SYN-DEMO-WO-001", "rationale": "r", "extra": 1}}),
        ),
        (
            "idem-bad-link-0011",
            json!({"recordVersion": 1, "payload": {"workOrderId": "wo-1", "rationale": "r"}}),
        ),
        (
            "idem-bad-link-0012",
            json!({"payload": {"workOrderId": "SYN-DEMO-WO-001", "rationale": "r"}}),
        ),
    ] {
        let r = post_raw(
            &s,
            path,
            Some("authority"),
            Some(key),
            None,
            &body.to_string(),
        )
        .await;
        assert_problem(&r, 400);
    }
    let r = post_raw(
        &s,
        path,
        Some("authority"),
        Some("idem-bad-link-0013"),
        None,
        "not json",
    )
    .await;
    assert_problem(&r, 400);
    let r = post_raw(
        &s,
        path,
        Some("authority"),
        Some("short"),
        None,
        &link_body(1, "SYN-DEMO-WO-001", "r").to_string(),
    )
    .await;
    assert_problem(&r, 400);
    let r = post_raw(
        &s,
        path,
        Some("authority"),
        None,
        None,
        &link_body(1, "SYN-DEMO-WO-001", "r").to_string(),
    )
    .await;
    assert_problem(&r, 400);
    let r = post_raw(
        &s,
        "/v1/authority/issues/lower-case/work-link",
        Some("authority"),
        Some("idem-bad-link-0014"),
        None,
        &link_body(1, "SYN-DEMO-WO-001", "r").to_string(),
    )
    .await;
    assert_problem(&r, 400);
    // none of that wrote anything, not even an idempotency record
    assert_eq!(digest(&owner).await, before);
    assert_eq!(
        count(&owner, "SELECT count(*) FROM idempotency_records").await,
        0
    );
}

// ------------------------------------------------------------------------------------------- resolveJurisdiction (J4)

#[tokio::test]
async fn a_disputed_jurisdiction_moves_to_an_external_agency_then_a_logged_handoff() {
    let _f = Fixture::new().await;
    let s = start().await;
    let owner = owner_pool().await;
    let before_events = events(&owner, "SYN-DEMO-KND-003").await;
    assert_eq!(before_events.len(), 7);

    // 1. CONFLICT_DISPUTED -> EXTERNAL_AGENCY_ASSIGNED (jurisdiction recordVersion 1)
    let b1 = resolve_body(
        1,
        "EXTERNAL_AGENCY_ASSIGNED",
        json!(AGENCY),
        "Corridor records point to a non-ward agency; review recorded.",
    );
    let r = resolve(&s, "SYN-DEMO-KND-003", "idem-jur-00000001", &b1).await;
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(r.header("etag"), Some("\"2\""));
    let d = r.json()["data"].clone();
    assert_eq!(d["status"], "EXTERNAL_AGENCY_ASSIGNED");
    assert_eq!(d["recordVersion"], 2);
    assert_eq!(d["externalAgencyLabel"], AGENCY);
    assert_eq!(d["confirmationBasis"], Value::Null);
    assert_eq!(d["legalOwnershipAsserted"], false);
    // spatial facts and the recorded conflict stay exactly as inferred and recorded
    assert_eq!(d["spatialMatchMethod"], "ST_INTERSECTS");
    assert_eq!(d["candidateWardId"], "SYN-DEMO-WARD-KW");
    assert_eq!(d["distanceToBoundaryMeters"], 553.5);
    assert!(d["sourceConflictNote"]
        .as_str()
        .unwrap()
        .contains("An authority must resolve the conflict"));
    assert_eq!(d["establishedAt"], "2026-11-12T03:40:00Z");
    assert!(d["confidenceNote"]
        .as_str()
        .unwrap()
        .contains("Not a legal determination"));

    // 2. EXTERNAL_AGENCY_ASSIGNED -> HANDOFF_LOGGED (version 2, label restated or null)
    let b2 = resolve_body(
        2,
        "HANDOFF_LOGGED",
        json!(null),
        "Handoff to the corridor agency recorded for its review.",
    );
    let r = resolve(&s, "SYN-DEMO-KND-003", "idem-jur-00000002", &b2).await;
    assert_eq!(r.status, 200, "{}", r.body);
    let d = r.json()["data"].clone();
    assert_eq!(
        (
            d["status"].as_str().unwrap(),
            d["recordVersion"].as_i64().unwrap()
        ),
        ("HANDOFF_LOGGED", 3)
    );
    assert_eq!(
        d["externalAgencyLabel"], AGENCY,
        "the assigned agency is kept through the handoff"
    );

    // lifecycle: exactly two new events named by the committed machine, prior history untouched, chain valid
    let ev = events(&owner, "SYN-DEMO-KND-003").await;
    assert_eq!(ev.len(), 9);
    assert_eq!(&ev[..7], &before_events[..]);
    assert_eq!(
        (ev[7].0, ev[7].1.as_str(), ev[7].2.as_str()),
        (8, "JURISDICTION_EXTERNAL_AGENCY_ASSIGNED", "authority")
    );
    assert_eq!(
        (ev[8].0, ev[8].1.as_str()),
        (9, "JURISDICTION_HANDOFF_LOGGED")
    );
    assert!(
        ev[7]
            .3
            .contains("CONFLICT_DISPUTED to EXTERNAL_AGENCY_ASSIGNED")
            && ev[7].3.contains("not a legal determination")
    );
    assert!(
        ev[8].3.contains("External-agency handoff recorded")
            && ev[8]
                .3
                .contains("EXTERNAL_AGENCY_ASSIGNED to HANDOFF_LOGGED")
    );
    assert!(chain_valid(&owner, "SYN-DEMO-KND-003").await);

    // the issue itself is untouched by a jurisdiction step
    let (ver, status): (i32, String) =
        sqlx::query_as("SELECT record_version, status FROM issues WHERE id = 'SYN-DEMO-KND-003'")
            .fetch_one(&owner)
            .await
            .unwrap();
    assert_eq!((ver, status.as_str()), (1, "TRIAGED_ASSIGNED"));

    // the dispute leaves the uncertain-jurisdiction queue once resolved
    let dash = get_as(&s, "/v1/authority/dashboard", Some("authority"))
        .await
        .json();
    assert!(!ids(&dash["data"]["uncertainJurisdictionIssueIds"])
        .contains(&"SYN-DEMO-KND-003".to_string()));

    // 3. HANDOFF_LOGGED is final: no further transition is legal
    for (key, target, label) in [
        ("idem-jur-00000003", "CONFIRMED_BMC_WARD", json!(null)),
        (
            "idem-jur-00000004",
            "EXTERNAL_AGENCY_ASSIGNED",
            json!(AGENCY),
        ),
        ("idem-jur-00000005", "HANDOFF_LOGGED", json!(null)),
    ] {
        let r = resolve(
            &s,
            "SYN-DEMO-KND-003",
            key,
            &resolve_body(3, target, label, "Illegal transition probe."),
        )
        .await;
        assert_problem(&r, 409);
    }
    assert_eq!(events(&owner, "SYN-DEMO-KND-003").await.len(), 9);
}

#[tokio::test]
async fn spatial_inference_stays_provisional_until_an_authorized_command_and_illegal_transitions_fail(
) {
    let _f = Fixture::new().await;
    let s = start().await;
    let owner = owner_pool().await;
    // a provisional jurisdiction is not confirmed by reading, listing or proximity: only the command changes it
    for _ in 0..2 {
        get(&s, "/v1/kundalis/SYN-DEMO-KND-004").await;
        get_as(&s, "/v1/authority/dashboard", Some("authority")).await;
    }
    let status: String =
        sqlx::query_scalar("SELECT status FROM jurisdictions WHERE issue_id = 'SYN-DEMO-KND-004'")
            .fetch_one(&owner)
            .await
            .unwrap();
    assert_eq!(status, "SPATIALLY_INFERRED_PROVISIONAL");

    // SPATIALLY_INFERRED_PROVISIONAL -> HANDOFF_LOGGED is not in the committed machine
    let r = resolve(
        &s,
        "SYN-DEMO-KND-004",
        "idem-ill-00000001",
        &resolve_body(1, "HANDOFF_LOGGED", json!(null), "Skip the assignment."),
    )
    .await;
    assert_problem(&r, 409);
    // SPATIALLY_INFERRED_PROVISIONAL -> CONFIRMED_BMC_WARD is legal and carries a confirmation basis
    let basis = "Ward office confirmation recorded from the demonstration work-order linkage, not from map proximity.";
    let r = resolve(
        &s,
        "SYN-DEMO-KND-004",
        "idem-ill-00000002",
        &resolve_body(1, "CONFIRMED_BMC_WARD", json!(null), basis),
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.body);
    let d = r.json()["data"].clone();
    assert_eq!(d["status"], "CONFIRMED_BMC_WARD");
    assert_eq!(d["confirmationBasis"], basis);
    assert_eq!(d["externalAgencyLabel"], Value::Null);
    assert_eq!(d["legalOwnershipAsserted"], false);
    assert!(d["confidenceNote"]
        .as_str()
        .unwrap()
        .contains("Not a legal determination of ownership"));
    // CONFIRMED_BMC_WARD is final in the machine
    for (key, target, label) in [
        (
            "idem-ill-00000003",
            "EXTERNAL_AGENCY_ASSIGNED",
            json!(AGENCY),
        ),
        ("idem-ill-00000004", "CONFIRMED_BMC_WARD", json!(null)),
        ("idem-ill-00000005", "HANDOFF_LOGGED", json!(null)),
    ] {
        assert_problem(
            &resolve(
                &s,
                "SYN-DEMO-KND-004",
                key,
                &resolve_body(2, target, label, "Illegal transition probe."),
            )
            .await,
            409,
        );
    }
    // another provisional issue may instead be assigned to an external agency, and a disputed one can be confirmed
    let r = resolve(
        &s,
        "SYN-DEMO-KND-005",
        "idem-ill-00000006",
        &resolve_body(
            1,
            "EXTERNAL_AGENCY_ASSIGNED",
            json!("Synthetic agency B"),
            "Corridor is outside the ward asset list.",
        ),
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.body);
    let r = resolve(
        &s,
        "SYN-DEMO-KND-003",
        "idem-ill-00000007",
        &resolve_body(
            1,
            "CONFIRMED_BMC_WARD",
            json!(null),
            "Ward record reviewed for this location.",
        ),
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.body);
    let d = r.json()["data"].clone();
    assert_eq!(
        d["externalAgencyLabel"],
        Value::Null,
        "the withdrawn candidate agency label is cleared"
    );
    let ev = events(&owner, "SYN-DEMO-KND-003").await;
    assert!(
        ev.last()
            .unwrap()
            .3
            .contains(&format!("Candidate agency label withdrawn: {AGENCY}")),
        "the withdrawn label stays in the audit trail"
    );
    // only the three transitions above wrote events
    assert_eq!(count(&owner, "SELECT count(*) FROM lifecycle_events WHERE event_type LIKE 'JURISDICTION_%' AND occurred_at >= '2026-11-21'").await, 3);
}

#[tokio::test]
async fn invalid_jurisdiction_requests_are_rejected_with_contract_problems_and_write_nothing() {
    let _f = Fixture::new().await;
    let s = start().await;
    let owner = owner_pool().await;
    let before = digest(&owner).await;
    let path = "/v1/authority/issues/SYN-DEMO-KND-003/jurisdiction";
    let good = resolve_body(
        1,
        "EXTERNAL_AGENCY_ASSIGNED",
        json!(AGENCY),
        "Corridor review recorded.",
    );
    let gs = good.to_string();

    // If-Match: required, quoted decimal, equal to the body version
    for (key, m, status) in [
        ("idem-jbad-0000001", None, 400),
        ("idem-jbad-0000002", Some("1"), 400),
        ("idem-jbad-0000003", Some("\"\""), 400),
        ("idem-jbad-0000004", Some("\"abc\""), 400),
        ("idem-jbad-0000005", Some("W/\"1\""), 400),
        ("idem-jbad-0000006", Some("\"2\""), 409),
    ] {
        let r = post_raw(&s, path, Some("authority"), Some(key), m, &gs).await;
        assert_problem(&r, status);
    }
    // stale recordVersion with a matching If-Match
    let r = resolve(
        &s,
        "SYN-DEMO-KND-003",
        "idem-jbad-0000007",
        &resolve_body(5, "EXTERNAL_AGENCY_ASSIGNED", json!(AGENCY), "r"),
    )
    .await;
    assert_problem(&r, 409);
    // value rules (422)
    let long_ok_for_contract = "r".repeat(300);
    let cases: Vec<(&str, Value)> = vec![
        (
            "idem-jbad-0000008",
            resolve_body(
                1,
                "CONFIRMED_BMC_WARD",
                json!(AGENCY),
                "A ward label must be null.",
            ),
        ),
        (
            "idem-jbad-0000009",
            resolve_body(
                1,
                "EXTERNAL_AGENCY_ASSIGNED",
                json!(null),
                "An agency needs a label.",
            ),
        ),
        (
            "idem-jbad-0000010",
            resolve_body(1, "EXTERNAL_AGENCY_ASSIGNED", json!(AGENCY), ""),
        ),
        (
            "idem-jbad-0000011",
            resolve_body(
                1,
                "EXTERNAL_AGENCY_ASSIGNED",
                json!(AGENCY),
                "Someone took a bribe here.",
            ),
        ),
        (
            "idem-jbad-0000012",
            resolve_body(1, "EXTERNAL_AGENCY_ASSIGNED", json!("a".repeat(161)), "r"),
        ),
        // fits the contract's 400 but not the 400-character audit event once the fixed wording is added
        (
            "idem-jbad-0000013",
            resolve_body(
                1,
                "EXTERNAL_AGENCY_ASSIGNED",
                json!(AGENCY),
                &long_ok_for_contract,
            ),
        ),
        (
            "idem-jbad-0000014",
            resolve_body(1, "CONFIRMED_BMC_WARD", json!(null), &"c".repeat(301)),
        ),
        (
            "idem-jbad-0000015",
            resolve_body(0, "EXTERNAL_AGENCY_ASSIGNED", json!(AGENCY), "r"),
        ),
    ];
    for (key, body) in cases {
        let v = body["recordVersion"].as_i64().unwrap();
        // version 0 cannot be quoted as a valid version; send it with its own quoted form (still 422 from the body rule)
        let r = post_raw(
            &s,
            path,
            Some("authority"),
            Some(key),
            Some(&format!("\"{v}\"")),
            &body.to_string(),
        )
        .await;
        assert_problem(&r, 422);
    }
    // structurally malformed (400): a non-commandable target, a missing nullable member, an unknown member
    for (key, body) in [
        (
            "idem-jbad-0000016",
            resolve_body(1, "CONFLICT_DISPUTED", json!(null), "r"),
        ),
        (
            "idem-jbad-0000017",
            resolve_body(1, "UNKNOWN", json!(null), "r"),
        ),
        (
            "idem-jbad-0000018",
            json!({"recordVersion": 1, "payload": {"targetStatus": "HANDOFF_LOGGED", "rationale": "r"}}),
        ),
        (
            "idem-jbad-0000019",
            json!({"recordVersion": 1, "payload": {"targetStatus": "HANDOFF_LOGGED", "externalAgencyLabel": null, "rationale": "r", "legalOwner": "x"}}),
        ),
    ] {
        let r = post_raw(
            &s,
            path,
            Some("authority"),
            Some(key),
            Some("\"1\""),
            &body.to_string(),
        )
        .await;
        assert_problem(&r, 400);
    }
    // unknown issue; malformed identifier
    let r = resolve(&s, "SYN-DEMO-KND-999", "idem-jbad-0000020", &good).await;
    assert_problem(&r, 404);
    let r = post_raw(
        &s,
        "/v1/authority/issues/bad_id/jurisdiction",
        Some("authority"),
        Some("idem-jbad-0000021"),
        Some("\"1\""),
        &gs,
    )
    .await;
    assert_problem(&r, 400);
    // a handoff that names a different agency than the assigned one is refused after the assignment
    let ok = resolve(&s, "SYN-DEMO-KND-003", "idem-jbad-0000022", &good).await;
    assert_eq!(ok.status, 200, "{}", ok.body);
    let r = resolve(
        &s,
        "SYN-DEMO-KND-003",
        "idem-jbad-0000023",
        &resolve_body(2, "HANDOFF_LOGGED", json!("A different agency"), "r"),
    )
    .await;
    assert_problem(&r, 422);
    // exactly one mutation happened in this whole test
    assert_eq!(
        count(&owner, "SELECT count(*) FROM idempotency_records").await,
        1
    );
    assert_eq!(events(&owner, "SYN-DEMO-KND-003").await.len(), 8);
    let _ = before;
}

#[tokio::test]
async fn a_jurisdiction_replay_is_exact_and_a_reused_key_with_another_body_conflicts() {
    let _f = Fixture::new().await;
    let s = start().await;
    let owner = owner_pool().await;
    let body = resolve_body(
        1,
        "EXTERNAL_AGENCY_ASSIGNED",
        json!(AGENCY),
        "Corridor review recorded.",
    );
    let first = resolve(&s, "SYN-DEMO-KND-003", "idem-jrep-0000001", &body).await;
    assert_eq!(first.status, 200);
    let again = resolve(&s, "SYN-DEMO-KND-003", "idem-jrep-0000001", &body).await;
    assert_eq!(again.status, 200);
    assert_eq!(again.json()["data"], first.json()["data"]);
    assert_eq!(events(&owner, "SYN-DEMO-KND-003").await.len(), 8);
    // same key, different body
    let other = resolve_body(
        1,
        "EXTERNAL_AGENCY_ASSIGNED",
        json!("Another agency"),
        "Corridor review recorded.",
    );
    assert_problem(
        &resolve(&s, "SYN-DEMO-KND-003", "idem-jrep-0000001", &other).await,
        409,
    );
    // the key is scoped by operation and persona: the same text on linkWork is an unrelated key
    let l = link(
        &s,
        "SYN-DEMO-KND-004",
        "idem-jrep-0000001",
        &link_body(1, "SYN-DEMO-WO-001", "Same segment."),
    )
    .await;
    assert_eq!(l.status, 200, "{}", l.body);
    assert_eq!(
        count(&owner, "SELECT count(*) FROM idempotency_records").await,
        2
    );
}

// ------------------------------------------------------------------------------------------- transactions and concurrency

#[tokio::test]
async fn a_failed_event_insert_rolls_back_the_link_and_the_jurisdiction_change() {
    let _f = Fixture::new().await;
    let s = start().await;
    let owner = owner_pool().await;
    // Pre-occupy the event id each command is about to use, under an unrelated entity, so its event insert fails after the
    // domain UPDATE already ran inside the transaction.
    for blocker in ["SYN-DEMO-EVT-KND-004-004", "SYN-DEMO-EVT-KND-003-008"] {
        sqlx::query(
            "INSERT INTO lifecycle_events (id, record_nature, source_tier, record_version, updated_at, entity_id, sequence, \
                event_type, actor_role, occurred_at, summary, previous_hash, payload_hash) \
             VALUES ($1, 'SYNTHETIC_DEMONSTRATION', 'SYNTHETIC_DEMO', 1, now(), 'SYN-DEMO-TEST-BLOCKER-' || $1, 1, 'TEST_BLOCKER', 'system', \
                '2026-11-20T00:00:00Z', 'blocker', NULL, lifecycle_event_hash('SYN-DEMO-TEST-BLOCKER-' || $1, 1, 'TEST_BLOCKER', \
                '2026-11-20T00:00:00Z'::timestamptz, 'system', 'blocker', NULL))",
        )
        .bind(blocker)
        .execute(&owner)
        .await
        .unwrap();
    }
    let r = link(
        &s,
        "SYN-DEMO-KND-004",
        "idem-roll-0000001",
        &link_body(1, "SYN-DEMO-WO-001", "Same segment."),
    )
    .await;
    assert_problem(&r, 409);
    let (wo, ver): (Option<String>, i32) = sqlx::query_as(
        "SELECT work_order_id::text, record_version FROM issues WHERE id = 'SYN-DEMO-KND-004'",
    )
    .fetch_one(&owner)
    .await
    .unwrap();
    assert_eq!(
        (wo, ver),
        (None, 1),
        "the issue UPDATE rolled back with the failed event"
    );

    let r = resolve(
        &s,
        "SYN-DEMO-KND-003",
        "idem-roll-0000002",
        &resolve_body(
            1,
            "EXTERNAL_AGENCY_ASSIGNED",
            json!(AGENCY),
            "Corridor review.",
        ),
    )
    .await;
    assert_problem(&r, 409);
    let (st, ver, label): (String, i32, Option<String>) = sqlx::query_as("SELECT status, record_version, external_agency_label FROM jurisdictions WHERE issue_id = 'SYN-DEMO-KND-003'")
        .fetch_one(&owner).await.unwrap();
    assert_eq!((st.as_str(), ver), ("CONFLICT_DISPUTED", 1));
    assert_eq!(
        label.as_deref(),
        Some(AGENCY),
        "the seeded label is untouched"
    );
    assert_eq!(
        count(&owner, "SELECT count(*) FROM idempotency_records").await,
        0,
        "no key was recorded either"
    );
}

#[tokio::test]
async fn concurrent_requests_with_one_key_produce_one_logical_transition() {
    let _f = Fixture::new().await;
    let s = Arc::new(start().await);
    let owner = owner_pool().await;
    let body = link_body(1, "SYN-DEMO-WO-001", "Same segment.");
    let mut handles = Vec::new();
    for _ in 0..6 {
        let (s, body) = (s.clone(), body.clone());
        handles.push(tokio::spawn(async move {
            link(&s, "SYN-DEMO-KND-004", "idem-conc-0000001", &body).await
        }));
    }
    for h in handles {
        let r = h.await.unwrap();
        assert_eq!(r.status, 200, "{}", r.body);
        assert_eq!(r.json()["data"]["recordVersion"], 2);
    }
    assert_eq!(events(&owner, "SYN-DEMO-KND-004").await.len(), 4);
    assert_eq!(
        count(&owner, "SELECT count(*) FROM idempotency_records").await,
        1
    );
    assert!(chain_valid(&owner, "SYN-DEMO-KND-004").await);
}

#[tokio::test]
async fn concurrent_requests_with_different_keys_and_one_version_let_exactly_one_win() {
    let _f = Fixture::new().await;
    let s = Arc::new(start().await);
    let owner = owner_pool().await;
    let mut handles = Vec::new();
    for i in 0..5 {
        let s = s.clone();
        handles.push(tokio::spawn(async move {
            let key = format!("idem-race-000000{i}");
            let body = resolve_body(
                1,
                "EXTERNAL_AGENCY_ASSIGNED",
                json!(format!("Synthetic agency {i}")),
                "Corridor review recorded.",
            );
            resolve(&s, "SYN-DEMO-KND-003", &key, &body).await.status
        }));
    }
    let mut statuses = Vec::new();
    for h in handles {
        statuses.push(h.await.unwrap());
    }
    assert_eq!(
        statuses.iter().filter(|c| **c == 200).count(),
        1,
        "{statuses:?}"
    );
    assert_eq!(
        statuses.iter().filter(|c| **c == 409).count(),
        4,
        "{statuses:?}"
    );
    let (st, ver): (String, i32) = sqlx::query_as(
        "SELECT status, record_version FROM jurisdictions WHERE issue_id = 'SYN-DEMO-KND-003'",
    )
    .fetch_one(&owner)
    .await
    .unwrap();
    assert_eq!((st.as_str(), ver), ("EXTERNAL_AGENCY_ASSIGNED", 2));
    assert_eq!(
        events(&owner, "SYN-DEMO-KND-003").await.len(),
        8,
        "one logical transition, one event"
    );
    assert_eq!(
        count(&owner, "SELECT count(*) FROM idempotency_records").await,
        1,
        "losers left no key behind"
    );
    assert!(chain_valid(&owner, "SYN-DEMO-KND-003").await);
}

// ------------------------------------------------------------------------------------------- identities and privileges

#[tokio::test]
async fn reads_use_the_read_only_identity_and_commands_use_the_command_identity() {
    let _f = Fixture::new().await;
    // without a command pool both reads still work (they never touch it) and both commands are unavailable, not silently run
    let s = serve(AppState::with_clock(read_pool().await, fixed(CLOCK))).await;
    assert_eq!(
        get_as(&s, "/v1/authority/dashboard", Some("authority"))
            .await
            .status,
        200
    );
    assert_eq!(
        get_as(&s, "/v1/authority/dlp-exceptions", Some("authority"))
            .await
            .status,
        200
    );
    let r = link(
        &s,
        "SYN-DEMO-KND-004",
        "idem-ident-000001",
        &link_body(1, "SYN-DEMO-WO-001", "Same segment."),
    )
    .await;
    assert_problem(&r, 503);
    let r = resolve(
        &s,
        "SYN-DEMO-KND-003",
        "idem-ident-000002",
        &resolve_body(1, "EXTERNAL_AGENCY_ASSIGNED", json!(AGENCY), "r"),
    )
    .await;
    assert_problem(&r, 503);
    // the read identity is read-only even for the columns the command identity may update
    let rp = read_pool().await;
    let e = sqlx::query("UPDATE jurisdictions SET status = status")
        .execute(&rp)
        .await
        .unwrap_err();
    assert_eq!(
        e.as_database_error().unwrap().code().as_deref(),
        Some("25006")
    );
    let e = sqlx::query("UPDATE issues SET work_order_id = NULL")
        .execute(&rp)
        .await
        .unwrap_err();
    assert_eq!(
        e.as_database_error().unwrap().code().as_deref(),
        Some("25006")
    );
    let id = read::runtime_identity(&rp).await.unwrap();
    assert!(id.is_least_privilege());
}

#[tokio::test]
async fn the_command_identity_holds_exactly_the_committed_column_level_updates() {
    let _f = Fixture::new().await;
    let pool = command_pool();
    let id = command::command_identity(&pool).await.unwrap();
    assert!(id.is_least_privilege(), "{id:?}");
    assert_eq!(id.updatable_columns, command::expected_update_columns());
    assert!(
        id.destructive_tables.is_empty(),
        "no table-wide UPDATE, DELETE, TRUNCATE, TRIGGER or REFERENCES"
    );
    assert_eq!(
        id.insertable_tables,
        command::COMMAND_INSERT_TABLES,
        "P6 adds no INSERT target"
    );
    assert!(!id.privileged && !id.can_create_in_public && id.owned_public_relations == 0);
    let select_work: bool =
        sqlx::query_scalar("SELECT has_table_privilege('mcl_command', 'work_orders', 'SELECT')")
            .fetch_one(&owner_pool().await)
            .await
            .unwrap();
    assert!(select_work, "work_orders is readable for the linkage check");
    // positive: the exact permitted UPDATEs work (no row is changed)
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("UPDATE jurisdictions SET status = status, external_agency_label = external_agency_label, confirmation_basis = confirmation_basis, \
                 confidence_note = confidence_note, record_version = record_version, updated_at = updated_at WHERE false")
        .execute(&mut *tx).await.unwrap();
    sqlx::query("UPDATE issues SET work_order_id = work_order_id, record_version = record_version, updated_at = updated_at WHERE false")
        .execute(&mut *tx).await.unwrap();
    tx.rollback().await.unwrap();
}

async fn denied(pool: &PgPool, sql: &str) -> String {
    let e = sqlx::query(sql).execute(pool).await.expect_err(sql);
    e.as_database_error()
        .and_then(|d| d.code().map(|c| c.to_string()))
        .unwrap_or_default()
}

#[tokio::test]
async fn every_update_beyond_the_committed_columns_and_every_delete_ddl_and_reset_is_refused() {
    let _f = Fixture::new().await;
    let pool = command_pool();
    let owner = owner_pool().await;
    let before = digest(&owner).await;
    for t in [
        // columns of the two permitted tables that are not granted
        "UPDATE jurisdictions SET spatial_match_method = 'NONE'",
        "UPDATE jurisdictions SET candidate_ward_id = NULL",
        "UPDATE jurisdictions SET distance_to_boundary_meters = 0",
        "UPDATE jurisdictions SET source_conflict_note = NULL",
        "UPDATE jurisdictions SET established_at = now()",
        "UPDATE jurisdictions SET legal_ownership_asserted = true",
        "UPDATE jurisdictions SET issue_id = 'SYN-DEMO-KND-001'",
        "UPDATE issues SET status = 'VERIFIED_COMPLETE'",
        "UPDATE issues SET title = 'x'",
        "UPDATE issues SET asset_id = NULL",
        "UPDATE issues SET responsible_department_id = 'SYN-DEMO-DEPT-ROADS'",
        // tables with no UPDATE at all, including the append-only history
        "UPDATE lifecycle_events SET summary = 'x'",
        "UPDATE corrections SET status = 'ACCEPTED_AMENDED'",
        "UPDATE corrections SET reason = 'x'",
        "UPDATE evidence SET caption = 'x'",
        "UPDATE work_orders SET status = 'DEFECT_NOTIFIED'",
        "UPDATE dlp_status SET potential_spend_label = NULL",
        "UPDATE idempotency_records SET operation_id = 'x'",
        "UPDATE wards SET code = 'X'",
        // no delete or truncate anywhere
        "DELETE FROM issues",
        "DELETE FROM jurisdictions",
        "DELETE FROM lifecycle_events",
        "DELETE FROM corrections",
        "TRUNCATE jurisdictions",
        "TRUNCATE lifecycle_events",
        "TRUNCATE corrections",
        // INSERT on tables outside the committed set
        "INSERT INTO work_orders (id) VALUES ('SYN-DEMO-WO-X')",
        "INSERT INTO corrections (id) VALUES ('SYN-DEMO-COR-X')",
        // DDL and role administration
        "CREATE TABLE p6_probe (x int)",
        "DROP TABLE jurisdictions",
        "ALTER TABLE issues ADD COLUMN x int",
        "ALTER TABLE issues DISABLE TRIGGER ALL",
        "CREATE ROLE p6_probe_role",
        "ALTER ROLE mcl_command SUPERUSER",
        "GRANT mcl_app TO mcl_command",
        "DROP TABLE _sqlx_migrations",
    ] {
        assert_eq!(denied(&pool, t).await, "42501", "{t}");
    }
    for role in ["mcl_app", "mcl_api", "civic", "postgres"] {
        let c = denied(&pool, &format!("SET ROLE {role}")).await;
        assert!(
            c == "42501" || c == "22023" || c == "42704",
            "SET ROLE {role}: {c}"
        );
    }
    assert!(demo::reset_and_seed(&pool, &demo::default_seed_dir())
        .await
        .is_err());
    // a self-grant is a no-op for a non-owner without grant option (PostgreSQL warns; it never errors): the identity is unchanged
    let _ = sqlx::query("GRANT UPDATE ON issues TO mcl_command")
        .execute(&pool)
        .await;
    let _ = sqlx::query("GRANT ALL ON lifecycle_events TO mcl_command")
        .execute(&pool)
        .await;
    let id = command::command_identity(&pool).await.unwrap();
    assert!(id.is_least_privilege(), "{id:?}");
    assert_eq!(
        denied(&pool, "UPDATE issues SET title = 'x'").await,
        "42501"
    );
    assert_eq!(
        denied(&pool, "UPDATE lifecycle_events SET summary = 'x'").await,
        "42501"
    );
    // history stays non-mutable at the trigger level as well (the owner is stopped by the guards too)
    let e = sqlx::query(
        "UPDATE lifecycle_events SET summary = 'x' WHERE entity_id = 'SYN-DEMO-KND-004'",
    )
    .execute(&owner)
    .await
    .unwrap_err();
    assert_eq!(
        e.as_database_error().unwrap().code().as_deref(),
        Some("55000")
    );
    assert_eq!(digest(&owner).await, before, "nothing changed");
}

// -------------------------------------------------------------------------------------------------- scope and transport

#[tokio::test]
async fn only_the_four_p6_operations_are_added_and_later_phase_writes_stay_absent() {
    let _f = Fixture::new().await;
    let s = start().await;
    let owner = owner_pool().await;
    let before = digest(&owner).await;
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
        ("GET", "/v1/audit/SYN-DEMO-KND-001"),
        ("GET", "/v1/issues/SYN-DEMO-KND-001"),
        ("PUT", "/v1/authority/dashboard"),
        ("DELETE", "/v1/authority/dlp-exceptions"),
        (
            "PATCH",
            "/v1/authority/issues/SYN-DEMO-KND-003/jurisdiction",
        ),
        ("GET", "/v1/authority/issues/SYN-DEMO-KND-003/jurisdiction"),
        ("GET", "/v1/authority/issues/SYN-DEMO-KND-003/work-link"),
        ("POST", "/v1/authority/dashboard"),
        ("POST", "/v1/authority/dlp-exceptions"),
    ] {
        let r = request(
            s.addr,
            method,
            path,
            &[("X-Demo-Persona", "authority"), ("Content-Length", "0")],
            None,
        )
        .await;
        assert!(
            r.status == 404 || r.status == 405,
            "{method} {path} -> {}",
            r.status
        );
        assert_eq!(r.header("content-type"), Some("application/problem+json"));
    }
    assert_eq!(digest(&owner).await, before);
}

#[tokio::test]
async fn cors_preflight_allows_if_match_for_the_authority_commands_and_nothing_wider() {
    let _f = Fixture::new().await;
    let s = start().await;
    let pre = request(
        s.addr,
        "OPTIONS",
        "/v1/authority/issues/SYN-DEMO-KND-003/jurisdiction",
        &[
            ("Origin", ORIGIN),
            ("Access-Control-Request-Method", "POST"),
            (
                "Access-Control-Request-Headers",
                "content-type,x-correlation-id,x-demo-persona,idempotency-key,if-match",
            ),
        ],
        None,
    )
    .await;
    assert!(pre.status == 200 || pre.status == 204);
    assert_eq!(pre.header("access-control-allow-origin"), Some(ORIGIN));
    let allowed = pre
        .header("access-control-allow-headers")
        .unwrap()
        .to_lowercase();
    assert!(
        allowed.contains("if-match")
            && allowed.contains("idempotency-key")
            && !allowed.contains('*')
    );
    assert!(!pre
        .header("access-control-allow-methods")
        .unwrap()
        .contains("DELETE"));
    let bad = request(
        s.addr,
        "OPTIONS",
        "/v1/authority/dashboard",
        &[
            ("Origin", "http://evil.example"),
            ("Access-Control-Request-Method", "GET"),
        ],
        None,
    )
    .await;
    assert!(bad.header("access-control-allow-origin").is_none());
}

#[tokio::test]
async fn an_unsafe_correlation_id_is_replaced_and_a_safe_one_is_returned_on_authority_routes() {
    let _f = Fixture::new().await;
    let s = start().await;
    let r = request(
        s.addr,
        "GET",
        "/v1/authority/dashboard",
        &[
            ("X-Demo-Persona", "authority"),
            ("X-Correlation-Id", "bad id <script>"),
        ],
        None,
    )
    .await;
    assert_eq!(r.status, 200);
    let cid = r.header("x-correlation-id").unwrap();
    assert!(
        !cid.contains('<') && !cid.contains(' ') && cid.len() >= 8,
        "{cid}"
    );
    assert_eq!(r.json()["correlationId"], cid);
    let r = request(
        s.addr,
        "GET",
        "/v1/authority/dashboard",
        &[("X-Correlation-Id", "good-correlation-77")],
        None,
    )
    .await;
    assert_eq!(r.status, 401);
    assert_eq!(r.header("x-correlation-id"), Some("good-correlation-77"));
    assert_eq!(r.json()["correlationId"], "good-correlation-77");
}

#[tokio::test]
async fn the_scope_helpers_agree_with_the_committed_operation_names() {
    assert_eq!(Operation::ResolveJurisdiction.id(), "resolveJurisdiction");
    assert_eq!(Operation::LinkWork.id(), "linkWork");
    let a = Scope {
        operation: Operation::LinkWork,
        persona: Persona::Authority,
        idempotency_key: "k-0000000001".into(),
    };
    let b = Scope {
        operation: Operation::ResolveJurisdiction,
        persona: Persona::Authority,
        idempotency_key: "k-0000000001".into(),
    };
    assert_ne!(a.key_hash(), b.key_hash());
}
