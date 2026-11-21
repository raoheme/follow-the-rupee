"""P6 live Journey 3 (potential active DLP -> work linkage) and Journey 4 (provisional jurisdiction -> external-agency handoff)
evidence against a RUNNING API (default http://127.0.0.1:8080) and the real civic_lens database.

Run:  python -B tests/p6/verify_live.py [base_url] [--no-restore]
Needs `jsonschema`, `referencing` and `PyYAML` (see tests/p1/requirements.txt). This verifier WRITES: as the simulated `authority`
persona it links an unlinked defect to a work order and walks a disputed jurisdiction through an external-agency assignment and a
logged handoff, and it exercises the 401/403, stale-version, replay, illegal-transition and validation paths. Every 200 body is
validated strictly against the OpenAPI component schema (AuthorityDashboardResult, DlpExceptionListResult, CivicIssueResult,
JurisdictionResult, KundaliResult) and every error against Problem. Expected queue contents and DLP membership come from an
independent oracle over data/demo/*.json and the evaluation instant the server itself reports (`asOf`), never from server output
alone.

Safety: it refuses to start unless the database is the clean CP-00 baseline (record versions, jurisdiction states and unlinked
issues are checked), and unless `--no-restore` is given it restores CP-00 afterwards with the guarded CLI (`mcl-seed reset`, which
refuses anything but the marked local civic_lens database) and proves the accepted digest returns (`mcl-seed verify`). It prints
only status codes, correlation ids and non-sensitive fields; no credential is read, sent or printed. Exit code 0 = every check
passed. Not a unittest module (it needs a live server), so `python -m unittest discover` never collects it.
"""
import json
import os
import pathlib
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

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
seed = lambda stem: json.loads((ROOT / "data" / "demo" / f"{stem}.json").read_text(encoding="utf-8"))
ISSUES, WORKS, DLPS, JURS, BUDGETS = seed("issues"), seed("work-orders"), seed("dlp-status"), seed("jurisdictions"), seed("budgets")
CID = "p6-live-evidence-0001"
AGENCY = "Synthetic metro-corridor agency placeholder"


def validator(name):
    return Draft202012Validator({"$ref": f"urn:mcl:openapi#/components/schemas/{name}"}, registry=registry)


def call(method, path, body=None, persona="authority", key=None, if_match=None, headers=None):
    h = {"X-Correlation-Id": CID}
    if persona:
        h["X-Demo-Persona"] = persona
    if key:
        h["Idempotency-Key"] = key
    if if_match:
        h["If-Match"] = if_match
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


def ok_json(name, schema, s, h, b, want=200):
    """A success: status, strict schema, correlation id echoed, never cached."""
    body = json.loads(b)
    good, why = valid(schema, body)
    check(f"{name} -> {want}, matches {schema}, correlation id echoed",
          s == want and good and body.get("correlationId") == CID and h.get("x-correlation-id") == CID, f"status={s} {why}")
    return body


def problem(name, s, h, b, want):
    p = json.loads(b)
    good, why = valid("Problem", p)
    leaked = any(w in b.lower() for w in ("select ", "insert into", "postgres", "sqlx", "panicked", "c:\\", "mcl_api_write", "mcl_command", "stack"))
    check(f"{name} -> {want} application/problem+json, matches Problem, nothing leaked, correlation id returned",
          s == want and h.get("content-type") == "application/problem+json" and good and not leaked and p["correlationId"] == h.get("x-correlation-id"),
          f"status={s} title={p.get('title')!r} cid={h.get('x-correlation-id')} {why}")


def run(cmd):
    env = dict(os.environ, CARGO_REGISTRIES_CRATES_IO_PROTOCOL="git")
    r = subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True, text=True, timeout=600)
    return r.returncode, (r.stdout + r.stderr)[-400:]


def parse_t(s):
    """RFC 3339 UTC with optional fractional seconds (the live API reports its wall-clock instant, not a rounded one)."""
    return datetime.strptime(s.split(".")[0].rstrip("Z"), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)


