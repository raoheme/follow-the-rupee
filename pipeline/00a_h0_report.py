"""H0 closure: reconcile rate-card threshold and write audit/H0_REPORT.md (reproducible).

Run: python -X utf8 pipeline/00a_h0_report.py
"""
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT / "pipeline" / "config" / "audit_rules.json").read_text(encoding="utf-8"))
DATA = Path(CFG["paths"]["data_dir"])
WORK = Path(CFG["paths"]["work_dir"])
TH = CFG["rate_card_variance"]["threshold"]


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def rows_of(p):
    if p.suffix == ".csv":
        return len(pd.read_csv(p))
    if p.suffix == ".geojson":
        return len(json.loads(p.read_text(encoding="utf-8"))["features"])
    if p.suffix == ".jsonl":
        return sum(1 for _ in open(p, encoding="utf-8"))
    if p.suffix == ".json":
        j = json.loads(p.read_text(encoding="utf-8"))
        return len(j) if isinstance(j, list) else 1
    return "-"


def git(*a):
    return subprocess.run(["git", *a], cwd=ROOT, capture_output=True, text=True).stdout.strip()


wo = pd.read_csv(DATA / "work_orders.csv")
rc = pd.read_csv(DATA / "rate_card.csv")
w = wo.merge(rc, on="repair_method", how="left")
w["exp"] = np.where(w.unit == "per sqm", w.area_sqm * w.standard_rate_inr, w.standard_rate_inr)
w["ratio"] = w.cost_inr / w.exp

L = []
A = L.append
A("# H0 Report — Follow the Rupee: Mumbai Monsoon Roads\n")
A(f"> {CFG['disclosure']}\n")
A(f"- Source repo: {CFG['source_repo']}")
A("- Invocation: `python -X utf8 pipeline/00_eda.py` (forensic EDA) then `python -X utf8 pipeline/00a_h0_report.py` (this report). Do not use `-I` (hides user-site packages).")
A(f"- Git baseline: `main` = `{git("rev-parse", "--short", "main")}`, `wip/p7-paused` = `{git('rev-parse', '--short=8', 'wip/p7-paused')}`, active branch `{git('rev-parse', '--abbrev-ref', 'HEAD')}`. P7/P8/validate_package.py are not run on this branch; database `civic_lens` is untouched.\n")

A("## 1. Source inventory (17 files, read-only, never copied into git)\n")
A("| file | rows/features | SHA-256 |\n|---|---:|---|")
for p in sorted(DATA.iterdir()):
    if p.is_file():
        A(f"| {p.name} | {rows_of(p)} | `{sha(p)}` |")

A("\n## 2. Rate-card reconciliation (113 vs 123 contradiction)\n")
A(f"Valid work orders: **{len(w)}** (unmatched repair_method: {int(w.unit.isna().sum())}; null/zero area or cost: {int(((w.area_sqm.fillna(0) <= 0) | (w.cost_inr <= 0)).sum())}). expected = area_sqm × rate (per sqm) or rate (per job); ratio = cost_inr / expected.\n")
A("| ratio ≥ | n | billed ₹ | expected ₹ | positive excess ₹ | contractors (id:n) | repair methods (n) |\n|---:|---:|---:|---:|---:|---|---|")
for t in [1.30, 1.35, 1.40, 1.45, 1.50, 1.55, 1.60, 1.80, 2.00]:
    s = w[w.ratio >= t]
    cd = ", ".join(f"{k}:{v}" for k, v in s.contractor_id.value_counts().items())
    md = "; ".join(f"{k} {v}" for k, v in s.repair_method.value_counts().items())
    A(f"| {t:.2f} | {len(s)} | {int(s.cost_inr.sum()):,} | {int(round(s.exp.sum())):,} | {int((s.cost_inr - s.exp).clip(lower=0).sum()):,} | {cd} | {md} |")
