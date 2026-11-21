-- Mumbai Civic Lens v1.2.3, P1: synthetic-database marker, derived DLP status and the non-owner application role.

-- 1. Synthetic marker. The CP-00 reset refuses to run unless this row exists and names the connected database.
CREATE TABLE synthetic_demo_marker (
  id text PRIMARY KEY CHECK (id = 'SYN-DEMO-MARKER'),
  record_nature text NOT NULL CHECK (record_nature = 'SYNTHETIC_DEMONSTRATION'),
  checkpoint text NOT NULL CHECK (checkpoint = 'CP-00'),
  database_name text NOT NULL,
  note text NOT NULL
);
INSERT INTO synthetic_demo_marker (id, record_nature, checkpoint, database_name, note)
VALUES ('SYN-DEMO-MARKER', 'SYNTHETIC_DEMONSTRATION', 'CP-00', current_database(),
        'Synthetic demonstration database. Holds no real records. Reset is allowed only for this marked database.');

-- 2. DLP status is derived, never stored: NOT_STARTED before dlp_starts_on (UTC midnight), ACTIVE until the work order's
--    dlp_ends_at (inclusive), EXPIRED afterwards. The evaluation timestamp is always explicit; there is no wall-clock default.
CREATE FUNCTION dlp_status_at(p_work_order text, p_at timestamptz) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
           WHEN p_at < (d.dlp_starts_on::timestamp AT TIME ZONE 'UTC') THEN 'NOT_STARTED'
           WHEN p_at <= w.dlp_ends_at THEN 'ACTIVE'
           ELSE 'EXPIRED'
         END
    FROM dlp_status d JOIN work_orders w ON w.id = d.work_order_id
   WHERE d.work_order_id = p_work_order
$$;

-- 3. Non-owner application role. NOLOGIN here: a login role is granted membership in a later phase, so no secret lives
--    in a migration. The role can read everything, insert and update demonstration records, and append to the lifecycle
--    log. It has no UPDATE, DELETE or TRUNCATE on lifecycle_events and no DELETE or TRUNCATE anywhere.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcl_app') THEN
    CREATE ROLE mcl_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO mcl_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO mcl_app;
GRANT INSERT, UPDATE ON wards, departments, assets, contractors, budgets, tenders, contracts, work_orders, dlp_status,
      issues, jurisdictions, evidence, completion_claims, verifications TO mcl_app;
GRANT INSERT ON corrections, lifecycle_events, idempotency_records TO mcl_app;
GRANT UPDATE (status, adjudication_note, appeal_note, record_version, updated_at) ON corrections TO mcl_app;
GRANT UPDATE ON idempotency_records TO mcl_app;
