"""P1 contract, schema and seed tests. Run: python -B -m unittest discover -s tests/p1 -v
Requires tests/p1/requirements.txt (PyYAML, jsonschema, openapi-spec-validator)."""
import copy
import hashlib
import json
import pathlib
import re
import unittest

import yaml
from jsonschema import Draft202012Validator, FormatChecker
from openapi_spec_validator import validate as validate_openapi

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEMO = ROOT / "data" / "demo"

# The 23 operations frozen at CAP-0 (commit 96a9c22): exact method, path and operationId.
FROZEN_OPERATIONS = [
    ("get", "/health/live", "healthLive"),
    ("get", "/health/ready", "healthReady"),
    ("get", "/version", "getVersion"),
    ("get", "/v1/map/features", "getMapFeatures"),
    ("get", "/v1/issues", "listIssues"),
    ("post", "/v1/issues", "submitIssue"),
    ("get", "/v1/issues/{id}", "getIssue"),
    ("post", "/v1/issues/{id}/duplicate-candidates", "checkDuplicates"),
    ("post", "/v1/issues/{id}/evidence", "addEvidence"),
    ("get", "/v1/kundalis/{id}", "getKundali"),
    ("get", "/v1/works/{id}", "getWorkOrder"),
    ("get", "/v1/budget-traces/{id}", "getBudgetTrace"),
    ("get", "/v1/authority/dashboard", "getAuthorityDashboard"),
    ("post", "/v1/authority/issues/{id}/jurisdiction", "resolveJurisdiction"),
    ("post", "/v1/authority/issues/{id}/work-link", "linkWork"),
    ("get", "/v1/authority/dlp-exceptions", "listDlpExceptions"),
    ("post", "/v1/authority/issues/{id}/completion-claim", "claimCompletion"),
    ("post", "/v1/issues/{id}/verification", "verifyResolution"),
    ("post", "/v1/records/{id}/corrections", "submitCorrection"),
    ("post", "/v1/corrections/{id}/decision", "decideCorrection"),
    ("post", "/v1/corrections/{id}/appeal", "appealCorrection"),
    ("get", "/v1/audit/{entityId}", "getAuditTimeline"),
    ("post", "/v1/demo/reset", "resetDemo"),
]
FORBIDDEN_PHRASES = [
    "official bmc integration", "zero municipal repair cost", "authenticated evidence", "immutable audit history",
    "immutable", "tamper-proof", "contractor culpability", "forensically verified", "zero-cost",
]


def jload(path):
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def seeds():
    return {p.stem: jload(p) for p in DEMO.glob("*.json") if p.stem not in ("reset-manifest", "demo-journeys")}


SCHEMA_MAP = jload(ROOT / "config" / "seed-schema-map.json")
SEEDS = seeds()


def validator(schema_name):
    return Draft202012Validator(jload(ROOT / "schemas" / f"{schema_name}.schema.json"), format_checker=FormatChecker())


class OpenApiContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.doc = yaml.safe_load((ROOT / "openapi" / "openapi.yaml").read_text(encoding="utf-8"))

    def test_spec_is_valid_openapi_3_1(self):
        self.assertEqual(self.doc["openapi"], "3.1.0")
        validate_openapi(self.doc)

    def test_all_23_operations_on_22_paths_are_preserved_with_exact_operation_ids(self):
        found = sorted((m, p, o["operationId"]) for p, v in self.doc["paths"].items() for m, o in v.items())
        self.assertEqual(len(self.doc["paths"]), 22)
        self.assertEqual(len(found), 23)
        self.assertEqual(found, sorted(FROZEN_OPERATIONS))
        self.assertEqual(self.doc["servers"][0]["url"], "http://localhost:8080")

    def test_every_response_and_request_body_is_typed(self):
        for p, v in self.doc["paths"].items():
            for m, o in v.items():
                for code, r in o["responses"].items():
                    self.assertTrue("$ref" in r or "content" in r, (p, m, code))
                if m != "get":
                    self.assertIn("requestBody", o, (p, m))
        schemas = self.doc["components"]["schemas"]
        self.assertNotIn("Result", schemas)  # generic untyped envelope removed
        for n, s in schemas.items():
            if n.endswith("Command") or n.endswith("Payload"):
                self.assertIs(s["additionalProperties"], False, n)

    def test_recordversion_is_the_single_concurrency_authority(self):
        text = (ROOT / "openapi" / "openapi.yaml").read_text(encoding="utf-8")
        self.assertNotIn("'412'", text)
        self.assertNotIn("PreconditionFailed", text)
        self.assertIn("Conflict", self.doc["components"]["responses"])
        for p, v in self.doc["paths"].items():
            for m, o in v.items():
                if m == "post":
                    self.assertIn("409", o["responses"], (p, m))
        ifm = self.doc["components"]["parameters"]["IfMatch"]
        self.assertIn("recordVersion", ifm["description"])
        self.assertIn("single concurrency authority", ifm["description"])
        refs = [x["$ref"] for x in self.doc["paths"]["/v1/authority/issues/{id}/jurisdiction"]["post"]["parameters"]]
        self.assertTrue(any(r.endswith("/IfMatch") for r in refs))
        for name in ("CivicIssue", "Evidence", "Jurisdiction", "CompletionClaim", "Verification", "Correction", "Kundali", "WorkOrderDetail"):
            etag = self.doc["components"]["responses"][name + "Ok"]["headers"]["ETag"]
            self.assertIn("recordVersion", etag["description"])
        cmd = self.doc["components"]["schemas"]["LinkWorkCommand"]
        self.assertEqual(cmd["required"], ["recordVersion", "payload"])

    def test_persona_wording_and_public_health_endpoints(self):
        scheme = self.doc["components"]["securitySchemes"]["DemoPersona"]
        self.assertEqual(scheme["name"], "X-Demo-Persona")
        self.assertEqual(scheme["description"], "Simulated demonstration persona, not authentication or authorization.")
        forbidden = self.doc["components"]["responses"]["Forbidden"]["description"]
        self.assertIn("Simulated demonstration workflow eligibility", forbidden)
        self.assertIn("never real authorization", forbidden)
        for ep in ("/health/live", "/health/ready", "/version"):
            self.assertEqual(self.doc["paths"][ep]["get"]["security"], [])

    def test_money_is_integer_paise_and_timestamps_differ_from_dates(self):
        text = (ROOT / "openapi" / "openapi.yaml").read_text(encoding="utf-8")
        self.assertNotIn("DisplayLabel", text)
        self.assertNotIn("rupee", text.lower().replace("rupees", "").replace("rupee amount", ""))
        s = self.doc["components"]["schemas"]
        for schema, field in (("BudgetAllocation", "amountPaise"), ("Contract", "valuePaise"), ("WorkOrder", "valuePaise"), ("Tender", "estimatedValuePaise")):
            self.assertEqual(s[schema]["properties"][field]["type"], "integer", (schema, field))
        self.assertEqual(s["WorkOrder"]["properties"]["dlpEndsAt"]["format"], "date-time")
        self.assertEqual(s["Tender"]["properties"]["publishedOn"]["format"], "date")
        self.assertEqual(s["DlpStatus"]["properties"]["status"]["enum"], ["NOT_STARTED", "ACTIVE", "EXPIRED"])
        self.assertIn("never stored", s["DlpStatus"]["description"])

    def test_claim_semantics_do_not_overstate(self):
        text = (ROOT / "openapi" / "openapi.yaml").read_text(encoding="utf-8").lower()
        for phrase in FORBIDDEN_PHRASES:
            self.assertNotIn(phrase, text, phrase)
        self.assertIn("silence never verifies closure", text)
        self.assertIn("not an official bmc service", text)
        v = self.doc["components"]["schemas"]["Verification"]["properties"]["state"]["enum"]
        self.assertIn("WINDOW_EXPIRED_NO_VERDICT", v)
        self.assertEqual(self.doc["components"]["schemas"]["Jurisdiction"]["properties"]["legalOwnershipAsserted"], {"const": False})
        self.assertEqual(self.doc["components"]["schemas"]["DuplicateCandidates"]["properties"]["silentRejection"], {"const": False})
        self.assertEqual(self.doc["components"]["schemas"]["Correction"]["properties"]["priorValuePreserved"], {"const": True})


