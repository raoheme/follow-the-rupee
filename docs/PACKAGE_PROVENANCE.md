# Package provenance

* Source: `git archive` of commit `c8fb7112` on branch `hackathon/follow-the-rupee` (270 tracked files; no history, no `node_modules`, no `target`, no `.env.local`).
* Built on 2026-11-21 by `build_submission_package.py` (kept outside the repository).
* Video link: set.

## Differences from the frozen commit

* `README.md` replaced by the submission README (original kept at `docs/archive/README_v1.2.3_original.md`).
* `scripts/start_hackathon_demo.ps1` and `stop_hackathon_demo.ps1`: PID/log folder moved from an absolute author path to `.demo-run\` inside the repository (one line each; no behaviour change otherwise).
* `.gitignore`: added `.demo-run/`.
* `HACKATHON_SUBMISSION.md`: demo-video link block added; the line pointing to local judge-export/video-kit folders now points to `evidence/judge_exports/`.
* Local Windows user name redacted to `<LOCAL_USER>` in: `audit/CAP0_REPORT.md`, `audit/OPEN_FINDINGS.json`, `audit/P4_REPORT.md`.

## Files added by the package (not in the commit)

* `docs/demo-evidence/CAPTURE_AND_UX_SUMMARY.md`
* `docs/GITHUB_UPLOAD_MOBILE.md`
* `docs/RUN_THE_DEMO.md`
* `README.md`
* `scripts/check_ready_to_publish.py`
* `scripts/set_video_url.py`
* `evidence/README.md`
* `docs/screenshots/*.jpg` (9 clean screenshots), `evidence/judge_exports/*` (8 files)

Every other file is byte-identical to the commit (apart from the redactions listed above).