# ------------------------------------------------------------------------------------------------------------ the oracle
def oracle(as_of):
    """Expected queues from the seeds and the server's own evaluation instant (independent of server queries)."""
    at = parse_t(as_of)
    is_open = lambda i: i["status"] not in ("DRAFT_LOCAL", "VERIFIED_COMPLETE")
    open_ids = [i["id"] for i in ISSUES if is_open(i)]
    awaiting = sorted(i["id"] for i in ISSUES if i["status"] == "CLOSURE_CLAIMED_PENDING_VERIFICATION")
    uncertain = sorted(j["issueId"] for j in JURS if j["issueId"] in open_ids and j["status"] in ("UNKNOWN", "SPATIALLY_INFERRED_PROVISIONAL", "CONFLICT_DISPUTED"))
    dlp_by_work = {d["workOrderId"]: d for d in DLPS}
    items = []
    for i in sorted(ISSUES, key=lambda x: x["id"]):
        if not is_open(i) or i["workOrderId"] is not None:
            continue
        for w in sorted(WORKS, key=lambda x: x["id"]):
            d = dlp_by_work.get(w["id"])
            if not d or w["assetId"] != i["assetId"] or d["syntheticFreshRepairEstimatePaise"] is None:
                continue
            starts = datetime.strptime(d["dlpStartsOn"], "%Y-%m-%d").replace(tzinfo=timezone.utc)
            ends = parse_t(w["dlpEndsAt"])
            if starts <= at <= ends and starts <= parse_t(i["reportedAt"]) <= ends:
                items.append((i["id"], w["id"]))
    gaps = sorted(b["id"] for b in BUDGETS if b["traceabilityStatus"] == "GAP_BEFORE_STREET_GEOMETRY")
    return {"open": len(open_ids), "awaiting": awaiting, "uncertain": uncertain, "dlp_pairs": items,
            "dlp_ids": sorted({p[0] for p in items}), "gaps": gaps}


def link_body(version, work="SYN-DEMO-WO-001", rationale="Same road segment; certified work inside its defect liability period."):
    return {"recordVersion": version, "payload": {"workOrderId": work, "rationale": rationale}}


def jur_body(version, target, label, rationale):
    return {"recordVersion": version, "payload": {"targetStatus": target, "externalAgencyLabel": label, "rationale": rationale}}


# =========================================================================================================== 0. baseline
s, h, b = call("GET", "/health/ready", persona=None)
check("the API is up and the database answers", s == 200, f"status={s}")
s, h, b = call("GET", "/v1/kundalis/SYN-DEMO-KND-003", persona=None)
k3 = json.loads(b)["data"] if s == 200 else {}
s, h, b = call("GET", "/v1/kundalis/SYN-DEMO-KND-004", persona=None)
k4 = json.loads(b)["data"] if s == 200 else {}
clean = (k3.get("jurisdiction", {}).get("status") == "CONFLICT_DISPUTED" and k3.get("jurisdiction", {}).get("recordVersion") == 1
         and k4.get("issue", {}).get("workOrderId") is None and k4.get("issue", {}).get("recordVersion") == 1
         and len(k4.get("auditEvents", [])) == 3 and len(k3.get("auditEvents", [])) == 7)
check("the database is the clean CP-00 baseline (refusing to write otherwise)", clean, "")
if not clean:
    evidence["failed"] = failures
    print(json.dumps(evidence, indent=2))
    sys.exit(1)

# ==================================================================================================== 1. persona gate
for path in ("/v1/authority/dashboard", "/v1/authority/dlp-exceptions"):
    for persona, want in ((None, 401), ("root", 401), ("public", 403), ("citizen", 403), ("moderator", 403), ("independent_reviewer", 403), ("demo_admin", 403)):
        s, h, b = call("GET", path, persona=persona)
        problem(f"GET {path} as {persona or 'no persona'}", s, h, b, want)
