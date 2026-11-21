"""H1: (re)create PostGIS database civic_lens_monsoon from pipeline/out and verify it.

Only civic_lens_monsoon is touched; the main app database civic_lens is never opened.
Run: python -X utf8 pipeline/02_load_postgis_monsoon.py   (after 01_build_monsoon_analytics.py)
SQL is piped into psql inside the Podman container, so no Python DB driver is required.
"""
import json
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT / "pipeline" / "config" / "audit_rules.json").read_text(encoding="utf-8"))
PG = CFG["postgis"]
OUT = ROOT / CFG["paths"]["out_dir"]
DB = PG["database"]
assert DB != "civic_lens" and DB.startswith("civic_lens_monsoon"), "refusing to touch any other database"
M = json.loads((OUT / "tables_manifest.json").read_text(encoding="utf-8"))
BASE = ["podman", "exec", "-i"]


def psql(sql=None, db=DB, stdin=None, env=None, user=None, host=False, check=True):
    cmd = BASE + ([f"-e", f"PGPASSWORD={env}"] if env else []) + [PG["container"], "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", user or PG["admin_user"], "-d", db, "-At"]
    if host:
        cmd += ["-h", "127.0.0.1"]
    if sql:
        cmd += ["-c", sql]
    r = subprocess.run(cmd, input=stdin, capture_output=True)
    out, err = r.stdout.decode("utf-8", "replace").strip(), r.stderr.decode("utf-8", "replace").strip()
    if check and r.returncode:
        raise RuntimeError(f"psql failed ({db}): {err[:600]}")
    return out if check else (r.returncode, out, err)


def q(s):
    return '"' + s.replace('"', '""') + '"'


print("recreating", DB)
psql(f"DROP DATABASE IF EXISTS {DB} WITH (FORCE)", db="postgres")
psql(f"CREATE DATABASE {DB}", db="postgres")
psql("CREATE EXTENSION IF NOT EXISTS postgis")
counts = {}
for name, m in M.items():
    cols = ", ".join(f"{q(c)} {t}" for c, t in m["columns"])
    psql(f"CREATE TABLE {name} ({cols})")
    names = ", ".join(q(c) for c, _ in m["columns"])
    data = (OUT / f"{name}.csv").read_bytes()
    psql(f"COPY {name} ({names}) FROM STDIN WITH (FORMAT csv, HEADER true)", stdin=data)
    psql(f"ALTER TABLE {name} ADD PRIMARY KEY ({q(m['pk'])})")
    if m["gist"]:
        psql(f"CREATE INDEX {name}_{m['gist']}_gix ON {name} USING GIST ({m['gist']})")
    for c in m["index"]:
        psql(f"CREATE INDEX {name}_{c.replace('/', '_')}_ix ON {name} ({q(c)})")
    psql(f"ANALYZE {name}")
    counts[name] = int(psql(f"SELECT count(*) FROM {name}"))
    assert counts[name] == m["rows"], f"{name}: loaded {counts[name]} != expected {m['rows']}"
    print(f"  {name:<24}{counts[name]:>6}")
