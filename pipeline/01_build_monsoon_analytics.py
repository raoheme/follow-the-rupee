"""H1: audit engine, fair accountability, complaint provenance, Next-Rupee planner, narratives.

Every threshold/weight/wording comes from pipeline/config/audit_rules.json.
Run: python -X utf8 pipeline/01_build_monsoon_analytics.py
Outputs (gitignored): pipeline/out/*.csv + tables_manifest.json, judge exports (outside git)
Committed output: pipeline/narratives_monsoon.json
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd
from shapely.geometry import LineString, Point, shape

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_rules import is_rate_variance, pick_candidate, variance_band  # noqa: E402
from lib_geo_text import (AMBULANCE, PHOTO, Gazetteer, WardPolys, norm, seg_dist_m, text_cat, text_is_english)  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT / "pipeline" / "config" / "audit_rules.json").read_text(encoding="utf-8"))
DATA, OUT = Path(CFG["paths"]["data_dir"]), ROOT / CFG["paths"]["out_dir"]
JUDGE, ENR = Path(CFG["paths"]["judge_exports_dir"]), Path(CFG["paths"]["enriched_dir"])
OUT.mkdir(parents=True, exist_ok=True)
JUDGE.mkdir(parents=True, exist_ok=True)
WARN = []


def rd(n):
    return pd.read_csv(DATA / n)


wards, wo, rate, ctr, roads, loc = rd("wards.csv"), rd("work_orders.csv"), rd("rate_card.csv"), rd("contractors.csv"), rd("roads.csv"), rd("localities.csv")
cmp_, soc, fh, fac, acc, traf = rd("complaints.csv"), rd("social_posts.csv"), rd("flood_hotspots.csv"), rd("facilities.csv"), rd("accidents.csv"), rd("traffic.csv")
rain, tides = rd("rainfall_daily.csv"), rd("tides.csv")
wgj = json.loads((DATA / "wards.geojson").read_text(encoding="utf-8"))
rgj = json.loads((DATA / "roads.geojson").read_text(encoding="utf-8"))
WP = WardPolys(wgj)
GZ = Gazetteer(loc)


def clean_float(v):
    return None if v is None or (isinstance(v, float) and not np.isfinite(v)) else v


# ============================================================ work-order base + context
w = wo.merge(rate, on="repair_method", how="left", validate="m:1")
assert w.unit.notna().all()
exp_raw = np.where(w.unit == "per sqm", w.area_sqm * w.standard_rate_inr, w.standard_rate_inr)
w["expected_cost_inr"] = np.round(exp_raw).astype(int)
w["cost_ratio"] = w.cost_inr / exp_raw
w["excess_inr"] = np.maximum(w.cost_inr - w.expected_cost_inr, 0).astype(int)
w = w.merge(roads[["road_id", "road_name", "road_type", "surface", "last_resurfaced", "under_dlp"]], on="road_id", how="left", validate="m:1")
for c in ("assigned_at", "work_started_at", "completed_at"):
    w[c] = pd.to_datetime(w[c])
w["unlinked"] = w.linked_complaint_ids.isna() | (w.linked_complaint_ids.astype(str).str.strip() == "")
w["sla_ok"] = w.sla_met == "Y"
w["reopened"] = w.reopened_within_30d == "Y"
wards["ll_q"] = pd.qcut(wards.low_lying_index, 4, labels=["Q1", "Q2", "Q3", "Q4"])
w["low_lying_index"] = w.ward_code.map(wards.set_index("ward_code").low_lying_index)
w["ll_q"] = w.ward_code.map(wards.set_index("ward_code").ll_q).astype(str)
order = ["no rain", "light", "moderate", "heavy", "very heavy", "extremely heavy"]
rain["rk"] = rain.imd_category.str.strip().str.lower().map({o: i for i, o in enumerate(order)})
worst = rain.sort_values("rk").groupby("date").tail(1).set_index("date").imd_category.str.strip().str.lower()
w["_d"] = w.work_started_at.dt.strftime("%Y-%m-%d")
w["imd_category"] = w._d.map(worst).fillna("no data")
w["heavy_rain"] = w.imd_category.isin(CFG["fairness"]["heavy_rain_categories"])
bt = tides.groupby("date").big_tide_flag.apply(lambda s: (s == "Y").any())
w["big_tide"] = w._d.map(bt).fillna(False).astype(bool)
w = w.drop(columns="_d")

# ============================================================ audit flags
flags = []
FID = [0]
PRIMARY = set(CFG["primary_financial_rule_ids"])


def add_flag(r, rule, tier, sev, label, reason, exposure=0, evidence=None, billed=None, expected=None, band=None):
    FID[0] += 1
    flags.append({"flag_id": f"FLG-{FID[0]:05d}", "work_order_id": r.work_order_id, "flag_type": rule, "display_label": label, "tier": tier,
                  "severity": sev, "public_reason": reason, "billed_cost_inr": int(r.cost_inr if billed is None else billed),
                  "expected_cost_inr": int(r.expected_cost_inr if expected is None else expected), "exposure_inr": int(exposure),
                  "ward_code": r.ward_code, "road_id": r.road_id, "contractor_id": r.contractor_id,
                  "evidence": json.dumps(evidence or {}, ensure_ascii=False, default=str), "variance_band": band, "flag_class": CFG["flag_classes"][rule]})


RO, DU, UN, DL, OI = CFG["rate_card_variance"], CFG["duplicate"], CFG["unlinked"], CFG["dlp"], CFG["outcome_indicators"]
for r in w.itertuples():
    if is_rate_variance(r.cost_ratio, RO["threshold"]):
        add_flag(r, RO["rule_id"], RO["tier"], RO["severity"], RO["display_label"],
                 RO["reason_template"].format(cost=r.cost_inr, exp=r.expected_cost_inr, ratio=r.cost_ratio, excess=r.excess_inr, method=r.repair_method),
                 exposure=r.excess_inr, band=variance_band(r.cost_ratio, RO["variance_bands"]), evidence={"cost_ratio": round(r.cost_ratio, 4), "variance_band": variance_band(r.cost_ratio, RO["variance_bands"]), "repair_method": r.repair_method, "area_sqm": r.area_sqm})
    if r.unlinked:
        add_flag(r, UN["rule_id"], UN["tier"], UN["severity"], UN["display_label"], UN["reason_template"], exposure=r.cost_inr, evidence={"linked_complaint_ids": None})
    if r.under_dlp == DL["dlp_flag_value"]:
        surf = r.repair_method in DL["surface_repair_methods"]
        if surf != (r.work_type in DL["surface_work_types"]):
            WARN.append(f"work_type/method mismatch {r.work_order_id}")
        if surf:
            add_flag(r, DL["surface_rule_id"], DL["surface_tier"], DL["surface_severity"], DL["surface_display_label"],
                     DL["surface_reason_template"].format(date=r.last_resurfaced), exposure=r.cost_inr, evidence={"last_resurfaced": r.last_resurfaced, "work_type": r.work_type, "repair_method": r.repair_method})
        else:
            add_flag(r, DL["context_rule_id"], DL["context_tier"], DL["context_severity"], DL["context_display_label"], DL["context_reason_template"],
                     evidence={"last_resurfaced": r.last_resurfaced, "work_type": r.work_type, "repair_method": r.repair_method})
    if not r.sla_ok:
        add_flag(r, OI["sla"]["rule_id"], OI["tier"], OI["sla"]["severity"], OI["sla"]["display_label"], OI["sla"]["reason"], evidence={"sla_hours": int(r.sla_hours)})
    if r.reopened:
        add_flag(r, OI["reopen"]["rule_id"], OI["tier"], OI["reopen"]["severity"], OI["reopen"]["display_label"], OI["reopen"]["reason"] + " " + OI["reopen"]["spend_reason"],
                 evidence={"spend_associated_inr": int(r.cost_inr)})

# duplicate candidates / repeated work (general behavioural rule, no hardcoded ids)
dup_pairs = {}
ws = w.sort_values(["assigned_at", "work_order_id"])
for _, g in ws.groupby(["road_id", "repair_method", "area_sqm"]):
    if len(g) < 2:
        continue
    recs = list(g.itertuples())
    for i, b in enumerate(recs):
        pri = [(a, (b.assigned_at - a.assigned_at).total_seconds() / 86400) for a in recs[:i]]
        pri = [(a, d) for a, d in pri if DU["min_interval_days"] <= d <= DU["max_interval_days"]]
        if pri:
            dup_pairs[b.work_order_id] = pri[-1]
wi = w.set_index("work_order_id")
n_dup = n_rep = 0
for wid, (a, days) in dup_pairs.items():
    b = wi.loc[wid]
    bb = type("R", (), {})()
    for c in ("work_order_id", "cost_inr", "expected_cost_inr", "ward_code", "road_id", "contractor_id"):
        setattr(bb, c, b[c] if c != "work_order_id" else wid)
    sup = {"same_contractor": bool(a.contractor_id == b.contractor_id), "cost_diff_pct": round(100 * abs(b.cost_inr / a.cost_inr - 1), 2),
           "interval_days": round(days, 2), "remark_blank": bool(pd.isna(b.engineer_remark)), "orig_wo": a.work_order_id, "orig_contractor": a.contractor_id}
    sup["cost_within_limit"] = bool(sup["cost_diff_pct"] <= DU["supporting_factors"]["cost_diff_pct_max"])
    sup["interval_within_limit"] = days <= DU["supporting_factors"]["interval_days_max"]
    if b.unlinked or not DU["require_current_link_blank"]:
        n_dup += 1
        add_flag(bb, DU["rule_id"], DU["tier"], DU["severity"], DU["display_label"],
                 DU["reason_template"].format(orig_wo=a.work_order_id, road_id=b.road_id, method=b.repair_method, area=f"{b.area_sqm:g}", days=days),
                 exposure=b.cost_inr, evidence=sup)
    else:
        n_rep += 1
        add_flag(bb, DU["repeated_rule_id"], DU["repeated_tier"], DU["repeated_severity"], DU["repeated_display_label"],
                 DU["repeated_reason_template"].format(orig_wo=a.work_order_id, days=days), evidence=sup)

F = pd.DataFrame(flags)
F["is_primary"] = F.flag_type.isin(PRIMARY)
F["amount_basis"] = F.flag_type.map(lambda t: "CALCULATED_VARIANCE" if t == RO["rule_id"] else ("BILLED_VALUE" if t in (DU["rule_id"], UN["rule_id"], DL["surface_rule_id"]) else "NONE"))
dedup = F[F.is_primary].groupby("work_order_id").exposure_inr.sum()
w["n_primary_flags"] = w.work_order_id.map(F[F.is_primary].groupby("work_order_id").size()).fillna(0).astype(int)
w["primary_exposure_sum_inr"] = w.work_order_id.map(dedup).fillna(0).astype(int)
w["dedup_exposure_inr"] = np.where(w.n_primary_flags > 0, w.cost_inr, 0).astype(int)  # = unique billed value touched by primary review flags
w["flag_codes"] = w.work_order_id.map(F.groupby("work_order_id").flag_type.apply(lambda s: "|".join(sorted(s)))).fillna("")
w["rate_card_outlier"] = np.round(w.cost_ratio, 6) > RO["threshold"]
w["in_valley"] = w.rate_card_outlier & (w.cost_ratio < RO["valley_upper"])
assert F.flag_id.is_unique

audit_summary = {}
for rid, g in F.groupby("flag_type"):
    audit_summary[rid] = {"count": int(len(g)), "billed_inr": int(g.billed_cost_inr.sum()), "exposure_inr": int(g.exposure_inr.sum()), "tier": g.tier.iloc[0]}
touched = w[w.n_primary_flags > 0]
_rv, _du, _un, _ds = (F[F.flag_type == RO["rule_id"]], F[F.flag_type == DU["rule_id"]], F[F.flag_type == UN["rule_id"]], F[F.flag_type == DL["surface_rule_id"]])
HERO = {"rate_card_calculated_variance_inr": int(_rv.exposure_inr.sum()), "rate_card_variance_wo_count": int(len(_rv)), "rate_card_recorded_billed_inr": int(_rv.billed_cost_inr.sum()),
        "duplicate_candidate_billed_inr": int(_du.billed_cost_inr.sum()), "duplicate_candidate_wo_count": int(len(_du)), "duplicate_candidates_also_unlinked": int(_du.work_order_id.isin(_un.work_order_id).sum()),
        "dlp_surface_billed_inr": int(_ds.billed_cost_inr.sum()), "dlp_surface_wo_count": int(len(_ds)),
        "note": "Three separate amounts; they overlap and must never be summed as a loss estimate."}
audit_summary["_hero"] = HERO
audit_summary["_touched"] = {"unique_primary_review_wo_count": int(len(touched)), "unique_billed_value_touched_inr": int(touched.cost_inr.sum()),
                             "label": CFG["exposure_basis"]["touched_label"].format(n=len(touched), inr=int(touched.cost_inr.sum()))}
_sets = {nm: set(F[F.flag_type == rid].work_order_id) for nm, rid in (("RATE_CARD_VARIANCE_REVIEW", RO["rule_id"]), ("HIGH_CONFIDENCE_DUPLICATE_CANDIDATE", DU["rule_id"]), ("UNLINKED_WORK_ORDER", UN["rule_id"]), ("DLP_SURFACE_REPAIR_REVIEW", DL["surface_rule_id"]))}
_ov = {}
for _r in w.itertuples():
    _k = tuple(nm for nm, st in _sets.items() if _r.work_order_id in st)
    if _k:
        _ov.setdefault(_k, []).append(_r)
OVERLAP = [{"combination": " + ".join(k), "unique_wo_count": len(v), "total_billed_inr": int(sum(x.cost_inr for x in v)),
            "rate_variance_inr": int(sum(x.excess_inr for x in v)) if "RATE_CARD_VARIANCE_REVIEW" in k else 0,
            "duplicate_candidate_billed_inr": int(sum(x.cost_inr for x in v)) if "HIGH_CONFIDENCE_DUPLICATE_CANDIDATE" in k else 0,
            "dlp_surface_billed_inr": int(sum(x.cost_inr for x in v)) if "DLP_SURFACE_REPAIR_REVIEW" in k else 0} for k, v in sorted(_ov.items(), key=lambda kv: (len(kv[0]), kv[0]))]
audit_summary["_overlap_matrix"] = OVERLAP
TAX = F.groupby("flag_class").size().to_dict()
assert sum(TAX.values()) == len(F), "flag taxonomy does not cover all rows"
audit_summary["_flag_class_counts"] = {k: int(v) for k, v in TAX.items()}
audit_summary["_flag_class_by_type"] = F.groupby(["flag_class", "flag_type"]).size().reset_index(name="n").to_dict("records")
dlp_ctx = F[F.flag_type == DL["context_rule_id"]]
FPS = {"normal_rate_variance_protected_count": int((w.cost_ratio <= RO["threshold"]).sum()),
       "normal_rate_variance_threshold": RO["threshold"],
       "linked_exact_area_protected_count": int((F.flag_type == DU["repeated_rule_id"]).sum()),
       "linked_exact_area_protected_wos": sorted(F[F.flag_type == DU["repeated_rule_id"]].work_order_id),
       "dlp_non_surface_excluded_count": int(len(dlp_ctx)), "dlp_non_surface_excluded_inr": int(dlp_ctx.billed_cost_inr.sum()),
       "statement": "Normal rate variance, linked repeat visits and drainage/pumping work on DLP roads are deliberately not flagged as violations."}

# ============================================================ fairness
mrate = w.groupby("repair_method").agg(jobs=("reopened", "size"), reopened=("reopened", "sum"), avg_cost_inr=("cost_inr", "mean"),
                                       rate_unit=("unit", "first"), standard_rate_inr=("standard_rate_inr", "first")).reset_index()
mrate["reopen_rate"] = mrate.reopened / mrate.jobs
mrate["survival_adjusted_30d_rate_inr"] = (mrate.standard_rate_inr / (1 - mrate.reopen_rate)).round(0)
mrate["avg_cost_inr"] = mrate.avg_cost_inr.round(0)
mrate["reopen_30d_pct"] = (100 * mrate.reopen_rate).round(2)
mrate["non_reopen_30d_pct"] = (100 - mrate.reopen_30d_pct).round(2)
mrate["unit_group"] = mrate.rate_unit.map(CFG["unit_groups"])
mrate["display_label"] = CFG["durability_labels"]["display_label"]
r_m = mrate.set_index("repair_method").reopen_rate.to_dict()
w["method_reopen_rate"] = w.repair_method.map(r_m)
sla_q = w.groupby("ll_q").sla_ok.mean().to_dict()
w["expected_sla_by_ll"] = w.ll_q.map(sla_q)
FZ = CFG["fairness"]
fx = FZ["score_params"]
fa_rows = []
fflag = F[F.is_primary].groupby("contractor_id")
for cid, g in w.groupby("contractor_id"):
    n = len(g)
    O = g.reopened.mean()
    E = g.method_reopen_rate.mean()
    delta = O - E
    sla = g.sla_ok.mean()
    esla = g.expected_sla_by_ll.mean()
    gf = F[F.contractor_id == cid]
    out_n = int((g.rate_card_outlier).sum())
    dup_n = int((gf.flag_type == DU["rule_id"]).sum())
    unl_n = int(g.unlinked.sum())
    dls_n = int((gf.flag_type == DL["surface_rule_id"]).sum())
    flagged_jobs = int(g[g.rate_card_outlier | g.work_order_id.isin(gf[gf.flag_type.isin([DU["rule_id"], UN["rule_id"]])].work_order_id)].shape[0])
    comp = {
        "durability_vs_method_mix": float(np.clip(fx["durability"]["neutral_score"] - fx["durability"]["points_per_pp_delta"] * 100 * delta, 0, 100)),
        "billing_integrity": float(np.clip(100 - fx["billing_integrity"]["penalty_per_flagged_share_pct"] * 100 * flagged_jobs / n, 0, 100)),
        "sla_vs_context": float(np.clip(fx["sla"]["neutral_score"] + fx["sla"]["points_per_pp_vs_benchmark"] * 100 * (sla - esla), 0, 100)),
        "dlp_surface_adherence": float(np.clip(100 - fx["dlp"]["penalty_per_surface_review_share_pct"] * 100 * dls_n / n, 0, 100)),
    }
    score = sum(FZ["weights"][k] * v for k, v in comp.items())
    enough = n >= FZ["min_jobs_comparative"]
    fa_rows.append({
        "contractor_id": cid, "n_jobs": n, "comparative_gate": "OK" if enough else FZ["insufficient_tag"], "total_spend_inr": int(g.cost_inr.sum()),
        "reopened_jobs": int(g.reopened.sum()), "observed_reopen_rate": O, "expected_reopen_rate_method_mix": E, "delta_reopen_vs_method_mix": delta,
        "raw_sla_met_pct": 100 * sla, "expected_sla_by_low_lying_pct": 100 * esla, "sla_vs_low_lying_benchmark_pts": 100 * (sla - esla),
        "low_lying_exposure_pct": 100 * (g.ll_q == FZ["low_lying_top_quartile_label"]).mean(), "avg_ward_low_lying_index": g.low_lying_index.mean(),
        "heavy_rain_job_pct": 100 * g.heavy_rain.mean(), "big_tide_job_pct": 100 * g.big_tide.mean(),
        "avg_cost_ratio": g.cost_ratio.mean(), "rate_card_outlier_count": out_n, "rate_card_excess_inr": int(g[g.rate_card_outlier].excess_inr.sum()),
        "duplicate_candidate_count": dup_n, "unlinked_wo_count": unl_n, "dlp_surface_review_count": dls_n,
        "dlp_surface_review_spend_inr": int(g[g.work_order_id.isin(gf[gf.flag_type == DL["surface_rule_id"]].work_order_id)].cost_inr.sum()),
        "reopened_30d_spend_inr": int(g[g.reopened].cost_inr.sum()),
        "unique_primary_flagged_wo": int((g.n_primary_flags > 0).sum()), "dedup_at_risk_inr": int(g.dedup_exposure_inr.sum()),
        "score_durability": comp["durability_vs_method_mix"], "score_billing_integrity": comp["billing_integrity"], "score_sla_context": comp["sla_vs_context"],
        "score_dlp_adherence": comp["dlp_surface_adherence"], "w_durability": FZ["weights"]["durability_vs_method_mix"], "w_billing": FZ["weights"]["billing_integrity"],
        "w_sla": FZ["weights"]["sla_vs_context"], "w_dlp": FZ["weights"]["dlp_surface_adherence"],
        "experimental_accountability_index": score, "sla_non_causal_note": FZ["sla_non_causal_note"], "reopen_context_note": FZ["reopen_context_note"],
        "engineer_remark_contribution": CFG["engineer_remarks"]["audit_contribution"]})
C = pd.DataFrame(fa_rows).merge(ctr[["contractor_id", "contractor_name", "empanelled_since", "active_wards"]], on="contractor_id")
assert (C.n_jobs >= FZ["min_jobs_comparative"]).all()
C = C.rename(columns={"n_jobs": "jobs_count", "raw_sla_met_pct": "sla_met_pct", "rate_card_outlier_count": "rate_variance_count", "rate_card_excess_inr": "rate_variance_inr", "dedup_at_risk_inr": "touched_billed_inr"})
C["observed_reopen_pct"] = 100 * C.observed_reopen_rate
C["expected_reopen_method_mix_pct"] = 100 * C.expected_reopen_rate_method_mix
C["reopen_delta_pts"] = 100 * C.delta_reopen_vs_method_mix
C = C.drop(columns=["observed_reopen_rate", "expected_reopen_rate_method_mix", "delta_reopen_vs_method_mix"])
_comp = {"durability_vs_method_mix": "score_durability", "billing_integrity": "score_billing_integrity", "sla_vs_context": "score_sla_context", "dlp_surface_adherence": "score_dlp_adherence"}
SENS = {"profiles": {}, "primary_evidence_order_by_reopen_delta_pts_best_first": C.sort_values("reopen_delta_pts").contractor_id.tolist()}
for _pn, _pw in FZ["sensitivity_profiles"].items():
    _col = "idx_" + _pn.lower().replace("-", "_")
    C[_col] = sum(_pw[k] * C[c_] for k, c_ in _comp.items())
    SENS["profiles"][_pn] = {"weights": _pw, "order_best_first": C.sort_values(_col, ascending=False).contractor_id.tolist(), "index": {r_.contractor_id: round(float(getattr(r_, _col)), 1) for r_ in C.itertuples()}}
_orders = [v["order_best_first"] for v in SENS["profiles"].values()]
SENS["bottom3_in_all_profiles"] = sorted(set.intersection(*[set(o[-3:]) for o in _orders]))
SENS["top3_in_all_profiles"] = sorted(set.intersection(*[set(o[:3]) for o in _orders]))
SENS["rank_range"] = {c_: [min(o.index(c_) + 1 for o in _orders), max(o.index(c_) + 1 for o in _orders)] for c_ in C.contractor_id}

# ============================================================ complaints
cc = cmp_.copy()
cc["has_gps"] = cc.lat.notna() & cc.lon.notna()
lk = [GZ.lookup(a, b) for a, b in zip(cc.locality_text, cc.description)]
cc["gaz_ward"] = [x[0][0] if x[0] else None for x in lk]
cc["gaz_lat"] = [x[0][1] if x[0] else np.nan for x in lk]
cc["gaz_lon"] = [x[0][2] if x[0] else np.nan for x in lk]
cc["canon_locality"] = [x[0][3] if x[0] else None for x in lk]
cc["pip_ward"] = [WP.of(a, b) if g else None for a, b, g in zip(cc.lat, cc.lon, cc.has_gps)]
cc["source_ward_code"] = cc.ward_code
cc["ward_provenance"] = np.where(cc.ward_code.notna(), "SOURCE_REPORTED", np.where(cc.pip_ward.notna(), "GPS_POINT_IN_POLYGON", np.where(cc.gaz_ward.notna(), "GAZETTEER_MATCHED", "UNRESOLVED")))
cc["ward_final"] = cc.ward_code.fillna(cc.pip_ward).fillna(cc.gaz_ward)
cc["ward_border_review"] = cc.has_gps & cc.ward_code.notna() & cc.pip_ward.notna() & (cc.pip_ward != cc.ward_code)
cc["locality_ward_mismatch"] = cc.ward_code.notna() & cc.gaz_ward.notna() & (cc.gaz_ward != cc.ward_code)
cc["coord_provenance"] = np.where(cc.has_gps, "SOURCE_GPS", np.where(cc.gaz_lat.notna(), "LOCALITY_CENTROID", "UNRESOLVED"))
cc["lat_final"] = np.where(cc.has_gps, cc.lat, cc.gaz_lat)
cc["lon_final"] = np.where(cc.has_gps, cc.lon, cc.gaz_lon)
cc.loc[cc.coord_provenance == "UNRESOLVED", ["lat_final", "lon_final"]] = np.nan
cc["text_en"] = cc.description.map(text_is_english)
cc["cat_photo"] = cc.photo_description.map(lambda x: PHOTO.get(x) if isinstance(x, str) else None)
cc["cat_text"] = cc.description.map(text_cat)
VAGUE = set(CFG["complaints"]["vague_categories"])


def resolve_cat(r):
    rep, ph, tx = r.category_reported, r.cat_photo, r.cat_text
    vague = rep in VAGUE
    if isinstance(ph, str):
        return ph, "photo_description", ("RESOLVED_FROM_VAGUE" if vague else ("CONFIRMED" if ph == rep else "CORRECTED")), None
    if r.text_en:
        if tx == "NONROAD":
            return "Not a road issue", "clear_english_description", "NON_ROAD", None
        if isinstance(tx, str):
            return tx, "clear_english_description", ("RESOLVED_FROM_VAGUE" if vague else ("CONFIRMED" if tx == rep else "CORRECTED")), None
        return rep, "reported_category", "CATEGORY_UNVERIFIED", "english_text_without_category_evidence"
    if vague and isinstance(tx, str) and tx != "NONROAD":
        return tx, "deterministic_multilingual_keyword_evidence", "LOW_CONFIDENCE_KEYWORD", None
    if vague:
        return rep, "reported_category", "CATEGORY_UNVERIFIED", "vague_category_without_evidence"
    return rep, "reported_category", "CATEGORY_UNVERIFIED", "non_english_generic_text_without_photo"


rc_ = cc.apply(resolve_cat, axis=1, result_type="expand")
cc["resolved_category"], cc["category_source"], cc["category_status"], cc["category_unverified_reason"] = rc_[0], rc_[1], rc_[2], rc_[3]
# optional Antigravity enrichment (never blocks)
cc["model_proposal_applied"] = False
efile = ENR / "complaints_ambiguous_enriched.jsonl"
if efile.exists():
    try:
        recs = [json.loads(x) for x in efile.read_text(encoding="utf-8").splitlines() if x.strip()]
        ids = {r["complaint_id"] for r in recs}
        bad = ids - set(cc.complaint_id)
        if bad:
            WARN.append(f"enriched complaints: {len(bad)} unknown ids ignored")
        valid_cats = set(rate.repair_method) | set(PHOTO.values()) | {"Not a road issue"}
        n_app = 0
        for r in recs:
            cat = r.get("category") or r.get("resolved_category") or r.get("proposed_category")
            i = cc.index[cc.complaint_id == r["complaint_id"]]
            if len(i) and cat in valid_cats and cc.loc[i[0], "category_status"] == "CATEGORY_UNVERIFIED":
                cc.loc[i[0], ["resolved_category", "category_source", "category_status", "model_proposal_applied"]] = [cat, "model_proposal", "MODEL_PROPOSED", True]
                n_app += 1
        WARN.append(f"enriched complaints merged: {n_app}/{len(recs)}")
    except Exception as e:  # noqa
        WARN.append(f"enriched complaints ignored: {e}")
# linkage
lmap = {}
for wid, s in zip(wo.work_order_id, wo.linked_complaint_ids):
    if isinstance(s, str):
        for x in s.split("|"):
            if x.strip():
                lmap.setdefault(x.strip(), []).append(wid)
cc["linked_work_order_ids"] = cc.complaint_id.map(lambda x: "|".join(lmap.get(x, [])) or None)
bmap = {s: k for k, v in CFG["complaints"]["linkage_buckets"].items() for s in v}
cc["linkage_bucket"] = cc.status.map(bmap)
lc = cc.linkage_bucket.value_counts().to_dict()
for k, v in CFG["complaints"]["expected_linkage_counts"].items():
    if lc.get(k) != v:
        WARN.append(f"linkage bucket {k}: {lc.get(k)} != expected {v}")
# nearest road (SOURCE_GPS only)
RA = roads[["start_lat", "start_lon", "end_lat", "end_lon"]].to_numpy().T
cc["nearest_road_id"] = None
cc["nearest_road_m"] = np.nan
g = cc[cc.has_gps]
dm = seg_dist_m(g.lat.to_numpy(), g.lon.to_numpy(), *RA)
ni, nd = dm.argmin(1), dm.min(1)
ok = nd <= CFG["complaints"]["nearest_road_max_m"]
cc.loc[g.index[ok], "nearest_road_id"] = roads.road_id.to_numpy()[ni[ok]]
cc.loc[g.index, "nearest_road_m"] = nd
cc["received_dt"] = pd.to_datetime(cc.received_at)
# clustering into monsoon_issues
cc["cluster_key"] = np.where(cc.nearest_road_id.notna(), "ROAD:" + cc.nearest_road_id.fillna(""), "LOC:" + cc.canon_locality.fillna(cc.locality_text.astype(str)))
cc["issue_id"] = None
iss = []
n_i = 0
win = pd.Timedelta(days=CFG["complaints"]["cluster_window_days"])
for (key, cat), g in cc.sort_values("received_dt").groupby(["cluster_key", "resolved_category"]):
    start = None
    cur = []
    for idx, t in zip(g.index, g.received_dt):
        if start is None or t - start > win:
            if cur:
                iss.append(cur)
            cur, start = [], t
        cur.append(idx)
    if cur:
        iss.append(cur)
ISSMAP = {}
rows = []
soc_rows = None  # filled later; corroboration added afterwards
for k, idxs in enumerate(iss, 1):
    g = cc.loc[idxs]
    iid = f"ISS-{k:05d}"
    ISSMAP.update({i: iid for i in idxs})
    gp = g[g.coord_provenance == "SOURCE_GPS"]
    lat, lon, cp = (gp.lat.mean(), gp.lon.mean(), "SOURCE_GPS") if len(gp) else ((g.lat_final.mean(), g.lon_final.mean(), "LOCALITY_CENTROID") if g.lat_final.notna().any() else (np.nan, np.nan, "UNRESOLVED"))
    key = g.cluster_key.iloc[0]
    wos = sorted({x for s in g.linked_work_order_ids.dropna() for x in s.split("|")})
    openn = int(g.status.isin(["Open", "In Progress"]).sum())
    rows.append({"issue_id": iid, "key_type": key.split(":")[0], "key_value": key.split(":", 1)[1], "nearest_road_id": g.nearest_road_id.dropna().iloc[0] if g.nearest_road_id.notna().any() else None,
                 "locality": g.canon_locality.dropna().mode().iloc[0] if g.canon_locality.notna().any() else g.locality_text.iloc[0], "ward_code": g.ward_final.dropna().mode().iloc[0] if g.ward_final.notna().any() else None,
                 "category": g.resolved_category.iloc[0], "category_status_mix": "|".join(sorted(set(g.category_status))), "first_received": g.received_dt.min(), "last_received": g.received_dt.max(),
                 "complaint_count": len(g), "channel_count": g.channel.nunique(), "channels": "|".join(sorted(set(g.channel))), "languages": "|".join(sorted(set(g.language))),
                 "open_count": openn, "linked_work_order_ids": "|".join(wos) or None, "complaint_ids": "|".join(g.complaint_id),
                 "issue_status": "OPEN_BACKLOG" if openn else ("LINKED_TO_WORK_ORDER" if wos else "FORWARDED_OR_REJECTED"),
                 "lat": lat, "lon": lon, "coord_provenance": cp})
I = pd.DataFrame(rows)
cc["issue_id"] = pd.Series(ISSMAP)

# ============================================================ social posts
S = soc.copy()
PAT = {"fwd": r"forward|fwd|please share|share karo|share this|copied|👇|plz share|\bfw\b|viral", "thanks": r"thank|dhanyavad|धन्यवाद|आभार|shukriya|kudos|well done|appreciate",
       "fail": r"just fixed|already back|fixed last week|phir se khul|re-?opened|came back|fir se", "sarc": r"wah|waah|great job|kya baat|bravo|so proud|🙄|😂|🤡|#achhe|vikas|best city|world class|good job bmc|swimming pool|nice job",
       "urg": r"ambulance|urgent|🚨|एम्बुलेंस", "act": r"pothole|khadd|manhole|waterlog|paani|pani|पाणी|पानी|खड्ड|गड्ढ|नाला|nullah|drain|flood|sinkhole|cave|road|sadak|रस्ता|रोड|dhas|gaddha|gadda|gutter|overflow"}
PX = {k: re.compile(v, re.I) for k, v in PAT.items()}
gl = [GZ.find(t) for t in S.text]
S["matched_localities"] = ["|".join(x[0]) for x in gl]
one = [x[0][0] if len(x[0]) == 1 else None for x in gl]
S["matched_locality"] = one
S["matched_ward_code"] = [GZ.gaz[norm(x[1][0])][0] if len(x[0]) == 1 else None for x in gl]
S["lat"] = [GZ.gaz[norm(x[1][0])][1] if len(x[0]) == 1 else np.nan for x in gl]
S["lon"] = [GZ.gaz[norm(x[1][0])][2] if len(x[0]) == 1 else np.nan for x in gl]
S["coord_provenance"] = np.where(S.lat.notna(), "LOCALITY_CENTROID", "UNRESOLVED")
rn = roads.groupby("road_name").road_id.apply(list).to_dict()
RWARD = roads.set_index("road_id").ward_code.to_dict()
rkeys = sorted(rn, key=lambda x: -len(x))


def road_match(t, ward):
    nt = norm(t)
    for k in rkeys:
        if norm(k) in nt:
            cand = [r for r in rn[k] if ward is None or RWARD[r] == ward]
            return k, (cand[0] if len(cand) == 1 else None)
    return None, None


rm = [road_match(t, wd) for t, wd in zip(S.text, S.matched_ward_code)]
S["matched_road_name"], S["matched_road_id"] = [x[0] for x in rm], [x[1] for x in rm]


def sclass(t, has_loc):
    if PX["fwd"].search(t):
        return "FORWARD_OR_DUPLICATE"
    if PX["thanks"].search(t):
        return "THANK_YOU"
    if PX["fail"].search(t):
        return "REPAIR_FAILED"
    if PX["sarc"].search(t):
        return "SARCASM_SIGNAL"
    if PX["urg"].search(t):
        return "AMBULANCE_URGENT"
    if PX["act"].search(t):
        return "ACTIONABLE_ISSUE"
    return "UNCERTAIN" if has_loc else "NON_ACTIONABLE"


S["social_class"] = [sclass(t, bool(x[0])) for t, x in zip(S.text, gl)]
S["engagement_weight_used"] = CFG["complaints"]["social"]["engagement_weight_in_audit"]
S["posted_dt"] = pd.to_datetime(S.posted_at)
semf = ENR / "social_posts_enriched.jsonl"
if semf.exists():
    WARN.append("social_posts_enriched.jsonl present but ignored in deterministic classes (displayed only)")
sig = S[S.social_class.isin(["ACTIONABLE_ISSUE", "REPAIR_FAILED", "AMBULANCE_URGENT"])]
bl = sig.groupby("matched_locality")
corr = []
for r in I.itertuples():
    g = sig[sig.matched_locality == r.locality]
    corr.append(int(((g.posted_dt >= r.first_received - pd.Timedelta(days=3)) & (g.posted_dt <= r.last_received + pd.Timedelta(days=7))).sum()) if len(g) else 0)
I["social_corroboration_count"] = corr

# ============================================================ Next-Rupee
NR = json.loads((ROOT / "pipeline" / "config" / "next_rupee_rules.json").read_text(encoding="utf-8"))
R = roads.copy()
R["mid_lat"], R["mid_lon"] = (R.start_lat + R.end_lat) / 2, (R.start_lon + R.end_lon) / 2
wr = w.groupby("road_id").agg(wo_n=("cost_inr", "size"), reopen_n=("reopened", "sum"), reopened_spend_inr=("cost_inr", lambda s: 0))
wr["reopened_spend_inr"] = w[w.reopened].groupby("road_id").cost_inr.sum()
R = R.merge(wr, on="road_id", how="left").fillna({"wo_n": 0, "reopen_n": 0, "reopened_spend_inr": 0})
surf_m = set(CFG["dlp"]["surface_repair_methods"])
sw = w[w.repair_method.isin(surf_m)]
best_surface = min(r_m[m] for m in surf_m)
sw = sw.assign(upgrade=sw.method_reopen_rate - best_surface)
R = R.merge(sw.groupby("road_id").agg(surface_wo_n=("upgrade", "size"), D_raw=("upgrade", "mean"), median_surface_area=("area_sqm", "median")), on="road_id", how="left")
# complaints burden
gps = cc[cc.nearest_road_id.notna()]
cb_all = gps.groupby("nearest_road_id").size()
cb_open = gps[gps.status.isin(["Open", "In Progress"])].groupby("nearest_road_id").size()
R["complaints_any_nearby"] = R.road_id.map(cb_all).fillna(0).astype(int)
R["C_raw"] = R.road_id.map(cb_open).fillna(0)
R["C_obs"] = R.complaints_any_nearby > 0
R["R_raw"] = R.reopen_n.astype(float)
R["R_obs"] = R.wo_n > 0
RAr = R[["start_lat", "start_lon", "end_lat", "end_lon"]].to_numpy().T
dh = seg_dist_m(fh.lat.to_numpy(), fh.lon.to_numpy(), *RAr)
wgt = np.clip(1 - dh / NR["hotspot_radius_m"], 0, None) * fh.years_flagged_last_5.to_numpy()[:, None]
R["F_raw"], R["F_obs"] = wgt.sum(0), True
R["hotspots_within_radius"] = (dh <= NR["hotspot_radius_m"]).sum(0)
ar = acc[acc.probable_cause.isin(NR["accident_causes"])].copy()
ar["w"] = ar.severity.map(NR["accident_severity_weights"])
R["A_raw"] = R.road_id.map(ar.groupby("road_id").w.sum()).fillna(0)
R["accidents_surface_cause"] = R.road_id.map(ar.groupby("road_id").size()).fillna(0).astype(int)
R["A_obs"] = True
FC = NR["facility"]
fv = fac.copy()
isH = (fv.type == "Hospital") & (fv.emergency_services == "Y")
fv["v"] = np.where(isH, FC["hospital_base"] + np.minimum(fv.beds_or_students / 100 * FC["per_100_beds"], FC["hospital_bed_cap_units"]),
                   FC["school_base"] + np.minimum(fv.beds_or_students / 500, FC["school_student_cap_units"]))
fv["is_eh"] = isH
R["V_raw"] = R.road_id.map(fv.groupby("ambulance_entry_road").v.sum()).fillna(0)
R["emergency_hospitals"] = R.road_id.map(fv[fv.is_eh].groupby("ambulance_entry_road").size()).fillna(0).astype(int)
R["schools"] = R.road_id.map(fv[fv.type == "School"].groupby("ambulance_entry_road").size()).fillna(0).astype(int)
R["V_obs"] = True
R = R.merge(traf, on="road_id", how="left")
R["T_obs"] = R.peak_hour_vehicles.notna()
R["D_obs"] = R.surface_wo_n.fillna(0) > 0
R["D_raw"] = R.D_raw.fillna(0)


def wnorm(x, obs):
    x = pd.Series(x, index=R.index).astype(float)
    cap = np.nanpercentile(x[obs], NR["normalization"]["winsor_percentile"]) if obs.any() else 0
    if cap <= 0:
        cap = x[obs].max() if obs.any() and x[obs].max() > 0 else 0
    return (100 * np.minimum(x, cap) / cap) if cap > 0 else x * 0


tw = NR["traffic_weights"]
t_norm = sum(tw[k] * wnorm(R[k].fillna(0), R.T_obs) for k in tw)
for f_, raw in (("C", R.C_raw), ("R", R.R_raw), ("F", R.F_raw), ("A", R.A_raw), ("V", R.V_raw), ("D", R.D_raw)):
    R[f"{f_}_norm"] = wnorm(raw, R[f"{f_}_obs"]).round(2)
R["T_raw"] = t_norm.round(2)
R["T_norm"] = t_norm.round(2)
W7 = NR["weights"]
num = sum(W7[f] * R[f"{f}_norm"] * R[f"{f}_obs"] for f in W7)
den = sum(W7[f] * R[f"{f}_obs"] for f in W7)
R["risk_score"] = (num / den).round(2)
R["evidence_coverage_pct"] = (100 * den).round(1)
R["factors_missing"] = R.apply(lambda r: ",".join(f for f in W7 if not r[f"{f}_obs"]), axis=1)
R["rank_status"] = np.where(R.evidence_coverage_pct < NR["coverage_min_pct"], NR["insufficient_tag"], "RANKED")
R["lane"] = np.where(R.under_dlp == "Y", NR["lanes"]["under_dlp_Y"], NR["lanes"]["under_dlp_N"])


def lane_rank(df):
    d = df.sort_values(["risk_score", "road_id"], ascending=[False, True])
    elig = [i for i in d.index if d.loc[i, "rank_status"] == "RANKED"]
    top = elig[: NR["top_rank_gate"]]
    rest = [i for i in d.index if i not in top]
    return {i: k for k, i in enumerate(top + rest, 1)}


R["lane_rank"] = 0
for lane, g in R.groupby("lane"):
    for i, k in lane_rank(g).items():
        R.loc[i, "lane_rank"] = k
# profile stability (risk independent of affordability, DLP status, social engagement and remarks)
def _risk_cov(wts):
    n_ = sum(wts[f] * R[f"{f}_norm"] * R[f"{f}_obs"] for f in wts)
    d_ = sum(wts[f] * R[f"{f}_obs"] for f in wts)
    return (n_ / d_).round(2), (100 * d_).round(1)


for pn, wts in NR["profiles"].items():
    R[f"risk_{pn}"], R[f"coverage_{pn}"] = _risk_cov(wts)
    R[f"rank_{pn}"] = 0
    for lane, g in R.groupby("lane"):
        tmp = g.assign(risk_score=R.loc[g.index, f"risk_{pn}"], rank_status=np.where(R.loc[g.index, f"coverage_{pn}"] < NR["coverage_min_pct"], "INSUFFICIENT", "RANKED"))
        for i, k in lane_rank(tmp).items():
            R.loc[i, f"rank_{pn}"] = k
assert (R.risk_A_balanced == R.risk_score).all() and (R.rank_A_balanced == R.lane_rank).all(), "profile A must equal primary risk"
TOPN = NR["stability_top_n"]
STAB = {"top_n": TOPN, "recommended_profile": NR["recommended_profile"], "methodology_status": NR["methodology_status"], "lanes": {}}
R["top10_profile_count"] = sum((R[f"rank_{pn}"] <= TOPN).astype(int) for pn in NR["profiles"])
for lane, g in R.groupby("lane"):
    cand = g[g.top10_profile_count > 0]
    STAB["lanes"][lane] = {
        "in_all_4_profiles": sorted(g[g.top10_profile_count == 4].road_id),
        "in_at_least_3_profiles": sorted(g[g.top10_profile_count >= 3].road_id),
        "in_any_profile": int(len(cand)),
        "rank_ranges": {r_.road_id: [int(min(getattr(r_, f"rank_{pn}") for pn in NR["profiles"])), int(max(getattr(r_, f"rank_{pn}") for pn in NR["profiles"]))] for r_ in g[g.top10_profile_count >= 3].itertuples()},
        "top10_by_profile": {pn: g.sort_values(f"rank_{pn}").head(TOPN).road_id.tolist() for pn in NR["profiles"]},
    }
STAB["lane_consistency"] = "Lane is fixed by roads.under_dlp (a road never changes lane between profiles)."
STAB["overlap_with_recommended_top10"] = {pn: {lane: len(set(STAB["lanes"][lane]["top10_by_profile"][pn]) & set(STAB["lanes"][lane]["top10_by_profile"]["A_balanced"])) for lane in STAB["lanes"]} for pn in NR["profiles"]}
R["methodology_status"] = NR["methodology_status"]
# recommendations: dominant issue -> compatible candidate treatment
wrem = (wards.set_index("ward_code").monsoon_repair_budget_inr_2025 - w.groupby("ward_code").cost_inr.sum()).to_dict()
mt = mrate.set_index("repair_method")
dlp_wo = F[F.flag_type == DL["surface_rule_id"]].groupby("road_id").work_order_id.apply(lambda s_: "|".join(sorted(s_))).to_dict()
reop_wo = w[w.reopened].groupby("road_id").work_order_id.apply(lambda s_: "|".join(sorted(s_))).to_dict()
FN = NR["factor_names"]
MATRIX = CFG["issue_treatment_compatibility"]
_oc, _rw = {}, {}
for (rid_, cat_), n_ in cc[cc.nearest_road_id.notna() & cc.status.isin(["Open", "In Progress"])].groupby(["nearest_road_id", "resolved_category"]).size().items():
    _oc.setdefault(rid_, Counter())[cat_] += int(n_)
for (rid_, wt_), n_ in w[w.reopened].groupby(["road_id", "work_type"]).size().items():
    _rw.setdefault(rid_, Counter())[wt_] += int(n_)
rr_, sr_ = mt.reopen_rate.to_dict(), mt.standard_rate_inr.to_dict()
DLN = NR["dlp_lane"]
rec = []
for r in R.itertuples():
    top2 = sorted(W7, key=lambda f: -getattr(r, f"{f}_norm") * W7[f])[:2]
    why = "; ".join(f"{FN[f]} {getattr(r, f'{f}_norm'):.0f}/100" for f in top2)
    d = {"top_factors": why, "ward_remaining_budget_inr": int(wrem[r.ward_code]), "reopened_wo_ids": reop_wo.get(r.road_id), "dlp_surface_review_wo_ids": dlp_wo.get(r.road_id)}
    comb = Counter(_oc.get(r.road_id, Counter())) + Counter(_rw.get(r.road_id, Counter()))
    keys = [k for k in MATRIX if comb.get(k, 0) > 0]
    dom = max(keys, key=lambda k: (comb[k], -list(MATRIX).index(k))) if keys else None
    d["dominant_issue_type"] = dom
    d["dominant_issue_basis"] = f"{_oc.get(r.road_id, Counter()).get(dom, 0)} open complaints + {_rw.get(r.road_id, Counter()).get(dom, 0)} reopened work orders" if dom else None
    ex_ = NR["exclude_cold_mix_when"]
    excl = ("Cold mix patch",) if (r.road_type in ex_["road_types"] or r.F_raw > ex_["flood_factor_gt"] or r.risk_score >= ex_["risk_score_gte"]) else ()
    meth = pick_candidate(dom, MATRIX, rr_, sr_, exclude=excl) if dom else None
    area = r.median_surface_area if pd.notna(r.median_surface_area) and r.median_surface_area > 0 else NR["default_patch_sqm_if_unknown"]
    if meth:
        est_ = round(sr_[meth] * (area if mt.loc[meth, "rate_unit"] == "per sqm" else 1))
        d.update({"candidate_treatment_method": meth, "candidate_treatment": f"{NR['candidate_treatment_label']}: {meth}", "candidate_unit_group": mt.loc[meth, "unit_group"],
                  "candidate_30d_reopen_pct": float(mt.loc[meth, "reopen_30d_pct"]), "estimated_candidate_cost_inr": int(est_), "assumed_area_sqm": round(float(area), 1) if mt.loc[meth, "rate_unit"] == "per sqm" else None})
    else:
        est_ = None
        d.update({"candidate_treatment_method": None, "candidate_treatment": NR["fallback_treatment"], "candidate_unit_group": None, "candidate_30d_reopen_pct": None, "estimated_candidate_cost_inr": None, "assumed_area_sqm": None})
    if r.lane == NR["lanes"]["under_dlp_Y"]:
        d.update({"allocation_action": DLN["allocation_action"], "allocation_note": DLN["allocation_note"], "affordable_now": None, "dlp_caveat": DLN["caveat"],
                  "potential_spend_avoided_label": DLN["potential_spend_label"], "potential_spend_avoided_inr": est_, "potential_spend_avoided_note": None if est_ is not None else "not quantified",
                  "action": DLN["allocation_note"] + " " + DLN["caveat"]})
    else:
        d.update({"allocation_action": "CANDIDATE_FOR_NEW_ALLOCATION", "allocation_note": "Candidate for new municipal allocation, subject to engineering review.", "affordable_now": (bool(wrem[r.ward_code] >= est_) if est_ is not None else None),
                  "dlp_caveat": None, "potential_spend_avoided_label": None, "potential_spend_avoided_inr": None, "potential_spend_avoided_note": None,
                  "action": (f"{d['candidate_treatment']}. Estimate = rate card x assumed area; engineering review decides scope." if meth else NR["fallback_treatment"] + ".")})
    rec.append(d)
R = pd.concat([R.reset_index(drop=True), pd.DataFrame(rec)], axis=1)
R["social_weight_used"] = CFG["complaints"]["social"]["engagement_weight_in_next_rupee"]

# ============================================================ wards
WD = wards.drop(columns="ll_q").copy()
wag = w.groupby("ward_code").agg(actual_spend_inr=("cost_inr", "sum"), wo_count=("cost_inr", "size"))
WD = WD.merge(wag, on="ward_code", how="left")
WD["remaining_inr"] = WD.monsoon_repair_budget_inr_2025 - WD.actual_spend_inr
WD["utilization_pct"] = (100 * WD.actual_spend_inr / WD.monsoon_repair_budget_inr_2025).round(1)
WD["reopened_30d_spend_inr"] = WD.ward_code.map(w[w.reopened].groupby("ward_code").cost_inr.sum()).fillna(0).astype(int)
WD["reopened_30d_jobs"] = WD.ward_code.map(w[w.reopened].groupby("ward_code").size()).fillna(0).astype(int)
for nm, rule in (("rate_card_outlier_count", RO["rule_id"]), ("duplicate_candidate_count", DU["rule_id"]), ("unlinked_wo_count", UN["rule_id"]), ("dlp_surface_review_count", DL["surface_rule_id"]), ("dlp_context_only_count", DL["context_rule_id"]), ("repeated_work_review_count", DU["repeated_rule_id"])):
    WD[nm] = WD.ward_code.map(F[F.flag_type == rule].groupby("ward_code").size()).fillna(0).astype(int)
WD["rate_card_excess_inr"] = WD.ward_code.map(F[F.flag_type == RO["rule_id"]].groupby("ward_code").exposure_inr.sum()).fillna(0).astype(int)
WD["dlp_surface_review_spend_inr"] = WD.ward_code.map(F[F.flag_type == DL["surface_rule_id"]].groupby("ward_code").billed_cost_inr.sum()).fillna(0).astype(int)
WD["dlp_context_only_spend_inr"] = WD.ward_code.map(F[F.flag_type == DL["context_rule_id"]].groupby("ward_code").billed_cost_inr.sum()).fillna(0).astype(int)
WD["dedup_at_risk_inr"] = WD.ward_code.map(w.groupby("ward_code").dedup_exposure_inr.sum()).fillna(0).astype(int)
WD["unique_primary_flagged_wo"] = WD.ward_code.map(w[w.n_primary_flags > 0].groupby("ward_code").size()).fillna(0).astype(int)
WD["open_complaints"] = WD.ward_code.map(cc[cc.status.isin(["Open", "In Progress"])].groupby("ward_final").size()).fillna(0).astype(int)
WD["ambulance_urgent_posts"] = WD.ward_code.map(S[S.social_class == "AMBULANCE_URGENT"].groupby("matched_ward_code").size()).fillna(0).astype(int)
cs = w.groupby(["ward_code", "contractor_id"]).cost_inr.sum().reset_index().sort_values("cost_inr", ascending=False).drop_duplicates("ward_code").set_index("ward_code")
ms = w.groupby(["ward_code", "repair_method"]).cost_inr.sum().reset_index().sort_values("cost_inr", ascending=False).drop_duplicates("ward_code").set_index("ward_code")
cn = ctr.set_index("contractor_id").contractor_name.str.replace(r" \(synthetic\)", "", regex=True)
WD["top_contractor_id"], WD["top_contractor_spend_inr"] = WD.ward_code.map(cs.contractor_id), WD.ward_code.map(cs.cost_inr)
WD["top_method"], WD["top_method_spend_inr"] = WD.ward_code.map(ms.repair_method), WD.ward_code.map(ms.cost_inr)
for lane, col in ((NR["lanes"]["under_dlp_N"], "top_new_budget_road_id"), (NR["lanes"]["under_dlp_Y"], "top_dlp_road_id")):
    t = R[R.lane == lane].sort_values(["ward_code", "lane_rank"]).drop_duplicates("ward_code").set_index("ward_code")
    WD[col] = WD.ward_code.map(t.road_id)
    # rank within ward (ward-local priority), skipping insufficient-evidence unless nothing else
    ok_ = R[(R.lane == lane) & (R.rank_status == "RANKED")].sort_values(["ward_code", "risk_score"], ascending=[True, False]).drop_duplicates("ward_code").set_index("ward_code")
    WD[col] = WD.ward_code.map(ok_.road_id).fillna(WD[col])
# flag exposure reconciliation
assert WD.actual_spend_inr.sum() == w.cost_inr.sum() == C.total_spend_inr.sum(), "spend reconciliation failed"
WD = WD.rename(columns={"rate_card_outlier_count": "rate_variance_count", "rate_card_excess_inr": "rate_variance_inr", "dedup_at_risk_inr": "touched_billed_inr", "unique_primary_flagged_wo": "unique_touched_wo_count"})

cn_full = ctr.set_index("contractor_id").contractor_name
WOIDS, RDIDS = set(wo.work_order_id), set(roads.road_id)
inr = lambda v: f"₹{int(round(v)):,}"  # noqa: E731
mil = lambda v: f"₹{v / 1e6:.2f}M"  # noqa: E731

# ============================================================ spotlight examples
sp = {}
c1 = w[w.rate_card_outlier & ~w.unlinked & (w.under_dlp == "N") & ~w.in_valley].sort_values("excess_inr", ascending=False).iloc[0]
sp["rate_card_variance_wo"] = {"id": c1.work_order_id, "why": f"Recorded cost is {c1.cost_ratio:.2f}× the calculated rate-card expectation (positive variance {inr(c1.excess_inr)}, {c1.repair_method})"}
d1 = F[(F.flag_type == DU["rule_id"])].copy()
d1["sc"] = d1.evidence.map(lambda e: sum(bool(json.loads(e)[k]) for k in ("same_contractor", "cost_within_limit", "interval_within_limit", "remark_blank")))
d1 = d1.sort_values(["sc", "billed_cost_inr"], ascending=False).iloc[0]
sp["duplicate_candidate_wo"] = {"id": d1.work_order_id, "why": d1.public_reason}
s1 = F[F.flag_type == DL["surface_rule_id"]].merge(w[["work_order_id", "unlinked"]], on="work_order_id")
s1 = s1[~s1.unlinked].sort_values("billed_cost_inr", ascending=False).iloc[0]
sp["surface_dlp_wo"] = {"id": s1.work_order_id, "why": s1.public_reason}
hosp_roads = set(R[R.emergency_hospitals > 0].road_id)
ne = cc[(cc.status.isin(["Open", "In Progress"])) & (cc.language != "en") & cc.nearest_road_id.isin(hosp_roads)].copy()
ne["amb"] = ne.description.map(lambda t: bool(AMBULANCE.search(str(t))))
ne = ne.sort_values(["amb", "upvotes"], ascending=False)
if len(ne):
    e1 = ne.iloc[0]
    sp["unfixed_multilingual_complaint_near_hospital_corridor"] = {"id": e1.complaint_id, "language": e1.language, "status": e1.status, "nearest_road_id": e1.nearest_road_id,
                                                                    "why": f"Open {e1.language} complaint on {e1.nearest_road_id}, an ambulance-entry road for an emergency hospital; mentions ambulance: {bool(e1.amb)}", "text": e1.description}
else:
    WARN.append("no spotlight complaint found")
for k, v in sp.items():
    ok_ = (v["id"] in WOIDS) if "wo" in k else (v["id"] in set(cc.complaint_id))
    assert ok_, f"spotlight {k} invalid"

# ============================================================ narratives (Claude-authored showcase entities; deterministic summary otherwise)
NCFG = CFG["narratives"]
_af = ROOT / NCFG["authored_file"]
AUTH = json.loads(_af.read_text(encoding="utf-8")) if _af.exists() else {}
SHOWCASE_WARDS = ["L", "E", "F/N", "F/S", "P/N", "G/N", "K/W", "R/C"]
TOP5 = R[R.lane == NR["lanes"]["under_dlp_N"]].sort_values("lane_rank").road_id.head(5).tolist()
CASE_IDS = [v["id"] for v in sp.values()]
ccx = cc.set_index("complaint_id")
Rx = R.set_index("road_id")
wix = w.set_index("work_order_id")
NAR = {"contractors": {}, "wards": {}, "cases": {}, "roads": {}}
IMPROVE = {"durability_vs_method_mix": "Improve: review method choice and curing on jobs that reopened within 30 days.",
           "billing_integrity": "Improve: attach measurement-book support for jobs recorded more than 30% above the calculated expectation.",
           "sla_vs_context": "Improve: pre-position crews in low-lying wards before heavy-rain days.",
           "dlp_surface_adherence": "Improve: confirm DLP status with the ward office before billing surface repairs."}
rdn = roads.set_index("road_id").road_name


def det_contractor(r):
    g = w[w.contractor_id == r.contractor_id]
    top_out = g[g.rate_card_outlier].sort_values("excess_inr", ascending=False).work_order_id.head(2).tolist()
    dup_ids = F[(F.contractor_id == r.contractor_id) & (F.flag_type == DU["rule_id"])].work_order_id.head(1).tolist()
    weakest = min(FZ["weights"], key=lambda k: {"durability_vs_method_mix": r.score_durability, "billing_integrity": r.score_billing_integrity, "sla_vs_context": r.score_sla_context, "dlp_surface_adherence": r.score_dlp_adherence}[k])
    parts = [f"{r.contractor_name.replace(' (synthetic)', '')} (fictional) completed {r.jobs_count} jobs worth {mil(r.total_spend_inr)} in this synthetic record.",
             f"{r.sla_met_pct:.0f}% met SLA ({r.sla_vs_low_lying_benchmark_pts:+.1f} pts vs the benchmark for its wards; {r.low_lying_exposure_pct:.0f}% of jobs in the most low-lying quartile). {FZ['sla_non_causal_note']}",
             f"{r.observed_reopen_pct:.1f}% reopened within 30 days versus {r.expected_reopen_method_mix_pct:.1f}% expected for its repair-method mix ({r.reopen_delta_pts:+.1f} pts).",
             f"Average cost ratio {r.avg_cost_ratio:.2f}x; {r.rate_variance_count} jobs more than 30% above the calculated rate-card expectation" + (f" (e.g. {', '.join(top_out)})." if top_out else "."),
             f"{r.duplicate_candidate_count} possible duplicate candidates" + (f" (e.g. {dup_ids[0]})" if dup_ids else "") + f" and {r.dlp_surface_review_count} DLP surface reviews need checking.", IMPROVE[weakest]]
    drop = [4, 3]
    txt = " ".join(parts)
    while len(txt.split()) > NCFG["contractor_max_words"] and drop:
        parts[drop.pop(0)] = ""
        txt = " ".join(p_ for p_ in parts if p_)
    return txt, top_out + dup_ids


def det_ward(r):
    wf = F[(F.ward_code == r.ward_code) & F.is_primary].sort_values("flag_amount_inr" if "flag_amount_inr" in F else "exposure_inr", ascending=False)
    ev = list(dict.fromkeys(wf.work_order_id))[:2]
    nb = R[R.road_id == r.top_new_budget_road_id].iloc[0] if r.top_new_budget_road_id else None
    dr = R[R.road_id == r.top_dlp_road_id].iloc[0] if r.top_dlp_road_id else None
    rem = r.remaining_inr
    parts = [f"Ward {r.ward_code} ({r.ward_name}) had a monsoon repair budget of {inr(r.monsoon_repair_budget_inr_2025)} and recorded spend of {inr(r.actual_spend_inr)} ({r.utilization_pct:.0f}% used), " + (f"leaving {inr(rem)}." if rem >= 0 else f"{inr(-rem)} over budget."),
             f"Most spend went to {cn[r.top_contractor_id]} ({inr(r.top_contractor_spend_inr)}) and {r.top_method} ({inr(r.top_method_spend_inr)}).",
             f"Spend associated with 30-day reopenings: {inr(r.reopened_30d_spend_inr)} across {r.reopened_30d_jobs} jobs.",
             f"Review flags: {r.rate_variance_count} rate-card variance reviews, {r.duplicate_candidate_count} possible duplicate candidates and {r.dlp_surface_review_count} surface repairs billed on DLP roads" + (f" (e.g. {', '.join(ev)})." if ev else "."),
             f"{r.unlinked_wo_count} jobs have no complaint linkage in the record; {r.open_complaints} complaints remain open or in progress.",
             (f"Next-rupee candidate: {nb.road_id} ({nb.road_name}), risk {nb.risk_score:.0f}/100; {nb.candidate_treatment.lower()}." if nb is not None else ""),
             (f"{dr.road_id} is under DLP: new allocation deferred pending DLP scope review." if dr is not None else ""),
             "Figures come from a synthetic record and are indicators for review, not findings of wrongdoing."]
    txt = " ".join(p_ for p_ in parts if p_)
    for drop in (4, 7, 2):
        if len(txt.split()) <= NCFG["ward_words_max"]:
            break
        parts[drop] = ""
        txt = " ".join(p_ for p_ in parts if p_)
    return txt, ev + [x for x in (r.top_new_budget_road_id, r.top_dlp_road_id) if x]


def put(kind, key, name, det_txt, ev, authored):
    txt = authored if authored else det_txt
    NAR[kind][key] = {"name": name, "text": txt, "words": len(txt.split()), "evidence_ids": ev,
                      "narrative_author": NCFG["authored_tag"] if authored else NCFG["deterministic_tag"]}


for r in C.itertuples():
    t_, ev_ = det_contractor(r)
    put("contractors", r.contractor_id, cn_full[r.contractor_id], t_, ev_, AUTH.get("contractors", {}).get(r.contractor_id))
for r in WD.itertuples():
    t_, ev_ = det_ward(r)
    put("wards", r.ward_code, r.ward_name, t_, ev_, AUTH.get("wards", {}).get(r.ward_code) if r.ward_code in SHOWCASE_WARDS else None)
for k, v in sp.items():
    det = (v.get("why") or "") + (" " + v["text"] if v.get("text") else "")
    put("cases", v["id"], k, det, [v["id"]], AUTH.get("cases", {}).get(v["id"]))
for rid in TOP5:
    rr = Rx.loc[rid]
    det = f"{rid} ({rr.road_name}, ward {rr.ward_code}): risk {rr.risk_score:.0f}/100 ({rr.top_factors}). {rr.candidate_treatment}; estimate {inr(rr.estimated_candidate_cost_inr) if pd.notna(rr.estimated_candidate_cost_inr) else 'not quantified'}."
    put("roads", rid, rr.road_name, det, [rid], AUTH.get("roads", {}).get(rid))


def _num_pool(*rows):
    pool = set()
    for row in rows:
        for v in row.values():
            if v is None or isinstance(v, (bool, np.bool_)):
                continue
            if isinstance(v, (int, float, np.integer, np.floating)) and np.isfinite(v):
                x = abs(float(v))
                pool |= {f"{x:.0f}", f"{x:.1f}", f"{x:.2f}", f"{x:,.0f}", f"{x:,.1f}", f"{x:,.2f}", f"{x / 1e6:.1f}", f"{x / 1e6:.2f}", f"{x / 1e5:.1f}", f"{x / 1e5:.2f}", f"{x / 1e7:.2f}", f"{x / 1e3:.0f}", f"{x / 1e3:.1f}"}
    return pool


SAFE = {str(i) for i in range(0, 13)} | {"30", "1.30", "1.60", "2.00", "100", "120", "2025", "1.3", "1.6", "2", "2.0"}
ID_RX = re.compile(r"WO25-\d{5}|RD\d{4}|BMC25-\d{6}|CT\d{2}|ISS-\d{5}|\d{4}-\d{2}-\d{2}")
ROADNUM_RX = re.compile("|".join(re.escape(n_) for n_ in roads.road_name.unique() if re.search(r"\d", n_)))
nerr = []
forb = [re.compile(r"\b" + re.escape(p_) + r"\b") for p_ in NCFG["forbidden_phrases"]]
for kind in NAR:
    for key, v in NAR[kind].items():
        txt = v["text"]
        low = txt.lower()
        for rx_ in forb:
            if rx_.search(low):
                nerr.append(f"{kind}:{key} forbidden '{rx_.pattern}'")
        if re.search(r"\b(Band|Grade) [A-D]\b", txt):
            nerr.append(f"{kind}:{key} letter grade")
        cited = set(ID_RX.findall(txt))
        rows = []
        if kind == "contractors":
            rows.append(C[C.contractor_id == key].iloc[0].to_dict())
        elif kind == "wards":
            rows.append(WD[WD.ward_code == key].iloc[0].to_dict())
        elif kind == "roads":
            rows.append(Rx.loc[key].to_dict())
        for i_ in set(re.findall(r"WO25-\d{5}", txt)) | ({key} if kind == "cases" and key.startswith("WO25") else set()):
            if i_ not in WOIDS:
                nerr.append(f"{kind}:{key} unknown {i_}")
            else:
                rows.append(wix.loc[i_].to_dict())
                for e_ in F[F.work_order_id == i_].evidence:
                    rows.append(json.loads(e_))
                rows.append({"v": F[F.work_order_id == i_].flag_amount_inr.sum() if "flag_amount_inr" in F else F[F.work_order_id == i_].exposure_inr.sum()})
        for i_ in set(re.findall(r"RD\d{4}", txt)):
            if i_ not in RDIDS:
                nerr.append(f"{kind}:{key} unknown {i_}")
            else:
                rows.append(Rx.loc[i_].to_dict())
        for i_ in set(re.findall(r"BMC25-\d{6}", txt)) | ({key} if kind == "cases" and key.startswith("BMC") else set()):
            if i_ not in ccx.index:
                nerr.append(f"{kind}:{key} unknown {i_}")
            else:
                rows.append(ccx.loc[i_].to_dict())
        if kind == "wards":
            for rid_ in (WD[WD.ward_code == key].iloc[0].top_new_budget_road_id, WD[WD.ward_code == key].iloc[0].top_dlp_road_id):
                if isinstance(rid_, str):
                    rows.append(Rx.loc[rid_].to_dict())
        pool = _num_pool(*rows)
        if v["narrative_author"] == NCFG["authored_tag"]:
            for tok in re.findall(r"\d[\d,]*(?:\.\d+)?", ROADNUM_RX.sub(" ", ID_RX.sub(" ", txt))):
                tok = tok.rstrip(",")
                if tok not in pool and tok not in SAFE:
                    nerr.append(f"{kind}:{key} number '{tok}' not traceable to computed values")
        if kind == "contractors" and v["words"] > NCFG["contractor_max_words"]:
            nerr.append(f"contractor {key} too long: {v['words']}")
        if kind == "wards" and v["narrative_author"] == NCFG["deterministic_tag"] and not (NCFG["ward_words_min"] <= v["words"] <= NCFG["ward_words_max"]):
            nerr.append(f"ward {key} words {v['words']}")
        if kind == "wards" and v["narrative_author"] != NCFG["deterministic_tag"] and not (60 <= v["words"] <= 160):
            nerr.append(f"ward {key} authored words {v['words']}")
for kind in ("wards", "cases", "roads"):
    for key in AUTH.get(kind, {}):
        if key not in NAR[kind]:
            nerr.append(f"authored {kind}:{key} has no matching entity")
NAR["_verification"] = {"errors": nerr, "authored_counts": {k: sum(1 for x in NAR[k].values() if x["narrative_author"] == NCFG["authored_tag"]) for k in ("contractors", "wards", "cases", "roads")},
                        "contractor_word_range": [min(x["words"] for x in NAR["contractors"].values()), max(x["words"] for x in NAR["contractors"].values())],
                        "method": "Showcase narratives authored by Claude Sonnet 5.5 offline from verified pipeline numbers (every number is checked against computed values); remaining wards use deterministic summaries.",
                        "disclosure": CFG["disclosure"], "model_contribution_disclosure": CFG["model_contribution_disclosure"]["text"]}
(ROOT / CFG["paths"]["narratives_file"]).write_text(json.dumps(NAR, ensure_ascii=False, indent=1, allow_nan=False), encoding="utf-8")
if nerr:
    print("NARRATIVE ERRORS:", *nerr, sep="\n  ")
    raise SystemExit("narrative verification failed")
for df_, kind, col in ((C, "contractors", "contractor_id"), (WD, "wards", "ward_code")):
    df_["narrative"] = df_[col].map(lambda k: NAR[kind][k]["text"])
    df_["narrative_author"] = df_[col].map(lambda k: NAR[kind][k]["narrative_author"])
R["narrative"] = R.road_id.map(lambda k: NAR["roads"][k]["text"] if k in NAR["roads"] else None)
R["narrative_author"] = R.road_id.map(lambda k: NAR["roads"][k]["narrative_author"] if k in NAR["roads"] else None)
for k, v in sp.items():
    v["narrative"] = NAR["cases"][v["id"]]["text"]
    v["narrative_author"] = NAR["cases"][v["id"]]["narrative_author"]

# ============================================================ assemble tables + judge exports
W2 = w.copy()
W2["cost_ratio"] = W2.cost_ratio.round(4)
W2["assigned_at"], W2["work_started_at"], W2["completed_at"] = W2.assigned_at.astype(str), W2.work_started_at.astype(str), W2.completed_at.astype(str)
W2 = W2.drop(columns=["expected_sla_by_ll"])
W2["variance_band"] = [variance_band(x, RO["variance_bands"]) if f_ else None for x, f_ in zip(w.cost_ratio, w.rate_card_outlier)]
W2 = W2.rename(columns={"rate_card_outlier": "rate_variance_flag", "excess_inr": "rate_variance_inr", "dedup_exposure_inr": "touched_billed_inr", "n_primary_flags": "primary_review_flag_count"}).drop(columns=["primary_exposure_sum_inr", "in_valley"])
Fx = F.rename(columns={"exposure_inr": "flag_amount_inr"}).drop(columns=["is_primary"])
MK = pd.DataFrame([{"dataset": "Claude-Impact-Labs-data-2", "synthetic": True, "source_repo": CFG["source_repo"], "disclosure": CFG["disclosure"], "config_version": CFG["config_version"], "note": "Hackathon dataset marker. This database has no synthetic_demo_marker table and is not a target of any CP-00 reset routine."}])
W2["engineer_remark_audit_weight"] = 0
CMP = cc[["complaint_id", "received_at", "channel", "category_reported", "description", "language", "locality_text", "source_ward_code", "ward_final", "ward_provenance", "ward_border_review", "locality_ward_mismatch",
          "pip_ward", "gaz_ward", "canon_locality", "lat", "lon", "gps_accuracy_m", "coord_provenance", "lat_final", "lon_final", "photo_description", "resolved_category", "category_source", "category_status",
          "category_unverified_reason", "model_proposal_applied", "status", "linkage_bucket", "linked_work_order_ids", "nearest_road_id", "nearest_road_m", "issue_id", "upvotes", "resolved_at"]].copy()
SOC = S[["post_id", "posted_at", "source", "author_handle", "text", "has_media", "likes_or_forwards", "social_class", "matched_localities", "matched_locality", "matched_ward_code", "matched_road_name", "matched_road_id", "lat", "lon", "coord_provenance", "engagement_weight_used"]].copy()
T = {}


def pt(df, la, lo):
    return [f"SRID=4326;POINT({b:.6f} {a:.6f})" if pd.notna(a) and pd.notna(b) else None for a, b in zip(df[la], df[lo])]


ward_geom = {f["properties"]["ward_code"]: shape(f["geometry"]) for f in wgj["features"]}
road_geom = {f["properties"]["road_id"]: shape(f["geometry"]) for f in rgj["features"]}
WDt = WD.copy()
WDt["geom"] = ["SRID=4326;" + ward_geom[c].wkt for c in WDt.ward_code]
Rt = R.copy()
Rt["geom"] = ["SRID=4326;" + road_geom[c].wkt for c in Rt.road_id]
for c in ("C_obs", "R_obs", "F_obs", "A_obs", "V_obs", "T_obs", "D_obs"):
    Rt[c] = Rt[c].astype(bool)
CMPt = CMP.copy()
CMPt["geom"] = pt(CMPt, "lat_final", "lon_final")
It = I.copy()
It["geom"] = pt(It, "lat", "lon")
St = SOC.copy()
St["geom"] = pt(St, "lat", "lon")
Lt = loc.copy()
Lt["geom"] = pt(Lt, "lat", "lon")
FHt, FAt, ACt = fh.copy(), fac.copy(), acc.copy()
for df_ in (FHt, FAt, ACt):
    df_["geom"] = pt(df_, "lat", "lon")
meta = {"disclosure": CFG["disclosure"], "config_version": CFG["config_version"], "source_repo": CFG["source_repo"], "false_positive_shields": FPS, "spotlight_examples": sp,
        "audit_summary": audit_summary, "linkage_bucket_counts": {k: int(v) for k, v in lc.items()}, "flag_display_labels": F.drop_duplicates("flag_type").set_index("flag_type").display_label.to_dict(),
        "rate_card_threshold": {"operator": RO["operator"], "value": RO["threshold"], "valley_upper": RO["valley_upper"], "evidence": RO["evidence"]},
        "next_rupee_weights": W7, "fairness_weights": FZ["weights"], "engineer_remark_audit_weight": 0, "social_engagement_weight": 0, "warnings": WARN}
meta.update({"hero_amounts": HERO, "unique_touched": audit_summary["_touched"], "overlap_matrix": OVERLAP, "flag_class_counts": {k: int(v) for k, v in TAX.items()},
             "contractor_sensitivity": SENS, "next_rupee_stability": STAB, "methodology_status": NR["methodology_status"], "model_contribution_disclosure": CFG["model_contribution_disclosure"],
             "unit_groups": CFG["unit_groups"], "durability_labels": CFG["durability_labels"], "dlp_lane": NR["dlp_lane"], "issue_treatment_compatibility": CFG["issue_treatment_compatibility"],
             "experimental_accountability_index": {"name": FZ["index_name"], "status": FZ["index_status"], "formula": FZ["index_formula"], "weights": FZ["weights"]},
             "narrative_authorship": NAR["_verification"]["authored_counts"], "variance_bands": RO["variance_bands"]})
MT = pd.DataFrame([{"key": k, "value": json.dumps(v, ensure_ascii=False, default=str, allow_nan=False)} for k, v in meta.items()])
TABLES = {
    "monsoon_wards": (WDt, "geom", "Polygon", "ward_code", ["ward_code", "top_contractor_id"]),
    "monsoon_roads": (Rt, "geom", "LineString", "road_id", ["ward_code", "lane", "under_dlp", "lane_rank"]),
    "monsoon_work_orders": (W2, None, None, "work_order_id", ["ward_code", "road_id", "contractor_id", "rate_variance_flag", "under_dlp", "variance_band"]),
    "monsoon_audit_flags": (Fx, None, None, "flag_id", ["work_order_id", "flag_type", "flag_class", "tier", "ward_code", "contractor_id", "road_id"]),
    "monsoon_contractors": (C, None, None, "contractor_id", []),
    "monsoon_complaints": (CMPt, "geom", "Point", "complaint_id", ["ward_final", "nearest_road_id", "issue_id", "linkage_bucket", "resolved_category", "status"]),
    "monsoon_issues": (It, "geom", "Point", "issue_id", ["ward_code", "nearest_road_id", "category", "issue_status"]),
    "monsoon_social_posts": (St, "geom", "Point", "post_id", ["matched_ward_code", "social_class", "matched_road_id"]),
    "monsoon_flood_hotspots": (FHt, "geom", "Point", "hotspot_id", ["ward_code"]),
    "monsoon_facilities": (FAt, "geom", "Point", "facility_id", ["ward_code", "ambulance_entry_road", "type"]),
    "monsoon_accidents": (ACt, "geom", "Point", "accident_id", ["ward_code", "road_id", "probable_cause"]),
    "monsoon_localities": (Lt, "geom", "Point", "locality", ["ward_code"]),
    "monsoon_rate_card": (mrate.rename(columns={"jobs": "wo_jobs", "reopened": "wo_reopened"}).sort_values(["unit_group", "survival_adjusted_30d_rate_inr"]), None, None, "repair_method", []),
    "monsoon_meta": (MT, None, None, "key", []),
    "hackathon_dataset_marker": (MK, None, None, "dataset", []),
}
manifest = {}
for name, (df, gcol, gtype, pk, idx) in TABLES.items():
    d = df.copy()
    cols = []
    for c in d.columns:
        s_ = d[c]
        if c == gcol:
            t = f"geometry({gtype},4326)"
        elif c in ("evidence", "value"):
            t = "jsonb"
        elif pd.api.types.is_bool_dtype(s_) or (s_.dtype == object and s_.notna().any() and set(s_.dropna().unique()) <= {True, False}):
            t = "boolean"
        elif pd.api.types.is_integer_dtype(s_):
            t = "bigint"
        elif pd.api.types.is_float_dtype(s_):
            t = "double precision"
        elif pd.api.types.is_datetime64_any_dtype(s_):
            t = "timestamp"
        else:
            t = "text"
        cols.append([c, t])
    for c, t in cols:
        if t == "double precision":
            d[c] = d[c].replace([np.inf, -np.inf], np.nan)
    d.to_csv(OUT / f"{name}.csv", index=False, encoding="utf-8")
    manifest[name] = {"columns": cols, "pk": pk, "index": idx, "gist": gcol, "rows": len(d)}
(OUT / "tables_manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")


def no_nan_json(obj):
    return json.dumps(obj, ensure_ascii=False, allow_nan=False, default=str)


def recs(df):
    return [{k: clean_float(v) if not isinstance(v, (np.integer, np.bool_)) else (int(v) if isinstance(v, np.integer) else bool(v)) for k, v in r.items()} for r in df.to_dict("records")]


exp_flags = Fx.copy()
exp_flags["evidence"] = exp_flags.evidence.map(json.loads)
(JUDGE / "audit_flags.json").write_text(no_nan_json(recs(exp_flags)), encoding="utf-8")
Fx.to_csv(JUDGE / "audit_flags.csv", index=False, encoding="utf-8")
PRIM = ["contractor_id", "contractor_name"] + FZ["primary_metrics"] + ["total_spend_inr", "rate_variance_inr", "reopened_30d_spend_inr", "unlinked_wo_count", "touched_billed_inr", "comparative_gate", "sla_non_causal_note", "reopen_context_note"]
C[PRIM].to_csv(JUDGE / "contractor_scorecards.csv", index=False, encoding="utf-8")
C[["contractor_id", "contractor_name", "experimental_accountability_index", "score_durability", "score_billing_integrity", "score_sla_context", "score_dlp_adherence"] + [c_ for c_ in C.columns if c_.startswith("idx_")]].to_csv(JUDGE / "contractor_experimental_index.csv", index=False, encoding="utf-8")
plan_cols = ["lane", "lane_rank", "road_id", "road_name", "ward_code", "road_type", "surface", "under_dlp", "risk_score", "evidence_coverage_pct", "rank_status", "factors_missing", "C_norm", "R_norm", "F_norm", "A_norm", "V_norm", "T_norm", "D_norm",
             "rank_A_balanced", "rank_B_backlog_durability", "rank_C_safety_facility", "rank_D_flood_traffic", "top10_profile_count", "dominant_issue_type", "dominant_issue_basis", "candidate_treatment", "candidate_unit_group", "candidate_30d_reopen_pct",
             "estimated_candidate_cost_inr", "allocation_action", "allocation_note", "affordable_now", "ward_remaining_budget_inr", "potential_spend_avoided_label", "potential_spend_avoided_inr", "potential_spend_avoided_note", "dlp_caveat",
             "top_factors", "action", "reopened_wo_ids", "dlp_surface_review_wo_ids", "methodology_status", "narrative_author"]
PL = R[plan_cols].sort_values(["lane", "lane_rank"])
PL.to_csv(JUDGE / "next_rupee_plan.csv", index=False, encoding="utf-8")
(JUDGE / "next_rupee_plan.json").write_text(no_nan_json(recs(PL)), encoding="utf-8")
WD.drop(columns="narrative").to_csv(JUDGE / "ward_summary.csv", index=False, encoding="utf-8")
(JUDGE / "overview_metadata.json").write_text(no_nan_json({k: v for k, v in meta.items()}), encoding="utf-8")
# NaN / Infinity guard over every export
bad = 0
for p in JUDGE.glob("*.csv"):
    for c in pd.read_csv(p).select_dtypes("number").columns:
        v = pd.read_csv(p)[c]
        bad += int((~np.isfinite(v.dropna())).sum())
    txt = p.read_text(encoding="utf-8")
    bad += len(re.findall(r"(?<![A-Za-z])(NaN|Infinity|-Infinity)(?![A-Za-z])", txt))
for p in JUDGE.glob("*.json"):
    json.loads(p.read_text(encoding="utf-8"), parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))
assert bad == 0, f"NaN/Inf in exports: {bad}"

# ============================================================ console summary + authoring facts
pd.set_option("display.width", 250, "display.max_columns", 40)
print("WARN:", WARN)
print(json.dumps({k: v for k, v in audit_summary.items() if k.startswith("_")}, indent=1, ensure_ascii=False))
print(C[["contractor_id", "jobs_count", "observed_reopen_pct", "expected_reopen_method_mix_pct", "reopen_delta_pts", "sla_met_pct", "low_lying_exposure_pct", "avg_cost_ratio", "rate_variance_count", "duplicate_candidate_count", "dlp_surface_review_count"]].round(2).to_string())
print(json.dumps(SENS, indent=1)[:3000])
print(mrate[["repair_method", "unit_group", "jobs", "reopen_30d_pct", "non_reopen_30d_pct", "standard_rate_inr", "survival_adjusted_30d_rate_inr"]].sort_values(["unit_group", "survival_adjusted_30d_rate_inr"]).to_string())
print(json.dumps(STAB["lanes"], indent=0)[:3500])
print(json.dumps(STAB["overlap_with_recommended_top10"]))
cols = ["lane_rank", "road_id", "road_name", "ward_code", "risk_score", "evidence_coverage_pct", "dominant_issue_type", "candidate_treatment_method", "estimated_candidate_cost_inr", "affordable_now", "top10_profile_count"]
print(R[R.lane == NR["lanes"]["under_dlp_N"]].sort_values("lane_rank")[cols].head(6).to_string())
print(R[R.lane == NR["lanes"]["under_dlp_Y"]].sort_values("lane_rank")[cols + ["potential_spend_avoided_inr"]].head(4).to_string())
print("dominant issue null roads:", int(R.dominant_issue_type.isna().sum()), "rank_status:", R.rank_status.value_counts().to_dict())
print({"wards_spend": int(WD.actual_spend_inr.sum()), "wo_cost": int(w.cost_inr.sum()), "contractor_spend": int(C.total_spend_inr.sum())}, "authored:", NAR["_verification"]["authored_counts"])
facts = {"contractors": recs(C.drop(columns=[c_ for c_ in C.columns if c_.startswith("idx_") or c_.startswith("w_") or c_ in ("narrative",)])),
         "wards": {k: recs(WD[WD.ward_code == k].drop(columns=["narrative"]))[0] for k in SHOWCASE_WARDS},
         "roads": {k: recs(R[R.road_id == k][["road_id", "road_name", "ward_code", "road_type", "surface", "under_dlp", "risk_score", "evidence_coverage_pct", "lane_rank", "top_factors", "dominant_issue_type", "dominant_issue_basis", "candidate_treatment", "estimated_candidate_cost_inr", "affordable_now", "ward_remaining_budget_inr", "emergency_hospitals", "schools", "hotspots_within_radius", "accidents_surface_cause", "reopen_n", "complaints_any_nearby", "C_raw", "top10_profile_count"]])[0] for k in TOP5},
         "cases": {v["id"]: v for v in sp.values()},
         "case_wo_rows": {v["id"]: {k: (None if isinstance(x_, float) and not np.isfinite(x_) else x_) for k, x_ in wix.loc[v["id"]][["ward_code", "road_id", "contractor_id", "repair_method", "work_type", "area_sqm", "cost_inr", "expected_cost_inr", "cost_ratio", "excess_inr", "linked_complaint_ids", "under_dlp", "last_resurfaced", "reopened_within_30d", "sla_met"]].to_dict().items()} for v in sp.values() if v["id"].startswith("WO")},
         "case_flags": {v["id"]: F[F.work_order_id == v["id"]][["flag_type", "public_reason", "evidence"]].to_dict("records") for v in sp.values() if v["id"].startswith("WO")},
         "case_complaint": {v["id"]: {k: (None if isinstance(x_, float) and not np.isfinite(x_) else x_) for k, x_ in ccx.loc[v["id"]][["received_at", "channel", "language", "locality_text", "ward_final", "status", "nearest_road_id", "nearest_road_m", "upvotes", "linkage_bucket", "category_status"]].to_dict().items()} for v in sp.values() if v["id"].startswith("BMC")},
         "hero": HERO, "touched": audit_summary["_touched"], "sensitivity": SENS}
(OUT / "facts_for_authoring.json").write_text(json.dumps(facts, ensure_ascii=False, indent=1, default=str, allow_nan=False), encoding="utf-8")
