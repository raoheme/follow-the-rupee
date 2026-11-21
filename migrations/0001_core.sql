-- Mumbai Civic Lens v1.2.3, P1 core schema (PostgreSQL 17 + PostGIS 3.5).
-- Synthetic demonstration data only. Column set mirrors schemas/*.schema.json (camelCase -> snake_case);
-- mcl-infrastructure tests assert that every seed key maps to a column.
-- Geometry: GeoJSON-compatible, stored as EPSG:4326 [longitude, latitude]; metre work uses geography or EPSG:32643.
-- Money: integer paise (domain paise). Timestamps: timestamptz (UTC). Calendar dates: date.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE DOMAIN syn_id AS text CHECK (VALUE ~ '^SYN-DEMO-[A-Z0-9][A-Z0-9-]*$');
CREATE DOMAIN paise AS bigint CHECK (VALUE >= 0 AND VALUE <= 9007199254740991);

CREATE TABLE wards (
  id syn_id PRIMARY KEY,
  record_nature text NOT NULL,
  source_tier text NOT NULL,
  record_version integer NOT NULL,
  updated_at timestamptz NOT NULL,
  code text NOT NULL,
  display_name text NOT NULL,
  locality_label text NOT NULL,
  role text NOT NULL,
  elected_oversight_note text NOT NULL,
  boundary geometry(Polygon,4326) NOT NULL,
  boundary_nature text NOT NULL,
  boundary_note text NOT NULL,
  CONSTRAINT wards_chk_1 CHECK (record_nature = 'SYNTHETIC_DEMONSTRATION'),
  CONSTRAINT wards_chk_2 CHECK (source_tier IN ('SYNTHETIC_DEMO', 'COMMUNITY_REFERENCE', 'OFFICIAL_SOURCE_PENDING')),
  CONSTRAINT wards_chk_3 CHECK (record_version >= 1),
  CONSTRAINT wards_chk_4 CHECK (code ~ '^[A-Z](/[A-Z])?$'),
  CONSTRAINT wards_chk_5 CHECK (char_length(display_name) BETWEEN 1 AND 120),
  CONSTRAINT wards_chk_6 CHECK (char_length(locality_label) BETWEEN 1 AND 160),
  CONSTRAINT wards_chk_7 CHECK (role IN ('PRIMARY_DEMONSTRATION', 'SCALE_PREVIEW')),
  CONSTRAINT wards_chk_8 CHECK (char_length(elected_oversight_note) BETWEEN 1 AND 400),
  CONSTRAINT wards_chk_9 CHECK (ST_IsValid(boundary)),
  CONSTRAINT wards_chk_10 CHECK (ST_SRID(boundary) = 4326),
  CONSTRAINT wards_chk_11 CHECK (ST_Within(boundary, ST_MakeEnvelope(72.77, 18.89, 72.99, 19.275, 4326))),
  CONSTRAINT wards_chk_12 CHECK (boundary_nature = 'SYNTHETIC_ILLUSTRATIVE_BOX'),
  CONSTRAINT wards_chk_13 CHECK (char_length(boundary_note) BETWEEN 1 AND 300)
);

CREATE TABLE departments (
  id syn_id PRIMARY KEY,
  record_nature text NOT NULL,
  source_tier text NOT NULL,
  record_version integer NOT NULL,
  updated_at timestamptz NOT NULL,
  kind text NOT NULL,
  display_name text NOT NULL,
  ward_id syn_id,
  post_titles text[] NOT NULL,
  scope_summary text NOT NULL,
  CONSTRAINT departments_ward_id_fk FOREIGN KEY (ward_id) REFERENCES wards (id),
  CONSTRAINT departments_chk_1 CHECK (record_nature = 'SYNTHETIC_DEMONSTRATION'),
  CONSTRAINT departments_chk_2 CHECK (source_tier IN ('SYNTHETIC_DEMO', 'COMMUNITY_REFERENCE', 'OFFICIAL_SOURCE_PENDING')),
  CONSTRAINT departments_chk_3 CHECK (record_version >= 1),
  CONSTRAINT departments_chk_4 CHECK (kind IN ('CENTRAL_DEPARTMENT', 'WARD_OFFICE')),
  CONSTRAINT departments_chk_5 CHECK (char_length(display_name) BETWEEN 1 AND 120),
  CONSTRAINT departments_chk_6 CHECK (cardinality(post_titles) >= 1),
  CONSTRAINT departments_chk_7 CHECK (char_length(scope_summary) BETWEEN 1 AND 300)
);

CREATE TABLE assets (
  id syn_id PRIMARY KEY,
  record_nature text NOT NULL,
  source_tier text NOT NULL,
  record_version integer NOT NULL,
  updated_at timestamptz NOT NULL,
  asset_type text NOT NULL,
  display_name text NOT NULL,
  street_name text NOT NULL,
  corridor_name text,
  nearby_landmark text NOT NULL,
  geometry geometry(Geometry,4326) NOT NULL,
  ward_candidate_id syn_id,
  responsible_department_id syn_id NOT NULL,
  CONSTRAINT assets_ward_candidate_id_fk FOREIGN KEY (ward_candidate_id) REFERENCES wards (id),
  CONSTRAINT assets_responsible_department_id_fk FOREIGN KEY (responsible_department_id) REFERENCES departments (id),
  CONSTRAINT assets_chk_1 CHECK (record_nature = 'SYNTHETIC_DEMONSTRATION'),
  CONSTRAINT assets_chk_2 CHECK (source_tier IN ('SYNTHETIC_DEMO', 'COMMUNITY_REFERENCE', 'OFFICIAL_SOURCE_PENDING')),
  CONSTRAINT assets_chk_3 CHECK (record_version >= 1),
  CONSTRAINT assets_chk_4 CHECK (asset_type IN ('ROAD_SEGMENT', 'DRAIN_SEGMENT', 'SCHOOL', 'DISPENSARY')),
  CONSTRAINT assets_chk_5 CHECK (char_length(display_name) BETWEEN 1 AND 160),
  CONSTRAINT assets_chk_6 CHECK (char_length(street_name) BETWEEN 1 AND 120),
  CONSTRAINT assets_chk_7 CHECK (char_length(corridor_name) BETWEEN 1 AND 120),
  CONSTRAINT assets_chk_8 CHECK (char_length(nearby_landmark) BETWEEN 1 AND 160),
  CONSTRAINT assets_chk_9 CHECK (ST_IsValid(geometry)),
  CONSTRAINT assets_chk_10 CHECK (ST_SRID(geometry) = 4326),
  CONSTRAINT assets_chk_11 CHECK (ST_Within(geometry, ST_MakeEnvelope(72.77, 18.89, 72.99, 19.275, 4326)))
);

CREATE TABLE contractors (
  id syn_id PRIMARY KEY,
  record_nature text NOT NULL,
  source_tier text NOT NULL,
  record_version integer NOT NULL,
  updated_at timestamptz NOT NULL,
  display_name text NOT NULL,
  organization_kind text NOT NULL,
  synthetic_note text NOT NULL,
  official_performance_rating text,
  CONSTRAINT contractors_chk_1 CHECK (record_nature = 'SYNTHETIC_DEMONSTRATION'),
  CONSTRAINT contractors_chk_2 CHECK (source_tier IN ('SYNTHETIC_DEMO', 'COMMUNITY_REFERENCE', 'OFFICIAL_SOURCE_PENDING')),
  CONSTRAINT contractors_chk_3 CHECK (record_version >= 1),
  CONSTRAINT contractors_chk_4 CHECK (char_length(display_name) BETWEEN 1 AND 120),
  CONSTRAINT contractors_chk_5 CHECK (organization_kind = 'SYNTHETIC_ORGANIZATION'),
  CONSTRAINT contractors_chk_6 CHECK (char_length(synthetic_note) BETWEEN 1 AND 200),
  CONSTRAINT contractors_chk_7 CHECK (official_performance_rating IS NULL)
);

CREATE TABLE budgets (
  id syn_id PRIMARY KEY,
  record_nature text NOT NULL,
  source_tier text NOT NULL,
  record_version integer NOT NULL,
  updated_at timestamptz NOT NULL,
  display_title text NOT NULL,
  budget_book_name text NOT NULL,
  budget_head text NOT NULL,
  amount_paise paise NOT NULL,
  financial_year text NOT NULL,
  department_id syn_id NOT NULL,
  traceability_status text NOT NULL,
  last_proven_link text NOT NULL,
  missing_next_link text,
  traceability_explanation text NOT NULL,
  CONSTRAINT budgets_department_id_fk FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT budgets_chk_1 CHECK (record_nature = 'SYNTHETIC_DEMONSTRATION'),
  CONSTRAINT budgets_chk_2 CHECK (source_tier IN ('SYNTHETIC_DEMO', 'COMMUNITY_REFERENCE', 'OFFICIAL_SOURCE_PENDING')),
  CONSTRAINT budgets_chk_3 CHECK (record_version >= 1),
  CONSTRAINT budgets_chk_4 CHECK (char_length(display_title) BETWEEN 1 AND 200),
  CONSTRAINT budgets_chk_5 CHECK (char_length(budget_book_name) BETWEEN 1 AND 120),
  CONSTRAINT budgets_chk_6 CHECK (char_length(budget_head) BETWEEN 1 AND 160),
  CONSTRAINT budgets_chk_7 CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT budgets_chk_8 CHECK (traceability_status IN ('LINKED_TO_STREET', 'GAP_BEFORE_STREET_GEOMETRY')),
  CONSTRAINT budgets_chk_9 CHECK (last_proven_link IN ('BUDGET', 'TENDER', 'CONTRACT', 'WORK_ORDER', 'ASSET_GEOMETRY')),
  CONSTRAINT budgets_chk_10 CHECK (missing_next_link IN ('TENDER', 'CONTRACT', 'WORK_ORDER', 'STREET_LEVEL_GEOMETRY')),
  CONSTRAINT budgets_chk_11 CHECK (char_length(traceability_explanation) BETWEEN 1 AND 400),
  CONSTRAINT budgets_traceability_gap_ck CHECK ((traceability_status = 'LINKED_TO_STREET' AND missing_next_link IS NULL AND last_proven_link = 'ASSET_GEOMETRY') OR (traceability_status = 'GAP_BEFORE_STREET_GEOMETRY' AND missing_next_link IS NOT NULL AND last_proven_link <> 'ASSET_GEOMETRY'))
);

CREATE TABLE tenders (
  id syn_id PRIMARY KEY,
  record_nature text NOT NULL,
  source_tier text NOT NULL,
  record_version integer NOT NULL,
  updated_at timestamptz NOT NULL,
  budget_id syn_id NOT NULL,
  tender_reference text NOT NULL,
  title text NOT NULL,
  status text NOT NULL,
  published_on date NOT NULL,
  estimated_value_paise paise NOT NULL,
  scope_summary text NOT NULL,
  location_description text NOT NULL,
  street_geometry_available boolean NOT NULL,
  CONSTRAINT tenders_budget_id_fk FOREIGN KEY (budget_id) REFERENCES budgets (id),
  CONSTRAINT tenders_chk_1 CHECK (record_nature = 'SYNTHETIC_DEMONSTRATION'),
  CONSTRAINT tenders_chk_2 CHECK (source_tier IN ('SYNTHETIC_DEMO', 'COMMUNITY_REFERENCE', 'OFFICIAL_SOURCE_PENDING')),
  CONSTRAINT tenders_chk_3 CHECK (record_version >= 1),
  CONSTRAINT tenders_chk_4 CHECK (tender_reference ~ '^SYN-DEMO-TNR-[A-Z0-9-]+$'),
  CONSTRAINT tenders_chk_5 CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT tenders_chk_6 CHECK (status IN ('TENDER_PUBLISHED', 'CONTRACT_AWARDED', 'RETENDER_REQUIRED')),
  CONSTRAINT tenders_chk_7 CHECK (char_length(scope_summary) BETWEEN 1 AND 300),
  CONSTRAINT tenders_chk_8 CHECK (char_length(location_description) BETWEEN 1 AND 300)
);

CREATE TABLE contracts (
  id syn_id PRIMARY KEY,
  record_nature text NOT NULL,
  source_tier text NOT NULL,
  record_version integer NOT NULL,
  updated_at timestamptz NOT NULL,
  tender_id syn_id NOT NULL,
  budget_id syn_id NOT NULL,
  vendor_id syn_id NOT NULL,
  display_title text NOT NULL,
  contract_status text NOT NULL,
  awarded_on date NOT NULL,
  value_paise paise NOT NULL,
  CONSTRAINT contracts_tender_id_fk FOREIGN KEY (tender_id) REFERENCES tenders (id),
  CONSTRAINT contracts_budget_id_fk FOREIGN KEY (budget_id) REFERENCES budgets (id),
  CONSTRAINT contracts_vendor_id_fk FOREIGN KEY (vendor_id) REFERENCES contractors (id),
  CONSTRAINT contracts_chk_1 CHECK (record_nature = 'SYNTHETIC_DEMONSTRATION'),
  CONSTRAINT contracts_chk_2 CHECK (source_tier IN ('SYNTHETIC_DEMO', 'COMMUNITY_REFERENCE', 'OFFICIAL_SOURCE_PENDING')),
  CONSTRAINT contracts_chk_3 CHECK (record_version >= 1),
  CONSTRAINT contracts_chk_4 CHECK (char_length(display_title) BETWEEN 1 AND 200),
  CONSTRAINT contracts_chk_5 CHECK (contract_status IN ('AWARDED', 'COMPLETED_IN_DLP'))
);

CREATE TABLE work_orders (
  id syn_id PRIMARY KEY,
  record_nature text NOT NULL,
  source_tier text NOT NULL,
  record_version integer NOT NULL,
  updated_at timestamptz NOT NULL,
  display_title text NOT NULL,
  public_description text NOT NULL,
  contract_id syn_id NOT NULL,
  asset_id syn_id NOT NULL,
  department_id syn_id NOT NULL,
  value_paise paise NOT NULL,
  started_on date NOT NULL,
  completion_certified_on date,
  dlp_ends_at timestamptz NOT NULL,
  status text NOT NULL,
  CONSTRAINT work_orders_contract_id_fk FOREIGN KEY (contract_id) REFERENCES contracts (id),
  CONSTRAINT work_orders_asset_id_fk FOREIGN KEY (asset_id) REFERENCES assets (id),
  CONSTRAINT work_orders_department_id_fk FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT work_orders_chk_1 CHECK (record_nature = 'SYNTHETIC_DEMONSTRATION'),
  CONSTRAINT work_orders_chk_2 CHECK (source_tier IN ('SYNTHETIC_DEMO', 'COMMUNITY_REFERENCE', 'OFFICIAL_SOURCE_PENDING')),
  CONSTRAINT work_orders_chk_3 CHECK (record_version >= 1),
  CONSTRAINT work_orders_chk_4 CHECK (char_length(display_title) BETWEEN 1 AND 200),
  CONSTRAINT work_orders_chk_5 CHECK (char_length(public_description) BETWEEN 1 AND 400),
  CONSTRAINT work_orders_chk_6 CHECK (status IN ('BUDGETED_PROPOSED', 'TENDER_PUBLISHED', 'RETENDER_REQUIRED', 'CONTRACT_AWARDED', 'WORK_ORDER_ISSUED', 'IN_EXECUTION', 'SUSPENDED', 'COMPLETION_CERTIFIED_IN_DLP', 'DEFECT_NOTIFIED', 'DLP_EXPIRED_ARCHIVED')),
  CONSTRAINT work_orders_dates_ck CHECK (completion_certified_on IS NULL OR completion_certified_on >= started_on)
);

CREATE TABLE dlp_status (
  id syn_id PRIMARY KEY,
  record_nature text NOT NULL,
  source_tier text NOT NULL,
  record_version integer NOT NULL,
  updated_at timestamptz NOT NULL,
  work_order_id syn_id NOT NULL,
  dlp_starts_on date NOT NULL,
  explanation text NOT NULL,
  warranty_path_note text NOT NULL,
  synthetic_fresh_repair_estimate_paise paise,
  potential_spend_label text,
  CONSTRAINT dlp_status_work_order_id_fk FOREIGN KEY (work_order_id) REFERENCES work_orders (id),
  CONSTRAINT dlp_status_chk_1 CHECK (record_nature = 'SYNTHETIC_DEMONSTRATION'),
  CONSTRAINT dlp_status_chk_2 CHECK (source_tier IN ('SYNTHETIC_DEMO', 'COMMUNITY_REFERENCE', 'OFFICIAL_SOURCE_PENDING')),
  CONSTRAINT dlp_status_chk_3 CHECK (record_version >= 1),
  CONSTRAINT dlp_status_chk_4 CHECK (char_length(explanation) BETWEEN 1 AND 400),
  CONSTRAINT dlp_status_chk_5 CHECK (char_length(warranty_path_note) BETWEEN 1 AND 400),
  CONSTRAINT dlp_status_chk_6 CHECK (potential_spend_label IN ('SYNTHETIC_POTENTIAL_NOT_REALIZED_SAVINGS')),
  CONSTRAINT dlp_status_potential_label_ck CHECK ((synthetic_fresh_repair_estimate_paise IS NULL) = (potential_spend_label IS NULL)),
  CONSTRAINT dlp_status_work_order_uq UNIQUE (work_order_id)
);

CREATE TABLE issues (
  id syn_id PRIMARY KEY,
  record_nature text NOT NULL,
  source_tier text NOT NULL,
  record_version integer NOT NULL,
  updated_at timestamptz NOT NULL,
  title text NOT NULL,
  public_description text NOT NULL,
  category text NOT NULL,
  status text NOT NULL,
  public_status_explanation text NOT NULL,
  reported_at timestamptz NOT NULL,
  street_name text NOT NULL,
  nearby_landmark text NOT NULL,
  geometry geometry(Geometry,4326) NOT NULL,
  asset_id syn_id,
  work_order_id syn_id,
  ward_candidate_id syn_id,
  responsible_department_id syn_id NOT NULL,
  responsible_post_title text NOT NULL,
  escalation_post_title text NOT NULL,
  parent_recurrence_id syn_id,
  journeys text[] NOT NULL,
  CONSTRAINT issues_asset_id_fk FOREIGN KEY (asset_id) REFERENCES assets (id),
  CONSTRAINT issues_work_order_id_fk FOREIGN KEY (work_order_id) REFERENCES work_orders (id),
  CONSTRAINT issues_ward_candidate_id_fk FOREIGN KEY (ward_candidate_id) REFERENCES wards (id),
  CONSTRAINT issues_responsible_department_id_fk FOREIGN KEY (responsible_department_id) REFERENCES departments (id),
  CONSTRAINT issues_parent_recurrence_id_fk FOREIGN KEY (parent_recurrence_id) REFERENCES issues (id),
  CONSTRAINT issues_chk_1 CHECK (record_nature = 'SYNTHETIC_DEMONSTRATION'),
  CONSTRAINT issues_chk_2 CHECK (source_tier IN ('SYNTHETIC_DEMO', 'COMMUNITY_REFERENCE', 'OFFICIAL_SOURCE_PENDING')),
  CONSTRAINT issues_chk_3 CHECK (record_version >= 1),
  CONSTRAINT issues_chk_4 CHECK (char_length(title) BETWEEN 1 AND 160),
  CONSTRAINT issues_chk_5 CHECK (char_length(public_description) BETWEEN 1 AND 400),
  CONSTRAINT issues_chk_6 CHECK (category IN ('POTHOLE', 'DRAIN_BLOCKAGE', 'WATERLOGGING', 'FACILITY_REPAIR')),
  CONSTRAINT issues_chk_7 CHECK (status IN ('DRAFT_LOCAL', 'SUBMITTED_UNVERIFIED', 'TRIAGED_ASSIGNED', 'IN_PROGRESS', 'CLOSURE_CLAIMED_PENDING_VERIFICATION', 'VERIFIED_COMPLETE', 'DISPUTED_REOPENED')),
  CONSTRAINT issues_chk_8 CHECK (char_length(public_status_explanation) BETWEEN 1 AND 300),
  CONSTRAINT issues_chk_9 CHECK (char_length(street_name) BETWEEN 1 AND 120),
  CONSTRAINT issues_chk_10 CHECK (char_length(nearby_landmark) BETWEEN 1 AND 160),
  CONSTRAINT issues_chk_11 CHECK (ST_IsValid(geometry)),
  CONSTRAINT issues_chk_12 CHECK (ST_SRID(geometry) = 4326),
  CONSTRAINT issues_chk_13 CHECK (ST_Within(geometry, ST_MakeEnvelope(72.77, 18.89, 72.99, 19.275, 4326))),
  CONSTRAINT issues_chk_14 CHECK (char_length(responsible_post_title) BETWEEN 1 AND 160),
  CONSTRAINT issues_chk_15 CHECK (char_length(escalation_post_title) BETWEEN 1 AND 160),
  CONSTRAINT issues_chk_16 CHECK (cardinality(journeys) >= 1)
);

CREATE TABLE jurisdictions (
  id syn_id PRIMARY KEY,
  record_nature text NOT NULL,
  source_tier text NOT NULL,
  record_version integer NOT NULL,
  updated_at timestamptz NOT NULL,
  issue_id syn_id NOT NULL,
  status text NOT NULL,
  spatial_match_method text NOT NULL,
  distance_to_boundary_meters numeric(10,1),
  candidate_ward_id syn_id,
  external_agency_label text,
  confirmation_basis text,
  source_conflict_note text,
  legal_ownership_asserted boolean NOT NULL,
  confidence_note text NOT NULL,
  established_at timestamptz NOT NULL,
  CONSTRAINT jurisdictions_issue_id_fk FOREIGN KEY (issue_id) REFERENCES issues (id),
  CONSTRAINT jurisdictions_candidate_ward_id_fk FOREIGN KEY (candidate_ward_id) REFERENCES wards (id),
  CONSTRAINT jurisdictions_chk_1 CHECK (record_nature = 'SYNTHETIC_DEMONSTRATION'),
  CONSTRAINT jurisdictions_chk_2 CHECK (source_tier IN ('SYNTHETIC_DEMO', 'COMMUNITY_REFERENCE', 'OFFICIAL_SOURCE_PENDING')),
  CONSTRAINT jurisdictions_chk_3 CHECK (record_version >= 1),
  CONSTRAINT jurisdictions_chk_4 CHECK (status IN ('UNKNOWN', 'SPATIALLY_INFERRED_PROVISIONAL', 'CONFIRMED_BMC_WARD', 'EXTERNAL_AGENCY_ASSIGNED', 'CONFLICT_DISPUTED', 'HANDOFF_LOGGED')),
  CONSTRAINT jurisdictions_chk_5 CHECK (spatial_match_method IN ('ST_COVERS', 'ST_INTERSECTS', 'NONE')),
  CONSTRAINT jurisdictions_chk_6 CHECK (distance_to_boundary_meters >= 0),
  CONSTRAINT jurisdictions_chk_7 CHECK (char_length(external_agency_label) BETWEEN 1 AND 160),
  CONSTRAINT jurisdictions_chk_8 CHECK (char_length(confirmation_basis) BETWEEN 1 AND 300),
  CONSTRAINT jurisdictions_chk_9 CHECK (char_length(source_conflict_note) BETWEEN 1 AND 400),
  CONSTRAINT jurisdictions_chk_10 CHECK (legal_ownership_asserted IS FALSE),
  CONSTRAINT jurisdictions_chk_11 CHECK (char_length(confidence_note) BETWEEN 1 AND 300),
  CONSTRAINT jurisdictions_issue_uq UNIQUE (issue_id),
  CONSTRAINT jurisdictions_confirmed_basis_ck CHECK (status <> 'CONFIRMED_BMC_WARD' OR confirmation_basis IS NOT NULL),
  CONSTRAINT jurisdictions_provisional_basis_ck CHECK (status NOT IN ('SPATIALLY_INFERRED_PROVISIONAL', 'CONFLICT_DISPUTED') OR confirmation_basis IS NULL)
);

CREATE TABLE evidence (
  id syn_id PRIMARY KEY,
  record_nature text NOT NULL,
  source_tier text NOT NULL,
  record_version integer NOT NULL,
  updated_at timestamptz NOT NULL,
  issue_id syn_id NOT NULL,
  stage text NOT NULL,
  caption text NOT NULL,
  confidence text NOT NULL,
  source_type text NOT NULL,
  captured_at timestamptz NOT NULL,
  location_confidence text NOT NULL,
  distance_to_asset_meters numeric(10,1),
  media_status text NOT NULL,
  media_ref text NOT NULL,
  sha256 text NOT NULL,
  hash_basis text NOT NULL,
  verification_state text NOT NULL,
  processing_state text NOT NULL,
  caveat text NOT NULL,
  CONSTRAINT evidence_issue_id_fk FOREIGN KEY (issue_id) REFERENCES issues (id),
  CONSTRAINT evidence_chk_1 CHECK (record_nature = 'SYNTHETIC_DEMONSTRATION'),
  CONSTRAINT evidence_chk_2 CHECK (source_tier IN ('SYNTHETIC_DEMO', 'COMMUNITY_REFERENCE', 'OFFICIAL_SOURCE_PENDING')),
  CONSTRAINT evidence_chk_3 CHECK (record_version >= 1),
  CONSTRAINT evidence_chk_4 CHECK (stage IN ('BEFORE', 'CLAIMED_AFTER', 'DISPUTED_OR_RECURRING')),
  CONSTRAINT evidence_chk_5 CHECK (char_length(caption) BETWEEN 1 AND 300),
  CONSTRAINT evidence_chk_6 CHECK (confidence IN ('CITIZEN_SUBMITTED', 'AUTHORITY_SUBMITTED', 'INDEPENDENTLY_VERIFIED')),
  CONSTRAINT evidence_chk_7 CHECK (source_type IN ('CITIZEN_FIXTURE', 'AUTHORITY_FIXTURE', 'INDEPENDENT_FIXTURE')),
  CONSTRAINT evidence_chk_8 CHECK (location_confidence IN ('LOCATION_CONSISTENT', 'LOCATION_UNVERIFIED', 'LOCATION_INCONSISTENT')),
  CONSTRAINT evidence_chk_9 CHECK (distance_to_asset_meters >= 0),
  CONSTRAINT evidence_chk_10 CHECK (media_status = 'SYNTHETIC_FIXTURE_REFERENCE_ONLY'),
  CONSTRAINT evidence_chk_11 CHECK (media_ref ~ '^fixtures/evidence/SYN-DEMO-[A-Z0-9-]+\.svg$'),
  CONSTRAINT evidence_chk_12 CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT evidence_chk_13 CHECK (hash_basis = 'FIXTURE_REFERENCE_STRING'),
  CONSTRAINT evidence_chk_14 CHECK (verification_state IN ('NOT_VERIFIED', 'CORROBORATED', 'INDEPENDENTLY_VERIFIED')),
  CONSTRAINT evidence_chk_15 CHECK (processing_state IN ('UPLOADED_QUARANTINE', 'PROCESSING', 'READY_FOR_REVIEW', 'PROCESSING_FAILED', 'MANUAL_REVIEW', 'PUBLISHED_PUBLIC', 'REJECTED')),
  CONSTRAINT evidence_chk_16 CHECK (char_length(caveat) BETWEEN 1 AND 400),
  CONSTRAINT evidence_media_hash_uq UNIQUE (media_ref)
);

CREATE TABLE completion_claims (
  id syn_id PRIMARY KEY,
  record_nature text NOT NULL,
  source_tier text NOT NULL,
  record_version integer NOT NULL,
  updated_at timestamptz NOT NULL,
  issue_id syn_id NOT NULL,
  work_order_id syn_id,
  claimed_at timestamptz NOT NULL,
  claimed_by_post_title text NOT NULL,
  atr_summary text NOT NULL,
  claimed_after_evidence_id syn_id NOT NULL,
  verification_window_ends_at timestamptz NOT NULL,
  claim_note text NOT NULL,
  CONSTRAINT completion_claims_issue_id_fk FOREIGN KEY (issue_id) REFERENCES issues (id),
  CONSTRAINT completion_claims_work_order_id_fk FOREIGN KEY (work_order_id) REFERENCES work_orders (id),
  CONSTRAINT completion_claims_claimed_after_evidence_id_fk FOREIGN KEY (claimed_after_evidence_id) REFERENCES evidence (id),
  CONSTRAINT completion_claims_chk_1 CHECK (record_nature = 'SYNTHETIC_DEMONSTRATION'),
  CONSTRAINT completion_claims_chk_2 CHECK (source_tier IN ('SYNTHETIC_DEMO', 'COMMUNITY_REFERENCE', 'OFFICIAL_SOURCE_PENDING')),
  CONSTRAINT completion_claims_chk_3 CHECK (record_version >= 1),
  CONSTRAINT completion_claims_chk_4 CHECK (char_length(claimed_by_post_title) BETWEEN 1 AND 160),
  CONSTRAINT completion_claims_chk_5 CHECK (char_length(atr_summary) BETWEEN 1 AND 400),
  CONSTRAINT completion_claims_chk_6 CHECK (char_length(claim_note) BETWEEN 1 AND 300),
  CONSTRAINT completion_claims_issue_uq UNIQUE (issue_id)
);

CREATE TABLE verifications (
  id syn_id PRIMARY KEY,
  record_nature text NOT NULL,
  source_tier text NOT NULL,
  record_version integer NOT NULL,
  updated_at timestamptz NOT NULL,
  issue_id syn_id NOT NULL,
  completion_claim_id syn_id NOT NULL,
  state text NOT NULL,
  window_opens_at timestamptz NOT NULL,
  window_ends_at timestamptz NOT NULL,
  citizen_verdict text,
  verdict_at timestamptz,
  dispute_evidence_id syn_id,
  silence_note text NOT NULL,
  CONSTRAINT verifications_issue_id_fk FOREIGN KEY (issue_id) REFERENCES issues (id),
  CONSTRAINT verifications_completion_claim_id_fk FOREIGN KEY (completion_claim_id) REFERENCES completion_claims (id),
  CONSTRAINT verifications_dispute_evidence_id_fk FOREIGN KEY (dispute_evidence_id) REFERENCES evidence (id),
  CONSTRAINT verifications_chk_1 CHECK (record_nature = 'SYNTHETIC_DEMONSTRATION'),
  CONSTRAINT verifications_chk_2 CHECK (source_tier IN ('SYNTHETIC_DEMO', 'COMMUNITY_REFERENCE', 'OFFICIAL_SOURCE_PENDING')),
  CONSTRAINT verifications_chk_3 CHECK (record_version >= 1),
  CONSTRAINT verifications_chk_4 CHECK (state IN ('AWAITING_AUTHORITY_CLAIM', 'WINDOW_OPEN', 'CITIZEN_CONFIRMED', 'CITIZEN_PARTLY_FIXED', 'CITIZEN_DISPUTED', 'WINDOW_EXPIRED_NO_VERDICT', 'INDEPENDENT_REVIEW_PENDING', 'INDEPENDENTLY_VERIFIED')),
  CONSTRAINT verifications_chk_5 CHECK (citizen_verdict IN ('FIXED', 'PARTLY_FIXED', 'STILL_UNRESOLVED')),
  CONSTRAINT verifications_chk_6 CHECK (char_length(silence_note) BETWEEN 1 AND 300),
  CONSTRAINT verifications_issue_uq UNIQUE (issue_id),
  CONSTRAINT verifications_silence_ck CHECK (state NOT IN ('WINDOW_OPEN', 'AWAITING_AUTHORITY_CLAIM', 'WINDOW_EXPIRED_NO_VERDICT') OR (citizen_verdict IS NULL AND verdict_at IS NULL)),
  CONSTRAINT verifications_window_ck CHECK (window_ends_at > window_opens_at)
);

CREATE TABLE corrections (
  id syn_id PRIMARY KEY,
  record_nature text NOT NULL,
  source_tier text NOT NULL,
  record_version integer NOT NULL,
  updated_at timestamptz NOT NULL,
  entity_id syn_id NOT NULL,
  field_path text NOT NULL,
  prior_value jsonb NOT NULL,
  proposed_value jsonb NOT NULL,
  status text NOT NULL,
  reason text NOT NULL,
  submitted_at timestamptz NOT NULL,
  adjudication_note text,
  appeal_note text,
  prior_value_preserved boolean NOT NULL,
  CONSTRAINT corrections_chk_1 CHECK (record_nature = 'SYNTHETIC_DEMONSTRATION'),
  CONSTRAINT corrections_chk_2 CHECK (source_tier IN ('SYNTHETIC_DEMO', 'COMMUNITY_REFERENCE', 'OFFICIAL_SOURCE_PENDING')),
  CONSTRAINT corrections_chk_3 CHECK (record_version >= 1),
  CONSTRAINT corrections_chk_4 CHECK (field_path ~ '^/[A-Za-z0-9/_-]+$'),
  CONSTRAINT corrections_chk_5 CHECK (status IN ('CHALLENGE_SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED_AMENDED', 'REJECTED_WITH_REASON', 'APPEAL_SUBMITTED')),
  CONSTRAINT corrections_chk_6 CHECK (char_length(reason) BETWEEN 1 AND 300),
  CONSTRAINT corrections_chk_7 CHECK (char_length(adjudication_note) BETWEEN 1 AND 400),
  CONSTRAINT corrections_chk_8 CHECK (char_length(appeal_note) BETWEEN 1 AND 400),
  CONSTRAINT corrections_chk_9 CHECK (prior_value_preserved IS TRUE)
);

CREATE TABLE lifecycle_events (
  id syn_id PRIMARY KEY,
  record_nature text NOT NULL,
  source_tier text NOT NULL,
  record_version integer NOT NULL,
  updated_at timestamptz NOT NULL,
  entity_id syn_id NOT NULL,
  sequence integer NOT NULL,
  event_type text NOT NULL,
  actor_role text NOT NULL,
  occurred_at timestamptz NOT NULL,
  summary text NOT NULL,
  previous_hash text,
  payload_hash text NOT NULL,
  CONSTRAINT lifecycle_events_chk_1 CHECK (record_nature = 'SYNTHETIC_DEMONSTRATION'),
  CONSTRAINT lifecycle_events_chk_2 CHECK (source_tier IN ('SYNTHETIC_DEMO', 'COMMUNITY_REFERENCE', 'OFFICIAL_SOURCE_PENDING')),
  CONSTRAINT lifecycle_events_chk_3 CHECK (record_version >= 1),
  CONSTRAINT lifecycle_events_chk_4 CHECK (sequence >= 1),
  CONSTRAINT lifecycle_events_chk_5 CHECK (event_type ~ '^[A-Z][A-Z_]+$'),
  CONSTRAINT lifecycle_events_chk_6 CHECK (actor_role IN ('public', 'citizen', 'authority', 'moderator', 'independent_reviewer', 'demo_admin', 'system')),
  CONSTRAINT lifecycle_events_chk_7 CHECK (char_length(summary) BETWEEN 1 AND 400),
  CONSTRAINT lifecycle_events_chk_8 CHECK (previous_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT lifecycle_events_chk_9 CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT lifecycle_events_entity_seq_uq UNIQUE (entity_id, sequence),
  CONSTRAINT lifecycle_events_genesis_ck CHECK ((sequence = 1) = (previous_hash IS NULL))
);

-- Idempotency (commands are implemented in a later phase).
CREATE TABLE idempotency_records (
  idempotency_key text PRIMARY KEY,
  operation_id text NOT NULL,
  response_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Spatial, journey and lookup indexes.
CREATE INDEX wards_boundary_gix ON wards USING gist (boundary);
CREATE INDEX wards_boundary_geog_gix ON wards USING gist ((boundary::geography));
CREATE INDEX assets_geometry_gix ON assets USING gist (geometry);
CREATE INDEX assets_geometry_geog_gix ON assets USING gist ((geometry::geography));
CREATE INDEX issues_geometry_gix ON issues USING gist (geometry);
CREATE INDEX issues_geometry_geog_gix ON issues USING gist ((geometry::geography));
CREATE INDEX assets_ward_idx ON assets (ward_candidate_id, asset_type);
CREATE INDEX budgets_department_idx ON budgets (department_id, traceability_status);
CREATE INDEX tenders_budget_idx ON tenders (budget_id);
CREATE INDEX contracts_budget_idx ON contracts (budget_id);
CREATE INDEX work_orders_asset_idx ON work_orders (asset_id, status);
CREATE INDEX issues_ward_status_idx ON issues (ward_candidate_id, status);
CREATE INDEX issues_category_idx ON issues (category);
CREATE INDEX issues_work_order_idx ON issues (work_order_id);
CREATE INDEX issues_unlinked_asset_idx ON issues (asset_id) WHERE work_order_id IS NULL;
CREATE INDEX jurisdictions_status_idx ON jurisdictions (status);
CREATE INDEX evidence_issue_stage_idx ON evidence (issue_id, stage);
CREATE INDEX corrections_entity_idx ON corrections (entity_id, submitted_at);
CREATE INDEX lifecycle_events_entity_idx ON lifecycle_events (entity_id, sequence);