for path, body, im in (("/v1/authority/issues/SYN-DEMO-KND-003/jurisdiction", jur_body(1, "EXTERNAL_AGENCY_ASSIGNED", AGENCY, "r"), '"1"'),
                       ("/v1/authority/issues/SYN-DEMO-KND-004/work-link", link_body(1), None)):
    for persona, want in ((None, 401), ("root", 401), ("citizen", 403), ("public", 403), ("demo_admin", 403)):
        s, h, b = call("POST", path, body, persona=persona, key="p6-live-gate-0001", if_match=im)
        problem(f"POST {path.split('/')[-1]} as {persona or 'no persona'}", s, h, b, want)

# ===================================================================================== 2. dashboard and DLP exceptions
s, h, b = call("GET", "/v1/authority/dashboard")
dash = ok_json("getAuthorityDashboard", "AuthorityDashboardResult", s, h, b)["data"]
exp = oracle(dash["asOf"])
check("the dashboard queues equal the independent oracle (open count, awaiting, uncertain jurisdiction, DLP, traceability gaps)",
      dash["openIssueCount"] == exp["open"] and dash["awaitingVerificationIssueIds"] == exp["awaiting"]
      and dash["uncertainJurisdictionIssueIds"] == exp["uncertain"] and dash["dlpExceptionIssueIds"] == exp["dlp_ids"]
      and dash["traceabilityGapBudgetIds"] == exp["gaps"], json.dumps({"server": dash, "oracle": exp}, default=str)[:300])
check("the dashboard carries one evaluation instant (asOf)", dash["asOf"].endswith("Z"), dash["asOf"])
s, h, b = call("GET", "/v1/authority/dlp-exceptions")
dlp = ok_json("listDlpExceptions", "DlpExceptionListResult", s, h, b)["data"]["items"]
check("the DLP exceptions equal the oracle pairs and are derived as ACTIVE at the server's instant",
      [(x["issueId"], x["candidateWorkOrderId"]) for x in dlp] == exp["dlp_pairs"]
      and all(x["dlpStatus"]["status"] == "ACTIVE" for x in dlp)
      and len({x["dlpStatus"]["evaluatedAt"] for x in dlp}) == 1, f"items={len(dlp)}")
check("every exception keeps the claim-safe label and the contract members only",
      all(x["potentialSpendLabel"] == "SYNTHETIC_POTENTIAL_NOT_REALIZED_SAVINGS" and "pending contractual verification" in x["warrantyPathNote"].lower() for x in dlp)
      and not any(w in json.dumps(dlp).lower() for w in ("zero municipal", "is liable", "guilty", "₹0")), "")
s, h, b = call("GET", "/v1/authority/dashboard?x=1")
problem("a query string on the dashboard", s, h, b, 400)

# =========================================================================================== 3. Journey 3: link the defect
s, h, b = call("POST", "/v1/authority/issues/SYN-DEMO-KND-004/work-link", link_body(1), key="p6-live-link-0001")
linked = ok_json("linkWork (J3, authority)", "CivicIssueResult", s, h, b)["data"]
check("linkWork returns the issue with the work order, recordVersion 2, an ETag derived from it, and an unchanged issue status",
      linked["workOrderId"] == "SYN-DEMO-WO-001" and linked["recordVersion"] == 2 and h.get("etag") == '"2"' and linked["status"] == "TRIAGED_ASSIGNED",
      f"etag={h.get('etag')}")
s, h, b = call("GET", "/v1/kundalis/SYN-DEMO-KND-004", persona=None)
kb = ok_json("getKundali after the link", "KundaliResult", s, h, b)["data"]
ev = kb["auditEvents"]
check("the Kundali shows the linked work order and a derived ACTIVE DLP view with the contractual-verification wording",
      kb["workOrder"] and kb["workOrder"]["id"] == "SYN-DEMO-WO-001" and kb["dlpStatus"] and kb["dlpStatus"]["status"] == "ACTIVE"
      and "pending contractual verification" in kb["dlpStatus"]["warrantyPathNote"].lower(), "")
check("exactly one new ISSUE_WORK_LINKED event by the authority role; the three earlier events are unchanged; the summary makes no liability or cost claim",
      len(ev) == 4 and [e["sequence"] for e in ev] == [1, 2, 3, 4] and ev[3]["eventType"] == "ISSUE_WORK_LINKED" and ev[3]["actorRole"] == "authority"
      and "not a finding of liability" in ev[3]["summary"] and "zero" not in ev[3]["summary"].lower(), json.dumps(ev[3])[:200])
