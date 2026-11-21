"""P5 live Journey 2 evidence against a RUNNING API (default http://127.0.0.1:8080) and the real civic_lens database.

Run:  python -B tests/p5/verify_live.py [base_url] [--no-restore]
Needs `jsonschema`, `referencing` and `PyYAML` (see tests/p1/requirements.txt). Unlike the P3/P4 verifiers this one WRITES: it
submits a synthetic report, runs the duplicate check, records a decision and exercises the error and replay paths, as the
simulated `citizen` persona. Every 200 body is validated strictly against the OpenAPI component schema (CivicIssueResult,
DuplicateCandidatesResult, EvidenceResult, KundaliResult) and every error against Problem. The duplicate scores are compared with
an independent Python oracle computed from config/duplicate-policy.json and data/demo/issues.json (never from server output).

Safety: it refuses to start unless the database is the clean CP-00 baseline, and unless `--no-restore` is given it restores CP-00
afterwards with the guarded CLI (`mcl-seed reset`, which itself refuses anything but the marked local civic_lens database) and
proves the accepted digest returns (`mcl-seed verify`). It prints only status codes, correlation ids and non-sensitive fields;
no credential is read, sent or printed. Exit code 0 = every check passed.
Not a unittest module (it needs a live server), so `python -m unittest discover` never collects it.
"""
import hashlib
import json
import math
import os
import pathlib
import subprocess
import sys
import urllib.error
import urllib.request

import yaml
from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

ROOT = pathlib.Path(__file__).resolve().parents[2]
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
RESTORE = "--no-restore" not in sys.argv
BASE = (ARGS[0] if ARGS else "http://127.0.0.1:8080").rstrip("/")

doc = yaml.safe_load((ROOT / "openapi" / "openapi.yaml").read_text(encoding="utf-8"))
registry = Registry().with_resource("urn:mcl:openapi", Resource.from_contents(doc, DRAFT202012))
policy = json.loads((ROOT / "config" / "duplicate-policy.json").read_text(encoding="utf-8"))
seed = lambda stem: json.loads((ROOT / "data" / "demo" / f"{stem}.json").read_text(encoding="utf-8"))
SEED_ISSUES = seed("issues")

CID = "p5-live-evidence-0001"


def validator(name):
    return Draft202012Validator({"$ref": f"urn:mcl:openapi#/components/schemas/{name}"}, registry=registry)


def call(method, path, body=None, persona="citizen", key=None, headers=None):
    h = {"X-Correlation-Id": CID}
    if persona:
        h["X-Demo-Persona"] = persona
    if key:
        h["Idempotency-Key"] = key
    h.update(headers or {})
    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
        h.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(BASE + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read().decode("utf-8")


failures = []
evidence = {"base": BASE, "checks": []}


def check(name, ok, detail=""):
    evidence["checks"].append({"check": name, "ok": bool(ok), "detail": detail})
    if not ok:
        failures.append(name)


def valid(schema_name, body):
    errs = sorted(validator(schema_name).iter_errors(body), key=lambda e: list(e.path))
    return not errs, "; ".join(f"{list(e.path)}: {e.message}"[:160] for e in errs[:3])


def problem(name, status, s, h, b, want):
    p = json.loads(b)
    ok, why = valid("Problem", p)
    leaked = any(w in b.lower() for w in ("select ", "insert into", "postgres", "sqlx", "panicked", "c:\\", "mcl_api_write", "stack"))
    check(f"{name} -> {want} application/problem+json, matches Problem, nothing leaked, correlation id returned",
          s == want and h.get("content-type") == "application/problem+json" and ok and not leaked and p["correlationId"] == h.get("x-correlation-id"),
          f"status={s} title={p.get('title')!r} cid={h.get('x-correlation-id')} {why}")


def run(cmd):
    env = dict(os.environ, CARGO_REGISTRIES_CRATES_IO_PROTOCOL="git")
    r = subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True, text=True, timeout=600)
    return r.returncode, (r.stdout + r.stderr)[-400:]


def haversine_m(a, b):
    r = 6371008.8
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp, dl = p2 - p1, math.radians(b[0] - a[0])
    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(x))


def parse_t(s):
    from datetime import datetime
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ")


def tokens(text):
    out, cur = set(), ""
    for ch in text.lower():
        if ch.isalnum():
            cur += ch
        elif cur:
            out.add(cur)
            cur = ""
    if cur:
        out.add(cur)
    return out


