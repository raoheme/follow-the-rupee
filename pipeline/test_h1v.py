import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_rules import is_rate_variance, pick_candidate, variance_band  # noqa: E402

CFG = json.loads((Path(__file__).resolve().parent / "config" / "audit_rules.json").read_text(encoding="utf-8"))
NR = json.loads((Path(__file__).resolve().parent / "config" / "next_rupee_rules.json").read_text(encoding="utf-8"))
RV = CFG["rate_card_variance"]


class RateCardBoundary(unittest.TestCase):
    def test_exact_boundaries(self):
        self.assertFalse(is_rate_variance(1.299999, RV["threshold"]))
        self.assertFalse(is_rate_variance(1.300000, RV["threshold"]))
        self.assertTrue(is_rate_variance(1.300001, RV["threshold"]))

    def test_float_noise_on_boundary_is_not_flagged(self):
        self.assertFalse(is_rate_variance(1.3000000000000003, RV["threshold"]))
        self.assertFalse(is_rate_variance(39000 / 30000, RV["threshold"]))

    def test_threshold_locked(self):
        self.assertEqual(RV["threshold"], 1.30)
        self.assertEqual(RV["operator"], ">")

    def test_bands(self):
        b = RV["variance_bands"]
        self.assertEqual(variance_band(1.300001, b), "REVIEW")
        self.assertEqual(variance_band(1.599999, b), "REVIEW")
        self.assertEqual(variance_band(1.60, b), "HIGH_VARIANCE_REVIEW")
        self.assertEqual(variance_band(1.999999, b), "HIGH_VARIANCE_REVIEW")
        self.assertEqual(variance_band(2.00, b), "VERY_HIGH_VARIANCE_REVIEW")
        self.assertEqual(variance_band(3.1, b), "VERY_HIGH_VARIANCE_REVIEW")


class Taxonomy(unittest.TestCase):
    def test_every_rule_has_exactly_one_class(self):
        rules = {RV["rule_id"], CFG["duplicate"]["rule_id"], CFG["duplicate"]["repeated_rule_id"], CFG["unlinked"]["rule_id"], CFG["dlp"]["surface_rule_id"], CFG["dlp"]["context_rule_id"],
                 CFG["outcome_indicators"]["sla"]["rule_id"], CFG["outcome_indicators"]["reopen"]["rule_id"]}
        self.assertEqual(set(CFG["flag_classes"]), rules)
        self.assertEqual(set(CFG["flag_classes"].values()), {"PRIMARY_REVIEW_FLAG", "TRACEABILITY_GAP", "CONTEXT_INDICATOR", "OUTCOME_INDICATOR"})

    def test_no_accusatory_public_wording_in_config(self):
        blob = json.dumps({k: CFG[k] for k in ("rate_card_variance", "duplicate", "unlinked", "dlp", "outcome_indicators")}).lower()
        for bad in ("overbill", "overcharg", "fraud", "corrupt", "ghost", "wasted"):
            self.assertNotIn(bad, blob)


class DlpAndNextRupee(unittest.TestCase):
    def test_dlp_lane_has_no_zero_cash_claim(self):
        blob = json.dumps(NR["dlp_lane"]).lower() + json.dumps(NR["lanes"])
        self.assertIn("DLP_REVIEW_FIRST_LANE", blob)
        self.assertNotIn("enforcement", blob.lower())
        self.assertNotIn("cash cost", blob.lower())
        self.assertEqual(NR["dlp_lane"]["allocation_action"], "DEFER_PENDING_DLP_SCOPE_REVIEW")

    def test_profiles_sum_to_one(self):
        self.assertEqual(set(NR["profiles"]), {"A_balanced", "B_backlog_durability", "C_safety_facility", "D_flood_traffic"})
        for k, v in NR["profiles"].items():
            self.assertAlmostEqual(sum(v.values()), 1.0, places=9, msg=k)
        self.assertEqual(NR["weights"], NR["profiles"]["A_balanced"])

    def test_coverage_gate(self):
        self.assertEqual(NR["coverage_min_pct"], 70)
        self.assertEqual(NR["insufficient_tag"], "INSUFFICIENT_EVIDENCE_FOR_TOP_RANK")

    def test_treatment_matrix_and_pick(self):
        m = CFG["issue_treatment_compatibility"]
        self.assertEqual(set(m["Waterlogging"]), {"Drain desilting", "Pump + debris removal", "Dewatering pump deployed"})
        rr = {"Drain desilting": 0.262, "Pump + debris removal": 0.222, "Dewatering pump deployed": 0.140}
        sr = {"Drain desilting": 90000, "Pump + debris removal": 110000, "Dewatering pump deployed": 60000}
        self.assertEqual(pick_candidate("Waterlogging", m, rr, sr), "Dewatering pump deployed")
        # tie on reopen rate -> lower standard rate wins
        rr2 = {"Drain desilting": 0.2, "Pump + debris removal": 0.2, "Dewatering pump deployed": 0.2}
        self.assertEqual(pick_candidate("Waterlogging", m, rr2, sr), "Dewatering pump deployed")
        self.assertIsNone(pick_candidate("Not a road issue", m, rr, sr))
        # cold mix excluded when asked
        rr3 = {"Hot mix patch": 0.3, "Mastic asphalt": 0.3, "Cold mix patch": 0.1}
        sr3 = {"Hot mix patch": 2600, "Mastic asphalt": 4200, "Cold mix patch": 1800}
        self.assertEqual(pick_candidate("Pothole", m, rr3, sr3), "Cold mix patch")
        self.assertEqual(pick_candidate("Pothole", m, rr3, sr3, exclude=("Cold mix patch",)), "Hot mix patch")


if __name__ == "__main__":
    unittest.main()
