#!/usr/bin/env python3
"""Insert (or change) the YouTube demo-video link in README.md and HACKATHON_SUBMISSION.md.

Usage (from the repository root, e.g. in a GitHub Codespace terminal):

    python3 scripts/set_video_url.py "https://youtu.be/XXXXXXXXXXX"

Accepts youtu.be/<id>, youtube.com/watch?v=<id>, /shorts/<id>, /embed/<id>, /live/<id>. Tracking parameters such as
?si=... are dropped. Safe to re-run with a different URL. Finishes by running scripts/check_ready_to_publish.py.
"""
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
START, END = "<!-- VIDEO_LINK_START -->", "<!-- VIDEO_LINK_END -->"


def video_id(url: str):
    u = urlparse(url.strip())
    host = u.netloc.lower()
    for prefix in ("www.", "m."):
        if host.startswith(prefix):
            host = host[len(prefix):]
    vid = ""
    if host == "youtu.be":
        vid = u.path.strip("/").split("/")[0]
    elif host in ("youtube.com", "music.youtube.com"):
        if u.path == "/watch":
            vid = parse_qs(u.query).get("v", [""])[0]
        else:
            parts = [p for p in u.path.split("/") if p]
            if len(parts) >= 2 and parts[0] in ("shorts", "embed", "live"):
                vid = parts[1]
    return vid if re.fullmatch(r"[A-Za-z0-9_-]{11}", vid) else None


def block(vid: str, big: bool) -> str:
    url = f"https://youtu.be/{vid}"
    if big:
        return (
            "## ▶ Watch the 3-minute demo\n"
            f"[![Watch the demo video on YouTube](https://img.youtube.com/vi/{vid}/hqdefault.jpg)]({url})\n\n"
            f"**Demo video (YouTube, unlisted):** {url}\n"
        )
    return f"**Demo video (YouTube, unlisted):** {url}\n"


def patch(path: Path, vid: str, big: bool) -> bool:
    text = path.read_text(encoding="utf-8")
    pattern = re.compile(re.escape(START) + r".*?" + re.escape(END), re.S)
    if not pattern.search(text):
        print(f"!! markers not found in {path.name}; nothing changed there")
        return False
    new = START + "\n" + block(vid, big) + END
    path.write_text(pattern.sub(lambda _m: new, text, count=1), encoding="utf-8")
    print(f"updated {path.name}")
    return True


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    vid = video_id(sys.argv[1])
    if not vid:
        print("That does not look like a YouTube video link (expected e.g. https://youtu.be/XXXXXXXXXXX). Nothing changed.")
        return 2
    ok = patch(ROOT / "README.md", vid, big=True) & patch(ROOT / "HACKATHON_SUBMISSION.md", vid, big=False)
    print(f"video link set to https://youtu.be/{vid}")
    checker = ROOT / "scripts" / "check_ready_to_publish.py"
    rc = subprocess.call([sys.executable, str(checker)]) if checker.exists() else 0
    return 0 if ok and rc == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
