//! P3 integration tests: the real Axum router on a real loopback socket, reading the real `civic_lens` PostGIS database
//! through the least-privilege `mcl_app` identity (login role `mcl_api`, `APP_DATABASE_URL` from `.env.local`).
//!
//! Every test is read-only and relies on the committed CP-00 baseline (`mcl-seed reset`). Nothing here mutates, resets or
//! prepares database state. Before any request the harness proves it is connected to the marked synthetic `civic_lens`
//! database on a local host. The expected results are computed independently from `data/demo/*.json` (a plain Rust oracle),
//! never copied from the server's own output. The readiness-failure test uses an isolated app with an unreachable pool and
//! never touches the shared database.
use mcl_api::{router, AppState, Clock};
use mcl_domain::dlp::{dlp_status_at, DlpStatus};
use mcl_infrastructure::read;
use serde_json::Value;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::PgPool;
use std::collections::BTreeSet;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use time::format_description::well_known::{Iso8601, Rfc3339};
use time::{Date, OffsetDateTime};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

const ORIGIN: &str = "http://localhost:5173";
const FULL_BBOX: &str = "72.77,18.89,72.99,19.275";
const CAP0_INSTANT: &str = "2026-11-20T00:00:00Z";

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
    assert_eq!(
        t.database, "civic_lens",
        "tests only run against civic_lens"
    );
    let pool = read::connect_app(&url).await.unwrap();
    // Live-database safety: the marked synthetic demonstration database, never anything else.
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

async fn serve(state: AppState) -> Server {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = router(state, &[ORIGIN.to_string()]);
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Server { addr }
}

