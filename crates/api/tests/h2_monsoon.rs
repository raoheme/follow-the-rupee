//! H2 live tests: the real router on a loopback socket against the real, read-only `civic_lens_monsoon` database
//! (`mcl_api` -> `mcl_app`). Expected values are the H1V-accepted figures stored in the database, never computed here.
use mcl_api::{monsoon, router, AppState};
use mcl_infrastructure::read;
use serde_json::Value;
use std::net::SocketAddr;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// The live database is shared and the heavy road queries are time-bounded (5 s), so the live tests run one at a time.
fn lock() -> &'static tokio::sync::Mutex<()> {
    static L: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();
    L.get_or_init(|| tokio::sync::Mutex::new(()))
}

async fn start() -> SocketAddr {
    let pool = read::connect_app(&read::app_database_url().unwrap())
        .await
        .unwrap();
    let state = AppState::new(pool).with_monsoon_pool(monsoon::connect_monsoon().unwrap());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = router(state, &["http://localhost:5173".to_string()]);
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    addr
}

struct Resp {
    status: u16,
    head: String,
    body: String,
}

async fn get(addr: SocketAddr, path: &str) -> Resp {
    let mut s = TcpStream::connect(addr).await.unwrap();
    let req = format!("GET {path} HTTP/1.0\r\nHost: localhost\r\n\r\n");
    s.write_all(req.as_bytes()).await.unwrap();
    let mut buf = Vec::new();
    s.read_to_end(&mut buf).await.unwrap();
    let text = String::from_utf8_lossy(&buf).to_string();
    let (head, body) = text.split_once("\r\n\r\n").unwrap();
    let status = head.split_whitespace().nth(1).unwrap().parse().unwrap();
    Resp {
        status,
        head: head.to_string(),
        body: body.to_string(),
    }
}

fn json(r: &Resp) -> Value {
    serde_json::from_str(&r.body).unwrap()
}

#[tokio::test]
async fn overview_serves_the_h1v_figures_from_the_database() {
    let _g = lock().lock().await;
    let a = start().await;
    let r = get(a, "/v1/monsoon/overview").await;
    assert_eq!(r.status, 200);
    let v = json(&r);
    assert_eq!(v["hero"]["ward_count"], 24);
    assert_eq!(v["hero"]["wo_count"], 2499);
    assert_eq!(v["hero"]["spend_inr"], 134_328_183);
    assert_eq!(v["primary"]["finding_count"], 433);
    assert_eq!(v["primary"]["unique_wo_count"], 415);
    assert_eq!(v["primary"]["unique_billed_inr"], 21_771_311);
    assert_eq!(
        v["primary"]["rate_variance"]["calculated_variance_inr"],
        6_066_314
    );
    assert_eq!(v["primary"]["duplicate"]["billed_inr"], 2_590_652);
    assert_eq!(v["primary"]["dlp_surface"]["billed_inr"], 8_729_314);
    assert_eq!(v["flag_class_counts"]["OUTCOME_INDICATOR"], 1870);
    assert_eq!(v["trail"]["coord_provenance_counts"]["UNRESOLVED"], 19);
    assert!(v["primary"]["qualification"]
        .as_str()
        .unwrap()
        .contains("not an estimate of confirmed loss"));
    assert!(v["meta"]["model_contribution_disclosure"]["text"]
        .as_str()
        .unwrap()
        .contains("deterministic"));
}

#[tokio::test]
async fn slash_wards_work_via_query_and_path_and_bad_wards_are_rejected_before_sql() {
    let _g = lock().lock().await;
    let a = start().await;
    for w in ["F%2FS", "K%2FW", "L", "R%2FC"] {
        let r = get(a, &format!("/v1/monsoon/ward-detail?ward={w}")).await;
        assert_eq!(r.status, 200, "{w}");
        let v = json(&r);
        assert!(
            !v["new_budget_roads"].as_array().unwrap().is_empty()
                || !v["dlp_roads"].as_array().unwrap().is_empty()
        );
    }
    assert_eq!(get(a, "/v1/monsoon/wards/F%2FS").await.status, 200);
    let m = json(&get(a, "/v1/monsoon/map-triage?ward=F%2FS").await);
    assert!(m["roads"]
        .as_array()
        .unwrap()
        .iter()
        .all(|r| r["ward_code"] == "F/S"));
    assert!(m["issues"]
        .as_array()
        .unwrap()
        .iter()
        .all(|i| i["coord_provenance"] != "UNRESOLVED"));
    assert_eq!(m["issues_returned"], m["issues_total"]);
    assert_eq!(
        get(a, "/v1/monsoon/map-triage?ward=%27%3BDROP")
            .await
            .status,
        400
    );
    let city = json(&get(a, "/v1/monsoon/map-triage").await);
    assert_eq!(city["issues_returned"], 0, "no complaint pins citywide");
    assert_eq!(
        json(&get(a, "/v1/monsoon/wards").await)["wards"]
            .as_array()
            .unwrap()
            .len(),
        24
    );
}