s, h, b = call("GET", "/v1/authority/dlp-exceptions")
dlp2 = json.loads(b)["data"]["items"]
check("the linked issue leaves the DLP exception queue; the other unlinked defect stays",
      "SYN-DEMO-KND-004" not in [x["issueId"] for x in dlp2] and len(dlp2) == len(dlp) - 1, f"before={len(dlp)} after={len(dlp2)}")
s2, h2, b2 = call("POST", "/v1/authority/issues/SYN-DEMO-KND-004/work-link", link_body(1), key="p6-live-link-0001")
body2 = ok_json("exact replay of linkWork", "CivicIssueResult", s2, h2, b2)
check("the replay returns the committed record and adds no event", body2["data"] == linked, "")
s, h, b = call("GET", "/v1/kundalis/SYN-DEMO-KND-004", persona=None)
check("still exactly four events after the replay", len(json.loads(b)["data"]["auditEvents"]) == 4, "")
s, h, b = call("POST", "/v1/authority/issues/SYN-DEMO-KND-004/work-link", link_body(1, rationale="Different text."), key="p6-live-link-0001")
problem("the same Idempotency-Key with a different body", s, h, b, 409)
s, h, b = call("POST", "/v1/authority/issues/SYN-DEMO-KND-004/work-link", link_body(1), key="p6-live-link-0002")
problem("a stale recordVersion on a new key", s, h, b, 409)
s, h, b = call("POST", "/v1/authority/issues/SYN-DEMO-KND-003/work-link", link_body(1), key="p6-live-link-0003")
problem("a work order on a different asset than the issue", s, h, b, 422)
s, h, b = call("POST", "/v1/authority/issues/SYN-DEMO-KND-002/work-link", link_body(1, work="SYN-DEMO-WO-999"), key="p6-live-link-0004")
problem("an unknown work order on an unlinked issue", s, h, b, 422)
s, h, b = call("POST", "/v1/authority/issues/SYN-DEMO-KND-001/work-link", link_body(1), key="p6-live-link-0005")
problem("an issue that is already linked", s, h, b, 409)
s, h, b = call("POST", "/v1/authority/issues/SYN-DEMO-KND-004/work-link", link_body(2, rationale="The contractor is liable for this."), key="p6-live-link-0006")
problem("an accusatory rationale", s, h, b, 422)
s, h, b = call("POST", "/v1/authority/issues/SYN-DEMO-KND-999/work-link", link_body(1), key="p6-live-link-0007")
problem("linkWork for an unknown issue", s, h, b, 404)

# ========================================================================= 4. Journey 4: jurisdiction and external agency
s, h, b = call("POST", "/v1/authority/issues/SYN-DEMO-KND-003/jurisdiction", jur_body(1, "EXTERNAL_AGENCY_ASSIGNED", AGENCY, "Corridor records point to a non-ward agency; review recorded."), key="p6-live-jur-0001", if_match='"1"')
j1 = ok_json("resolveJurisdiction CONFLICT_DISPUTED -> EXTERNAL_AGENCY_ASSIGNED", "JurisdictionResult", s, h, b)["data"]
check("the jurisdiction is EXTERNAL_AGENCY_ASSIGNED at recordVersion 2 with the label, a matching ETag, no legal ownership and the spatial facts intact",
      j1["status"] == "EXTERNAL_AGENCY_ASSIGNED" and j1["recordVersion"] == 2 and h.get("etag") == '"2"' and j1["externalAgencyLabel"] == AGENCY
      and j1["legalOwnershipAsserted"] is False and j1["spatialMatchMethod"] == "ST_INTERSECTS" and j1["candidateWardId"] == "SYN-DEMO-WARD-KW"
      and j1["distanceToBoundaryMeters"] == 553.5 and j1["sourceConflictNote"] and "Not a legal determination" in j1["confidenceNote"], json.dumps(j1)[:240])
