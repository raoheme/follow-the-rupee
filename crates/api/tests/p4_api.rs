//! P4 integration tests: `getKundali`, `getWorkOrder` and `getBudgetTrace` on the real Axum router and a real loopback
//! socket, reading the real `civic_lens` PostGIS database through the least-privilege `mcl_app` identity (login role
//! `mcl_api`, `APP_DATABASE_URL` from `.env.local`).
//!
//! Every test is read-only and relies on the committed CP-00 baseline. Expected values are computed independently from
//! `data/demo/*.json` (a plain Rust oracle that follows the relationships in the seed files), never copied from the
//! server's own output. The DLP derivation tests inject the clock; nothing reads the wall clock.
use mcl_api::{router, AppState, Clock};
use mcl_infrastructure::read;
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
const CAP0_INSTANT: &str = "2026-11-20T00:00:00Z";
const ISSUES: [&str; 6] = [
    "SYN-DEMO-KND-001",
    "SYN-DEMO-KND-002",
    "SYN-DEMO-KND-003",
    "SYN-DEMO-KND-004",
    "SYN-DEMO-KND-005",
    "SYN-DEMO-KND-006",
];

fn at(s: &str) -> OffsetDateTime {
    OffsetDateTime::parse(s, &Rfc3339).unwrap()
}

fn fixed(s: &str) -> Clock {
    let t = at(s);
    Arc::new(move || t)
}

// ---------------------------------------------------------------------------------------------------------------- harness

async fn app_pool() -> PgPool {
    let url = read::app_database_url().expect("APP_DATABASE_URL in the environment or .env.local");
    let t = read::redacted(&url).unwrap();
    assert!(
        ["127.0.0.1", "localhost", "::1"].contains(&t.host.as_str()),
        "tests only run against a local host"
    );
    assert_eq!(t.database, "civic_lens");
    let pool = read::connect_app(&url).await.unwrap();
    let (db, marker): (String, i64) = sqlx::query_as(
        "SELECT current_database()::text, (SELECT count(*) FROM synthetic_demo_marker \
         WHERE id = 'SYN-DEMO-MARKER' AND database_name = current_database())",
    )
    .fetch_one(&pool)
    .await
    .expect("civic_lens is reachable as mcl_app");
    assert_eq!((db.as_str(), marker), ("civic_lens", 1));
    pool
}

struct Server {
    addr: SocketAddr,
}

async fn start(clock: &str) -> Server {
    let state = AppState::with_clock(app_pool().await, fixed(clock));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = router(state, &[ORIGIN.to_string()]);
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Server { addr }
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
    fn data(&self) -> Value {
        self.json()["data"].clone()
    }
}

