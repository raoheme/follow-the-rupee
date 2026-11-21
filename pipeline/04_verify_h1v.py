"""H1V closure verification: settled analytical assertions + civic_lens_monsoon isolation proofs.
Read-only against civic_lens_monsoon (plus read-only catalog/mcl-seed verify for civic_lens). Writes pipeline/out/h1v_verify.json.
Run: python -X utf8 pipeline/04_verify_h1v.py
"""
import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT / "pipeline" / "config" / "audit_rules.json").read_text(encoding="utf-8"))
PG = CFG["postgis"]
DB = PG["database"]
OUT = ROOT / CFG["paths"]["out_dir"]
RES = {"checks": {}, "failures": []}


def psql(sql, db=DB, user=None, pw=None, host=False):
    cmd = ["podman", "exec", "-i"] + (["-e", f"PGPASSWORD={pw}"] if pw else []) + [PG["container"], "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", user or PG["admin_user"], "-d", db, "-At"] + (["-h", "127.0.0.1"] if host else []) + ["-c", sql]
    r = subprocess.run(cmd, capture_output=True)
    return r.returncode, r.stdout.decode("utf-8", "replace").strip(), r.stderr.decode("utf-8", "replace").strip()


def q(sql, **kw):
    rc, out, err = psql(sql, **kw)
    assert rc == 0, f"{sql[:80]} -> {err[:200]}"
    return out


def check(name, cond, detail):
    RES["checks"][name] = {"pass": bool(cond), "detail": detail}
    if not cond:
        RES["failures"].append(name)


env = {}
for line in (ROOT / ".env.local").read_text(encoding="utf-8").splitlines():
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
pw = unquote(urlparse(env["APP_DATABASE_URL"]).password or "")

# ------------------------------------------------------------ A. identity
check("A1 current_database", q("select current_database()") == DB, DB)
check("A2 hackathon_dataset_marker exactly once", q("select count(*) from hackathon_dataset_marker") == "1" and q("select count(*) from pg_tables where tablename='hackathon_dataset_marker'") == "1", q("select dataset||'|'||synthetic from hackathon_dataset_marker"))
check("A3 synthetic_demo_marker absent", q("select count(*) from pg_class where relname='synthetic_demo_marker'") == "0", "no relation named synthetic_demo_marker in any schema")
tables = q("select tablename from pg_tables where schemaname='public' and tablename<>'spatial_ref_sys' order by 1").splitlines()
check("A4 15 expected tables", len(tables) == 15, tables)

# ------------------------------------------------------------ B. read identity
rc, out, err = psql("select count(*) from monsoon_wards", user=PG["login_role"], pw=pw, host=True)
check("B1 mcl_api direct SELECT denied", rc != 0 and "permission denied" in err, err[:80])
sel = {}
for t in tables:
    rc, out, err = psql(f"set role mcl_app; select count(*) from {t}", user=PG["login_role"], pw=pw, host=True)
    sel[t] = int(out.splitlines()[-1]) if rc == 0 else err[:60]
check("B2 mcl_api SET ROLE mcl_app SELECT all 15", all(isinstance(v, int) for v in sel.values()) and len(sel) == 15, sel)
wr = {}
for stmt in ("insert into hackathon_dataset_marker(dataset, synthetic) values ('x', false)", "update monsoon_wards set ward_name = ward_name", "delete from monsoon_work_orders", "truncate monsoon_roads",
             "create table public.zz_ddl_probe(a int)", "alter table monsoon_wards add column zz int", "drop table monsoon_rate_card", "create index zz_ix on monsoon_wards(ward_code)"):
    rc, out, err = psql("set role mcl_app; " + stmt, user=PG["login_role"], pw=pw, host=True)
    wr[stmt.split()[0] + " " + stmt.split()[1]] = bool(rc != 0 and "permission denied" in err or "must be owner" in err)
check("B3 mcl_app (via mcl_api) cannot INSERT/UPDATE/DELETE/TRUNCATE or run DDL", all(wr.values()), wr)
rc, out, err = psql("create table public.zz_ddl_probe(a int)", user=PG["login_role"], pw=pw, host=True)
check("B4 mcl_api direct DDL denied", rc != 0, err[:80])
check("B5 no probe objects created", q("select count(*) from pg_class where relname like 'zz_%'") == "0", "0")