class StrictSchemas(unittest.TestCase):
    def test_every_seed_record_validates_against_its_schema(self):
        for stem, name in SCHEMA_MAP.items():
            v = validator(name)
            for rec in SEEDS[stem]:
                errs = list(v.iter_errors(rec))
                self.assertEqual(errs, [], f"{stem}/{rec.get('id')}: {[e.message for e in errs][:2]}")

    def test_all_schemas_forbid_extra_properties_and_use_the_synthetic_nature(self):
        for path in (ROOT / "schemas").glob("*.schema.json"):
            s = jload(path)
            self.assertIs(s["additionalProperties"], False, path.name)
            self.assertEqual(s["properties"]["recordNature"], {"const": "SYNTHETIC_DEMONSTRATION"}, path.name)

    def test_negative_cases_are_rejected_for_every_schema(self):
        for stem, name in SCHEMA_MAP.items():
            v = validator(name)
            good = SEEDS[stem][0]
            extra = {**good, "notInContract": 1}
            self.assertFalse(v.is_valid(extra), f"{name}: extra property must fail")
            for required in [k for k in jload(ROOT / "schemas" / f"{name}.schema.json")["required"]]:
                broken = {k: val for k, val in good.items() if k != required}
                self.assertFalse(v.is_valid(broken), f"{name}: missing {required} must fail")
            self.assertFalse(v.is_valid({**good, "id": "REAL-ID-1"}), f"{name}: non-synthetic id")
            self.assertFalse(v.is_valid({**good, "recordNature": "OFFICIAL_RECORD"}), f"{name}: non-synthetic nature")
            self.assertFalse(v.is_valid({**good, "recordVersion": 0}), f"{name}: record version")

    def test_enum_money_geometry_and_rule_violations(self):
        def bad(stem, name, **kw):
            return not validator(name).is_valid({**SEEDS[stem][0], **kw})

        self.assertTrue(bad("issues", "civic-issue", status="AUTO_VERIFIED_BY_SILENCE"))
        self.assertTrue(bad("issues", "civic-issue", category="NOISE"))
        self.assertTrue(bad("work-orders", "work-order", status="DONE"))
        self.assertTrue(bad("budgets", "budget-allocation", amountPaise=-1))
        self.assertTrue(bad("budgets", "budget-allocation", amountPaise=25000000.5))
        self.assertTrue(bad("contracts", "contract", valuePaise="180000000"))
        self.assertTrue(bad("issues", "civic-issue", geometry={"type": "Point", "coordinates": [19.1197, 72.8315]}))
        self.assertTrue(bad("issues", "civic-issue", geometry={"type": "Point", "coordinates": [10.0, 10.0]}))
        self.assertTrue(bad("evidence", "evidence", sha256="xyz"))
        self.assertTrue(bad("evidence", "evidence", stage="AFTER"))
        self.assertTrue(bad("contractors", "contractor-record", officialPerformanceRating="A"))
        self.assertTrue(bad("jurisdictions", "jurisdiction", legalOwnershipAsserted=True))
        self.assertTrue(bad("corrections", "correction", priorValuePreserved=False))
        # verification: no verdict while the window is open, i.e. silence cannot verify
        self.assertTrue(bad("verifications", "verification", citizenVerdict="FIXED"))
        self.assertFalse(bad("verifications", "verification", state="CITIZEN_CONFIRMED", citizenVerdict="FIXED", verdictAt="2026-11-19T09:00:00Z"))
        # budget gap consistency
        self.assertTrue(bad("budgets", "budget-allocation", missingNextLink="CONTRACT"))
        gap = SEEDS["budgets"][1]
        self.assertTrue(validator("budget-allocation").is_valid(gap))
        self.assertFalse(validator("budget-allocation").is_valid({**gap, "missingNextLink": None}))
        self.assertFalse(validator("budget-allocation").is_valid({**gap, "lastProvenLink": "ASSET_GEOMETRY"}))
        # DLP: persisted status or duplicated end date is not part of the contract; estimate needs its potential label
        dlp = SEEDS["dlp-status"][0]
        self.assertFalse(validator("dlp-status").is_valid({**dlp, "status": "ACTIVE"}))
        self.assertFalse(validator("dlp-status").is_valid({**dlp, "dlpEndsOn": "2027-03-31"}))
        self.assertFalse(validator("dlp-status").is_valid({**dlp, "potentialSpendLabel": None}))
        # money authority: no display-label fields anywhere in the data contracts
        for path in list((ROOT / "schemas").glob("*.json")) + list(DEMO.glob("*.json")):
            self.assertNotIn("DisplayLabel", path.read_text(encoding="utf-8"), path.name)
            self.assertNotIn("displayReference", path.read_text(encoding="utf-8"), path.name)