async fn send(addr: SocketAddr, method: &str, path: &str, headers: &[(&str, &str)]) -> Resp {
    let mut req = format!("{method} {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n");
    for (k, v) in headers {
        req.push_str(&format!("{k}: {v}\r\n"));
    }
    req.push_str("\r\n");
    let mut s = TcpStream::connect(addr).await.unwrap();
    s.write_all(req.as_bytes()).await.unwrap();
    let mut buf = Vec::new();
    let _ = tokio::time::timeout(Duration::from_secs(10), s.read_to_end(&mut buf)).await;
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

async fn get(s: &Server, path: &str) -> Resp {
    send(s.addr, "GET", path, &[]).await
}

// ------------------------------------------------------------------------------------------------- independent seed oracle

fn seed(stem: &str) -> Vec<Value> {
    let p = mcl_infrastructure::demo::default_seed_dir().join(format!("{stem}.json"));
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

fn one(rows: &[Value], key: &str, id: &str) -> Option<Value> {
    rows.iter().find(|r| r[key] == id).cloned()
}

fn many(rows: &[Value], key: &str, id: &str) -> Vec<Value> {
    rows.iter().filter(|r| r[key] == id).cloned().collect()
}

fn ids(rows: &[Value]) -> Vec<String> {
    rows.iter()
        .map(|r| r["id"].as_str().unwrap().to_string())
        .collect()
}

// ------------------------------------------------------------------------------------------------------------- getKundali

#[tokio::test(flavor = "multi_thread")]
async fn every_seeded_issue_has_a_kundali_that_matches_the_seed_relationships() {
    let s = start(CAP0_INSTANT).await;
    let (issues, wards, assets, depts, juris, works) = (
        seed("issues"),
        seed("wards"),
        seed("assets"),
        seed("departments"),
        seed("jurisdictions"),
        seed("work-orders"),
    );
    let (evidence, claims, verifs, corrections, events) = (
        seed("evidence"),
        seed("completion-claims"),
        seed("verifications"),
        seed("corrections"),
        seed("lifecycle-events"),
    );
    for id in ISSUES {
        let r = get(&s, &format!("/v1/kundalis/{id}")).await;
        assert_eq!(r.status, 200, "{id}: {}", r.body);
        assert_eq!(r.header("content-type"), Some("application/json"));
        assert_eq!(r.header("cache-control"), Some("no-store"));
        let body = r.json();
        assert!(body["correlationId"]
            .as_str()
            .is_some_and(|c| !c.is_empty()));
        let d = &body["data"];
        let issue = one(&issues, "id", id).unwrap();

        // exact required key set of the Kundali schema, nothing added
        let mut keys: Vec<&str> = d.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "asset",
                "auditEvents",
                "budgetTrace",
                "canonicalDemoPath",
                "completionClaim",
                "corrections",
                "dlpStatus",
                "evidence",
                "issue",
                "jurisdiction",
                "responsibleDepartment",
                "syntheticBanner",
                "verification",
                "ward",
                "workOrder"
            ]
        );
        assert_eq!(
            d["syntheticBanner"],
            "DEMONSTRATION - SYNTHETIC DATA - NOT AN OFFICIAL BMC PORTAL"
        );
        assert_eq!(d["canonicalDemoPath"], format!("/demo/kundali/{id}"));
        assert_eq!(d["issue"], issue, "{id}: issue is the committed record");
        assert_eq!(
            d["ward"],
            issue["wardCandidateId"]
                .as_str()
                .and_then(|w| one(&wards, "id", w))
                .unwrap_or(Value::Null),
            "{id}: ward"
        );
        assert_eq!(
            d["asset"],
            issue["assetId"]
                .as_str()
                .and_then(|a| one(&assets, "id", a))
                .unwrap_or(Value::Null),
            "{id}: asset"
        );
        assert_eq!(
            d["responsibleDepartment"],
            one(
                &depts,
                "id",
                issue["responsibleDepartmentId"].as_str().unwrap()
            )
            .unwrap()
        );
        assert_eq!(
            d["jurisdiction"],
            one(&juris, "issueId", id).unwrap(),
            "{id}: jurisdiction"
        );
        let work = issue["workOrderId"]
            .as_str()
            .and_then(|w| one(&works, "id", w));
        assert_eq!(d["workOrder"], work.clone().unwrap_or(Value::Null));
        assert_eq!(
            d["dlpStatus"].is_null(),
            work.is_none(),
            "{id}: dlp only with a work order"
        );
        assert_eq!(
            d["budgetTrace"].is_null(),
            work.is_none(),
            "{id}: trace only with a work order"
        );
        let mut want_ev = ids(&many(&evidence, "issueId", id));
        want_ev.sort();
        let mut got_ev = ids(d["evidence"].as_array().unwrap());
        got_ev.sort();
        assert_eq!(got_ev, want_ev, "{id}: evidence");
        for e in d["evidence"].as_array().unwrap() {
            assert_eq!(
                Some(e.clone()),
                one(&evidence, "id", e["id"].as_str().unwrap())
            );
        }
        assert_eq!(
            d["completionClaim"],
            one(&claims, "issueId", id).unwrap_or(Value::Null)
        );
        assert_eq!(
            d["verification"],
            one(&verifs, "issueId", id).unwrap_or(Value::Null)
        );
        assert_eq!(
            ids(d["corrections"].as_array().unwrap()),
            ids(&many(&corrections, "entityId", id)),
            "{id}: corrections"
        );
        let mut want_ev: Vec<Value> = many(&events, "entityId", id);
        want_ev.sort_by_key(|e| e["sequence"].as_u64().unwrap());
        assert_eq!(
            d["auditEvents"].as_array().unwrap(),
            &want_ev,
            "{id}: audit events in sequence order"
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn journey_1_kundali_keeps_claim_and_verification_distinct_and_links_the_trace() {
    let s = start(CAP0_INSTANT).await;
    let d = get(&s, "/v1/kundalis/SYN-DEMO-KND-001").await.data();
    assert_eq!(d["issue"]["status"], "CLOSURE_CLAIMED_PENDING_VERIFICATION");
    assert_eq!(d["completionClaim"]["id"], "SYN-DEMO-CLM-001");
    assert_eq!(d["verification"]["state"], "WINDOW_OPEN");
    assert!(d["verification"]["citizenVerdict"].is_null());
    assert_eq!(d["workOrder"]["id"], "SYN-DEMO-WO-001");
    assert_eq!(d["budgetTrace"]["budget"]["id"], "SYN-DEMO-BUD-001");
    assert_eq!(d["budgetTrace"]["traceabilityStatus"], "LINKED_TO_STREET");
    assert_eq!(d["dlpStatus"]["status"], "ACTIVE");
    assert_eq!(d["dlpStatus"]["evaluatedAt"], CAP0_INSTANT);
    assert_eq!(
        d["dlpStatus"]["syntheticFreshRepairEstimatePaise"],
        1_200_000
    );
    assert_eq!(
        d["dlpStatus"]["potentialSpendLabel"],
        "SYNTHETIC_POTENTIAL_NOT_REALIZED_SAVINGS"
    );
    // integer paise only: no JSON float anywhere in the money fields
    for p in [
        &d["workOrder"]["valuePaise"],
        &d["budgetTrace"]["budget"]["amountPaise"],
        &d["budgetTrace"]["contract"]["valuePaise"],
        &d["budgetTrace"]["tender"]["estimatedValuePaise"],
    ] {
        assert!(p.is_u64(), "paise must be an integer: {p}");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn kundali_derives_dlp_status_from_the_injected_instant_only() {
    for (instant, status) in [
        ("2026-03-31T23:59:59Z", "NOT_STARTED"),
        ("2026-04-01T00:00:00Z", "ACTIVE"),
        (CAP0_INSTANT, "ACTIVE"),
        ("2027-03-31T18:29:59Z", "ACTIVE"),
        ("2027-03-31T18:30:00Z", "EXPIRED"),
        ("2030-01-01T00:00:00Z", "EXPIRED"),
    ] {
        let s = start(instant).await;
        let k = get(&s, "/v1/kundalis/SYN-DEMO-KND-001").await.data();
        assert_eq!(k["dlpStatus"]["status"], status, "kundali at {instant}");
        assert_eq!(k["dlpStatus"]["evaluatedAt"], instant);
        let w = get(&s, "/v1/works/SYN-DEMO-WO-001").await.data();
        assert_eq!(w["dlpStatus"]["status"], status, "work at {instant}");
        assert_eq!(w["dlpStatus"]["evaluatedAt"], instant);
    }
    // the stored work order never changes with the instant: status is not persisted
    let (n,): (i64,) = sqlx::query_as(
        "SELECT count(*) FROM information_schema.columns WHERE table_name IN ('work_orders','dlp_status') \
         AND column_name IN ('status_at','evaluated_at','dlp_state')",
    )
    .fetch_one(&app_pool().await)
    .await
    .unwrap();
    assert_eq!(n, 0, "no derived DLP column is stored");
}

#[tokio::test(flavor = "multi_thread")]
async fn kundali_is_one_snapshot_with_one_evaluation_instant_per_request() {
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let c = calls.clone();
    let t = at(CAP0_INSTANT);
    let clock: Clock = Arc::new(move || {
        c.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        t
    });
    let state = AppState::with_clock(app_pool().await, clock);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = router(state, &[ORIGIN.to_string()]);
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let s = Server { addr };
    let r = get(&s, "/v1/kundalis/SYN-DEMO-KND-001").await;
    assert_eq!(r.status, 200);
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    let r = get(&s, "/v1/works/SYN-DEMO-WO-001").await;
    assert_eq!(r.status, 200);
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn disputed_and_provisional_jurisdiction_stay_honest_and_never_assert_legal_ownership() {
    let s = start(CAP0_INSTANT).await;
    let disputed = get(&s, "/v1/kundalis/SYN-DEMO-KND-003").await.data();
    assert_eq!(disputed["jurisdiction"]["status"], "CONFLICT_DISPUTED");
    assert_eq!(disputed["jurisdiction"]["legalOwnershipAsserted"], false);
    assert!(disputed["jurisdiction"]["confirmationBasis"].is_null());
    let provisional = get(&s, "/v1/kundalis/SYN-DEMO-KND-002").await.data();
    assert_eq!(
        provisional["jurisdiction"]["status"],
        "SPATIALLY_INFERRED_PROVISIONAL"
    );
    assert!(provisional["workOrder"].is_null() && provisional["dlpStatus"].is_null());
    // recurrence evidence for the DLP-exception issue is carried as committed evidence metadata
    let recurring = get(&s, "/v1/kundalis/SYN-DEMO-KND-004").await.data();
    assert_eq!(recurring["evidence"][0]["stage"], "DISPUTED_OR_RECURRING");
}

// ------------------------------------------------------------------------------------------------------------- getWorkOrder

#[tokio::test(flavor = "multi_thread")]
async fn work_order_detail_matches_the_seed_chain() {
    let s = start(CAP0_INSTANT).await;
    let r = get(&s, "/v1/works/SYN-DEMO-WO-001").await;
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(r.header("etag"), Some("\"1\""));
    let d = r.data();
    let work = one(&seed("work-orders"), "id", "SYN-DEMO-WO-001").unwrap();
    assert_eq!(d["workOrder"], work);
    assert_eq!(
        d["contract"],
        one(
            &seed("contracts"),
            "id",
            work["contractId"].as_str().unwrap()
        )
        .unwrap()
    );
    assert_eq!(
        d["contractor"],
        one(
            &seed("contractors"),
            "id",
            d["contract"]["vendorId"].as_str().unwrap()
        )
        .unwrap()
    );
    assert_eq!(
        d["asset"],
        one(&seed("assets"), "id", work["assetId"].as_str().unwrap()).unwrap()
    );
    assert_eq!(d["linkedIssueIds"], json!(["SYN-DEMO-KND-001"]));
    assert!(d["contractor"]
        .get("officialPerformanceRating")
        .is_none_or(Value::is_null));
    assert_eq!(d["workOrder"]["valuePaise"], 180_000_000);
    assert_eq!(d["dlpStatus"]["status"], "ACTIVE");
}

// ---------------------------------------------------------------------------------------------------------- getBudgetTrace

#[tokio::test(flavor = "multi_thread")]
async fn complete_chain_links_budget_tender_contract_contractor_work_and_asset() {
    let s = start(CAP0_INSTANT).await;
    let r = get(&s, "/v1/budget-traces/SYN-DEMO-BUD-001").await;
    assert_eq!(r.status, 200, "{}", r.body);
    let d = r.data();
    assert_eq!(d["traceabilityStatus"], "LINKED_TO_STREET");
    assert_eq!(d["lastProvenLink"], "ASSET_GEOMETRY");
    assert!(d["missingNextLink"].is_null());
    assert_eq!(d["budget"]["amountPaise"], 250_000_000);
    assert_eq!(d["tender"]["id"], "SYN-DEMO-TND-001");
    assert_eq!(d["contract"]["id"], "SYN-DEMO-CON-001");
    assert_eq!(d["contractor"]["id"], "SYN-DEMO-VND-001");
    assert_eq!(d["workOrder"]["id"], "SYN-DEMO-WO-001");
    assert_eq!(d["asset"]["id"], "SYN-DEMO-AST-ROAD-001");
    assert_eq!(
        d["explanation"], d["budget"]["traceabilityExplanation"],
        "the explanation is the stored one"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn gap_chain_stops_at_the_tender_and_invents_no_geometry_or_links() {
    let s = start(CAP0_INSTANT).await;
    let d = get(&s, "/v1/budget-traces/SYN-DEMO-BUD-002").await.data();
    assert_eq!(d["traceabilityStatus"], "GAP_BEFORE_STREET_GEOMETRY");
    assert_eq!(d["lastProvenLink"], "TENDER");
    assert_eq!(d["missingNextLink"], "STREET_LEVEL_GEOMETRY");
    assert_eq!(d["tender"]["id"], "SYN-DEMO-TND-002");
    assert_eq!(d["tender"]["streetGeometryAvailable"], false);
    for k in ["contract", "contractor", "workOrder", "asset"] {
        assert!(d[k].is_null(), "{k} must be null, never invented");
    }
    let text = d["explanation"].as_str().unwrap();
    assert!(text.contains("TRACEABILITY GAP") && text.contains("not an allegation"));
    assert_eq!(d["budget"]["amountPaise"], 120_000_000);
}

// ------------------------------------------------------------------------------------------------------------- error shapes

#[tokio::test(flavor = "multi_thread")]
async fn malformed_identifiers_and_queries_are_400_problems_that_echo_nothing() {
    let s = start(CAP0_INSTANT).await;
    let long = format!("SYN-DEMO-{}", "A".repeat(200));
    let cases = [
        "/v1/kundalis/not-an-id".to_string(),
        "/v1/kundalis/syn-demo-knd-001".to_string(),
        "/v1/kundalis/SYN-DEMO-".to_string(),
        "/v1/kundalis/SYN-DEMO--X".replace("--X", "-%20X"),
        "/v1/kundalis/SYN-DEMO-KND-001%27%20OR%201=1".to_string(),
        "/v1/works/%3Cscript%3Ealert(1)%3C%2Fscript%3E".to_string(),
        "/v1/works/..%2F..%2Fetc%2Fpasswd".to_string(),
        "/v1/budget-traces/SYN-DEMO-%FF".to_string(),
        format!("/v1/budget-traces/{long}"),
        "/v1/kundalis/SYN-DEMO-KND-001?x=1".to_string(),
        "/v1/works/SYN-DEMO-WO-001?dlpOnly=true".to_string(),
        "/v1/budget-traces/SYN-DEMO-BUD-001?".to_string() + "a=b",
    ];
    for path in cases {
        let r = get(&s, &path).await;
        assert_eq!(r.status, 400, "{path}: {}", r.body);
        assert_eq!(r.header("content-type"), Some("application/problem+json"));
        let p = r.json();
        assert_eq!(p["status"], 400);
        assert!(p["correlationId"].as_str().is_some());
        let lower = r.body.to_lowercase();
        for leak in [
            "select ", "postgres", "sqlx", "panicked", "c:\\", "script", "passwd", "or 1=1",
        ] {
            assert!(!lower.contains(leak), "{path} leaked {leak}: {}", r.body);
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn valid_but_absent_identifiers_are_404_problems() {
    let s = start(CAP0_INSTANT).await;
    for path in [
        "/v1/kundalis/SYN-DEMO-KND-999",
        "/v1/works/SYN-DEMO-WO-999",
        "/v1/budget-traces/SYN-DEMO-BUD-999",
        // a real id of the wrong kind is also absent for that operation
        "/v1/kundalis/SYN-DEMO-WO-001",
        "/v1/works/SYN-DEMO-KND-001",
        "/v1/budget-traces/SYN-DEMO-WO-001",
    ] {
        let r = get(&s, path).await;
        assert_eq!(r.status, 404, "{path}: {}", r.body);
        assert_eq!(r.header("content-type"), Some("application/problem+json"));
        let p = r.json();
        assert_eq!(p["status"], 404);
        assert!(!r.body.contains("SYN-DEMO-KND-999"), "no id echo");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn responses_carry_the_record_version_etag_and_a_sanitized_correlation_id() {
    let s = start(CAP0_INSTANT).await;
    for path in [
        "/v1/kundalis/SYN-DEMO-KND-001",
        "/v1/works/SYN-DEMO-WO-001",
        "/v1/budget-traces/SYN-DEMO-BUD-002",
    ] {
        let r = send(
            s.addr,
            "GET",
            path,
            &[("X-Correlation-Id", "p4-test-correlation-1")],
        )
        .await;
        assert_eq!(r.status, 200, "{path}");
        assert_eq!(r.header("etag"), Some("\"1\""), "{path}");
        assert_eq!(r.header("x-correlation-id"), Some("p4-test-correlation-1"));
        assert_eq!(r.json()["correlationId"], "p4-test-correlation-1");
    }
    let r = send(
        s.addr,
        "GET",
        "/v1/kundalis/SYN-DEMO-KND-001",
        &[("X-Correlation-Id", "bad id with spaces <script>")],
    )
    .await;
    assert_eq!(r.status, 200);
    let cid = r.header("x-correlation-id").unwrap();
    assert!(!cid.contains('<') && !cid.contains(' '), "sanitized: {cid}");
}

// ------------------------------------------------------------------------------------------------- scope and read-only

#[tokio::test(flavor = "multi_thread")]
async fn only_the_three_p4_operations_are_added_and_nothing_can_write() {
    let s = start(CAP0_INSTANT).await;
    // later-phase reads are still absent, not silently half-implemented
    for path in ["/v1/issues/SYN-DEMO-KND-001", "/v1/audit/SYN-DEMO-KND-001"] {
        assert_eq!(get(&s, path).await.status, 404, "{path} is deferred");
    }
    // every mutating method on the new routes is refused, and the reset operation does not exist
    for method in ["POST", "PUT", "PATCH", "DELETE"] {
        for path in [
            "/v1/kundalis/SYN-DEMO-KND-001",
            "/v1/works/SYN-DEMO-WO-001",
            "/v1/budget-traces/SYN-DEMO-BUD-001",
        ] {
            assert_eq!(
                send(s.addr, method, path, &[]).await.status,
                405,
                "{method} {path}"
            );
        }
    }
    assert_ne!(
        send(s.addr, "POST", "/v1/demo/reset", &[]).await.status,
        200
    );
    // the baseline is untouched by any of it
    let (n,): (i64,) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM issues) + (SELECT count(*) FROM lifecycle_events)",
    )
    .fetch_one(&app_pool().await)
    .await
    .unwrap();
    assert_eq!(n, 6 + 27);
}

#[tokio::test(flavor = "multi_thread")]
async fn demo_persona_header_is_presentation_only_and_never_changes_a_response() {
    let s = start(CAP0_INSTANT).await;
    let plain = get(&s, "/v1/kundalis/SYN-DEMO-KND-001").await.data();
    for persona in [
        "authority",
        "moderator",
        "demo_admin",
        "independent_reviewer",
    ] {
        let r = send(
            s.addr,
            "GET",
            "/v1/kundalis/SYN-DEMO-KND-001",
            &[("X-Demo-Persona", persona)],
        )
        .await;
        assert_eq!(r.data(), plain, "{persona}");
    }
}
