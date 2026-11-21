//! P1 database proof against the running PostgreSQL/PostGIS instance (no skipping: a missing database fails).
//! Each test creates its own scratch database named mcl_p1_*, applies the real migrations from clean, seeds CP-00
//! through the guarded reset, then drops the scratch database. The demonstration database is never touched here.
use mcl_domain::policy::DuplicatePolicy;
use mcl_infrastructure::demo::{self, DemoError, ResetPolicy};
use sha2::{Digest, Sha256};
use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::Row;

struct Scratch {
    admin: PgPool,
    pool: PgPool,
    name: String,
    url: String,
}

async fn scratch(test: &str) -> Scratch {
    let url = demo::database_url()
        .expect("DATABASE_URL (environment or .env.local) is required for P1 database tests");
    let admin = demo::connect(&url)
        .await
        .expect("connect to the running PostgreSQL instance");
    let name = format!("mcl_p1_{test}");
    sqlx::query(&format!("DROP DATABASE IF EXISTS {name} WITH (FORCE)"))
        .execute(&admin)
        .await
        .unwrap();
    sqlx::query(&format!("CREATE DATABASE {name}"))
        .execute(&admin)
        .await
        .unwrap();
    let scratch_url = demo::with_database_name(&url, &name);
    let pool = demo::connect(&scratch_url).await.unwrap();
    Scratch {
        admin,
        pool,
        name,
        url: scratch_url,
    }
}

impl Scratch {
    fn policy(&self) -> ResetPolicy {
        ResetPolicy::scratch(&self.name).unwrap()
    }
    async fn seeded(test: &str) -> Scratch {
        let s = scratch(test).await;
        demo::migrate(&s.pool)
            .await
            .expect("migrations apply on a clean database");
        demo::reset_and_seed_with(&s.pool, &demo::default_seed_dir(), &s.policy())
            .await
            .expect("guarded reset and seed applies");
        s
    }
    async fn reset(&self) -> Result<demo::BaselineReport, DemoError> {
        demo::reset_and_seed_with(&self.pool, &demo::default_seed_dir(), &self.policy()).await
    }
    /// A pool whose every connection runs as the non-owner application role.
    async fn app_pool(&self) -> PgPool {
        PgPoolOptions::new()
            .max_connections(1)
            .after_connect(|conn, _| {
                Box::pin(async move {
                    sqlx::query("SET ROLE mcl_app").execute(conn).await?;
                    Ok(())
                })
            })
            .connect(&self.url)
            .await
            .unwrap()
    }
    async fn finish(self) {
        self.pool.close().await;
        sqlx::query(&format!(
            "DROP DATABASE IF EXISTS {} WITH (FORCE)",
            self.name
        ))
        .execute(&self.admin)
        .await
        .unwrap();
    }
}