# grants: read-only for mcl_app; mcl_api may connect and SET ROLE mcl_app (membership already exists cluster-wide)
psql(f"REVOKE ALL ON DATABASE {DB} FROM PUBLIC")
psql(f"GRANT CONNECT ON DATABASE {DB} TO {PG['login_role']}, {PG['read_role']}")
psql(f"GRANT USAGE ON SCHEMA public TO {PG['read_role']}")
psql(f"GRANT SELECT ON ALL TABLES IN SCHEMA public TO {PG['read_role']}")
psql(f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO {PG['read_role']}")

# ---------------------------------------------------------------- reconciliation
res = {}
spend = psql("SELECT (SELECT sum(actual_spend_inr) FROM monsoon_wards), (SELECT sum(cost_inr) FROM monsoon_work_orders), (SELECT sum(total_spend_inr) FROM monsoon_contractors)")
a, b, c = [int(float(x)) for x in spend.split("|")]
assert a == b == c, f"spend mismatch {a} {b} {c}"
res["spend_wards_wo_contractors_inr"] = [a, b, c]
for t in ("monsoon_wards", "monsoon_roads"):
    bad = int(psql(f"SELECT count(*) FROM {t} WHERE NOT ST_IsValid(geom) OR geom IS NULL"))
    assert bad == 0, f"{t}: {bad} invalid geometries"
    res[f"{t}_valid_geom"] = counts[t]
res["flag_rows_by_type"] = dict(x.split("|") for x in psql("SELECT flag_type, count(*) FROM monsoon_audit_flags GROUP BY 1 ORDER BY 1").splitlines())
res["complaints_unresolved_coords_have_null_geom"] = int(psql("SELECT count(*) FROM monsoon_complaints WHERE coord_provenance='UNRESOLVED' AND geom IS NOT NULL")) == 0
assert res["complaints_unresolved_coords_have_null_geom"]
res["gist_indexes"] = int(psql("SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexdef ILIKE '%USING gist%'"))
res["total_indexes"] = int(psql("SELECT count(*) FROM pg_indexes WHERE schemaname='public'"))

# ---------------------------------------------------------------- mcl_api -> SET ROLE mcl_app (read-only) proof
pw = None
for line in (ROOT / ".env.local").read_text(encoding="utf-8").splitlines():
    if line.startswith("APP_DATABASE_URL="):
        pw = unquote(urlparse(line.split("=", 1)[1].strip()).password or "")
        break
if pw:
    ok = psql("SET ROLE mcl_app; SELECT count(*) FROM monsoon_wards;", user=PG["login_role"], env=pw, host=True, check=False)
    res["mcl_api_set_role_mcl_app_select"] = {"rc": ok[0], "out": ok[1]}
    assert ok[0] == 0 and ok[1].splitlines()[-1] == str(counts["monsoon_wards"]), f"mcl_api read proof failed: {ok[2][:200]}"
    w = psql("SET ROLE mcl_app; DELETE FROM monsoon_wards;", user=PG["login_role"], env=pw, host=True, check=False)
    res["mcl_api_write_attempt"] = {"rc": w[0], "denied": "permission denied" in w[2]}
    assert w[0] != 0 and "permission denied" in w[2], "write was not denied!"
    direct = psql("SELECT count(*) FROM monsoon_wards", user=PG["login_role"], env=pw, host=True, check=False)
    res["mcl_api_direct_without_set_role"] = {"rc": direct[0], "denied": "permission denied" in direct[2]}
else:
    res["mcl_api_proof"] = "SKIPPED: APP_DATABASE_URL not found in .env.local"
# ---------------------------------------------------------------- H1V isolation proofs (real psql checks)
tables = psql("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'spatial_ref_sys' ORDER BY 1").splitlines()
res["tables"] = {"count": len(tables), "names": tables}
assert len(tables) == 15 and "hackathon_dataset_marker" in tables, tables
res["marker_row"] = psql("SELECT dataset || '|' || synthetic::text FROM hackathon_dataset_marker")
assert res["marker_row"] == "Claude-Impact-Labs-data-2|true"
res["synthetic_demo_marker_exists"] = psql("SELECT to_regclass('public.synthetic_demo_marker') IS NOT NULL") == "t"
assert not res["synthetic_demo_marker_exists"], "synthetic_demo_marker must not exist in the hackathon database"
priv = lambda role, p_: int(psql("SELECT count(*) FROM pg_tables t WHERE schemaname='public' AND tablename <> 'spatial_ref_sys' AND has_table_privilege('%s', format('%%I.%%I', schemaname, tablename), '%s')" % (role, p_)))  # noqa: E731
res["privilege_counts_over_the_15_tables"] = {r_: {p_: priv(r_, p_) for p_ in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE")} for r_ in (PG["login_role"], PG["read_role"], "mcl_command", "mcl_api_write", "mcl_reset", "mcl_api_reset")}
pc = res["privilege_counts_over_the_15_tables"]
assert pc[PG["login_role"]]["SELECT"] == 0, "mcl_api must have no direct table access"
assert pc[PG["read_role"]]["SELECT"] >= 15 and all(pc[PG["read_role"]][k] == 0 for k in ("INSERT", "UPDATE", "DELETE", "TRUNCATE")), "mcl_app must be read-only"
for r_ in ("mcl_command", "mcl_api_write", "mcl_reset", "mcl_api_reset"):
    assert all(pc[r_][k] == 0 for k in ("INSERT", "UPDATE", "DELETE", "TRUNCATE")), f"{r_} has write privilege"
res["mcl_command_database_connect"] = psql("SELECT has_database_privilege('mcl_command', current_database(), 'CONNECT')") == "t"
# real attempted writes under each non-owner role (superuser SET ROLE) must all be denied
denied = {}
for r_ in ("mcl_app", "mcl_command", "mcl_api_write"):
    for stmt in ("INSERT INTO hackathon_dataset_marker (dataset, synthetic) VALUES ('x', false)", "UPDATE monsoon_wards SET ward_name = ward_name", "DELETE FROM monsoon_work_orders", "TRUNCATE monsoon_roads"):
        rc, _, err = psql(f"SET ROLE {r_}; {stmt}", check=False)
        denied[f"{r_}:{stmt.split()[0]}"] = bool(rc != 0 and "permission denied" in err)
res["write_attempts_denied"] = denied
assert all(denied.values()), denied
if pw:
    allsel = {}
    for t in tables:
        rc, out, err = psql(f"SET ROLE mcl_app; SELECT count(*) FROM {t};", user=PG["login_role"], env=pw, host=True, check=False)
        allsel[t] = int(out.splitlines()[-1]) if rc == 0 else f"ERR {err[:60]}"
    res["mcl_api_set_role_mcl_app_select_all_tables"] = allsel
    assert all(isinstance(v, int) and v == counts.get(t, v) for t, v in allsel.items()), allsel
    direct_all = {t: ("permission denied" in psql(f"SELECT count(*) FROM {t}", user=PG["login_role"], env=pw, host=True, check=False)[2]) for t in tables}
    res["mcl_api_direct_denied_all_tables"] = all(direct_all.values())
    assert all(direct_all.values()), direct_all
print(json.dumps(res, indent=1))
(OUT / "load_report.json").write_text(json.dumps({"counts": counts, **res}, indent=1), encoding="utf-8")
sys.exit(0)