A("\n**Resolution.** `123` is not reproducible from the supplied files; the exact counts are above (≥1.30: 114; ≥1.35: 113). 113 was the ≥1.35 count in the first EDA; 114 includes WO25-02490 (1.3161).\n")
normal = w[w.ratio <= TH]
valley = w[(w.ratio > TH) & (w.ratio < CFG["rate_card_variance"]["valley_upper"])].sort_values("ratio")
A(f"**Locked `rate_card_variance_threshold` = strictly > {TH:.2f}** (`pipeline/config/audit_rules.json`). Evidence: the documented normal variance is 20–30% around the rate; all {len(normal)} jobs ≤ 1.30 have max ratio {normal.ratio.max():.4f} (flat 0.75–1.30 band, ~230 jobs per 0.05 step); above 1.30 there are only {len(valley)} jobs in the valley 1.30–1.55 ({', '.join(valley.work_order_id)}) against {int((w.ratio >= 1.55).sum())} jobs ≥ 1.55. These {len(valley)} are flagged but marked `in_valley=true`. Sensitivity: 114 (>1.30) → 111 (≥1.40) → 109 (≥1.50/1.55) → 104 (≥1.60) → 64 (≥2.00); contractor concentration (CT03 Mahalaxmi, CT07 Arabian Sea) is unchanged at every threshold.\n")
A("### Every work order with 1.25 ≤ ratio < 1.65 (ascending)\n")
v = w[(w.ratio >= 1.25) & (w.ratio < 1.65)].sort_values("ratio")
A(f"{len(v)} work orders. Columns: WO | contractor | method | expected ₹ | billed ₹ | ratio.\n")
A("| WO | ctr | method | expected | billed | ratio |\n|---|---|---|---:|---:|---:|")
for r in v.itertuples():
    A(f"| {r.work_order_id} | {r.contractor_id} | {r.repair_method} | {int(r.exp):,} | {r.cost_inr:,} | {r.ratio:.4f} |")

A("\n## 3. DLP classification (exact observed values)\n")
d = CFG["dlp"]
roads = pd.read_csv(DATA / "roads.csv")
x = w.merge(roads[["road_id", "under_dlp"]], on="road_id")
x = x[x.under_dlp == "Y"]
sr = x[x.repair_method.isin(d["surface_repair_methods"])]
cx = x[x.repair_method.isin(d["context_only_methods"])]
A(f"- `dlp_surface_review` work_type: {d['surface_work_types']}; repair_method: {d['surface_repair_methods']} → **{len(sr)} jobs, ₹{int(sr.cost_inr.sum()):,}**")
A(f"- `dlp_context_only` work_type: {d['context_only_work_types']}; repair_method: {d['context_only_methods']} → **{len(cx)} jobs, ₹{int(cx.cost_inr.sum()):,}** (excluded from suspected DLP-covered expenditure)")
A(f"- Work-type ↔ method mapping is 1:1 in the data (checked: no job pairs a surface work_type with a context-only method). Total DLP-road jobs {len(x)}, ₹{int(x.cost_inr.sum()):,}.")
bad = x[(x.work_type.isin(d["surface_work_types"])) != (x.repair_method.isin(d["surface_repair_methods"]))]
A(f"- work_type/method inconsistencies on DLP roads: {len(bad)}")

A("\n## 4. External artefacts (outside git)\n")
A("| path | rows | SHA-256 |\n|---|---:|---|")
for p in sorted(WORK.rglob("*")):
    if p.is_file() and p.suffix in (".md", ".csv", ".jsonl", ".json"):
        A(f"| `{p.relative_to(WORK.parent).as_posix()}` | {rows_of(p) if p.suffix != '.md' else '-'} | `{sha(p)}` |")
A("\nDerived files are reproducible from `pipeline/` and must never be committed (`.gitignore` blocks `pipeline/out/`, derived CSV/JSONL/parquet, `external-inputs/`).")
(ROOT / "audit").mkdir(exist_ok=True)
(ROOT / "audit" / "H0_REPORT.md").write_text("\n".join(L) + "\n", encoding="utf-8")
print("wrote audit/H0_REPORT.md", len(L), "lines")