async fn text(pool: &PgPool, sql: &str) -> String {
    sqlx::query_scalar::<_, String>(sql)
        .fetch_one(pool)
        .await
        .unwrap()
}
async fn num(pool: &PgPool, sql: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(sql)
        .fetch_one(pool)
        .await
        .unwrap()
}
fn sqlstate(r: Result<sqlx::postgres::PgQueryResult, sqlx::Error>) -> String {
    match r {
        Ok(_) => "OK".to_string(),
        Err(e) => e
            .as_database_error()
            .and_then(|d| d.code().map(|c| c.to_string()))
            .unwrap_or_else(|| format!("{e}")),
    }
}
fn manifest() -> serde_json::Value {
    serde_json::from_str(
        &std::fs::read_to_string(demo::default_seed_dir().join("reset-manifest.json")).unwrap(),
    )
    .unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn migrations_apply_from_clean_and_postgis_srid_32643_exists() {
    let s = scratch("migrate").await;
    demo::migrate(&s.pool).await.unwrap();
    demo::migrate(&s.pool).await.unwrap(); // idempotent re-run
    assert_eq!(
        num(
            &s.pool,
            "SELECT count(*) FROM _sqlx_migrations WHERE success"
        )
        .await,
        3
    );
    for t in demo::SEED_ORDER
        .iter()
        .map(|x| x.table)
        .chain(["idempotency_records", "synthetic_demo_marker"])
    {
        assert_eq!(num(&s.pool, &format!("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='{t}'")).await, 1, "table {t}");
    }
    assert!(text(&s.pool, "SELECT postgis_full_version()")
        .await
        .starts_with("POSTGIS=\"3.5"));
    assert_eq!(
        num(
            &s.pool,
            "SELECT count(*) FROM spatial_ref_sys WHERE srid = 32643"
        )
        .await,
        1
    );
    assert!(
        num(
            &s.pool,
            "SELECT count(*) FROM pg_indexes WHERE indexdef ILIKE '%USING gist%'"
        )
        .await
            >= 6,
        "spatial indexes"
    );
    assert_eq!(
        text(&s.pool, "SELECT database_name FROM synthetic_demo_marker").await,
        s.name
    );
    assert_eq!(num(&s.pool, "SELECT count(*) FROM pg_roles WHERE rolname = 'mcl_app' AND NOT rolsuper AND NOT rolcanlogin AND NOT rolcreatedb").await, 1);
    // no reset bypass setting exists anywhere in the schema
    assert_eq!(
        num(
            &s.pool,
            "SELECT count(*) FROM pg_proc WHERE prosrc ILIKE '%reset_authorized%'"
        )
        .await,
        0
    );
    s.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn guarded_reset_is_deterministic_and_matches_the_canonical_digest_spec() {
    let s = scratch("reset").await;
    demo::migrate(&s.pool).await.unwrap();
    let dir = demo::default_seed_dir();
    let m = manifest();
    let first = s.reset().await.unwrap();
    for (table, n) in &first.counts {
        assert_eq!(
            m["expectedCounts"][table].as_i64().unwrap(),
            *n,
            "count for {table}"
        );
    }
    assert_eq!(
        first.counts.len(),
        m["expectedCounts"].as_object().unwrap().len()
    );
    assert_eq!(first.digest, demo::manifest_expected_digest(&dir).unwrap());
    // the manifest documents the same fixed, alphabetical table list the code hashes
    let spec_tables: Vec<&str> = m["digestSpec"]["tables"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert_eq!(spec_tables, demo::DIGEST_TABLES);
    // the digest is SHA-256 over the documented canonical byte stream
    let canonical = demo::baseline_canonical_text(&s.pool).await.unwrap();
    assert!(
        canonical.starts_with("assets\n[{")
            && canonical.contains("\nwards\n[{")
            && canonical.contains("\"2026-10-05T04:15:00.000000Z\"")
    );
    assert!(
        !canonical.contains("idempotency_records") && !canonical.contains("synthetic_demo_marker")
    );
    let hex = demo::to_hex(&Sha256::digest(canonical.as_bytes()));
    assert_eq!(hex, first.digest);
    // mutate, then reset: the exact baseline returns, twice in a row, with identical counts
    sqlx::query("UPDATE issues SET title = 'edited', record_version = record_version + 1 WHERE id = 'SYN-DEMO-KND-002'").execute(&s.pool).await.unwrap();
    sqlx::query("DELETE FROM jurisdictions WHERE issue_id = 'SYN-DEMO-KND-005'")
        .execute(&s.pool)
        .await
        .unwrap();
    assert_ne!(demo::baseline_digest(&s.pool).await.unwrap(), first.digest);
    let second = s.reset().await.unwrap();
    let third = s.reset().await.unwrap();
    assert_eq!(first, second);
    assert_eq!(second, third);
    println!(
        "two consecutive resets: digest {} counts {:?}",
        third.digest, third.counts
    );
    s.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn reset_refuses_wrong_database_missing_marker_foreign_role_and_the_demo_policy_on_scratch() {
    let s = Scratch::seeded("guard").await;
    let before = demo::baseline_digest(&s.pool).await.unwrap();
    let dir = demo::default_seed_dir();
    // demo policy names civic_lens, so it must refuse a scratch database
    let e = demo::reset_and_seed(&s.pool, &dir)
        .await
        .unwrap_err()
        .to_string();
    assert!(
        e.contains("reset refused") && e.contains("civic_lens"),
        "{e}"
    );
    // a policy for a different database name refuses too
    let other = ResetPolicy::scratch("mcl_p1_somewhere_else").unwrap();
    assert!(demo::reset_and_seed_with(&s.pool, &dir, &other)
        .await
        .unwrap_err()
        .to_string()
        .contains("reset refused"));
    // a marker that names another database refuses
    sqlx::query("UPDATE synthetic_demo_marker SET database_name = 'someone_else'")
        .execute(&s.pool)
        .await
        .unwrap();
    assert!(s
        .reset()
        .await
        .unwrap_err()
        .to_string()
        .contains("marker names database"));
    // a missing marker refuses
    sqlx::query("DELETE FROM synthetic_demo_marker")
        .execute(&s.pool)
        .await
        .unwrap();
    assert!(s
        .reset()
        .await
        .unwrap_err()
        .to_string()
        .contains("marker is missing"));
    sqlx::query("INSERT INTO synthetic_demo_marker VALUES ('SYN-DEMO-MARKER','SYNTHETIC_DEMONSTRATION','CP-00', current_database(), 'restored for the test')")
        .execute(&s.pool)
        .await
        .unwrap();
    // the non-owner application role is refused before anything is truncated
    let app = s.app_pool().await;
    let e = demo::reset_and_seed_with(&app, &dir, &s.policy())
        .await
        .unwrap_err()
        .to_string();
    assert!(e.contains("does not own"), "{e}");
    app.close().await;
    // nothing changed after any refusal, and the authorised owner reset still succeeds
    assert_eq!(demo::baseline_digest(&s.pool).await.unwrap(), before);
    assert_eq!(s.reset().await.unwrap().digest, before);
    s.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn app_role_cannot_rewrite_audit_history_but_owner_reset_succeeds() {
    let s = Scratch::seeded("approle").await;
    let app = s.app_pool().await;
    assert_eq!(text(&app, "SELECT current_user::text").await, "mcl_app");
    let exec = |sql: &'static str| {
        let app = app.clone();
        async move { sqlstate(sqlx::query(sql).execute(&app).await) }
    };
    // (a) the application role has no UPDATE, DELETE or TRUNCATE on the lifecycle log or corrections
    assert_eq!(exec("UPDATE lifecycle_events SET summary = 'rewritten' WHERE entity_id = 'SYN-DEMO-KND-001'").await, "42501");
    assert_eq!(
        exec("DELETE FROM lifecycle_events WHERE entity_id = 'SYN-DEMO-KND-001'").await,
        "42501"
    );
    assert_eq!(exec("TRUNCATE lifecycle_events").await, "42501");
    assert_eq!(exec("TRUNCATE corrections").await, "42501");
    assert_eq!(
        exec("DELETE FROM corrections WHERE id = 'SYN-DEMO-COR-001'").await,
        "42501"
    );
    assert_eq!(exec("UPDATE corrections SET prior_value = '\"rewritten\"'::jsonb WHERE id = 'SYN-DEMO-COR-001'").await, "42501");
    assert_eq!(
        exec("DELETE FROM issues WHERE id = 'SYN-DEMO-KND-002'").await,
        "42501"
    );
    assert_eq!(exec("TRUNCATE issues").await, "42501");
    // ...but it can read, and append a correctly chained event
    assert_eq!(num(&app, "SELECT count(*) FROM lifecycle_events").await, 27);
    let append = sqlx::query(
        "INSERT INTO lifecycle_events (id, record_nature, source_tier, record_version, updated_at, entity_id, sequence, event_type, actor_role, occurred_at, summary, previous_hash, payload_hash)
         SELECT 'SYN-DEMO-EVT-KND-002-002','SYNTHETIC_DEMONSTRATION','SYNTHETIC_DEMO',1, timestamptz '2026-11-20T06:00:00Z','SYN-DEMO-KND-002',2,'ISSUE_TRIAGED_ASSIGNED','authority', timestamptz '2026-11-20T06:00:00Z','Triaged (append test)', e.payload_hash,
                lifecycle_event_hash('SYN-DEMO-KND-002',2,'ISSUE_TRIAGED_ASSIGNED', timestamptz '2026-11-20T06:00:00Z','authority','Triaged (append test)', e.payload_hash)
           FROM lifecycle_events e WHERE e.entity_id='SYN-DEMO-KND-002' AND e.sequence=1",
    )
    .execute(&app)
    .await;
    assert_eq!(sqlstate(append), "OK");
    assert!(
        sqlx::query_scalar::<_, bool>("SELECT lifecycle_chain_is_valid('SYN-DEMO-KND-002')")
            .fetch_one(&app)
            .await
            .unwrap()
    );
    app.close().await;
    // the BEFORE UPDATE OR DELETE trigger still stops even the owner from rewriting history
    let owner = |sql: &'static str| {
        let p = s.pool.clone();
        async move { sqlstate(sqlx::query(sql).execute(&p).await) }
    };
    assert_eq!(owner("UPDATE lifecycle_events SET summary = 'rewritten' WHERE entity_id = 'SYN-DEMO-KND-001' AND sequence = 1").await, "55000");
    assert_eq!(
        owner("DELETE FROM lifecycle_events WHERE entity_id = 'SYN-DEMO-KND-001'").await,
        "55000"
    );
    assert_eq!(
        owner("DELETE FROM corrections WHERE id = 'SYN-DEMO-COR-001'").await,
        "55000"
    );
    assert_eq!(owner("UPDATE corrections SET prior_value = '\"rewritten\"'::jsonb WHERE id = 'SYN-DEMO-COR-001'").await, "55000");
    // (b) the authorised owner reset (role civic) succeeds cleanly and discards the appended demo event
    assert_eq!(text(&s.pool, "SELECT current_user::text").await, "civic");
    let r = s.reset().await.unwrap();
    assert_eq!(
        r.digest,
        demo::manifest_expected_digest(&demo::default_seed_dir()).unwrap()
    );
    assert_eq!(
        num(&s.pool, "SELECT count(*) FROM lifecycle_events").await,
        27
    );
    s.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn seed_keys_all_map_to_columns() -> Result<(), DemoError> {
    let s = scratch("columns").await;
    demo::migrate(&s.pool).await?;
    demo::check_seed_columns(&s.pool, &demo::default_seed_dir()).await?;
    s.finish().await;
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn primary_kundali_chain_resolves_end_to_end() {
    let s = Scratch::seeded("kundali").await;
    let p = &s.pool;
    let row = sqlx::query(
        "SELECT i.id AS issue, a.id AS asset, w.id AS wo, w.value_paise AS wo_paise, c.value_paise AS con_paise,
                t.id AS tender, b.id AS budget, b.amount_paise AS bud_paise, d.display_name, i.responsible_post_title, v.display_name AS vendor
           FROM issues i JOIN assets a ON a.id = i.asset_id JOIN work_orders w ON w.id = i.work_order_id
           JOIN contracts c ON c.id = w.contract_id JOIN tenders t ON t.id = c.tender_id JOIN budgets b ON b.id = c.budget_id
           JOIN departments d ON d.id = i.responsible_department_id JOIN contractors v ON v.id = c.vendor_id
          WHERE i.id = 'SYN-DEMO-KND-001'",
    )
    .fetch_one(p)
    .await
    .unwrap();
    assert_eq!(row.get::<String, _>("issue"), "SYN-DEMO-KND-001");
    assert_eq!(row.get::<String, _>("asset"), "SYN-DEMO-AST-ROAD-001");
    assert_eq!(row.get::<String, _>("wo"), "SYN-DEMO-WO-001");
    assert_eq!(row.get::<String, _>("tender"), "SYN-DEMO-TND-001");
    assert_eq!(row.get::<String, _>("budget"), "SYN-DEMO-BUD-001");
    assert_eq!(row.get::<i64, _>("bud_paise"), 250_000_000); // 25 lakh rupees
    assert_eq!(row.get::<i64, _>("wo_paise"), 180_000_000); // 18 lakh rupees, not 1.80 crore
    assert_eq!(row.get::<i64, _>("con_paise"), 180_000_000);
    assert_eq!(row.get::<String, _>("display_name"), "Roads Department");
    assert_eq!(
        row.get::<String, _>("responsible_post_title"),
        "Assistant Engineer (Roads), K/West Ward"
    );
    assert_eq!(
        row.get::<String, _>("vendor"),
        "Demo Civic Works Consortium"
    );
    assert_eq!(
        text(
            p,
            "SELECT status FROM jurisdictions WHERE issue_id='SYN-DEMO-KND-001'"
        )
        .await,
        "CONFIRMED_BMC_WARD"
    );
    assert_eq!(text(p, "SELECT string_agg(stage, ',' ORDER BY stage) FROM evidence WHERE issue_id='SYN-DEMO-KND-001'").await, "BEFORE,CLAIMED_AFTER");
    assert_eq!(
        text(
            p,
            "SELECT stage FROM evidence WHERE issue_id='SYN-DEMO-KND-004'"
        )
        .await,
        "DISPUTED_OR_RECURRING"
    );
    assert_eq!(text(p, "SELECT e.stage FROM completion_claims c JOIN evidence e ON e.id = c.claimed_after_evidence_id WHERE c.issue_id='SYN-DEMO-KND-001'").await, "CLAIMED_AFTER");
    assert_eq!(text(p, "SELECT state||'/'||coalesce(citizen_verdict,'none') FROM verifications WHERE issue_id='SYN-DEMO-KND-001'").await, "WINDOW_OPEN/none");
    assert_eq!(
        text(p, "SELECT status FROM issues WHERE id='SYN-DEMO-KND-001'").await,
        "CLOSURE_CLAIMED_PENDING_VERIFICATION"
    );
    assert_eq!(
        text(
            p,
            "SELECT status||'|'||prior_value::text FROM corrections WHERE id='SYN-DEMO-COR-002'"
        )
        .await,
        "ACCEPTED_AMENDED|\"near S.V. Rd junction (synthetic label)\""
    );
    // J3: an unlinked defect on the same road while the DLP is active at the explicit CAP-0 evaluation instant
    assert_eq!(num(p, "SELECT count(*) FROM issues i JOIN work_orders w ON w.asset_id = i.asset_id WHERE i.work_order_id IS NULL AND i.id = 'SYN-DEMO-KND-004' AND dlp_status_at(w.id, timestamptz '2026-11-20T00:00:00Z') = 'ACTIVE'").await, 1);
    // audit events are ordered and hash-linked
    assert_eq!(text(p, "SELECT string_agg(sequence::text, ',' ORDER BY sequence) FROM lifecycle_events WHERE entity_id='SYN-DEMO-KND-001'").await, "1,2,3,4,5,6,7,8,9");
    assert_eq!(text(p, "SELECT event_type FROM lifecycle_events WHERE entity_id='SYN-DEMO-KND-001' ORDER BY sequence DESC LIMIT 1").await, "VERIFICATION_WINDOW_OPEN");
    assert_eq!(num(p, "SELECT count(*) FROM (SELECT DISTINCT entity_id FROM lifecycle_events) q WHERE NOT lifecycle_chain_is_valid(entity_id)").await, 0);
    assert_eq!(num(p, "SELECT count(*) FROM (SELECT occurred_at, lag(occurred_at) OVER (PARTITION BY entity_id ORDER BY sequence) AS prev FROM lifecycle_events) q WHERE prev > occurred_at").await, 0);
    s.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn dlp_status_is_derived_from_an_explicit_instant_and_agrees_with_the_domain_function() {
    use time::format_description::well_known::{Iso8601, Rfc3339};
    let s = Scratch::seeded("dlp").await;
    let p = &s.pool;
    // no persisted status or duplicated end date
    assert_eq!(num(p, "SELECT count(*) FROM information_schema.columns WHERE table_name='dlp_status' AND column_name IN ('status','dlp_ends_on','as_of_date')").await, 0);
    let row = sqlx::query("SELECT d.dlp_starts_on::text AS starts, to_char(w.dlp_ends_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS ends FROM dlp_status d JOIN work_orders w ON w.id = d.work_order_id WHERE d.work_order_id='SYN-DEMO-WO-001'")
        .fetch_one(p)
        .await
        .unwrap();
    let starts = time::Date::parse(&row.get::<String, _>("starts"), &Iso8601::DATE).unwrap();
    let ends = time::OffsetDateTime::parse(&row.get::<String, _>("ends"), &Rfc3339).unwrap();
    for (at, want) in [
        ("2026-03-31T23:59:59Z", "NOT_STARTED"),
        ("2026-04-01T00:00:00Z", "ACTIVE"),
        ("2026-11-20T00:00:00Z", "ACTIVE"), // CAP-0 evaluation date
        ("2027-03-31T18:29:59Z", "ACTIVE"),
        ("2027-03-31T18:30:00Z", "EXPIRED"),
    ] {
        let sql = text(
            p,
            &format!("SELECT dlp_status_at('SYN-DEMO-WO-001', timestamptz '{at}')"),
        )
        .await;
        assert_eq!(sql, want, "SQL at {at}");
        let rust = mcl_domain::dlp::dlp_status_at(
            starts,
            ends,
            time::OffsetDateTime::parse(at, &Rfc3339).unwrap(),
        );
        let rust = serde_json::to_value(rust).unwrap();
        assert_eq!(rust, serde_json::Value::from(want), "domain at {at}");
    }
    s.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn traceability_gap_stops_at_the_tender_without_inventing_geometry() {
    let s = Scratch::seeded("gap").await;
    let p = &s.pool;
    let row = sqlx::query("SELECT traceability_status, last_proven_link, missing_next_link, amount_paise FROM budgets WHERE id='SYN-DEMO-BUD-002'")
        .fetch_one(p)
        .await
        .unwrap();
    assert_eq!(
        row.get::<String, _>("traceability_status"),
        "GAP_BEFORE_STREET_GEOMETRY"
    );
    assert_eq!(row.get::<String, _>("last_proven_link"), "TENDER");
    assert_eq!(
        row.get::<String, _>("missing_next_link"),
        "STREET_LEVEL_GEOMETRY"
    );
    assert_eq!(row.get::<i64, _>("amount_paise"), 120_000_000);
    assert_eq!(num(p, "SELECT count(*) FROM tenders WHERE budget_id='SYN-DEMO-BUD-002' AND NOT street_geometry_available").await, 1);
    assert_eq!(num(p, "SELECT count(*) FROM contracts WHERE budget_id='SYN-DEMO-BUD-002' OR tender_id='SYN-DEMO-TND-002'").await, 0);
    assert_eq!(num(p, "SELECT count(*) FROM work_orders w JOIN contracts c ON c.id = w.contract_id WHERE c.budget_id='SYN-DEMO-BUD-002'").await, 0);
    assert_eq!(
        text(
            p,
            "SELECT traceability_explanation FROM budgets WHERE id='SYN-DEMO-BUD-002'"
        )
        .await
        .split('.')
        .next()
        .unwrap(),
        "TRACEABILITY GAP: Street-level geometry is not available in the synthetic source record"
    );
    assert_eq!(
        text(
            p,
            "SELECT traceability_status FROM budgets WHERE id='SYN-DEMO-BUD-001'"
        )
        .await,
        "LINKED_TO_STREET"
    );
    assert_eq!(
        num(
            p,
            "SELECT count(*) FROM budgets WHERE traceability_status='GAP_BEFORE_STREET_GEOMETRY'"
        )
        .await,
        1
    );
    let bad =
        sqlx::query("UPDATE budgets SET missing_next_link = NULL WHERE id='SYN-DEMO-BUD-002'")
            .execute(p)
            .await;
    assert_eq!(sqlstate(bad), "23514");
    s.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn j2_distance_is_measured_in_srid_32643_against_the_configured_pothole_radius() {
    let s = Scratch::seeded("spatial").await;
    let p = &s.pool;
    let policy_text = std::fs::read_to_string(
        demo::workspace_root()
            .join("config")
            .join("duplicate-policy.json"),
    )
    .unwrap();
    let policy = DuplicatePolicy::from_json(&policy_text).unwrap();
    let radius = policy
        .radius_meters("POTHOLE")
        .expect("POTHOLE radius in config/duplicate-policy.json");
    assert_eq!(policy.weights.total(), 100);

    assert_eq!(
        num(
            p,
            "SELECT count(*) FROM issues WHERE ST_SRID(geometry) = 4326 AND ST_IsValid(geometry)"
        )
        .await,
        6
    );
    assert_eq!(num(p, "SELECT ST_SRID(ST_Transform(geometry, 32643))::bigint FROM issues WHERE id='SYN-DEMO-KND-001'").await, 32643);
    let measure = |other: &'static str| {
        let p = p.clone();
        async move {
            let sql = format!("SELECT ST_Distance(ST_Transform(a.geometry,32643), ST_Transform(b.geometry,32643))::float8 FROM issues a, issues b WHERE a.id='SYN-DEMO-KND-001' AND b.id='{other}'");
            sqlx::query_scalar::<_, f64>(&sql)
                .fetch_one(&p)
                .await
                .unwrap()
        }
    };
    let j2 = measure("SYN-DEMO-KND-002").await;
    let j3 = measure("SYN-DEMO-KND-004").await;
    println!("MEASURED SRID 32643 distance J2 (KND-002) from KND-001: {j2:.3} m; configured POTHOLE radius: {radius} m; KND-004: {j3:.3} m");
    assert!(
        j2 > 0.0 && j2 <= radius,
        "J2 {j2} m must fall within the configured radius {radius} m"
    );
    assert!(
        j3 > radius,
        "KND-004 at {j3} m should be outside the configured radius {radius} m"
    );
    // the geography measurement agrees with the UTM measurement
    let geog: f64 = sqlx::query_scalar("SELECT ST_Distance(a.geometry::geography, b.geometry::geography)::float8 FROM issues a, issues b WHERE a.id='SYN-DEMO-KND-001' AND b.id='SYN-DEMO-KND-002'").fetch_one(p).await.unwrap();
    assert!(
        (j2 - geog).abs() / geog < 0.005,
        "UTM {j2} vs geography {geog}"
    );
    // the radius reaches PostGIS only as a bound parameter read from config
    let within = |other: &'static str| {
        let p = p.clone();
        async move {
            let sql = format!("SELECT count(*) FROM issues a, issues b WHERE a.id='SYN-DEMO-KND-001' AND b.id='{other}' AND ST_DWithin(a.geometry::geography, b.geometry::geography, $1)");
            sqlx::query_scalar::<_, i64>(&sql)
                .bind(radius)
                .fetch_one(&p)
                .await
                .unwrap()
        }
    };
    assert_eq!(within("SYN-DEMO-KND-002").await, 1);
    assert_eq!(within("SYN-DEMO-KND-004").await, 0);
    // bbox viewport query over the K/West demonstration area returns exactly the four K/W issues
    assert_eq!(num(p, "SELECT count(*) FROM issues WHERE geometry && ST_MakeEnvelope(72.826, 19.114, 72.840, 19.126, 4326)").await, 4);
    // every issue lies in its candidate ward box; the seeded boundary distance agrees with PostGIS
    assert_eq!(num(p, "SELECT count(*) FROM issues i JOIN wards w ON w.id = i.ward_candidate_id WHERE NOT ST_Intersects(w.boundary, i.geometry)").await, 0);
    let worst: f64 = sqlx::query_scalar(
        "SELECT max(abs(j.distance_to_boundary_meters::float8 - ST_Distance(ST_Boundary(w.boundary)::geography, i.geometry::geography)))::float8
           FROM jurisdictions j JOIN issues i ON i.id = j.issue_id JOIN wards w ON w.id = j.candidate_ward_id",
    )
    .fetch_one(p)
    .await
    .unwrap();
    assert!(
        worst < 0.1,
        "seeded boundary distance deviates by {worst} m"
    );
    // swapped [lat, lon] order is rejected by the Greater Mumbai envelope check
    let swapped = sqlx::query("INSERT INTO assets (id, record_nature, source_tier, record_version, updated_at, asset_type, display_name, street_name, corridor_name, nearby_landmark, geometry, ward_candidate_id, responsible_department_id) VALUES ('SYN-DEMO-AST-BAD','SYNTHETIC_DEMONSTRATION','SYNTHETIC_DEMO',1,timestamptz '2026-11-20T08:30:00Z','ROAD_SEGMENT','x','x',NULL,'x',ST_SetSRID(ST_MakePoint(19.12,72.83),4326),NULL,'SYN-DEMO-DEPT-ROADS')").execute(p).await;
    assert_eq!(sqlstate(swapped), "23514");
    s.finish().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn invalid_state_money_and_missing_data_are_rejected() {
    let s = Scratch::seeded("invalid").await;
    let p = &s.pool;
    let exec = |sql: &'static str| async move { sqlstate(sqlx::query(sql).execute(p).await) };
    assert_eq!(
        exec("UPDATE issues SET status = 'AUTO_VERIFIED_BY_SILENCE' WHERE id='SYN-DEMO-KND-001'")
            .await,
        "23514"
    );
    assert_eq!(
        exec("UPDATE work_orders SET status = 'DONE' WHERE id='SYN-DEMO-WO-001'").await,
        "23514"
    );
    assert_eq!(
        exec("UPDATE contracts SET value_paise = -1 WHERE id='SYN-DEMO-CON-001'").await,
        "23514"
    );
    assert_eq!(
        exec("UPDATE budgets SET amount_paise = -100 WHERE id='SYN-DEMO-BUD-001'").await,
        "23514"
    );
    assert_eq!(
        exec("UPDATE issues SET title = NULL WHERE id='SYN-DEMO-KND-001'").await,
        "23502"
    );
    assert_eq!(
        exec("UPDATE issues SET record_nature = 'OFFICIAL_RECORD' WHERE id='SYN-DEMO-KND-001'")
            .await,
        "23514"
    );
    assert_eq!(
        exec("UPDATE wards SET id = 'WARD-REAL' WHERE id='SYN-DEMO-WARD-GN'").await,
        "23514"
    );
    assert_eq!(
        exec("UPDATE verifications SET citizen_verdict = 'FIXED' WHERE id='SYN-DEMO-VER-001'")
            .await,
        "23514"
    );
    assert_eq!(exec("UPDATE jurisdictions SET legal_ownership_asserted = TRUE WHERE issue_id='SYN-DEMO-KND-002'").await, "23514");
    assert_eq!(
        exec("UPDATE jurisdictions SET confirmation_basis = 'x' WHERE issue_id='SYN-DEMO-KND-002'")
            .await,
        "23514"
    );
    assert_eq!(
        exec("UPDATE issues SET work_order_id = 'SYN-DEMO-WO-999' WHERE id='SYN-DEMO-KND-004'")
            .await,
        "23503"
    );
    assert_eq!(
        exec(
            "UPDATE contractors SET official_performance_rating = 'A' WHERE id='SYN-DEMO-VND-001'"
        )
        .await,
        "23514"
    );
    assert_eq!(
        exec("INSERT INTO lifecycle_events (id, record_nature, source_tier, record_version, updated_at, entity_id, sequence, event_type, actor_role, occurred_at, summary, previous_hash, payload_hash) VALUES ('SYN-DEMO-EVT-X-001','SYNTHETIC_DEMONSTRATION','SYNTHETIC_DEMO',1,timestamptz '2026-11-20T08:30:00Z','SYN-DEMO-KND-002',5,'ISSUE_IN_PROGRESS','system',timestamptz '2026-11-20T08:30:00Z','skips the chain',NULL,repeat('0',64))").await,
        "23514"
    );
    s.finish().await;
}