def oracle(subject, keywords):
    """Independent scoring of the earlier committed reports (the subject itself and later reports are excluded)."""
    w = policy["weights"]
    cp = policy["categoryPolicies"].get(subject["category"])
    kw = tokens(" ".join(keywords))
    rows = []
    for c in SEED_ISSUES:
        if c["reportedAt"] >= subject["reportedAt"]:
            continue
        cpt = c["geometry"]["coordinates"] if c["geometry"]["type"] == "Point" else None
        dist = haversine_m(subject["geometry"]["coordinates"], cpt) if cpt else None
        same_asset = subject["assetId"] is not None and c["assetId"] == subject["assetId"]
        in_radius = bool(cp and dist is not None and dist <= cp["radiusMeters"])
        if not (same_asset or in_radius):
            continue
        hours = abs((parse_t(subject["reportedAt"]) - parse_t(c["reportedAt"])).total_seconds()) / 3600
        text = tokens(c["title"] + " " + c["publicDescription"])
        matched = len(kw & text)
        b = {
            "sameAssetOrSegment": w["sameAssetOrSegment"] if same_asset else 0,
            "sameCategory": w["sameCategory"] if c["category"] == subject["category"] else 0,
            "withinConfiguredRadius": w["withinConfiguredRadius"] if in_radius else 0,
            "withinConfiguredWindow": w["withinConfiguredWindow"] if (cp and hours <= cp["windowHours"]) else 0,
            "keywordOverlap": (w["keywordOverlap"] * matched // len(kw)) if kw else 0,
        }
        rows.append((c["id"], sum(b.values()), b))
    rows.sort(key=lambda r: (-r[1], r[0]))
    return rows


def band(score):
    t = policy["thresholds"]
    return "LIKELY_SAME" if score >= t["likelySame"][0] else "POSSIBLE_MATCH" if score >= t["possible"][0] else "PROBABLY_DISTINCT"


# 0. precondition: a clean CP-00 baseline and a ready API
s, h, b = call("GET", "/health/ready", persona=None)
check("API is ready (PostGIS reachable)", s == 200 and json.loads(b).get("status") == "READY", f"status={s}")
s, h, b = call("GET", "/v1/issues", persona=None)
ids = sorted(i["id"] for i in json.loads(b)["data"]["items"]) if s == 200 else []
clean = ids == sorted(i["id"] for i in SEED_ISSUES)
check("precondition: the database is the clean CP-00 baseline (exactly the six committed issues)", clean, f"ids={len(ids)}")
if not clean:
    print(json.dumps(evidence, indent=2))
    sys.exit(2)

KEYWORDS = ["pothole", "paliram", "junction"]
SUBMIT = {"recordVersion": 1, "payload": {
    "category": "POTHOLE",
    "geometry": {"type": "Point", "coordinates": [72.83158, 19.11974]},
    "title": "Pothole near the S.V. Road Junction approach",
    "publicDescription": "Synthetic pothole on the Paliram Road approach to the junction.",
    "nearbyLandmark": None,
    "assetId": "SYN-DEMO-AST-ROAD-001"}}
KEY = "p5-live-submit-0001"

# 1. submitIssue
s, h, b = call("POST", "/v1/issues", SUBMIT, key=KEY)
j = json.loads(b)
ok, why = valid("CivicIssueResult", j)
issue = j.get("data", {})
check("POST /v1/issues -> 200, matches CivicIssueResult, ETag is the quoted recordVersion, correlation id echoed",
      s == 200 and ok and h.get("etag") == '"1"' and j.get("correlationId") == CID and h.get("x-correlation-id") == CID,
      f"status={s} id={issue.get('id')} etag={h.get('etag')} {why}")
check("new report is SUBMITTED_UNVERIFIED, recordVersion 1, synthetic, journey J2, provisional ward only",
      issue.get("status") == "SUBMITTED_UNVERIFIED" and issue.get("recordVersion") == 1 and issue.get("recordNature") == "SYNTHETIC_DEMONSTRATION"
      and issue.get("journeys") == ["J2"] and issue.get("wardCandidateId") == "SYN-DEMO-WARD-KW" and issue.get("workOrderId") is None,
      f"status={issue.get('status')} ward={issue.get('wardCandidateId')}")
NEW = issue["id"]

s2, h2, b2 = call("POST", "/v1/issues", SUBMIT, key=KEY)
check("exact replay (same Idempotency-Key and body) returns the same committed record", s2 == 200 and json.loads(b2)["data"] == issue, f"status={s2}")
changed = json.loads(json.dumps(SUBMIT))
changed["payload"]["title"] = "A different title"
s3, h3, b3 = call("POST", "/v1/issues", changed, key=KEY)
problem("same key with a different body", 409, s3, h3, b3, 409)

# 2. checkDuplicates
CHECK = {"recordVersion": 1, "payload": {"category": "POTHOLE", "geometry": SUBMIT["payload"]["geometry"], "descriptionKeywords": KEYWORDS}}
s, h, b = call("POST", f"/v1/issues/{NEW}/duplicate-candidates", CHECK, key="p5-live-check-0001")
j = json.loads(b)
ok, why = valid("DuplicateCandidatesResult", j)
d = j.get("data", {})
check("POST duplicate-candidates -> 200, matches DuplicateCandidatesResult, policy label and three choices, no silent rejection",
      s == 200 and ok and d.get("policyLabel") == "DEMONSTRATION_HEURISTIC_V1" and d.get("choices") == policy["choices"] and d.get("silentRejection") is False,
      f"status={s} cid={h.get('x-correlation-id')} {why}")
subject = {**issue}
want = oracle(subject, KEYWORDS)
got = [(c["issueId"], c["score"], c["breakdown"]) for c in d.get("candidates", [])]
check("candidate set, order, factor points and scores equal the independent oracle (policy file + committed seeds)",
      got == want, f"server={[(g[0], g[1]) for g in got]} oracle={[(w[0], w[1]) for w in want]}")
check("every band follows the committed thresholds, the subject is not its own candidate, out-of-radius issues are excluded",
      all(c["band"] == band(c["score"]) for c in d.get("candidates", [])) and NEW not in [c["issueId"] for c in d.get("candidates", [])]
      and not {"SYN-DEMO-KND-005", "SYN-DEMO-KND-006"} & {c["issueId"] for c in d.get("candidates", [])}, "")
s4, h4, b4 = call("POST", f"/v1/issues/{NEW}/duplicate-candidates", CHECK, key="p5-live-check-0002")
check("identical baseline gives identical output under a second key", s4 == 200 and json.loads(b4)["data"] == d, f"status={s4}")

# 3. addEvidence: endorse the closest committed report
MEDIA = "fixtures/evidence/SYN-DEMO-EVD-CITIZEN-P5LIVE0001.svg"
EVID = {"recordVersion": 1, "payload": {
    "stage": "BEFORE", "caption": "Synthetic note: the same surface break is visible here.", "sourceType": "CITIZEN_FIXTURE",
    "capturedAt": "2026-11-21T04:20:00Z", "mediaRef": MEDIA, "sha256": hashlib.sha256(MEDIA.encode()).hexdigest(),
    "duplicateChoice": "ENDORSE_EXISTING"}}
target = want[0][0] if want else "SYN-DEMO-KND-001"
s, h, b = call("POST", f"/v1/issues/{target}/evidence", EVID, key="p5-live-evid-0001")
j = json.loads(b)
ok, why = valid("EvidenceResult", j)
ev = j.get("data", {})
check("POST evidence -> 200, matches EvidenceResult, ETag is the quoted recordVersion",
      s == 200 and ok and h.get("etag") == '"1"', f"status={s} id={ev.get('id')} {why}")
check("evidence is metadata only, quarantined, unverified, location unverified, citizen fixture",
      ev.get("processingState") == "UPLOADED_QUARANTINE" and ev.get("verificationState") == "NOT_VERIFIED"
      and ev.get("locationConfidence") == "LOCATION_UNVERIFIED" and ev.get("mediaStatus") == "SYNTHETIC_FIXTURE_REFERENCE_ONLY"
      and ev.get("confidence") == "CITIZEN_SUBMITTED" and ev.get("hashBasis") == "FIXTURE_REFERENCE_STRING", "")
s5, h5, b5 = call("POST", f"/v1/issues/{target}/evidence", EVID, key="p5-live-evid-0001")
check("evidence replay returns the same committed record", s5 == 200 and json.loads(b5)["data"] == ev, f"status={s5}")

# 4. the committed records are visible through the read identity
s, h, b = call("GET", f"/v1/kundalis/{NEW}", persona=None)
j = json.loads(b)
ok, why = valid("KundaliResult", j)
types = [e["eventType"] for e in j.get("data", {}).get("auditEvents", [])]
check("GET kundali of the new report -> 200, matches KundaliResult, ETag 1, jurisdiction provisional and not legal ownership",
      s == 200 and ok and h.get("etag") == '"1"' and j["data"]["jurisdiction"]["status"] == "SPATIALLY_INFERRED_PROVISIONAL"
      and j["data"]["jurisdiction"]["legalOwnershipAsserted"] is False, f"status={s} {why}")
check("new report's lifecycle events are the submitted, jurisdiction and two distinct checks (replays added none)",
      types == ["ISSUE_SUBMITTED_UNVERIFIED", "JURISDICTION_SPATIALLY_INFERRED_PROVISIONAL", "DUPLICATE_CHECK_EVALUATED", "DUPLICATE_CHECK_EVALUATED"],
      f"events={types}")
s, h, b = call("GET", f"/v1/kundalis/{target}", persona=None)
tk = json.loads(b)["data"]
check("the endorsed report's Kundali lists the new evidence and the decision event; its prior history is intact",
      any(e["id"] == ev.get("id") for e in tk["evidence"]) and tk["auditEvents"][-1]["eventType"] == "DUPLICATE_ENDORSED_EXISTING"
      and [e["sequence"] for e in tk["auditEvents"]] == sorted(e["sequence"] for e in tk["auditEvents"]), f"last={tk['auditEvents'][-1]['eventType']}")

# 5. contract errors
bad = {"recordVersion": 1, "payload": {**SUBMIT["payload"], "title": "x" * 161}}
s, h, b = call("POST", "/v1/issues", bad, key="p5-live-bad-0001")
problem("title longer than 160 characters", 422, s, h, b, 422)
s, h, b = call("POST", "/v1/issues", b"{not json", key="p5-live-bad-0002")
problem("malformed JSON", 400, s, h, b, 400)
s, h, b = call("POST", "/v1/issues", SUBMIT, persona="public", key="p5-live-bad-0003")
problem("simulated persona that may not submit", 422, s, h, b, 422)
s, h, b = call("POST", "/v1/issues", SUBMIT, key="short")
problem("Idempotency-Key shorter than 8 characters", 400, s, h, b, 400)
s, h, b = call("POST", "/v1/issues/SYN-DEMO-KND-999/duplicate-candidates", CHECK, key="p5-live-bad-0004")
problem("duplicate check for an unknown issue", 404, s, h, b, 404)
s, h, b = call("POST", f"/v1/issues/{NEW}/evidence", {**EVID, "recordVersion": 9}, key="p5-live-bad-0005")
problem("stale recordVersion", 409, s, h, b, 409)
s, h, b = call("POST", "/v1/issues/lower-case/evidence", EVID, key="p5-live-bad-0006")
problem("malformed path identifier", 400, s, h, b, 400)
s, h, b = call("POST", "/v1/issues", SUBMIT, key="p5-live-bad-0007", headers={"X-Correlation-Id": "bad id with spaces"})
check("an unsafe correlation id is replaced by a generated one that is returned", s == 200 and len(h.get("x-correlation-id", "")) == 36 and h["x-correlation-id"] != "bad id with spaces", f"cid_len={len(h.get('x-correlation-id', ''))}")
for method, path in (("POST", "/v1/demo/reset"), ("POST", "/v1/authority/issues/SYN-DEMO-KND-001/completion-claim"), ("PUT", "/v1/issues")):
    s, _, _ = call(method, path, b"{}", key="p5-live-scope-0001")
    check(f"{method} {path} is not available (no unapproved operation)", s in (404, 405), f"status={s}")

# 6. restore the accepted CP-00 baseline with the guarded CLI and prove the original digest returns
if RESTORE:
    rc, out = run(["cargo", "run", "-q", "-p", "mcl-infrastructure", "--bin", "mcl-seed", "--", "reset"])
    check("guarded mcl-seed reset completed", rc == 0, out.strip().splitlines()[-1] if out.strip() else "")
    rc, out = run(["cargo", "run", "-q", "-p", "mcl-infrastructure", "--bin", "mcl-seed", "--", "verify"])
    check("CP-00 baseline digest matches the accepted digest after restoration", rc == 0 and "baseline matches CP-00" in out, out.strip().splitlines()[-1] if out.strip() else "")
    s, h, b = call("GET", "/v1/issues", persona=None)
    check("the six committed issues are back and the live report is gone", s == 200 and len(json.loads(b)["data"]["items"]) == 6, "")

evidence["failed"] = failures
print(json.dumps(evidence, indent=2))
sys.exit(1 if failures else 0)