async fn start(clock: &str) -> Server {
    serve(AppState::with_clock(app_pool().await, fixed(clock))).await
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

/// Send raw bytes as one HTTP/1.1 exchange and parse the answer.
async fn raw(addr: SocketAddr, request: &[u8]) -> Resp {
    let mut s = TcpStream::connect(addr).await.unwrap();
    s.write_all(request).await.unwrap();
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

async fn send(addr: SocketAddr, method: &str, path: &str, headers: &[(&str, &str)]) -> Resp {
    let mut req = format!("{method} {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n");
    for (k, v) in headers {
        req.push_str(&format!("{k}: {v}\r\n"));
    }
    req.push_str("\r\n");
    raw(addr, req.as_bytes()).await
}

async fn get(s: &Server, path: &str) -> Resp {
    send(s.addr, "GET", path, &[]).await
}

fn ids_of_list(r: &Resp) -> BTreeSet<String> {
    r.json()["data"]["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["id"].as_str().unwrap().to_string())
        .collect()
}

fn issue_ids_of_map(r: &Resp) -> BTreeSet<String> {
    r.json()["data"]["features"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|f| f["properties"]["kind"] == "ISSUE")
        .map(|f| f["id"].as_str().unwrap().to_string())
        .collect()
}

fn encode(p: &str) -> String {
    p.replace('/', "%2F")
}

// ------------------------------------------------------------------------------------------------- independent seed oracle

fn seed(stem: &str) -> Vec<Value> {
    let p = mcl_infrastructure::demo::default_seed_dir().join(format!("{stem}.json"));
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

fn by_id(rows: &[Value], id: &str) -> Option<Value> {
    rows.iter().find(|r| r["id"] == id).cloned()
}

struct Oracle {
    issues: Vec<Value>,
    wards: Vec<Value>,
    works: Vec<Value>,
    dlps: Vec<Value>,
}

impl Oracle {
    fn load() -> Self {
        Oracle {
            issues: seed("issues"),
            wards: seed("wards"),
            works: seed("work-orders"),
            dlps: seed("dlp-status"),
        }
    }
    fn dlp_active(&self, work_order: &str, instant: &str) -> bool {
        let Some(w) = by_id(&self.works, work_order) else {
            return false;
        };
        let Some(d) = self.dlps.iter().find(|d| d["workOrderId"] == work_order) else {
            return false;
        };
        let starts = Date::parse(d["dlpStartsOn"].as_str().unwrap(), &Iso8601::DATE).unwrap();
        let ends = at(w["dlpEndsAt"].as_str().unwrap());
        dlp_status_at(starts, ends, at(instant)) == DlpStatus::Active
    }
    fn expected_issue_ids(
        &self,
        ward: Option<&str>,
        category: Option<&str>,
        status: Option<&str>,
        dlp_only: bool,
        instant: &str,
    ) -> BTreeSet<String> {
        self.issues
            .iter()
            .filter(|i| {
                ward.is_none_or(|code| {
                    i["wardCandidateId"]
                        .as_str()
                        .and_then(|wid| by_id(&self.wards, wid))
                        .is_some_and(|w| w["code"] == code)
                })
            })
            .filter(|i| category.is_none_or(|c| i["category"] == c))
            .filter(|i| status.is_none_or(|s| i["status"] == s))
            .filter(|i| {
                !dlp_only
                    || i["workOrderId"]
                        .as_str()
                        .is_some_and(|w| self.dlp_active(w, instant))
            })
            .map(|i| i["id"].as_str().unwrap().to_string())
            .collect()
    }
}

fn query(
    ward: Option<&str>,
    category: Option<&str>,
    status: Option<&str>,
    dlp: Option<&str>,
) -> String {
    let mut q = Vec::new();
    if let Some(w) = ward {
        q.push(format!("ward={}", encode(w)));
    }
    if let Some(c) = category {
        q.push(format!("category={c}"));
    }
    if let Some(s) = status {
        q.push(format!("status={s}"));
    }
    if let Some(d) = dlp {
        q.push(format!("dlpOnly={d}"));
    }
    q.join("&")
}

// --------------------------------------------------------------------------------------------------------- identity tests

#[tokio::test(flavor = "multi_thread")]
async fn runtime_identity_is_mcl_app_through_mcl_api_read_only_and_cannot_write_or_create() {
    let pool = app_pool().await;
    let id = read::runtime_identity(&pool).await.unwrap();
    assert!(id.is_least_privilege(), "{id:?}");
    assert_eq!(id.database, "civic_lens");
    // Every mutation is refused (read-only session first, privileges behind it).
    for sql in [
        "DELETE FROM issues",
        "UPDATE issues SET title = title",
        "INSERT INTO issues (id) VALUES ('SYN-DEMO-X-1')",
        "TRUNCATE issues",
        "CREATE TABLE p3_probe (x int)",
        "UPDATE lifecycle_events SET summary = 'x'",
        "DELETE FROM lifecycle_events",
    ] {
        let e = sqlx::query(sql).execute(&pool).await.unwrap_err();
        let code = e
            .as_database_error()
            .and_then(|d| d.code().map(|c| c.to_string()));
        assert!(
            matches!(code.as_deref(), Some("25006") | Some("42501")),
            "{sql}: {e}"
        );
    }
    // The login role has no privileges of its own: without SET ROLE it cannot read anything.
    let url = read::app_database_url().unwrap();
    let plain = PgPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .unwrap();
    let who: String = sqlx::query_scalar("SELECT current_user::text")
        .fetch_one(&plain)
        .await
        .unwrap();
    assert_eq!(who, "mcl_api");
    let e = sqlx::query("SELECT count(*) FROM issues")
        .fetch_one(&plain)
        .await
        .unwrap_err();
    assert_eq!(
        e.as_database_error()
            .and_then(|d| d.code().map(|c| c.to_string()))
            .as_deref(),
        Some("42501")
    );
    // mcl_app itself stays NOLOGIN (the P1 invariant) and the login role is a plain, non-privileged role.
    let (app_login, api_super, api_createdb, api_createrole, api_inherit): (bool, bool, bool, bool, bool) =
        sqlx::query_as(
            "SELECT (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'mcl_app'), a.rolsuper, a.rolcreatedb, \
                    a.rolcreaterole, a.rolinherit FROM pg_roles a WHERE a.rolname = 'mcl_api'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!app_login && !api_super && !api_createdb && !api_createrole && !api_inherit);
}

#[tokio::test(flavor = "multi_thread")]
async fn runtime_credentials_are_never_in_tracked_files_or_example_placeholders() {
    let root = mcl_infrastructure::demo::workspace_root();
    let example = std::fs::read_to_string(root.join(".env.example")).unwrap();
    let line = example
        .lines()
        .find(|l| l.starts_with("APP_DATABASE_URL="))
        .unwrap();
    assert!(
        line.contains("replace-with"),
        "example must hold a placeholder only"
    );
    // The real secret in .env.local must not appear in any tracked source/config/doc file.
    let real = read::app_database_url().unwrap();
    let secret = real
        .split_once("mcl_api:")
        .unwrap()
        .1
        .split('@')
        .next()
        .unwrap()
        .to_string();
    assert!(secret.len() >= 16 && !secret.starts_with("replace-with"));
    for dir in [
        "crates",
        "migrations",
        "audit",
        "openapi",
        "scripts",
        "tests",
        "apps/web/src",
        "data",
    ] {
        scan_for(&root.join(dir), &secret);
    }
    for f in [
        "TASKS.md",
        ".env.example",
        "README.md",
        "compose.yaml",
        "PACKAGE_MANIFEST.json",
    ] {
        let t = std::fs::read_to_string(root.join(f)).unwrap();
        assert!(!t.contains(&secret), "{f}");
    }
}

fn scan_for(dir: &std::path::Path, needle: &str) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if name == "target" || name == "node_modules" || name == "dist" {
            continue;
        }
        if p.is_dir() {
            scan_for(&p, needle);
        } else if let Ok(t) = std::fs::read_to_string(&p) {
            assert!(!t.contains(needle), "secret found in {}", p.display());
        }
    }
}

// ------------------------------------------------------------------------------------------------- health, version, CORS

#[tokio::test(flavor = "multi_thread")]
async fn health_live_ready_and_version_have_the_contract_shapes() {
    let s = start(CAP0_INSTANT).await;
    let live = get(&s, "/health/live").await;
    assert_eq!(live.status, 200);
    assert_eq!(live.json(), serde_json::json!({"status": "UP"}));
    let ready = get(&s, "/health/ready").await;
    assert_eq!(ready.status, 200);
    let j = ready.json();
    assert_eq!(
        (j["status"].as_str(), j["database"].as_str()),
        (Some("READY"), Some("UP"))
    );
    assert!(j["postgisVersion"].as_str().unwrap().starts_with("3."));
    assert_eq!(j.as_object().unwrap().len(), 3);
    let v = get(&s, "/version").await;
    assert_eq!(v.status, 200);
    let vj = v.json();
    let mut keys: Vec<&str> = vj.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort();
    assert_eq!(keys, ["apiVersion", "packageVersion", "recordNature"]);
    assert_eq!(vj["packageVersion"], "1.2.3");
    assert_eq!(vj["recordNature"], "SYNTHETIC_DEMONSTRATION");
    // nothing that identifies the machine, user, paths or repository
    let body = v.body.to_lowercase();
    for leak in [
        "users", "hemant", "c:\\", "c:/", "git", "http", "rustc", "branch",
    ] {
        assert!(!body.contains(leak), "{leak}");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn readiness_fails_honestly_for_an_unreachable_database_without_touching_the_shared_one() {
    // Isolated app: a lazy pool aimed at a closed local port, with a short acquire bound.
    let unreachable = PgConnectOptions::new()
        .host("127.0.0.1")
        .port(1)
        .username("mcl_api")
        .database("civic_lens");
    let pool = PgPoolOptions::new()
        .acquire_timeout(Duration::from_secs(1))
        .connect_lazy_with(unreachable);
    let s = serve(AppState::with_clock(pool, fixed(CAP0_INSTANT))).await;
    // liveness is process-only and stays UP
    let live = get(&s, "/health/live").await;
    assert_eq!(
        (
            live.status,
            live.json()["status"].as_str().map(str::to_string)
        ),
        (200, Some("UP".into()))
    );
    let ready = get(&s, "/health/ready").await;
    assert_eq!(ready.status, 503);
    assert_eq!(
        ready.json(),
        serde_json::json!({"status": "NOT_READY", "database": "DOWN", "postgisVersion": null})
    );
    // data endpoints answer with a problem, not a fabricated body and not an internal detail
    let issues = get(&s, "/v1/issues").await;
    assert_eq!(issues.status, 503);
    assert_eq!(
        issues.header("content-type"),
        Some("application/problem+json")
    );
    let p = issues.json();
    assert_eq!(p["status"], 503);
    assert!(p.get("data").is_none());
    for leak in ["127.0.0.1", "postgres", "sqlx", "civic_lens", "mcl_api"] {
        assert!(!issues.body.contains(leak), "{leak}");
    }
    // the shared database is still healthy
    let shared = start(CAP0_INSTANT).await;
    assert_eq!(get(&shared, "/health/ready").await.status, 200);
}

#[tokio::test(flavor = "multi_thread")]
async fn cors_allows_only_the_exact_local_origin_methods_and_headers_and_never_a_wildcard() {
    let s = start(CAP0_INSTANT).await;
    // approved origin on a simple request
    let ok = send(s.addr, "GET", "/health/live", &[("Origin", ORIGIN)]).await;
    assert_eq!(ok.header("access-control-allow-origin"), Some(ORIGIN));
    // unapproved origins receive no allowing header (the request itself is not rejected)
    for bad in [
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "https://localhost:5173",
        "http://evil.example",
        "null",
        "http://localhost:5173.evil.example",
    ] {
        let r = send(s.addr, "GET", "/health/live", &[("Origin", bad)]).await;
        assert_eq!(r.status, 200, "{bad}");
        assert!(r.header("access-control-allow-origin").is_none(), "{bad}");
    }
    // preflight from the approved origin
    let pre = send(
        s.addr,
        "OPTIONS",
        "/v1/map/features",
        &[
            ("Origin", ORIGIN),
            ("Access-Control-Request-Method", "GET"),
            (
                "Access-Control-Request-Headers",
                "x-correlation-id,x-demo-persona",
            ),
        ],
    )
    .await;
    assert!(pre.status == 200 || pre.status == 204, "{}", pre.status);
    assert_eq!(pre.header("access-control-allow-origin"), Some(ORIGIN));
    // P5 extends CORS narrowly for the confirmed commands: POST and Idempotency-Key. P6 adds If-Match, which only
    // `resolveJurisdiction` declares. No wildcard.
    assert_eq!(pre.header("access-control-allow-methods"), Some("GET,POST"));
    let allowed = pre
        .header("access-control-allow-headers")
        .unwrap()
        .to_lowercase();
    let mut list: Vec<&str> = allowed.split(',').map(str::trim).collect();
    list.sort();
    assert_eq!(
        list,
        [
            "content-type",
            "idempotency-key",
            "if-match",
            "x-correlation-id",
            "x-demo-persona"
        ]
    );
    // preflight from an unapproved origin
    let bad = send(
        s.addr,
        "OPTIONS",
        "/v1/map/features",
        &[
            ("Origin", "http://evil.example"),
            ("Access-Control-Request-Method", "GET"),
        ],
    )
    .await;
    assert!(bad.header("access-control-allow-origin").is_none());
    // no response anywhere carries a wildcard
    for r in [&ok, &pre, &bad] {
        assert_ne!(r.header("access-control-allow-origin"), Some("*"));
        for (_, v) in &r.headers {
            assert!(v != "*", "wildcard header value");
        }
    }
}

// ----------------------------------------------------------------------------------------------------------- correlation

#[tokio::test(flavor = "multi_thread")]
async fn correlation_id_is_generated_echoed_bounded_and_never_reflected_unsanitized() {
    let s = start(CAP0_INSTANT).await;
    // absent -> generated UUID, echoed in header and body
    let r = get(&s, "/v1/issues").await;
    let h = r.header("x-correlation-id").unwrap().to_string();
    assert_eq!(h.len(), 36);
    assert_eq!(r.json()["correlationId"], h.as_str());
    // valid -> echoed unchanged in header, body and the problem body
    let v = send(
        s.addr,
        "GET",
        "/v1/issues",
        &[("X-Correlation-Id", "trace-ABC_123.xyz")],
    )
    .await;
    assert_eq!(v.header("x-correlation-id"), Some("trace-ABC_123.xyz"));
    assert_eq!(v.json()["correlationId"], "trace-ABC_123.xyz");
    let p = send(
        s.addr,
        "GET",
        "/v1/issues?ward=bad",
        &[("X-Correlation-Id", "trace-ABC_123.xyz")],
    )
    .await;
    assert_eq!(p.status, 400);
    assert_eq!(p.json()["correlationId"], "trace-ABC_123.xyz");
    // bounds from the contract: 8..=128
    let max = "a".repeat(128);
    assert_eq!(
        send(s.addr, "GET", "/health/live", &[("X-Correlation-Id", &max)])
            .await
            .header("x-correlation-id"),
        Some(max.as_str())
    );
    for bad in [
        "a".repeat(129),
        "short".to_string(),
        "has space inside".to_string(),
    ] {
        let r = send(s.addr, "GET", "/health/live", &[("X-Correlation-Id", &bad)]).await;
        let got = r.header("x-correlation-id").unwrap();
        assert_eq!(got.len(), 36, "{bad:?} replaced by a generated id");
        assert_ne!(got, bad);
    }
    // CR/LF cannot smuggle a header: the injected line is a separate request header and the value stays the sanitized part
    let inj = raw(
        s.addr,
        b"GET /health/live HTTP/1.1\r\nHost: x\r\nConnection: close\r\nX-Correlation-Id: abcd1234\r\nX-Injected: yes\r\n\r\n",
    )
    .await;
    assert_eq!(inj.header("x-correlation-id"), Some("abcd1234"));
    assert!(inj.header("x-injected").is_none());
    // a control character inside the value never reaches a handler or a response
    let ctl = raw(
        s.addr,
        b"GET /health/live HTTP/1.1\r\nHost: x\r\nConnection: close\r\nX-Correlation-Id: abcd\x01efgh\r\n\r\n",
    )
    .await;
    assert_eq!(ctl.status, 400);
    assert!(!ctl.body.contains("abcd"));
    // obs-text (non-ASCII) bytes are replaced, not reflected
    let obs = raw(
        s.addr,
        b"GET /health/live HTTP/1.1\r\nHost: x\r\nConnection: close\r\nX-Correlation-Id: abcd\xffefgh12\r\n\r\n",
    )
    .await;
    assert_eq!(obs.status, 200);
    assert_eq!(obs.header("x-correlation-id").unwrap().len(), 36);
}

// --------------------------------------------------------------------------------------------- problems and strict input

#[tokio::test(flavor = "multi_thread")]
async fn bad_requests_are_rfc9457_problems_that_leak_nothing() {
    let s = start(CAP0_INSTANT).await;
    let cases = [
        "/v1/map/features",                               // bbox required
        "/v1/map/features?bbox=72.99,18.89,72.77,19.275", // min > max
        "/v1/map/features?bbox=72.77,19.275,72.99,18.89",
        "/v1/map/features?bbox=181,0,182,1", // out of range
        "/v1/map/features?bbox=0,91,1,92",
        "/v1/map/features?bbox=1,2,3", // wrong arity
        "/v1/map/features?bbox=a,b,c,d",
        "/v1/map/features?bbox=72.77,18.89,72.99,19.275&ward=k/w", // lower-case ward
        "/v1/map/features?bbox=72.77,18.89,72.99,19.275&category=pothole",
        "/v1/map/features?bbox=72.77,18.89,72.99,19.275&dlpOnly=maybe",
        "/v1/issues?bbox=72.77,18.89,72.99,19.275", // bbox is not declared on the list
        "/v1/issues?status=IN_PROGRESS&status=VERIFIED_COMPLETE", // multiple values
        "/v1/issues?ward=",                         // empty
        "/v1/issues?ward=SYN-DEMO-WARD-KW",         // id, not code
        "/v1/issues?ward=K/West",                   // display name, not code
        "/v1/issues?unknown=1",
        "/v1/issues?ward=%ZZ",
    ];
    for path in cases {
        let r = get(&s, path).await;
        assert_eq!(r.status, 400, "{path}");
        assert_eq!(
            r.header("content-type"),
            Some("application/problem+json"),
            "{path}"
        );
        let p = r.json();
        let mut keys: Vec<&str> = p.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort();
        assert_eq!(
            keys,
            ["correlationId", "detail", "status", "title", "type"],
            "{path}"
        );
        assert_eq!(p["status"], 400);
        assert_eq!(p["correlationId"], r.header("x-correlation-id").unwrap());
        let lower = r.body.to_lowercase();
        for leak in [
            "select ", "sqlx", "postgres", "panicked", "src/", "c:\\", "stack",
        ] {
            assert!(!lower.contains(leak), "{path}: {leak}");
        }
    }
    let nf = get(&s, "/v1/nope").await;
    assert_eq!(
        (nf.status, nf.header("content-type")),
        (404, Some("application/problem+json"))
    );
    // POST /v1/issues is the confirmed P5 submitIssue command; an unsupported method on the same path is still a Problem.
    let nm = send(s.addr, "PUT", "/v1/issues", &[("Content-Length", "0")]).await;
    assert_eq!(
        (nm.status, nm.header("content-type")),
        (405, Some("application/problem+json"))
    );
    let reset = send(s.addr, "POST", "/v1/demo/reset", &[("Content-Length", "0")]).await;
    assert!(
        reset.status == 404 || reset.status == 405,
        "the reset endpoint is not part of P3"
    );
}

// ------------------------------------------------------------------------------------- baseline contents and geometry

#[tokio::test(flavor = "multi_thread")]
async fn baseline_list_and_map_match_the_seed_exactly_including_geometry_type_and_order() {
    let s = start(CAP0_INSTANT).await;
    let o = Oracle::load();
    let list = get(&s, "/v1/issues").await;
    assert_eq!(list.status, 200);
    let lj = list.json();
    assert_eq!(lj["data"]["total"], 6);
    assert_eq!(lj["data"]["items"].as_array().unwrap().len(), 6);
    // each returned issue equals its seed record (every field, including geometry), in id order
    let ids: Vec<String> = lj["data"]["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["id"].as_str().unwrap().to_string())
        .collect();
    let mut sorted = ids.clone();
    sorted.sort();
    assert_eq!(ids, sorted, "stable id ordering");
    for item in lj["data"]["items"].as_array().unwrap() {
        let seed = by_id(&o.issues, item["id"].as_str().unwrap()).unwrap();
        assert_eq!(item, &seed, "{}", item["id"]);
    }
    let map = get(&s, &format!("/v1/map/features?bbox={FULL_BBOX}")).await;
    assert_eq!(map.status, 200);
    let mj = map.json();
    assert_eq!(mj["data"]["type"], "FeatureCollection");
    for f in mj["data"]["features"].as_array().unwrap() {
        assert_eq!(f["type"], "Feature");
        assert_eq!(f["id"], f["properties"]["recordId"]);
        assert_eq!(f["properties"]["recordNature"], "SYNTHETIC_DEMONSTRATION");
        // GeoJSON [longitude, latitude]: every vertex lies in Mumbai's longitude and latitude bands
        let mut stack = vec![f["geometry"]["coordinates"].clone()];
        while let Some(c) = stack.pop() {
            if let Some(a) = c.as_array() {
                if a.len() == 2 && a[0].is_f64() {
                    let (lon, lat) = (a[0].as_f64().unwrap(), a[1].as_f64().unwrap());
                    assert!(
                        (72.77..=72.99).contains(&lon) && (18.89..=19.275).contains(&lat),
                        "{lon},{lat}"
                    );
                } else {
                    stack.extend(a.iter().cloned());
                }
            }
        }
        if f["properties"]["kind"] == "ISSUE" {
            let seed = by_id(&o.issues, f["id"].as_str().unwrap()).unwrap();
            // original geometry type and coordinates, not a centroid
            assert_eq!(f["geometry"], seed["geometry"], "{}", f["id"]);
            assert_eq!(f["properties"]["category"], seed["category"]);
            assert_eq!(f["properties"]["status"], seed["status"]);
            assert_eq!(f["properties"]["wardId"], seed["wardCandidateId"]);
            assert_eq!(f["properties"]["title"], seed["title"]);
        }
    }
    let kinds = |k: &str| {
        mj["data"]["features"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|f| f["properties"]["kind"] == k)
            .count()
    };
    assert_eq!(
        (kinds("ISSUE"), kinds("ASSET"), kinds("PUBLIC_WORK")),
        (6, 4, 1)
    );
    // the polygon issue stays a polygon
    let poly = mj["data"]["features"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["id"] == "SYN-DEMO-KND-003")
        .unwrap();
    assert_eq!(poly["geometry"]["type"], "Polygon");
    // assets are drawn on their own geometry; the public work reuses its asset's geometry, never an invented one
    let assets = seed("assets");
    for f in mj["data"]["features"].as_array().unwrap() {
        match f["properties"]["kind"].as_str().unwrap() {
            "ASSET" => assert_eq!(
                f["geometry"],
                by_id(&assets, f["id"].as_str().unwrap()).unwrap()["geometry"]
            ),
            "PUBLIC_WORK" => {
                let w = by_id(&o.works, f["id"].as_str().unwrap()).unwrap();
                assert_eq!(
                    f["geometry"],
                    by_id(&assets, w["assetId"].as_str().unwrap()).unwrap()["geometry"]
                );
                assert_eq!(f["properties"]["status"], w["status"]);
                assert_eq!(f["properties"]["category"], Value::Null);
            }
            _ => {}
        }
    }
    // the budget traceability-gap record has no authoritative spatial entity, so it is absent from map geometry
    for f in mj["data"]["features"].as_array().unwrap() {
        let id = f["id"].as_str().unwrap();
        assert!(
            !id.contains("-BUD-") && !id.contains("-TND-") && !id.contains("-CON-"),
            "{id}"
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn bbox_selects_by_intersection_with_inclusive_boundaries_and_returns_empty_not_an_error() {
    let s = start(CAP0_INSTANT).await;
    let issue001 = seed("issues")
        .into_iter()
        .find(|i| i["id"] == "SYN-DEMO-KND-001")
        .unwrap();
    let c = issue001["geometry"]["coordinates"].as_array().unwrap();
    let (lon, lat) = (c[0].as_f64().unwrap(), c[1].as_f64().unwrap());
    let only = |q: &str| {
        let q = q.to_string();
        let s = &s;
        async move { issue_ids_of_map(&get(s, &format!("/v1/map/features?{q}")).await) }
    };
    // a box whose edges pass exactly through the point includes it (ST_Intersects is boundary inclusive)
    let edge = format!("bbox={},{},{},{}", lon - 0.001, lat - 0.001, lon, lat);
    assert!(only(&edge).await.contains("SYN-DEMO-KND-001"));
    // a box that stops just short excludes it
    let short = format!(
        "bbox={},{},{},{}",
        lon - 0.001,
        lat - 0.001,
        lon - 0.0000001,
        lat
    );
    assert!(!only(&short).await.contains("SYN-DEMO-KND-001"));
    // far away: empty collection, 200
    let far = get(&s, "/v1/map/features?bbox=10,10,11,11").await;
    assert_eq!(far.status, 200);
    assert_eq!(far.json()["data"]["features"], serde_json::json!([]));
    // the whole world is legal
    assert_eq!(only("bbox=-180,-90,180,90").await.len(), 6);
    // a box crossing only the polygon and the drain line selects them (intersection, not containment)
    let poly = seed("issues")
        .into_iter()
        .find(|i| i["id"] == "SYN-DEMO-KND-003")
        .unwrap();
    let pc = poly["geometry"]["coordinates"][0][0]
        .as_array()
        .unwrap()
        .clone();
    let (plon, plat) = (pc[0].as_f64().unwrap(), pc[1].as_f64().unwrap());
    let tiny = format!(
        "bbox={},{},{},{}",
        plon - 0.00001,
        plat - 0.00001,
        plon + 0.00001,
        plat + 0.00001
    );
    assert!(only(&tiny).await.contains("SYN-DEMO-KND-003"));
}

// --------------------------------------------------------------------------------------------- parity and filter semantics

#[tokio::test(flavor = "multi_thread")]
async fn map_and_list_have_identical_eligible_issue_ids_for_every_shared_filter_combination() {
    let s = start(CAP0_INSTANT).await;
    let o = Oracle::load();
    let wards = [None, Some("K/W"), Some("G/N"), Some("M/E"), Some("Z/Z")];
    let cats = [
        None,
        Some("POTHOLE"),
        Some("DRAIN_BLOCKAGE"),
        Some("WATERLOGGING"),
        Some("FACILITY_REPAIR"),
    ];
    let statuses = [
        None,
        Some("DRAFT_LOCAL"),
        Some("SUBMITTED_UNVERIFIED"),
        Some("TRIAGED_ASSIGNED"),
        Some("IN_PROGRESS"),
        Some("CLOSURE_CLAIMED_PENDING_VERIFICATION"),
        Some("VERIFIED_COMPLETE"),
        Some("DISPUTED_REOPENED"),
    ];
    let dlps = [None, Some("false"), Some("true")];
    let mut checked = 0;
    let mut non_empty = 0;
    for w in wards {
        for c in cats {
            for st in statuses {
                for d in dlps {
                    let q = query(w, c, st, d);
                    let list = get(&s, &format!("/v1/issues?{q}")).await;
                    let map_q = if q.is_empty() {
                        format!("bbox={FULL_BBOX}")
                    } else {
                        format!("bbox={FULL_BBOX}&{q}")
                    };
                    let map = get(&s, &format!("/v1/map/features?{map_q}")).await;
                    assert_eq!((list.status, map.status), (200, 200), "{q}");
                    let (li, mi) = (ids_of_list(&list), issue_ids_of_map(&map));
                    assert_eq!(li, mi, "map/list eligible ids differ for {q}");
                    // the list total is the full eligible count, and equals the independent oracle
                    assert_eq!(
                        list.json()["data"]["total"].as_u64().unwrap() as usize,
                        li.len(),
                        "{q}"
                    );
                    let expected = o.expected_issue_ids(w, c, st, d == Some("true"), CAP0_INSTANT);
                    assert_eq!(li, expected, "oracle mismatch for {q}");
                    // filters narrow, never widen: every returned map feature of any kind honours category/status
                    for f in map.json()["data"]["features"].as_array().unwrap() {
                        if let Some(c) = c {
                            assert_eq!(f["properties"]["category"], c, "{q}");
                        }
                        if let (Some(st), "ISSUE") = (st, f["properties"]["kind"].as_str().unwrap())
                        {
                            assert_eq!(f["properties"]["status"], st, "{q}");
                        }
                        if d == Some("true") {
                            assert_eq!(f["properties"]["dlpActive"], true, "{q}");
                        }
                    }
                    checked += 1;
                    if !li.is_empty() {
                        non_empty += 1;
                    }
                }
            }
        }
    }
    assert_eq!(checked, 5 * 5 * 8 * 3);
    assert!(
        non_empty > 20,
        "the matrix must exercise non-empty results, got {non_empty}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn known_filter_semantics_on_the_cp00_baseline() {
    let s = start(CAP0_INSTANT).await;
    let ids = |q: &str| {
        let q = q.to_string();
        let s = &s;
        async move {
            ids_of_list(&get(s, &format!("/v1/issues?{q}")).await)
                .into_iter()
                .collect::<Vec<_>>()
        }
    };
    assert_eq!(
        ids("ward=K%2FW").await,
        [
            "SYN-DEMO-KND-001",
            "SYN-DEMO-KND-002",
            "SYN-DEMO-KND-003",
            "SYN-DEMO-KND-004"
        ]
    );
    assert_eq!(
        ids("ward=K/W").await.len(),
        4,
        "an unescaped slash is the same code"
    );
    assert_eq!(ids("ward=G%2FN").await, ["SYN-DEMO-KND-005"]);
    assert_eq!(ids("ward=M%2FE").await, ["SYN-DEMO-KND-006"]);
    assert_eq!(
        ids("category=POTHOLE").await,
        [
            "SYN-DEMO-KND-001",
            "SYN-DEMO-KND-002",
            "SYN-DEMO-KND-004",
            "SYN-DEMO-KND-005"
        ]
    );
    assert_eq!(
        ids("status=SUBMITTED_UNVERIFIED").await,
        ["SYN-DEMO-KND-002", "SYN-DEMO-KND-005", "SYN-DEMO-KND-006"]
    );
    // dlpOnly=true keeps only the issue linked to the work order whose DLP is active; false is the same as omitted
    assert_eq!(ids("dlpOnly=true").await, ["SYN-DEMO-KND-001"]);
    assert_eq!(ids("dlpOnly=false").await, ids("").await);
    // KND-002 and KND-004 sit on the same road as the DLP work but are not linked, so DLP is not asserted for them
    assert!(!ids("dlpOnly=true")
        .await
        .contains(&"SYN-DEMO-KND-004".to_string()));
    // combined filters intersect
    assert_eq!(
        ids("ward=K%2FW&category=POTHOLE&status=TRIAGED_ASSIGNED").await,
        ["SYN-DEMO-KND-004"]
    );
    // a well-formed filter that matches nothing is an honest empty list, not an error
    let none = get(&s, "/v1/issues?ward=Z%2FZ").await;
    assert_eq!(none.status, 200);
    assert_eq!(
        none.json()["data"],
        serde_json::json!({"items": [], "total": 0})
    );
    // issue-only filters remove assets and works from the map; ward and dlpOnly keep their DLP-active context
    let m = get(
        &s,
        &format!("/v1/map/features?bbox={FULL_BBOX}&category=POTHOLE"),
    )
    .await;
    assert!(m.json()["data"]["features"]
        .as_array()
        .unwrap()
        .iter()
        .all(|f| f["properties"]["kind"] == "ISSUE"));
    let m = get(
        &s,
        &format!("/v1/map/features?bbox={FULL_BBOX}&dlpOnly=true"),
    )
    .await;
    let kinds: Vec<String> = m.json()["data"]["features"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["properties"]["kind"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(kinds, ["ISSUE", "ASSET", "PUBLIC_WORK"]);
    let m = get(&s, &format!("/v1/map/features?bbox={FULL_BBOX}&ward=G%2FN")).await;
    let ward_ids: BTreeSet<String> = m.json()["data"]["features"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["properties"]["wardId"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(ward_ids, BTreeSet::from(["SYN-DEMO-WARD-GN".to_string()]));
}

// -------------------------------------------------------------------------------------------------- DLP evaluation instant

#[tokio::test(flavor = "multi_thread")]
async fn dlp_is_derived_from_one_injected_instant_per_request() {
    let o = Oracle::load();
    let cases = [
        ("2026-03-31T23:59:59Z", false), // before dlpStartsOn (2026-04-01 UTC midnight)
        ("2026-04-01T00:00:00Z", true),  // start is inclusive
        (CAP0_INSTANT, true),
        ("2027-03-31T18:29:59Z", true), // dlpEndsAt is inclusive
        ("2027-03-31T18:30:00Z", false),
        ("2030-01-01T00:00:00Z", false),
    ];
    for (instant, active) in cases {
        let calls = Arc::new(AtomicUsize::new(0));
        let t = at(instant);
        let counter = calls.clone();
        let clock: Clock = Arc::new(move || {
            counter.fetch_add(1, Ordering::SeqCst);
            t
        });
        let s = serve(AppState::with_clock(app_pool().await, clock)).await;
        // the full map returns several features (issue, asset and work) yet the clock is read once per request
        let map = get(
            &s,
            &format!("/v1/map/features?bbox={FULL_BBOX}&dlpOnly=true"),
        )
        .await;
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "{instant}: one clock read for the map request"
        );
        let list = get(&s, "/v1/issues?dlpOnly=true").await;
        assert_eq!(
            calls.load(Ordering::SeqCst),
            2,
            "{instant}: one clock read for the list request"
        );
        let expect = o.expected_issue_ids(None, None, None, true, instant);
        assert_eq!(
            expect.contains("SYN-DEMO-KND-001"),
            active,
            "oracle {instant}"
        );
        assert_eq!(ids_of_list(&list), expect, "{instant}");
        assert_eq!(issue_ids_of_map(&map), expect, "{instant}");
        let all_features = map.json()["data"]["features"].as_array().unwrap().len();
        assert_eq!(all_features, if active { 3 } else { 0 }, "{instant}");
        // dlpActive on an unfiltered map follows the same instant
        let full = get(&s, &format!("/v1/map/features?bbox={FULL_BBOX}")).await;
        let flagged: Vec<String> = full.json()["data"]["features"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|f| f["properties"]["dlpActive"] == true)
            .map(|f| f["id"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(flagged.len(), if active { 3 } else { 0 }, "{instant}");
        // DLP status is never persisted
        let pool = app_pool().await;
        let cols: i64 = sqlx::query_scalar("SELECT count(*) FROM information_schema.columns WHERE (table_name = 'dlp_status' AND column_name = 'status') OR column_name IN ('dlp_status', 'dlp_active', 'dlp_state')").fetch_one(&pool).await.unwrap();
        assert_eq!(cols, 0, "no stored DLP status column");
    }
}

// ---------------------------------------------------------------------------------------------------- contract inventory

#[test]
fn openapi_inventory_is_unchanged_23_operations_on_22_paths_with_the_same_operation_ids() {
    let text = std::fs::read_to_string(
        mcl_infrastructure::demo::workspace_root().join("openapi/openapi.yaml"),
    )
    .unwrap();
    let paths_at = text.find("\npaths:\n").unwrap();
    let section = &text[paths_at..];
    let paths: Vec<&str> = section
        .lines()
        .filter(|l| l.starts_with("  /") && l.ends_with(':'))
        .collect();
    let ops: Vec<&str> = section
        .lines()
        .filter_map(|l| l.trim_start().strip_prefix("operationId: "))
        .collect();
    assert_eq!(paths.len(), 22, "paths");
    assert_eq!(ops.len(), 23, "operations");
    assert_eq!(
        ops,
        [
            "healthLive",
            "healthReady",
            "getVersion",
            "getMapFeatures",
            "listIssues",
            "submitIssue",
            "getIssue",
            "checkDuplicates",
            "addEvidence",
            "getKundali",
            "getWorkOrder",
            "getBudgetTrace",
            "getAuthorityDashboard",
            "resolveJurisdiction",
            "linkWork",
            "listDlpExceptions",
            "claimCompletion",
            "verifyResolution",
            "submitCorrection",
            "decideCorrection",
            "appealCorrection",
            "getAuditTimeline",
            "resetDemo"
        ]
    );
    // bbox is declared on the map operation only, so parity is tested across the filters both declare
    let map_block = section
        .split("  /v1/map/features:\n")
        .nth(1)
        .unwrap()
        .split("\n  /v1/issues:\n")
        .next()
        .unwrap();
    let issues_get = section
        .split("\n  /v1/issues:\n")
        .nth(1)
        .unwrap()
        .split("    post:")
        .next()
        .unwrap();
    assert!(map_block.contains("parameters/Bbox"));
    assert!(!issues_get.contains("parameters/Bbox"));
    for p in ["Ward", "Category", "Status", "DlpOnly"] {
        assert!(
            map_block.contains(&format!("parameters/{p}"))
                && issues_get.contains(&format!("parameters/{p}")),
            "{p}"
        );
    }
    // the three probes keep `security: []`
    for p in ["/health/live", "/health/ready", "/version"] {
        let block = section
            .split(&format!("\n  {p}:\n"))
            .nth(1)
            .unwrap()
            .split("\n  /")
            .next()
            .unwrap();
        assert!(block.contains("security: []"), "{p}");
    }
}