class SeedIntegrity(unittest.TestCase):
    def ids(self, stem):
        return {r["id"] for r in SEEDS[stem]}

    def test_ids_are_unique_synthetic_and_conspicuous(self):
        every = [r["id"] for rows in SEEDS.values() for r in rows]
        self.assertEqual(len(every), len(set(every)))
        for i in every:
            self.assertRegex(i, r"^SYN-DEMO-[A-Z0-9][A-Z0-9-]*$")
        for rows in SEEDS.values():
            for r in rows:
                self.assertEqual(r["recordNature"], "SYNTHETIC_DEMONSTRATION")
        # HEAD identifiers are preserved and the gap budget follows the existing pattern
        self.assertTrue({"SYN-DEMO-BUD-001", "SYN-DEMO-BUD-002"} <= self.ids("budgets"))
        self.assertTrue({"SYN-DEMO-KND-001", "SYN-DEMO-WO-001", "SYN-DEMO-CON-001", "SYN-DEMO-AST-ROAD-001"} <= {r["id"] for rows in SEEDS.values() for r in rows})

    def test_foreign_keys_resolve(self):
        s = SEEDS
        wards, depts, assets = self.ids("wards"), self.ids("departments"), self.ids("assets")
        for d in s["departments"]:
            self.assertTrue(d["wardId"] is None or d["wardId"] in wards)
        for a in s["assets"]:
            self.assertIn(a["responsibleDepartmentId"], depts)
            self.assertTrue(a["wardCandidateId"] in wards)
        for b in s["budgets"]:
            self.assertIn(b["departmentId"], depts)
        for t in s["tenders"]:
            self.assertIn(t["budgetId"], self.ids("budgets"))
        for c in s["contracts"]:
            self.assertIn(c["tenderId"], self.ids("tenders"))
            self.assertIn(c["budgetId"], self.ids("budgets"))
            self.assertIn(c["vendorId"], self.ids("contractors"))
        for w in s["work-orders"]:
            self.assertIn(w["contractId"], self.ids("contracts"))
            self.assertIn(w["assetId"], assets)
            self.assertIn(w["departmentId"], depts)
        for d in s["dlp-status"]:
            self.assertIn(d["workOrderId"], self.ids("work-orders"))
        issues = self.ids("issues")
        for i in s["issues"]:
            self.assertIn(i["assetId"], assets)
            self.assertIn(i["responsibleDepartmentId"], depts)
            self.assertTrue(i["workOrderId"] is None or i["workOrderId"] in self.ids("work-orders"))
            self.assertIn(i["wardCandidateId"], wards)
        for j in s["jurisdictions"]:
            self.assertIn(j["issueId"], issues)
        self.assertEqual({j["issueId"] for j in s["jurisdictions"]}, issues)
        for e in s["evidence"]:
            self.assertIn(e["issueId"], issues)
        for c in s["completion-claims"]:
            self.assertIn(c["claimedAfterEvidenceId"], self.ids("evidence"))
            self.assertIn(c["issueId"], issues)
        for v in s["verifications"]:
            self.assertIn(v["completionClaimId"], self.ids("completion-claims"))
        for c in s["corrections"]:
            self.assertIn(c["entityId"], issues)

    def test_money_is_consistent_integer_paise(self):
        b = {r["id"]: r for r in SEEDS["budgets"]}
        self.assertEqual(b["SYN-DEMO-BUD-001"]["amountPaise"], 2500000 * 100)  # 25 lakh rupees
        self.assertEqual(SEEDS["contracts"][0]["valuePaise"], 1800000 * 100)  # 18 lakh rupees
        self.assertEqual(SEEDS["work-orders"][0]["valuePaise"], 180000000)
        self.assertLessEqual(SEEDS["contracts"][0]["valuePaise"], b["SYN-DEMO-BUD-001"]["amountPaise"])
        self.assertLessEqual(SEEDS["tenders"][0]["estimatedValuePaise"], b["SYN-DEMO-BUD-001"]["amountPaise"])
        self.assertNotIn("₹", json.dumps(SEEDS, ensure_ascii=False))  # rupee text is derived in Rust, never persisted
        # 1.80 crore would be 1,800,000,000 paise: the work order is one tenth of that
        self.assertNotEqual(SEEDS["work-orders"][0]["valuePaise"], 1_800_000_000)

    def test_primary_story_chain_and_dlp_dates(self):
        issue = next(i for i in SEEDS["issues"] if i["id"] == "SYN-DEMO-KND-001")
        wo = next(w for w in SEEDS["work-orders"] if w["id"] == issue["workOrderId"])
        con = next(c for c in SEEDS["contracts"] if c["id"] == wo["contractId"])
        self.assertEqual(wo["assetId"], issue["assetId"])
        self.assertEqual(con["budgetId"], "SYN-DEMO-BUD-001")
        self.assertEqual(wo["status"], "COMPLETION_CERTIFIED_IN_DLP")
        self.assertEqual(wo["dlpEndsAt"], "2027-03-31T18:29:59Z")
        self.assertEqual(issue["status"], "CLOSURE_CLAIMED_PENDING_VERIFICATION")
        self.assertIn("Synthetic CC-road work order with an active DLP period", wo["displayTitle"])
        stages = {e["stage"] for e in SEEDS["evidence"] if e["issueId"] == "SYN-DEMO-KND-001"}
        self.assertEqual(stages, {"BEFORE", "CLAIMED_AFTER"})
        self.assertEqual({e["stage"] for e in SEEDS["evidence"]}, {"BEFORE", "CLAIMED_AFTER", "DISPUTED_OR_RECURRING"})
        ver = SEEDS["verifications"][0]
        self.assertEqual((ver["state"], ver["citizenVerdict"]), ("WINDOW_OPEN", None))  # silence is not verification
        self.assertEqual(issue["responsiblePostTitle"], "Assistant Engineer (Roads), K/West Ward")
        ward = next(w for w in SEEDS["wards"] if w["id"] == issue["wardCandidateId"])
        self.assertIn("Deliberative ward-committee oversight only", ward["electedOversightNote"])
        dept = next(d for d in SEEDS["departments"] if d["id"] == issue["responsibleDepartmentId"])
        ward_office = next(d for d in SEEDS["departments"] if d["wardId"] == ward["id"])
        self.assertIn(issue["responsiblePostTitle"], ward_office["postTitles"])
        self.assertIn(issue["escalationPostTitle"], dept["postTitles"])

    def test_traceability_gap_is_visible_honest_and_has_no_invented_geometry(self):
        gap = next(b for b in SEEDS["budgets"] if b["id"] == "SYN-DEMO-BUD-002")
        self.assertEqual((gap["traceabilityStatus"], gap["lastProvenLink"], gap["missingNextLink"]),
                         ("GAP_BEFORE_STREET_GEOMETRY", "TENDER", "STREET_LEVEL_GEOMETRY"))
        self.assertTrue(gap["traceabilityExplanation"].startswith("TRACEABILITY GAP: Street-level geometry is not available in the synthetic source record."))
        self.assertIn("not an allegation", gap["traceabilityExplanation"])
        tender = next(t for t in SEEDS["tenders"] if t["budgetId"] == gap["id"])
        self.assertFalse(tender["streetGeometryAvailable"])
        self.assertFalse([c for c in SEEDS["contracts"] if c["budgetId"] == gap["id"] or c["tenderId"] == tender["id"]])
        self.assertNotIn("geometry", tender)
        self.assertEqual(sum(1 for b in SEEDS["budgets"] if b["traceabilityStatus"] != "LINKED_TO_STREET"), 1)

    def test_scale_preview_records_are_light_and_separate(self):
        codes = {w["code"]: w for w in SEEDS["wards"]}
        self.assertEqual(set(codes), {"K/W", "G/N", "M/E"})
        previews = [i for i in SEEDS["issues"] if i["journeys"] == ["PREVIEW"]]
        self.assertEqual({i["wardCandidateId"] for i in previews}, {codes["G/N"]["id"], codes["M/E"]["id"]})
        self.assertEqual(codes["K/W"]["role"], "PRIMARY_DEMONSTRATION")

    def test_jurisdiction_stays_uncertain_where_it_is_uncertain(self):
        j = {x["issueId"]: x for x in SEEDS["jurisdictions"]}
        self.assertEqual(j["SYN-DEMO-KND-003"]["status"], "CONFLICT_DISPUTED")
        self.assertIsNotNone(j["SYN-DEMO-KND-003"]["externalAgencyLabel"])
        for k in ("SYN-DEMO-KND-002", "SYN-DEMO-KND-004"):
            self.assertEqual(j[k]["status"], "SPATIALLY_INFERRED_PROVISIONAL")
        self.assertTrue(all(x["legalOwnershipAsserted"] is False for x in j.values()))

    def test_evidence_hashes_are_fixture_reference_hashes_with_caveats(self):
        for e in SEEDS["evidence"]:
            self.assertEqual(e["sha256"], hashlib.sha256(f"{e['id']}|{e['mediaRef']}".encode()).hexdigest())
            self.assertEqual(e["hashBasis"], "FIXTURE_REFERENCE_STRING")
            self.assertIn("does not establish authenticity", e["caveat"])

    def test_lifecycle_events_are_ordered_and_hash_linked(self):
        by = {}
        for e in SEEDS["lifecycle-events"]:
            by.setdefault(e["entityId"], []).append(e)
        self.assertIn("SYN-DEMO-KND-001", by)
        for entity, evs in by.items():
            evs.sort(key=lambda e: e["sequence"])
            self.assertEqual([e["sequence"] for e in evs], list(range(1, len(evs) + 1)), entity)
            prev = None
            last_time = ""
            for e in evs:
                self.assertEqual(e["previousHash"], prev)
                s = "|".join([e["entityId"], str(e["sequence"]), e["eventType"], e["occurredAt"], e["actorRole"], e["summary"], prev or "GENESIS"])
                self.assertEqual(e["payloadHash"], hashlib.sha256(s.encode()).hexdigest(), (entity, e["sequence"]))
                self.assertGreaterEqual(e["occurredAt"], last_time)
                prev, last_time = e["payloadHash"], e["occurredAt"]

    def test_potential_spend_is_labelled_not_savings(self):
        d = SEEDS["dlp-status"][0]
        self.assertEqual(d["potentialSpendLabel"], "SYNTHETIC_POTENTIAL_NOT_REALIZED_SAVINGS")
        self.assertIn("pending contractual verification", d["warrantyPathNote"])
        self.assertNotIn("saving", json.dumps(SEEDS).lower().replace("realized_savings", "").replace("realized savings", ""))

    def test_no_real_pii_and_no_prohibited_claims(self):
        blob = "\n".join(json.dumps(v, ensure_ascii=False) for v in SEEDS.values())
        self.assertIsNone(re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", blob), "email address")
        self.assertIsNone(re.search(r"(?<![0-9A-Fa-f])(?:\+?91[- ]?)?[6-9][0-9]{9}(?![0-9A-Fa-f])", blob), "phone number")
        self.assertIsNone(re.search(r"https?://", blob), "external URL")
        low = blob.lower()
        for phrase in FORBIDDEN_PHRASES:
            self.assertNotIn(phrase, low, phrase)
        for rows in SEEDS.values():
            for r in rows:
                for k in r:
                    self.assertNotIn(k.lower(), {"name", "phone", "email", "officername", "contact"}, k)

    def test_reset_manifest_documents_the_digest_spec(self):
        m = jload(DEMO / "reset-manifest.json")
        self.assertEqual(m["checkpoint"], "CP-00")
        self.assertRegex(m["expectedDigest"], r"^[a-f0-9]{64}$")
        self.assertEqual(m["digestSpec"]["tables"], sorted(m["digestSpec"]["tables"]))
        for key in ("algorithm", "tableOrder", "rowOrder", "rowEncoding", "canonicalJson", "timestamps", "geometry", "volatileColumnsAndTablesExcluded", "byteStream"):
            self.assertIn(key, m["digestSpec"])
        self.assertEqual(sum(m["expectedCounts"].values()), sum(len(v) for v in SEEDS.values()))
        self.assertEqual({f[:-5] for f in m["seedFiles"]}, set(SEEDS))

    def test_p1_tooling_scratch_directory_is_not_in_the_repository(self):
        self.assertFalse(list(ROOT.rglob("p1gen")))


class MigrationFiles(unittest.TestCase):
    def test_migration_set_is_ordered_and_has_no_reset_bypass(self):
        files = sorted(p.name for p in (ROOT / "migrations").glob("*.sql"))
        self.assertEqual(files, ["0001_core.sql", "0002_audit_guards.sql", "0003_app_role_marker_dlp.sql"])
        sql = "\n".join((ROOT / "migrations" / f).read_text(encoding="utf-8") for f in files)
        self.assertNotIn("reset_authorized", sql)
        self.assertNotIn("CASCADE", sql.replace("ON DELETE CASCADE", ""))
        self.assertIn("synthetic_demo_marker", sql)
        self.assertIn("CREATE ROLE mcl_app NOLOGIN", sql)
        self.assertNotIn("PASSWORD", sql.upper())
        self.assertRegex(sql, r"GRANT INSERT ON corrections, lifecycle_events")
        self.assertNotRegex(sql, r"GRANT[^;]*(DELETE|TRUNCATE)[^;]*mcl_app")
        self.assertNotIn("status text", sql[sql.index("CREATE TABLE dlp_status"): sql.index("CREATE TABLE issues")])


if __name__ == "__main__":
    unittest.main()
