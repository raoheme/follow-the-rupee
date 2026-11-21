"""H3 deterministic verification against the launcher-started stack (API 127.0.0.1:8080).

Run: python -I tests/hackathon/verify_h3.py
Read-only except for one POST /v1/issues probe that MUST answer 503 (commands are disabled on this branch).
"""
import csv
import io
import json
import math
import sys
import urllib.error
import urllib.parse
import urllib.request

API = "http://127.0.0.1:8080"
JUDGE_CSV = r"C:\Projects\Mumbai Civic Lens\external-inputs\hackathon-work\judge-exports\audit_flags.csv"
WARDS = ["A", "B", "C", "D", "E", "F/N", "F/S", "G/N", "G/S", "H/E", "H/W", "K/E", "K/W", "L", "M/E", "M/W", "N", "P/N", "P/S", "R/C", "R/N", "R/S", "S", "T"]
SLASH = [w for w in WARDS if "/" in w]
fails = []
passed = 0


def check(name, ok, detail=""):
    global passed
    if ok:
        passed += 1
    else:
        fails.append(f"{name} {detail}")
        print(f"FAIL {name} {detail}")


def get(path, method="GET", data=None, headers=None):
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()


def has_nan(o):
    if isinstance(o, float):
        return math.isnan(o) or math.isinf(o)
    if isinstance(o, dict):
        return any(has_nan(v) for v in o.values())
    if isinstance(o, list):
        return any(has_nan(v) for v in o)
    return False


def jget(path):
    s, _, b = get(path)
    try:
        # NaN/Infinity tokens are not valid JSON: reject them instead of silently accepting
        return s, json.loads(b, parse_constant=lambda c: (_ for _ in ()).throw(ValueError(c)))
    except Exception as e:  # noqa: BLE001
        return s, {"__parse_error__": str(e)}


assert len(WARDS) == 24 and len(SLASH) == 15

# 1. capabilities and command-disabled behaviour
s, d = jget("/health/capabilities")
check("capabilities 200", s == 200, str(s))
check("monsoonReads AVAILABLE", d.get("monsoonReads") == "AVAILABLE", str(d))
check("commands DISABLED", d.get("commands") == "DISABLED", str(d))
body = json.dumps({"recordVersion": 1, "payload": {"category": "POTHOLE", "geometry": {"type": "Point", "coordinates": [72.83158, 19.11974]}, "title": "h3 probe", "publicDescription": "Synthetic pothole report near the S.V. Road Junction approach on Paliram Road.", "nearbyLandmark": "near S.V. Road Junction approach (synthetic label)", "assetId": "SYN-DEMO-AST-ROAD-001"}}).encode()
s, _, _ = get("/v1/issues", "POST", body, {"Content-Type": "application/json", "X-Demo-Persona": "citizen", "Idempotency-Key": "h3-probe-key-0001"})
check("POST /v1/issues is 503", s == 503, str(s))
s, _, _ = get("/health/ready")
check("health/ready 200 (civic_lens read pool only)", s == 200, str(s))

# 2. all 24 wards on 4 endpoints
for w in WARDS:
    q = urllib.parse.urlencode({"ward": w})
    for ep in ("ward-detail", "map-triage", "audit/flags", "next-rupee"):
        s, d = jget(f"/v1/monsoon/{ep}?{q}")
        ok = s == 200 and "__parse_error__" not in d and not has_nan(d)
        check(f"{ep} ?ward={w}", ok, f"{s} {d.get('__parse_error__', '')}")
    s, d = jget(f"/v1/monsoon/map-triage?{q}")
    if s == 200:
        check(f"map-triage {w} roads in ward", all(r["ward_code"] == w for r in d["roads"]))
        check(f"map-triage {w} no unresolved pins", all(i["coord_provenance"] in ("SOURCE_GPS", "LOCALITY_CENTROID") for i in d["issues"]))
        check(f"map-triage {w} issues_returned==total", d["issues_returned"] == d["issues_total"])

# 3. audit CSV parity with judge export (433 primary rows, 415 unique WOs)
s, h, b = get("/v1/monsoon/audit/flags?flag_class=PRIMARY_REVIEW_FLAG&format=csv&limit=3000")
check("csv 200", s == 200, str(s))
check("csv content-type", (h.get("Content-Type") or "").startswith("text/csv; charset=utf-8"), str(h.get("Content-Type")))
check("csv attachment filename", 'filename="mumbai_civic_lens_audit_flags.csv"' in (h.get("Content-Disposition") or ""), str(h.get("Content-Disposition")))
rows = list(csv.DictReader(io.StringIO(b.decode("utf-8-sig"))))
check("csv 433 data rows", len(rows) == 433, str(len(rows)))
check("csv 415 unique WOs", len({r["work_order_id"] for r in rows}) == 415, str(len({r["work_order_id"] for r in rows})))
with open(JUDGE_CSV, encoding="utf-8-sig", newline="") as f:
    judge = [r for r in csv.DictReader(f) if r["flag_class"] == "PRIMARY_REVIEW_FLAG"]
check("judge export 433 primary", len(judge) == 433, str(len(judge)))
check("csv flag_id set equals judge export", {r["flag_id"] for r in rows} == {r["flag_id"] for r in judge})
jm = {r["flag_id"]: r for r in judge}
check("csv amounts equal judge export", all(r["flag_amount_inr"] == jm[r["flag_id"]]["flag_amount_inr"] and r["work_order_id"] == jm[r["flag_id"]]["work_order_id"] for r in rows if r["flag_id"] in jm))

# 4. OF-6 rank semantics
s, d = jget("/v1/monsoon/next-rupee")
dlp = {r["road_id"]: r for r in d["dlp_review_lane"]}
r220 = dlp.get("RD0220", {})
check("RD0220 #1/#1 DLP lane", (r220.get("ward_rank"), r220.get("citywide_lane_rank"), r220.get("lane")) == (1, 1, "DLP_REVIEW_FIRST_LANE"), str(r220.get("ward_rank")))
check("RD0220 affordable_now null", r220.get("affordable_now", "x") is None)
s, d = jget("/v1/monsoon/next-rupee?ward=L")
r222 = next((r for r in d["new_budget_lane"] if r["road_id"] == "RD0222"), {})
check("RD0222 ward rank != citywide rank", r222.get("ward_rank") is not None and r222.get("ward_rank") != r222.get("citywide_lane_rank"), f"{r222.get('ward_rank')}/{r222.get('citywide_lane_rank')}")
s, d0 = jget("/v1/monsoon/next-rupee?budget_override_inr=0")
s, d1 = jget("/v1/monsoon/next-rupee")
ranks = lambda d: [(r["road_id"], r["citywide_lane_rank"], r["risk_score"]) for r in d["new_budget_lane"]]  # noqa: E731
check("risk rank invariant under budget 0", ranks(d0) == ranks(d1))

print(f"\nverify_h3: {passed} checks passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
