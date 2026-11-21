# Run the demo

> Synthetic challenge dataset. Not official BMC data. Contractors, amounts, dates, coordinates and transactions are fictional.

## 1. See it without installing anything

* The demo video linked at the top of the [README](../README.md).
* Screenshots: `docs/screenshots/`.
* Live figures and the 3-minute script: [`HACKATHON_SUBMISSION.md`](../HACKATHON_SUBMISSION.md).
* Exported evidence (audit flags, scorecards, plan): `evidence/judge_exports/`.

## 2. Run it on your own machine (Windows 11)

The prototype is a read-only Rust API plus a React UI over a PostGIS database. It was built and verified on Windows 11 with
WSL2 and Podman. This is the **recorded sequence from the author's machine**; the launcher in step 7 and the checks in step 8
were run at this exact commit, a clean-machine rebuild of steps 1–6 was not repeated for the submission package.

**Prerequisites:** Windows 11, WSL2, Podman 6 (WSL machine), Rust stable (`rust-toolchain.toml`), Node 20+ with
pnpm 11 (`package.json` → `packageManager`), Python 3.13 with `pandas`, `numpy`, `shapely`.

1. **Put the repository at the canonical path** `C:\Projects\Mumbai Civic Lens\mumbai-civic-lens` (see `INSTALL_LOCATION.md`).
   Several scripts assume it.
2. **Get the challenge dataset** (public, synthetic):
   `git clone https://github.com/SumeetGDoshi/Claude-Impact-Labs-data-2 "C:\Projects\Mumbai Civic Lens\external-inputs\Claude-Impact-Labs-data-2-main"`.
   If you use other folders, edit the `paths` block of `pipeline/config/audit_rules.json` (and `JUDGE_CSV` at the top of
   `tests/hackathon/verify_h3.py`). They are absolute Windows paths.
3. **Create `.env.local`** from `.env.example` with strong local passwords. Never commit it (it is git-ignored).
4. **Start the database container:** `podman compose --env-file .env.local up -d db` (container `mumbai-civic-lens_db_1`, image `postgis/postgis:17-3.5`).
5. **Main app database and read-only API role:** run the `mcl-seed` binary (`cargo run -p mcl-infrastructure --bin mcl-seed -- migrate`, then `-- provision-api-role` as described in `.env.example`; background in `audit/P1_REPORT.md` and `audit/P3_REPORT.md`).
6. **Build the analytics and load the monsoon database:**
   `python -X utf8 pipeline/01_build_monsoon_analytics.py` then `python -X utf8 pipeline/02_load_postgis_monsoon.py`
   (creates only `civic_lens_monsoon`; see `pipeline/README.md`).
7. **Install and launch:** `pnpm install --frozen-lockfile`, then

   ```powershell
   .\scripts\start_hackathon_demo.ps1
   ```

   Open <http://localhost:5173/>. The launcher waits for three readiness signals and prints them:
   `/health/capabilities` reports `monsoonReads=AVAILABLE` and `commands=DISABLED`, `/v1/monsoon/overview` answers 200, and the UI answers 200.
   (`/health/ready` alone is **not** enough on this branch; see `OF-H2-CMD-ROLE` in `HACKATHON_SUBMISSION.md`.)
8. **Verify:** `python -I tests/hackathon/verify_h3.py` runs 185 read-only checks across all 24 wards.
9. **Stop:** `.\scripts\stop_hackathon_demo.ps1` (leaves the database container running).

Launcher state (process ids, logs) is written to `.demo-run\` inside the repository folder; it is git-ignored.

## 3. Why there is no one-click online demo

The UI needs the API and the PostGIS database; GitHub cannot host those. The video and screenshots are the zero-install demo.
A containerised one-command demo (API + database + UI in Docker Compose) is the natural next step and is not part of this submission.