#[tokio::test]
async fn audit_flags_filter_and_csv_download_headers() {
    let _g = lock().lock().await;
    let a = start().await;
    let v = json(&get(a, "/v1/monsoon/audit/flags").await);
    assert_eq!(v["total"], 433);
    assert!(v["rows"].as_array().unwrap().len() <= 100);
    let all = json(&get(a, "/v1/monsoon/audit/flags?flag_class=ALL&limit=1").await);
    assert_eq!(all["total"], 2570);
    assert_eq!(
        json(
            &get(
                a,
                "/v1/monsoon/audit/flags?variance_band=VERY_HIGH_VARIANCE_REVIEW"
            )
            .await
        )["total"],
        64
    );
    assert_eq!(
        get(a, "/v1/monsoon/audit/flags?flag_class=NOPE")
            .await
            .status,
        400
    );
    let c = get(a, "/v1/monsoon/audit/flags?format=csv&ward=K%2FW").await;
    assert_eq!(c.status, 200);
    let h = c.head.to_lowercase();
    assert!(h.contains("content-type: text/csv; charset=utf-8"));
    assert!(h.contains(
        "content-disposition: attachment; filename=\"mumbai_civic_lens_audit_flags.csv\""
    ));
    assert!(c
        .body
        .trim_start_matches('\u{feff}')
        .starts_with("flag_id,work_order_id,flag_type,display_label,flag_class"));
}