s, h, b = call("POST", "/v1/authority/issues/SYN-DEMO-KND-003/jurisdiction", jur_body(2, "HANDOFF_LOGGED", None, "Handoff to the corridor agency recorded for its review."), key="p6-live-jur-0002", if_match='"2"')
j2 = ok_json("resolveJurisdiction EXTERNAL_AGENCY_ASSIGNED -> HANDOFF_LOGGED", "JurisdictionResult", s, h, b)["data"]
check("the handoff is logged at recordVersion 3 and keeps the assigned agency", j2["status"] == "HANDOFF_LOGGED" and j2["recordVersion"] == 3 and j2["externalAgencyLabel"] == AGENCY, "")
s, h, b = call("GET", "/v1/kundalis/SYN-DEMO-KND-003", persona=None)
kd = ok_json("getKundali after the handoff", "KundaliResult", s, h, b)["data"]
ev = kd["auditEvents"]
check("two new events named by the committed machine, by the authority role, after the seven earlier ones; the issue itself is unchanged",
      len(ev) == 9 and [e["eventType"] for e in ev[7:]] == ["JURISDICTION_EXTERNAL_AGENCY_ASSIGNED", "JURISDICTION_HANDOFF_LOGGED"]
      and all(e["actorRole"] == "authority" for e in ev[7:]) and "CONFLICT_DISPUTED to EXTERNAL_AGENCY_ASSIGNED" in ev[7]["summary"]
      and "EXTERNAL_AGENCY_ASSIGNED to HANDOFF_LOGGED" in ev[8]["summary"] and kd["issue"]["recordVersion"] == 1 and kd["issue"]["status"] == "TRIAGED_ASSIGNED", "")
s, h, b = call("GET", "/v1/authority/dashboard")
d3 = json.loads(b)["data"]
check("the resolved dispute leaves the uncertain-jurisdiction queue", "SYN-DEMO-KND-003" not in d3["uncertainJurisdictionIssueIds"], "")
s, h, b = call("POST", "/v1/authority/issues/SYN-DEMO-KND-003/jurisdiction", jur_body(3, "CONFIRMED_BMC_WARD", None, "Illegal transition probe."), key="p6-live-jur-0003", if_match='"3"')
problem("HANDOFF_LOGGED is final: an illegal transition", s, h, b, 409)
s, h, b = call("POST", "/v1/authority/issues/SYN-DEMO-KND-004/jurisdiction", jur_body(1, "HANDOFF_LOGGED", None, "Skip the assignment."), key="p6-live-jur-0004", if_match='"1"')
problem("SPATIALLY_INFERRED_PROVISIONAL -> HANDOFF_LOGGED is not in the machine", s, h, b, 409)
s, h, b = call("POST", "/v1/authority/issues/SYN-DEMO-KND-003/jurisdiction", jur_body(2, "EXTERNAL_AGENCY_ASSIGNED", AGENCY, "r"), key="p6-live-jur-0005", if_match='"2"')
problem("a stale jurisdiction recordVersion", s, h, b, 409)
s, h, b = call("POST", "/v1/authority/issues/SYN-DEMO-KND-004/jurisdiction", jur_body(1, "CONFIRMED_BMC_WARD", None, "Ward record reviewed."), key="p6-live-jur-0006")
problem("a missing If-Match header", s, h, b, 400)
s, h, b = call("POST", "/v1/authority/issues/SYN-DEMO-KND-004/jurisdiction", jur_body(1, "CONFIRMED_BMC_WARD", None, "Ward record reviewed."), key="p6-live-jur-0007", if_match='"2"')
problem("an If-Match that differs from the body recordVersion", s, h, b, 409)
s, h, b = call("POST", "/v1/authority/issues/SYN-DEMO-KND-004/jurisdiction", jur_body(1, "CONFIRMED_BMC_WARD", AGENCY, "A ward carries no agency label."), key="p6-live-jur-0008", if_match='"1"')
problem("an agency label on a ward confirmation", s, h, b, 422)
s, h, b = call("POST", "/v1/authority/issues/SYN-DEMO-KND-004/jurisdiction", jur_body(1, "CONFIRMED_BMC_WARD", None, "Someone took a bribe here."), key="p6-live-jur-0009", if_match='"1"')
problem("an accusatory rationale", s, h, b, 422)
s, h, b = call("POST", "/v1/authority/issues/SYN-DEMO-KND-004/jurisdiction", {"recordVersion": 1, "payload": {"targetStatus": "CONFLICT_DISPUTED", "externalAgencyLabel": None, "rationale": "r"}}, key="p6-live-jur-0010", if_match='"1"')
problem("a target the contract does not offer", s, h, b, 400)
s, h, b = call("POST", "/v1/authority/issues/SYN-DEMO-KND-004/jurisdiction", jur_body(1, "CONFIRMED_BMC_WARD", None, "Ward record reviewed."), key="p6-live-jur-0011", if_match='"1"')
j4 = ok_json("resolveJurisdiction SPATIALLY_INFERRED_PROVISIONAL -> CONFIRMED_BMC_WARD", "JurisdictionResult", s, h, b)["data"]
check("a confirmed ward carries its confirmation basis, no agency label and no legal-ownership claim",
      j4["status"] == "CONFIRMED_BMC_WARD" and j4["confirmationBasis"] == "Ward record reviewed." and j4["externalAgencyLabel"] is None and j4["legalOwnershipAsserted"] is False, "")
