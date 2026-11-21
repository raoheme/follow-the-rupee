"""P4 live vertical-slice evidence against a RUNNING API (default http://127.0.0.1:8080).

Run:  python -B tests/p4/verify_live.py [base_url]
Needs `jsonschema` and `PyYAML` (see tests/p1/requirements.txt). It sends only GET requests (never POST /v1/demo/reset) and
prints redacted evidence: status codes, correlation ids and a few non-sensitive field values. Every 200 body is validated
against the OpenAPI component schema (KundaliResult, WorkOrderDetailResult, BudgetTraceResult) and every error against
Problem. No credentials are read or printed. Exit code 0 = every check passed.
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

doc = yaml.safe_load((ROOT / "openapi" / "openapi.yaml").read_text(encoding="utf-8"))
registry = Registry().with_resource("urn:mcl:openapi", Resource.from_contents(doc, DRAFT202012))
seed = lambda stem: json.loads((ROOT / "data" / "demo" / f"{stem}.json").read_text(encoding="utf-8"))


def validator(name):
    return Draft202012Validator({"$ref": f"urn:mcl:openapi#/components/schemas/{name}"}, registry=registry)


def get(path, headers=None, method="GET"):
    req = urllib.request.Request(BASE + path, headers=headers or {}, method=method)
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


def no_float_money(node, path=""):
    """Money fields (*Paise) must be JSON integers, never floats."""
    bad = []
    if isinstance(node, dict):
        for k, v in node.items():
            if k.lower().endswith("paise") and v is not None and (isinstance(v, float) or isinstance(v, bool) or not isinstance(v, int)):
                bad.append(f"{path}/{k}={v!r}")
            bad += no_float_money(v, f"{path}/{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            bad += no_float_money(v, f"{path}[{i}]")
    return bad


# 1. every seeded issue: a schema-valid Kundali that equals the committed record
for issue in seed("issues"):
    iid = issue["id"]
    s, h, b = get(f"/v1/kundalis/{iid}")
    j = json.loads(b)
    ok, why = validated("KundaliResult", j)
    d = j.get("data", {})
    check(f"GET /v1/kundalis/{iid} -> 200, matches KundaliResult, issue equals the committed record",
          s == 200 and ok and d.get("issue") == issue and h.get("etag") == f'"{issue["recordVersion"]}"',
          f"status={s} cid={h.get('x-correlation-id')} etag={h.get('etag')} {why}")
    check(f"{iid}: money fields are integers", not no_float_money(j), str(no_float_money(j)))

# 2. Journey 1 content
k = json.loads(get("/v1/kundalis/SYN-DEMO-KND-001")[2])["data"]
check("Journey 1: closure is claimed, verification window is open, no verdict (claim is not verification)",
      k["issue"]["status"] == "CLOSURE_CLAIMED_PENDING_VERIFICATION" and k["verification"]["state"] == "WINDOW_OPEN" and k["verification"]["citizenVerdict"] is None,
      f"status={k['issue']['status']} verification={k['verification']['state']}")
check("Journey 1: derived DLP status is computed from one request instant (evaluatedAt present, status ACTIVE on the CAP-0 baseline period)",
      k["dlpStatus"]["status"] in ("ACTIVE", "EXPIRED", "NOT_STARTED") and k["dlpStatus"]["evaluatedAt"].endswith("Z"),
      f"status={k['dlpStatus']['status']} evaluatedAt={k['dlpStatus']['evaluatedAt']}")
check("Journey 1: bounded audit preview is the committed ordered events", [e["sequence"] for e in k["auditEvents"]] == sorted(e["sequence"] for e in k["auditEvents"]) and len(k["auditEvents"]) == 9,
      f"events={len(k['auditEvents'])}")

# 3. work order detail and both traces
s, h, b = get("/v1/works/SYN-DEMO-WO-001")
j = json.loads(b)
ok, why = validated("WorkOrderDetailResult", j)
check("GET /v1/works/SYN-DEMO-WO-001 -> 200, matches WorkOrderDetailResult, linked issue is KND-001",
      s == 200 and ok and j["data"]["linkedIssueIds"] == ["SYN-DEMO-KND-001"], f"status={s} cid={h.get('x-correlation-id')} {why}")
for bid, status, last, missing in (("SYN-DEMO-BUD-001", "LINKED_TO_STREET", "ASSET_GEOMETRY", None),
                                   ("SYN-DEMO-BUD-002", "GAP_BEFORE_STREET_GEOMETRY", "TENDER", "STREET_LEVEL_GEOMETRY")):
    s, h, b = get(f"/v1/budget-traces/{bid}")
    j = json.loads(b)
    ok, why = validated("BudgetTraceResult", j)
    d = j["data"]
    check(f"GET /v1/budget-traces/{bid} -> 200, matches BudgetTraceResult, status/last link/missing link as committed",
          s == 200 and ok and d["traceabilityStatus"] == status and d["lastProvenLink"] == last and d["missingNextLink"] == missing,
          f"status={s} cid={h.get('x-correlation-id')} {why}")
gap = json.loads(get("/v1/budget-traces/SYN-DEMO-BUD-002")[2])["data"]
check("gap trace invents no downstream link or geometry", all(gap[x] is None for x in ("contract", "contractor", "workOrder", "asset")), "")

# 4. errors: RFC 9457, no leakage, sanitized correlation id
for path, want in (("/v1/kundalis/not-an-id", 400), ("/v1/works/SYN-DEMO-WO-999", 404), ("/v1/budget-traces/SYN-DEMO-BUD-999", 404), ("/v1/kundalis/SYN-DEMO-KND-001?x=1", 400)):
    s, h, b = get(path, {"X-Correlation-Id": "p4-live-evidence-0001"})
    p = json.loads(b)
    ok, why = validated("Problem", p)
    leaked = any(w in b.lower() for w in ("select ", "postgres", "sqlx", "panicked", "c:\\"))
    check(f"GET {path} -> {want} application/problem+json, matches Problem, nothing leaked",
          s == want and h.get("content-type") == "application/problem+json" and ok and not leaked and p["correlationId"] == "p4-live-evidence-0001",
          f"status={s} title={p.get('title')!r} {why}")

# 5. read-only and scope: nothing writes, reset does not exist, later-phase reads are absent
for method, path in (("POST", "/v1/kundalis/SYN-DEMO-KND-001"), ("DELETE", "/v1/works/SYN-DEMO-WO-001"), ("POST", "/v1/demo/reset")):
    s, _, _ = get(path, method=method)
    check(f"{method} {path} is refused (read-only phase)", s in (404, 405), f"status={s}")
for path in ("/v1/issues/SYN-DEMO-KND-001", "/v1/audit/SYN-DEMO-KND-001"):
    check(f"GET {path} stays deferred (404)", get(path)[0] == 404, "")

evidence["failed"] = failures
print(json.dumps(evidence, indent=2))
sys.exit(1 if failures else 0)
