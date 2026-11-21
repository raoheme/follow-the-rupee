//! `mcl-seed migrate | reset | verify | provision-api-role | provision-command-roles` against the configured PostgreSQL/PostGIS database.
//! The connection string comes from DATABASE_URL or .env.local and is never printed.
use mcl_infrastructure::{command, demo, read};
use std::process::ExitCode;

#[tokio::main]
async fn main() -> ExitCode {
    let cmd = std::env::args().nth(1).unwrap_or_default();
    match run(&cmd).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("mcl-seed {cmd}: {e}");
            ExitCode::FAILURE
        }
    }
}

async fn run(cmd: &str) -> Result<(), demo::DemoError> {
    let pool = demo::connect(&demo::database_url()?).await?;
    let dir = demo::default_seed_dir();
    match cmd {
        "migrate" => {
            demo::migrate(&pool).await?;
            println!("migrations applied");
        }
        "reset" => {
            demo::migrate(&pool).await?;
            let r = demo::reset_and_seed(&pool, &dir).await?;
            for (t, n) in &r.counts {
                println!("{t}: {n}");
            }
            println!("baselineDigest: {}", r.digest);
        }
        "verify" => {
            let digest = demo::baseline_digest(&pool).await?;
            let expected = demo::manifest_expected_digest(&dir)?;
            println!("baselineDigest: {digest}\nexpectedDigest: {expected}");
            if digest != expected {
                return Err(demo::DemoError::Msg(
                    "baseline digest differs from reset-manifest.json".into(),
                ));
            }
            println!("baseline matches CP-00");
        }
        "provision-api-role" => {
            let url = read::app_database_url().map_err(|e| demo::DemoError::Msg(e.to_string()))?;
            let t = read::provision_api_role(&pool, &url)
                .await
                .map_err(|e| demo::DemoError::Msg(e.to_string()))?;
            println!(
                "api login role {} provisioned on {}:{}/{} (member of {} without inheritance)",
                t.user,
                t.host,
                t.port,
                t.database,
                read::APP_ROLE
            );
        }
        "provision-command-roles" => {
            let url = command::write_database_url().map_err(|e| demo::DemoError::Msg(e.to_string()))?;
            let t = command::provision_command_roles(&pool, &url)
                .await
                .map_err(|e| demo::DemoError::Msg(e.to_string()))?;
            // Prove the result by logging in as the new identity (credentials are never printed).
            let write_pool = command::connect_command(&url).map_err(|e| demo::DemoError::Msg(e.to_string()))?;
            let id = command::command_identity(&write_pool)
                .await
                .map_err(|e| demo::DemoError::Msg(e.to_string()))?;
            if !id.is_least_privilege() {
                return Err(demo::DemoError::Msg(
                    "provisioned identity is not least privilege".into(),
                ));
            }
            println!(
                "command login role {} provisioned on {}:{}/{}; effective role {} verified least privilege (insert on {}; column-level update on {})",
                t.user,
                t.host,
                t.port,
                t.database,
                id.current_user,
                id.insertable_tables.join(", "),
                id.updatable_columns.join(", ")
            );
        }
        _ => {
            return Err(demo::DemoError::Msg(
                "usage: mcl-seed migrate | reset | verify | provision-api-role | provision-command-roles".into(),
            ))
        }
    }
    Ok(())
}