#[tokio::test]
async fn next_rupee_keeps_lanes_apart_and_rank_independent_of_budget() {
    let _g = lock().lock().await;
    let a = start().await;
    let base = json(&get(a, "/v1/monsoon/next-rupee").await);
    assert_eq!(base["new_budget_lane"].as_array().unwrap().len(), 25);
    assert_eq!(base["dlp_review_lane"].as_array().unwrap().len(), 15);
    assert!(base["new_budget_lane"]
        .as_array()
        .unwrap()
        .iter()
        .all(|r| r["under_dlp"] == "N" && r["lane"] == "NEW_BUDGET_CANDIDATE_LANE"));
    let dlp = &base["dlp_review_lane"][0];
    assert_eq!(
        (
            dlp["road_id"].as_str().unwrap(),
            dlp["citywide_lane_rank"].as_i64().unwrap()
        ),
        ("RD0220", 1)
    );
    assert!(dlp["ward_rank"].as_i64().is_some() && dlp["affordable_now"].is_null());
    assert!(dlp["allocation_note"]
        .as_str()
        .unwrap()
        .contains("defer pending DLP scope review"));
    let zero = json(&get(a, "/v1/monsoon/next-rupee?budget_override_inr=0").await);
    let rank = |v: &Value| {
        v["new_budget_lane"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| {
                (
                    r["road_id"].clone(),
                    r["citywide_lane_rank"].clone(),
                    r["risk_score"].clone(),
                )
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(
        rank(&base),
        rank(&zero),
        "risk rank never changes with budget"
    );
    assert!(zero["new_budget_lane"]
        .as_array()
        .unwrap()
        .iter()
        .all(|r| r["affordable_now"] == false));
    let csv = get(a, "/v1/monsoon/next-rupee?format=csv").await;
    assert!(csv.head.to_lowercase().contains("text/csv; charset=utf-8"));
    let e = json(&get(a, "/v1/monsoon/next-rupee?ward=E").await);
    assert!(e["new_budget_lane"]
        .as_array()
        .unwrap()
        .iter()
        .any(|r| r["road_id"] == "RD0057"));
}

#[tokio::test]
async fn contractors_have_raw_measures_and_no_letter_grades() {
    let _g = lock().lock().await;
    let a = start().await;
    let v = json(&get(a, "/v1/monsoon/contractors").await);
    let rows = v["contractors"].as_array().unwrap();
    assert_eq!(rows.len(), 8);
    for r in rows {
        for k in [
            "jobs_count",
            "observed_reopen_pct",
            "expected_reopen_method_mix_pct",
            "reopen_delta_pts",
            "sla_met_pct",
            "low_lying_exposure_pct",
            "avg_cost_ratio",
        ] {
            assert!(!r[k].is_null(), "{k}");
        }
        assert!(r.get("band").is_none() && r.get("grade").is_none());
    }
    assert!(v["sla_note"]
        .as_str()
        .unwrap()
        .contains("does not establish causation"));
}

#[tokio::test]
async fn kundali_resolves_every_id_kind_and_returns_problem_json_404() {
    let _g = lock().lock().await;
    let a = start().await;
    for (id, kind) in [
        ("WO25-00611", "work_order"),
        ("RD0220", "road"),
        ("BMC25-004589", "complaint"),
    ] {
        let r = get(a, &format!("/v1/monsoon/kundali/{id}")).await;
        assert_eq!(r.status, 200, "{id}");
        assert_eq!(json(&r)["kind"], kind);
    }
    let wo = json(&get(a, "/v1/monsoon/kundali/WO25-00611").await);
    assert_eq!(wo["work_orders"][0]["engineer_remark_audit_weight"], 0);
    if let Some(i) = wo["issue"]["issue_id"].as_str() {
        assert_eq!(
            get(a, &format!("/v1/monsoon/kundali/{i}")).await.status,
            200
        );
    }
    let nf = get(a, "/v1/monsoon/kundali/WO25-99999").await;
    assert_eq!(nf.status, 404);
    assert!(nf.head.to_lowercase().contains("application/problem+json"));
}

#[tokio::test]
async fn the_monsoon_session_is_the_read_only_mcl_app_role() {
    let _g = lock().lock().await;
    let p = monsoon::connect_monsoon().unwrap();
    let (login, eff, db, ro) = monsoon::identity(&p).await.unwrap();
    assert_eq!(
        (login.as_str(), eff.as_str(), db.as_str(), ro),
        ("mcl_api", "mcl_app", "civic_lens_monsoon", true)
    );
    assert!(sqlx::query("CREATE TABLE h2_should_fail (x int)")
        .execute(&p)
        .await
        .is_err());
    assert!(sqlx::query("UPDATE monsoon_wards SET zone = zone")
        .execute(&p)
        .await
        .is_err());
}

/// OF-H2-CMD-ROLE: with no command pool (the branch-specific startup mode) every original write path answers 503 before any
/// command transaction can begin, while monsoon reads and the capability report stay truthful.
#[tokio::test]
async fn commands_disabled_mode_answers_503_before_any_mutation_and_reads_stay_up() {
    let _g = lock().lock().await;
    let a = start().await; // no command pool attached
    let mut s = TcpStream::connect(a).await.unwrap();
    let body = r#"{"recordVersion":1,"payload":{"category":"POTHOLE","geometry":{"type":"Point","coordinates":[72.83158,19.11974]},"title":"H2 disabled-mode probe","publicDescription":"Synthetic pothole report near the S.V. Road Junction approach on Paliram Road.","nearbyLandmark":"near S.V. Road Junction approach (synthetic label)","assetId":"SYN-DEMO-AST-ROAD-001"}}"#;
    let req = format!(
        "POST /v1/issues HTTP/1.0
Host: localhost
Content-Type: application/json
Idempotency-Key: h2-test-key-0001
Content-Length: {}

{body}",
        body.len()
    );
    s.write_all(req.as_bytes()).await.unwrap();
    let mut buf = Vec::new();
    s.read_to_end(&mut buf).await.unwrap();
    let text = String::from_utf8_lossy(&buf).to_string();
    assert!(
        text.starts_with("HTTP/1.0 503") || text.starts_with("HTTP/1.1 503"),
        "{text}"
    );
    assert!(text.to_lowercase().contains("application/problem+json"));
    let cap = get(a, "/health/capabilities").await;
    assert_eq!(cap.status, 200);
    let j = json(&cap);
    assert_eq!(
        (j["monsoonReads"].as_str(), j["commands"].as_str()),
        (Some("AVAILABLE"), Some("DISABLED"))
    );
    assert!(!cap.body.contains("postgres://"));
    assert_eq!(get(a, "/v1/monsoon/overview").await.status, 200);
}
