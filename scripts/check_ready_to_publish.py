#!/usr/bin/env python3
"""Pre-publish check. Run from the repository root:  python3 scripts/check_ready_to_publish.py

Fails (exit 1) if the video link is still a placeholder, a required file is missing, or something that must never be
published is present (.env.local, private keys, tokens, build folders, oversized files, video files).
"""
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = [
    "README.md", "HACKATHON_SUBMISSION.md", "Cargo.toml", "Cargo.lock", "pnpm-lock.yaml", ".env.example",
    "apps/web/package.json", "crates/api/Cargo.toml", "scripts/start_hackathon_demo.ps1",
    "tests/hackathon/verify_h3.py", "docs/RUN_THE_DEMO.md", "docs/GITHUB_UPLOAD_MOBILE.md",
    "docs/demo-evidence/CAPTURE_AND_UX_SUMMARY.md", "docs/screenshots/01_map_ward_FS.jpg",
]
BAD_DIRS = {"node_modules", "target", "dist", "__pycache__", ".demo-run"}
BAD_NAMES = {".env", ".env.local"}
BAD_SUFFIX = {".pem", ".key", ".webm", ".mp4", ".mov", ".zip", ".pyc"}
SECRET = re.compile(
    r"ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"
)
DSN = re.compile(r"postgres(?:ql)?://([^:@/\s]+):([^@\s]{6,})@")
DSN_OK = ("replace-with", "super-secret-value", "p%40ss-word", "<", "example", "changeme-local")
MAX_BYTES = 25 * 1024 * 1024

problems, notes = [], []
files = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d != ".git"]
    for d in list(dirnames):
        if d in BAD_DIRS:
            problems.append(f"must not be published: folder {Path(dirpath, d).relative_to(ROOT).as_posix()}/")
            dirnames.remove(d)
    for f in filenames:
        files.append(Path(dirpath, f))

for p in files:
    rel = p.relative_to(ROOT).as_posix()
    if p.name in BAD_NAMES or p.suffix.lower() in BAD_SUFFIX:
        problems.append(f"must not be published: {rel}")
        continue
    if p.stat().st_size > MAX_BYTES:
        problems.append(f"file larger than 25 MB: {rel}")
    if p.suffix.lower() in {".md", ".json", ".py", ".ps1", ".rs", ".ts", ".tsx", ".toml", ".yaml", ".yml", ".sql", ".example", ".txt", ".csv", ".mjs"} or p.name == ".env.example":
        try:
            t = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if SECRET.search(t):
            problems.append(f"secret-looking token in {rel}")
        for m in DSN.finditer(t):
            if not any(ok in m.group(0) for ok in DSN_OK):
                problems.append(f"database URL with a real-looking password in {rel}")
                break

for r in REQUIRED:
    if not (ROOT / r).exists():
        problems.append(f"missing required file: {r}")

readme = (ROOT / "README.md").read_text(encoding="utf-8") if (ROOT / "README.md").exists() else ""
if "PASTE_YOUTUBE_URL_HERE" in readme or "PASTE_YOUTUBE_URL_HERE" in (
    (ROOT / "HACKATHON_SUBMISSION.md").read_text(encoding="utf-8") if (ROOT / "HACKATHON_SUBMISSION.md").exists() else ""
):
    problems.append("video link is still the placeholder -> run: python3 scripts/set_video_url.py \"https://youtu.be/<id>\"")
elif not re.search(r"https://youtu\.be/[A-Za-z0-9_-]{11}", readme):
    problems.append("README.md has no https://youtu.be/<id> video link")
else:
    notes.append("video link present in README.md")

print(f"files checked: {len(files)}")
for n in notes:
    print("ok:", n)
if problems:
    print("\nNOT READY TO PUBLISH:")
    for p in problems:
        print(" -", p)
    sys.exit(1)
print("\nREADY TO PUBLISH. Next: git add -A && git commit -m \"Final submission\" && git push")