s, h, b = call("POST", "/v1/authority/issues/SYN-DEMO-KND-003/jurisdiction", jur_body(3, "HANDOFF_LOGGED", None, "r"), key="p6-live-jur-0002", if_match='"3"')
problem("reusing an Idempotency-Key for a different request", s, h, b, 409)
s2, h2, b2 = call("POST", "/v1/authority/issues/SYN-DEMO-KND-003/jurisdiction", jur_body(2, "HANDOFF_LOGGED", None, "Handoff to the corridor agency recorded for its review."), key="p6-live-jur-0002", if_match='"2"')
check("an exact replay of the handoff returns the committed record", s2 == 200 and json.loads(b2)["data"] == j2, f"status={s2}")

# ========================================================================================= 5. scope and the unchanged contract
for method, path in (("POST", "/v1/authority/issues/SYN-DEMO-KND-001/completion-claim"), ("POST", "/v1/demo/reset"), ("GET", "/v1/audit/SYN-DEMO-KND-001"), ("PUT", "/v1/authority/dashboard")):
    s, _, _ = call(method, path, b"{}", key="p6-live-scope-0001")
    check(f"{method} {path} is not available in P6 (no unapproved operation)", s in (404, 405), f"status={s}")
paths = doc["paths"]
ops = sorted(op["operationId"] for p in paths.values() for m, op in p.items() if m in ("get", "post"))
check("the contract still has 23 operations on 22 paths", len(ops) == 23 and len(paths) == 22, f"ops={len(ops)} paths={len(paths)}")

# ========================================================================================== 6. restore CP-00 and prove it
if RESTORE:
    rc, out = run(["cargo", "run", "-q", "-p", "mcl-infrastructure", "--bin", "mcl-seed", "--", "reset"])
    check("guarded mcl-seed reset completed", rc == 0, out.strip().splitlines()[-1] if out.strip() else "")
    rc, out = run(["cargo", "run", "-q", "-p", "mcl-infrastructure", "--bin", "mcl-seed", "--", "verify"])
    check("CP-00 baseline digest matches the accepted digest after restoration", rc == 0 and "baseline matches CP-00" in out, out.strip().splitlines()[-1] if out.strip() else "")
    s, h, b = call("GET", "/v1/authority/dashboard")
    d = json.loads(b)["data"]
    check("the seeded queues are back (KND-003 and KND-004 uncertain again, two DLP exceptions)", "SYN-DEMO-KND-003" in d["uncertainJurisdictionIssueIds"] and len(d["dlpExceptionIssueIds"]) == 2, "")

evidence["failed"] = failures
print(json.dumps(evidence, indent=2))
sys.exit(1 if failures else 0)
