# Evidence

`judge_exports/` holds the files exported from the database loaded by `pipeline/` at commit `c8fb7112`: audit flags (CSV/JSON), contractor scorecards and experimental index, the Next-Rupee plan (CSV/JSON), ward summary and overview metadata. Synthetic challenge dataset; not official BMC data.
`tests/hackathon/verify_h3.py` compares the live Audit CSV with `judge_exports/audit_flags.csv`.
