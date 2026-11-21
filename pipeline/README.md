# Follow the Rupee — pipeline

> Synthetic challenge dataset. Not official BMC data. Contractors, amounts, dates, coordinates and transactions are fictional. Real Mumbai geographic names are used only for challenge realism.

All thresholds, categories, weights and wording live in `config/audit_rules.json`; edit it and rerun `01` + `02` (≈ seconds).

| step | command | output |
|---|---|---|
| H0 EDA | `python -X utf8 pipeline/00_eda.py` | `external-inputs/hackathon-work/EDA_REPORT.md`, `batches/*.jsonl` (outside git) |
| H0 report | `python -X utf8 pipeline/00a_h0_report.py` | `audit/H0_REPORT.md` |
| H1 analytics | `python -X utf8 pipeline/01_build_monsoon_analytics.py` | `pipeline/out/*` (gitignored), `pipeline/narratives_monsoon.json`, judge exports |
| H1V report | `python -X utf8 pipeline/03_write_h1v_report.py` | `audit/H1V_REPORT.md` (also runs `python -X utf8 -m unittest pipeline/test_h1v.py`) |
| H1V verify | `python -X utf8 pipeline/04_verify_h1v.py` | `pipeline/out/h1v_verify.json` (51 closure checks: isolation, roles, settled analytical values, CP-00) |
| H1 PostGIS | `python -X utf8 pipeline/02_load_postgis_monsoon.py` | database `civic_lens_monsoon` (loaded through `podman exec psql`) |

Notes
- Do not run with `-I`: it hides user-site packages (shapely).
- Requires pandas, numpy, shapely; no database driver needed (SQL is piped to `psql` inside the Podman container).
- Source data is read from `paths.data_dir` and is never copied into git. Optional Antigravity enrichments are merged if present in `paths.enriched_dir` (`complaints_ambiguous_enriched.jsonl`, `social_posts_enriched.jsonl`).
- `civic_lens` (the main app database) is never touched; the loader only creates/recreates `civic_lens_monsoon`.

Config: `config/audit_rules.json` (audit rules, fairness, treatment matrix) and `config/next_rupee_rules.json` (risk model + 4 profiles). `narratives_authored.json` holds Claude-authored showcase texts; `01` verifies every number against computed values.