# ------------------------------------------------------------ C. command identity
pc = {}
for r_ in ("mcl_command", "mcl_api_write"):
    pc[r_] = {p: int(q(f"select count(*) from pg_tables t where schemaname='public' and tablename<>'spatial_ref_sys' and has_table_privilege('{r_}', format('%I.%I', schemaname, tablename), '{p}')")) for p in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE")}
check("C1 mcl_command no write on any monsoon table", all(pc["mcl_command"][p] == 0 for p in ("INSERT", "UPDATE", "DELETE", "TRUNCATE")), pc["mcl_command"])
check("C2 mcl_api_write no effective write authority", all(pc["mcl_api_write"][p] == 0 for p in ("INSERT", "UPDATE", "DELETE", "TRUNCATE")), pc["mcl_api_write"])
mem = q("select string_agg(r.rolname||'->'||m.rolname||'(set='||a.set_option||',inherit='||a.inherit_option||')', '; ') from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member where m.rolname in ('mcl_api','mcl_api_write','mcl_command')")
check("C3 role memberships reviewed", True, mem)
check("C4 mcl_api cannot SET ROLE to a write role", q("select pg_has_role('mcl_api','mcl_command','MEMBER') or pg_has_role('mcl_api','mcl_api_write','MEMBER') or pg_has_role('mcl_api','mcl_reset','MEMBER')") == "f", "no membership in mcl_command/mcl_api_write/mcl_reset")
check("C5 mcl_command / mcl_api_write cannot CONNECT", q("select has_database_privilege('mcl_command', current_database(), 'CONNECT') or has_database_privilege('mcl_api_write', current_database(), 'CONNECT')") == "f", "CONNECT false")

# ------------------------------------------------------------ D. reset isolation
check("D1 reset routine absent in civic_lens_monsoon", q("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname not in ('pg_catalog','information_schema') and p.proname ilike '%reset%'") == "0"
      and q("select to_regprocedure('reset_synthetic_demo_to_cp00()') is null") == "t", "no non-system function containing 'reset'; reset_synthetic_demo_to_cp00 not registered")
check("D2 reset roles cannot connect/execute here", q("select has_database_privilege('mcl_reset', current_database(), 'CONNECT') or has_database_privilege('mcl_api_reset', current_database(), 'CONNECT')") == "f", "CONNECT false for mcl_reset and mcl_api_reset")
m = subprocess.run(["git", "show", "wip/p7-paused:migrations/0004_reset_cp00_routine.sql"], cwd=ROOT, capture_output=True, text=True).stdout
hits = [ln.strip()[:140] for ln in m.splitlines() if re.search(r"synthetic_demo_marker|current_database|civic_lens", ln)]
check("D3 parked P7 routine is gated on synthetic_demo_marker / current database (static review of wip/p7-paused)", len(hits) > 0, hits[:6])
main_rs = subprocess.run(["git", "show", "e456b87:crates/api/src/main.rs"], cwd=ROOT, capture_output=True, text=True).stdout
check("D4 serving API reads APP_* URLs, not the owner DATABASE_URL (static review of main.rs at e456b87)", "APP_DATABASE_URL" in main_rs and not re.search(r'env::var\("DATABASE_URL"\)', main_rs),
      {"APP_DATABASE_URL referenced": "APP_DATABASE_URL" in main_rs, "plain DATABASE_URL read": bool(re.search(r'env::var\("DATABASE_URL"\)', main_rs))})
roles = {k: urlparse(v).username for k, v in env.items() if k.startswith("APP_") and k.endswith("_URL")}
check("D5 no owner role in serving credentials", "civic" not in roles.values(), roles)

# ------------------------------------------------------------ E. original prototype
p = subprocess.run([str(ROOT / "target" / "debug" / "mcl-seed.exe"), "verify"], cwd=ROOT, capture_output=True, text=True)
CP00 = "967586872548df061a9035ef72b44a93ac937ccf4dcea74b22d2f85cc562989c"
check("E1 civic_lens CP-00 digest", p.returncode == 0 and CP00 in p.stdout and "baseline matches CP-00" in p.stdout, p.stdout.strip().splitlines())

# ------------------------------------------------------------ analytical assertions
def n(sql):
    return int(float(q(sql)))


exp = {"wards": (24, "select count(*) from monsoon_wards"), "roads": (291, "select count(*) from monsoon_roads"), "work_orders": (2499, "select count(*) from monsoon_work_orders"),
       "complaints": (6501, "select count(*) from monsoon_complaints"), "social_posts": (650, "select count(*) from monsoon_social_posts"),
       "total_spend_inr_work_orders": (134328183, "select sum(cost_inr) from monsoon_work_orders"), "total_spend_inr_wards": (134328183, "select sum(actual_spend_inr) from monsoon_wards"),
       "total_spend_inr_contractors": (134328183, "select sum(total_spend_inr) from monsoon_contractors"),
       "RATE_CARD_VARIANCE_REVIEW": (114, "select count(*) from monsoon_audit_flags where flag_type='RATE_CARD_VARIANCE_REVIEW'"),
       "HIGH_CONFIDENCE_DUPLICATE_CANDIDATE": (45, "select count(*) from monsoon_audit_flags where flag_type='HIGH_CONFIDENCE_DUPLICATE_CANDIDATE'"),
       "UNLINKED_WORK_ORDER": (45, "select count(*) from monsoon_audit_flags where flag_type='UNLINKED_WORK_ORDER'"),
       "DLP_SURFACE_REPAIR_REVIEW": (274, "select count(*) from monsoon_audit_flags where flag_type='DLP_SURFACE_REPAIR_REVIEW'"),
       "DLP_CONTEXT_ONLY": (219, "select count(*) from monsoon_audit_flags where flag_type='DLP_CONTEXT_ONLY'"),
       "REOPENED_WITHIN_30D": (611, "select count(*) from monsoon_audit_flags where flag_type='REOPENED_WITHIN_30D'"),
       "SLA_MISSED": (1259, "select count(*) from monsoon_audit_flags where flag_type='SLA_MISSED'"),
       "total_classified_indicators": (2570, "select count(*) from monsoon_audit_flags"),
       "PRIMARY_REVIEW_FLAG": (433, "select count(*) from monsoon_audit_flags where flag_class='PRIMARY_REVIEW_FLAG'"),
       "TRACEABILITY_GAP": (45, "select count(*) from monsoon_audit_flags where flag_class='TRACEABILITY_GAP'"),
       "CONTEXT_INDICATOR": (222, "select count(*) from monsoon_audit_flags where flag_class='CONTEXT_INDICATOR'"),
       "OUTCOME_INDICATOR": (1870, "select count(*) from monsoon_audit_flags where flag_class='OUTCOME_INDICATOR'"),
       "flags_with_null_class": (0, "select count(*) from monsoon_audit_flags where flag_class is null"),
       "unique_wo_touched_by_primary": (415, "select count(*) from monsoon_work_orders where primary_review_flag_count>0"),
       "unique_billed_value_touched_inr": (21771311, "select sum(cost_inr) from monsoon_work_orders where primary_review_flag_count>0"),
       "rate_card_calculated_variance_inr": (6066314, "select sum(flag_amount_inr) from monsoon_audit_flags where flag_type='RATE_CARD_VARIANCE_REVIEW'"),
       "duplicate_candidate_billed_inr": (2590652, "select sum(billed_cost_inr) from monsoon_audit_flags where flag_type='HIGH_CONFIDENCE_DUPLICATE_CANDIDATE'"),
       "dlp_surface_billed_inr": (8729314, "select sum(billed_cost_inr) from monsoon_audit_flags where flag_type='DLP_SURFACE_REPAIR_REVIEW'"),
       "wo_with_cost_gt_1.30x_expected (recomputed from cost_inr, expected_cost_inr)": (114, "select count(*) from monsoon_work_orders where cost_inr > 1.30 * expected_cost_inr"),
       "variance_flagged_wo_with_ratio<=1.30 (must be 0)": (0, "select count(*) from monsoon_work_orders where rate_variance_flag and cost_inr <= 1.30 * expected_cost_inr"),
       "unflagged_wo_with_ratio>1.30 (must be 0)": (0, "select count(*) from monsoon_work_orders where not rate_variance_flag and cost_inr > 1.30 * expected_cost_inr"),
       "duplicate_candidates_also_unlinked": (45, "select count(*) from monsoon_audit_flags d join monsoon_audit_flags u on u.work_order_id=d.work_order_id and u.flag_type='UNLINKED_WORK_ORDER' where d.flag_type='HIGH_CONFIDENCE_DUPLICATE_CANDIDATE'"),
       "invalid_ward_or_road_geometries": (0, "select (select count(*) from monsoon_wards where not st_isvalid(geom))+(select count(*) from monsoon_roads where not st_isvalid(geom))")}
for k, (want, sql) in exp.items():
    got = n(sql)
    check(f"X {k}", got == want, {"expected": want, "actual": got})
RES["flag_type_counts"] = dict(x.split("|") for x in q("select flag_type||'|'||count(*) from monsoon_audit_flags group by flag_type order by 1").splitlines())
RES["variance_band_counts"] = dict(x.split("|") for x in q("select variance_band||'|'||count(*) from monsoon_audit_flags where flag_type='RATE_CARD_VARIANCE_REVIEW' group by variance_band order by variance_band").splitlines())
RES["lane_counts"] = dict(x.split("|") for x in q("select lane||'|'||count(*) from monsoon_roads group by lane").splitlines())
RES["passed"] = len(RES["checks"]) - len(RES["failures"])
RES["total_checks"] = len(RES["checks"])
(OUT / "h1v_verify.json").write_text(json.dumps(RES, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
print(f"{RES['passed']}/{RES['total_checks']} checks passed; failures: {RES['failures']}")
sys.exit(1 if RES["failures"] else 0)
