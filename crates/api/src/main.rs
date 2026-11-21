//! `mcl-api`: host-native Axum API. Binds 127.0.0.1:8080 by default and connects to PostgreSQL/PostGIS through two separate
//! least-privilege pools: the read pool (`APP_DATABASE_URL`: `mcl_api` -> `mcl_app`, read-only) and the command pool
//! (`APP_WRITE_DATABASE_URL`: `mcl_api_write` -> `mcl_command`: inserts plus the committed P6 column-level updates). It never reads `DATABASE_URL` (the owner
//! credential) and never logs a URL. Startup fails if either pool's actual role state is more privileged than expected.
use mcl_api::config::{Config, RawConfig};
use mcl_api::{router, AppState};
use mcl_infrastructure::{command, read};
use std::process::ExitCode;

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(msg) => {
            eprintln!("mcl-api: {msg}");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), String> {
    let config = Config::from_raw(&RawConfig::from_env()).map_err(|e| e.to_string())?;
    let url = read::app_database_url().map_err(|e| e.to_string())?;
    let target = read::redacted(&url).map_err(|e| e.to_string())?;
    let pool = read::connect_app(&url).await.map_err(|e| e.to_string())?;

    match read::runtime_identity(&pool).await {
        Ok(id) if id.is_least_privilege() => {
            tracing::info!(
                host = %target.host, port = target.port, database = %id.database,
                login_role = %id.session_user, effective_role = %id.current_user,
                "database identity verified: least privilege, read-only session"
            );
        }
        Ok(id) => {
            return Err(format!(
                "refusing to start: database identity is {}/{} (read-only={}, superuser={}); expected {} via {}",
                id.session_user,
                id.current_user,
                id.read_only_session,
                id.superuser,
                read::APP_ROLE,
                read::API_LOGIN_ROLE
            ));
        }
        Err(e) if e.is_unavailable() => {
            tracing::warn!(
                "database unreachable at start; /health/ready will report NOT_READY until it is"
            );
        }
        Err(e) => return Err(format!("cannot establish the database identity: {e}")),
    }

    // The command pool. Its URL is required: the API has write operations and must not silently run without its identity.
    let write_url = command::write_database_url().map_err(|e| e.to_string())?;
    let write_target = read::redacted(&write_url).map_err(|e| e.to_string())?;
    let command_pool = command::connect_command(&write_url).map_err(|e| e.to_string())?;
    let mut command_ok = true;
    match command::command_identity(&command_pool).await {
        Ok(id) if id.is_least_privilege() => {
            tracing::info!(
                host = %write_target.host, port = write_target.port, database = %id.database,
                login_role = %id.session_user, effective_role = %id.current_user,
                insert_tables = %id.insertable_tables.join(","),
                "command identity verified: committed inserts and column-level updates only, no delete/truncate, no ownership"
            );
        }
        Ok(id) => {
            // Hackathon branch: the civic_lens command role carries grants from the paused P7 work, which the committed P6 check rejects.
            // Write operations are disabled (503) instead of refusing to start; the read-only Follow the Rupee API needs no command pool.
            tracing::error!(
                login_role = %id.session_user, effective_role = %id.current_user,
                "command identity does not match the committed grants; write operations are DISABLED (read-only mode). Recorded as open finding OF-H2-CMD-ROLE"
            );
            command_ok = false;
        }
        Err(e) if e.is_unavailable() => {
            tracing::warn!(
                "command database unreachable at start; write operations will fail with 503 until it is"
            );
        }
        Err(e) => return Err(format!("cannot establish the command identity: {e}")),
    }

    // The Follow the Rupee pool: separate database, same least-privilege identity, read-only. Never fatal: only /v1/monsoon/* degrades.
    let monsoon_pool = mcl_api::monsoon::connect_monsoon()?;
    match mcl_api::monsoon::identity(&monsoon_pool).await {
        Ok((login, eff, db, ro)) if eff == read::APP_ROLE && ro => {
            tracing::info!(database = %db, login_role = %login, effective_role = %eff, "monsoon identity verified: read-only mcl_app session");
        }
        Ok((login, eff, db, ro)) => {
            return Err(format!(
                "refusing to start: monsoon identity is {login}/{eff} on {db} (read-only={ro}); expected mcl_app read-only"
            ));
        }
        Err(_) => tracing::warn!(
            "monsoon database unreachable at start; /v1/monsoon/* will answer 503 until it is"
        ),
    }

    let listener = tokio::net::TcpListener::bind(config.bind)
        .await
        .map_err(|e| format!("cannot bind {}: {e}", config.bind))?;
    tracing::info!(addr = %config.bind, "listening");
    axum::serve(
        listener,
        router(
            {
                let st = AppState::new(pool).with_monsoon_pool(monsoon_pool);
                if command_ok {
                    st.with_command_pool(command_pool)
                } else {
                    st
                }
            },
            &config.cors_origins,
        ),
    )
    .with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await
    .map_err(|e| e.to_string())
}
