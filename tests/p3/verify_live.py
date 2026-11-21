"""P3 live vertical-slice evidence against a RUNNING API (default http://127.0.0.1:8080).

Run:  python -B tests/p3/verify_live.py [base_url]
Needs `jsonschema` and `PyYAML` (see tests/p1/requirements.txt). It sends only GET requests and prints redacted evidence:
status codes, correlation ids and eligible issue ids. No credentials are read or printed. Exit code 0 = every check passed.
Not a unittest module (it needs a live server), so `python -m unittest discover` never collects it.
"""
import json
import pathlib
import sys
import urllib.error
import urllib.request

import yaml
from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

ROOT = pathlib.Path(__file__).resolve().parents[2]
BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8080").rstrip("/")
ORIGIN = "http://localhost:5173"
FULL_BBOX = "72.77,18.89,72.99,19.275"

doc = yaml.safe_load((ROOT / "openapi" / "openapi.yaml").read_text(encoding="utf-8"))
registry = Registry().with_resource("urn:mcl:openapi", Resource.from_contents(doc, DRAFT202012))


def validator(name):
    return Draft202012Validator({"$ref": f"urn:mcl:openapi#/components/schemas/{name}"}, registry=registry)


def get(path, headers=None):
    req = urllib.request.Request(BASE + path, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, dict(r.headers), r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8")


failures = []
evidence = {"base": BASE, "checks": []}


def check(name, ok, detail=""):
    evidence["checks"].append({"check": name, "ok": bool(ok), "detail": detail})
    if not ok:
        failures.append(name)


def validated(schema_name, body):
    errs = sorted(validator(schema_name).iter_errors(body), key=lambda e: list(e.path))
    return not errs, "; ".join(f"{list(e.path)}: {e.message}"[:160] for e in errs[:3])


# 1. probes
for path, schema in (("/health/live", "HealthLive"), ("/health/ready", "HealthReady"), ("/version", "VersionInfo")):
    s, h, b = get(path)
    ok, why = validated(schema, json.loads(b))
    check(f"GET {path} -> 200 and matches {schema}", s == 200 and ok, f"status={s} cid={h.get('x-correlation-id')} {why}")
ready = json.loads(get("/health/ready")[2])
check("readiness reports a live database and PostGIS", ready["status"] == "READY" and ready["database"] == "UP", f"postgis={ready['postgisVersion']}")

# 2. identical filters on both endpoints, several combinations
combos = ["", "ward=K%2FW", "ward=K%2FW&dlpOnly=true", "category=POTHOLE&status=SUBMITTED_UNVERIFIED", "status=TRIAGED_ASSIGNED&ward=K%2FW", "ward=G%2FN&dlpOnly=false"]
for q in combos:
    ls, lh, lb = get("/v1/issues" + ("?" + q if q else ""))
    ms, mh, mb = get(f"/v1/map/features?bbox={FULL_BBOX}" + ("&" + q if q else ""))
    lj, mj = json.loads(lb), json.loads(mb)
    lok, lwhy = validated("IssueListResult", lj)
    mok, mwhy = validated("MapFeatureCollectionResult", mj)
    list_ids = sorted(i["id"] for i in lj["data"]["items"])
    map_ids = sorted(f["id"] for f in mj["data"]["features"] if f["properties"]["kind"] == "ISSUE")
    check(
        f"filters '{q or '(none)'}': list and map eligible issue ids identical, both match their schemas",
        ls == ms == 200 and lok and mok and list_ids == map_ids and lj["data"]["total"] == len(list_ids),
        f"ids={list_ids} total={lj['data']['total']} listCid={lh.get('x-correlation-id')} mapCid={mh.get('x-correlation-id')} {lwhy} {mwhy}",
    )

# 3. invalid bbox -> RFC 9457 problem
s, h, b = get("/v1/map/features?bbox=72.99,18.89,72.77,19.275", {"X-Correlation-Id": "p3-live-evidence-0001"})
p = json.loads(b)
pok, pwhy = validated("Problem", p)
check("invalid bbox -> 400 application/problem+json matching Problem, correlation id echoed",
      s == 400 and h.get("content-type") == "application/problem+json" and pok and p["correlationId"] == "p3-live-evidence-0001" == h.get("x-correlation-id"),
      f"status={s} title={p.get('title')!r} detail={p.get('detail')!r} {pwhy}")

# 4. CORS
s, h, _ = get("/health/live", {"Origin": ORIGIN})
check("approved origin gets its exact Access-Control-Allow-Origin", h.get("access-control-allow-origin") == ORIGIN, str(h.get("access-control-allow-origin")))
s, h, _ = get("/health/live", {"Origin": "http://evil.example"})
check("unapproved origin gets no allowing header", "access-control-allow-origin" not in {k.lower() for k in h}, "")

evidence["failed"] = failures
print(json.dumps(evidence, indent=2))
sys.exit(1 if failures else 0)
