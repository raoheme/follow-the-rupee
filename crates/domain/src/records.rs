//! Strict records for every file in data/demo. All structs reject unknown fields; enums mirror the JSON Schemas and the
//! frozen state machines. Timestamps and calendar dates stay ISO-8601 strings here and are checked by the schemas.
use crate::money::Paise;
use serde::{Deserialize, Serialize};
use serde_json::Value;

macro_rules! str_enum {
    ($(#[$m:meta])* $name:ident { $($v:ident = $s:literal),+ $(,)? }) => {
        $(#[$m])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
        pub enum $name { $(#[serde(rename = $s)] $v),+ }
    };
}

str_enum!(RecordNature { SyntheticDemonstration = "SYNTHETIC_DEMONSTRATION" });
str_enum!(SourceTier { SyntheticDemo = "SYNTHETIC_DEMO", CommunityReference = "COMMUNITY_REFERENCE", OfficialSourcePending = "OFFICIAL_SOURCE_PENDING" });
str_enum!(IssueCategory { Pothole = "POTHOLE", DrainBlockage = "DRAIN_BLOCKAGE", Waterlogging = "WATERLOGGING", FacilityRepair = "FACILITY_REPAIR" });
str_enum!(IssueStatus {
    DraftLocal = "DRAFT_LOCAL", SubmittedUnverified = "SUBMITTED_UNVERIFIED", TriagedAssigned = "TRIAGED_ASSIGNED",
    InProgress = "IN_PROGRESS", ClosureClaimedPendingVerification = "CLOSURE_CLAIMED_PENDING_VERIFICATION",
    VerifiedComplete = "VERIFIED_COMPLETE", DisputedReopened = "DISPUTED_REOPENED",
});
str_enum!(WorkStatus {
    BudgetedProposed = "BUDGETED_PROPOSED", TenderPublished = "TENDER_PUBLISHED", RetenderRequired = "RETENDER_REQUIRED",
    ContractAwarded = "CONTRACT_AWARDED", WorkOrderIssued = "WORK_ORDER_ISSUED", InExecution = "IN_EXECUTION",
    Suspended = "SUSPENDED", CompletionCertifiedInDlp = "COMPLETION_CERTIFIED_IN_DLP", DefectNotified = "DEFECT_NOTIFIED",
    DlpExpiredArchived = "DLP_EXPIRED_ARCHIVED",
});
str_enum!(AssetType { RoadSegment = "ROAD_SEGMENT", DrainSegment = "DRAIN_SEGMENT", School = "SCHOOL", Dispensary = "DISPENSARY" });
str_enum!(WardRole { PrimaryDemonstration = "PRIMARY_DEMONSTRATION", ScalePreview = "SCALE_PREVIEW" });
str_enum!(BoundaryNature { SyntheticIllustrativeBox = "SYNTHETIC_ILLUSTRATIVE_BOX" });
str_enum!(DepartmentKind { CentralDepartment = "CENTRAL_DEPARTMENT", WardOffice = "WARD_OFFICE" });
str_enum!(OrganizationKind { SyntheticOrganization = "SYNTHETIC_ORGANIZATION" });
str_enum!(TraceabilityStatus { LinkedToStreet = "LINKED_TO_STREET", GapBeforeStreetGeometry = "GAP_BEFORE_STREET_GEOMETRY" });
str_enum!(ProvenLink { Budget = "BUDGET", Tender = "TENDER", Contract = "CONTRACT", WorkOrder = "WORK_ORDER", AssetGeometry = "ASSET_GEOMETRY" });
str_enum!(MissingLink { Tender = "TENDER", Contract = "CONTRACT", WorkOrder = "WORK_ORDER", StreetLevelGeometry = "STREET_LEVEL_GEOMETRY" });
str_enum!(TenderStatus { TenderPublished = "TENDER_PUBLISHED", ContractAwarded = "CONTRACT_AWARDED", RetenderRequired = "RETENDER_REQUIRED" });
str_enum!(ContractStatus { Awarded = "AWARDED", CompletedInDlp = "COMPLETED_IN_DLP" });
str_enum!(PotentialSpendLabel { SyntheticPotentialNotRealizedSavings = "SYNTHETIC_POTENTIAL_NOT_REALIZED_SAVINGS" });
str_enum!(JourneyTag { J1 = "J1", J2 = "J2", J3 = "J3", J4 = "J4", J5 = "J5", J6 = "J6", Preview = "PREVIEW" });
str_enum!(JurisdictionStatus {
    Unknown = "UNKNOWN", SpatiallyInferredProvisional = "SPATIALLY_INFERRED_PROVISIONAL", ConfirmedBmcWard = "CONFIRMED_BMC_WARD",
    ExternalAgencyAssigned = "EXTERNAL_AGENCY_ASSIGNED", ConflictDisputed = "CONFLICT_DISPUTED", HandoffLogged = "HANDOFF_LOGGED",
});
str_enum!(SpatialMatchMethod { StCovers = "ST_COVERS", StIntersects = "ST_INTERSECTS", None = "NONE" });
str_enum!(EvidenceStage { Before = "BEFORE", ClaimedAfter = "CLAIMED_AFTER", DisputedOrRecurring = "DISPUTED_OR_RECURRING" });
str_enum!(EvidenceConfidence { CitizenSubmitted = "CITIZEN_SUBMITTED", AuthoritySubmitted = "AUTHORITY_SUBMITTED", IndependentlyVerified = "INDEPENDENTLY_VERIFIED" });
str_enum!(EvidenceSourceType { CitizenFixture = "CITIZEN_FIXTURE", AuthorityFixture = "AUTHORITY_FIXTURE", IndependentFixture = "INDEPENDENT_FIXTURE" });
str_enum!(LocationConfidence { LocationConsistent = "LOCATION_CONSISTENT", LocationUnverified = "LOCATION_UNVERIFIED", LocationInconsistent = "LOCATION_INCONSISTENT" });
str_enum!(MediaStatus { SyntheticFixtureReferenceOnly = "SYNTHETIC_FIXTURE_REFERENCE_ONLY" });
str_enum!(HashBasis { FixtureReferenceString = "FIXTURE_REFERENCE_STRING" });
str_enum!(EvidenceVerificationState { NotVerified = "NOT_VERIFIED", Corroborated = "CORROBORATED", IndependentlyVerified = "INDEPENDENTLY_VERIFIED" });
str_enum!(EvidenceProcessingState {
    UploadedQuarantine = "UPLOADED_QUARANTINE", Processing = "PROCESSING", ReadyForReview = "READY_FOR_REVIEW",
    ProcessingFailed = "PROCESSING_FAILED", ManualReview = "MANUAL_REVIEW", PublishedPublic = "PUBLISHED_PUBLIC", Rejected = "REJECTED",
});
str_enum!(VerificationState {
    AwaitingAuthorityClaim = "AWAITING_AUTHORITY_CLAIM", WindowOpen = "WINDOW_OPEN", CitizenConfirmed = "CITIZEN_CONFIRMED",
    CitizenPartlyFixed = "CITIZEN_PARTLY_FIXED", CitizenDisputed = "CITIZEN_DISPUTED", WindowExpiredNoVerdict = "WINDOW_EXPIRED_NO_VERDICT",
    IndependentReviewPending = "INDEPENDENT_REVIEW_PENDING", IndependentlyVerified = "INDEPENDENTLY_VERIFIED",
});
str_enum!(CitizenVerdict { Fixed = "FIXED", PartlyFixed = "PARTLY_FIXED", StillUnresolved = "STILL_UNRESOLVED" });
str_enum!(CorrectionStatus {
    ChallengeSubmitted = "CHALLENGE_SUBMITTED", UnderReview = "UNDER_REVIEW", AcceptedAmended = "ACCEPTED_AMENDED",
    RejectedWithReason = "REJECTED_WITH_REASON", AppealSubmitted = "APPEAL_SUBMITTED",
});
str_enum!(ActorRole {
    Public = "public", Citizen = "citizen", Authority = "authority", Moderator = "moderator",
    IndependentReviewer = "independent_reviewer", DemoAdmin = "demo_admin", System = "system",
});

/// Identifier that must begin `SYN-DEMO-` followed by upper-case letters, digits and hyphens.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Deserialize, Serialize)]
#[serde(try_from = "String", into = "String")]
pub struct SynId(String);

impl SynId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for SynId {
    type Error = String;
    fn try_from(s: String) -> Result<Self, String> {
        let ok = s.strip_prefix("SYN-DEMO-").is_some_and(|rest| {
            rest.chars()
                .next()
                .is_some_and(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
                && rest
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '-')
        });
        if ok {
            Ok(SynId(s))
        } else {
            Err(format!("not a synthetic demonstration identifier: {s}"))
        }
    }
}

impl From<SynId> for String {
    fn from(v: SynId) -> String {
        v.0
    }
}

/// GeoJSON position [longitude, latitude] inside the Greater Mumbai bounds; swapped order is rejected.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
#[serde(try_from = "[f64; 2]", into = "[f64; 2]")]
pub struct Position([f64; 2]);

impl Position {
    pub fn lon(self) -> f64 {
        self.0[0]
    }
    pub fn lat(self) -> f64 {
        self.0[1]
    }
}

impl TryFrom<[f64; 2]> for Position {
    type Error = String;
    fn try_from(p: [f64; 2]) -> Result<Self, String> {
        if (72.77..=72.99).contains(&p[0]) && (18.89..=19.275).contains(&p[1]) {
            Ok(Position(p))
        } else {
            Err(format!(
                "position {p:?} is outside Greater Mumbai or not [longitude, latitude]"
            ))
        }
    }
}

impl From<Position> for [f64; 2] {
    fn from(p: Position) -> [f64; 2] {
        p.0
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum Geometry {
    Point { coordinates: Position },
    LineString { coordinates: Vec<Position> },
    Polygon { coordinates: Vec<Vec<Position>> },
}

/// A JSON boolean that must be `false` (for example: jurisdiction is never asserted as legal ownership).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(try_from = "bool", into = "bool")]
pub struct AlwaysFalse;

impl TryFrom<bool> for AlwaysFalse {
    type Error = String;
    fn try_from(b: bool) -> Result<Self, String> {
        if b {
            Err("must be false".into())
        } else {
            Ok(AlwaysFalse)
        }
    }
}

impl From<AlwaysFalse> for bool {
    fn from(_: AlwaysFalse) -> bool {
        false
    }
}

/// A JSON boolean that must be `true`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(try_from = "bool", into = "bool")]
pub struct AlwaysTrue;

impl TryFrom<bool> for AlwaysTrue {
    type Error = String;
    fn try_from(b: bool) -> Result<Self, String> {
        if b {
            Ok(AlwaysTrue)
        } else {
            Err("must be true".into())
        }
    }
}

impl From<AlwaysTrue> for bool {
    fn from(_: AlwaysTrue) -> bool {
        true
    }
}

macro_rules! record {
    ($(#[$m:meta])* $name:ident { $($(#[$fm:meta])* $f:ident : $t:ty),* $(,)? }) => {
        $(#[$m])*
        #[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
        #[serde(deny_unknown_fields, rename_all = "camelCase")]
        pub struct $name {
            pub id: SynId,
            pub record_nature: RecordNature,
            pub source_tier: SourceTier,
            pub record_version: u32,
            pub updated_at: String,
            $($(#[$fm])* pub $f: $t),*
        }
    };
}

record!(Ward {
    code: String,
    display_name: String,
    locality_label: String,
    role: WardRole,
    elected_oversight_note: String,
    boundary: Geometry,
    boundary_nature: BoundaryNature,
    boundary_note: String
});
record!(Department { kind: DepartmentKind, display_name: String, ward_id: Option<SynId>, post_titles: Vec<String>,
    scope_summary: String });
record!(CivicAsset { asset_type: AssetType, display_name: String, street_name: String, corridor_name: Option<String>,
    nearby_landmark: String, geometry: Geometry, ward_candidate_id: Option<SynId>, responsible_department_id: SynId });
record!(Contractor { display_name: String, organization_kind: OrganizationKind, synthetic_note: String,
    /// Must stay null: this prototype carries no contractor ratings.
    official_performance_rating: Option<()> });
record!(Budget { display_title: String, budget_book_name: String, budget_head: String, amount_paise: Paise,
    financial_year: String, department_id: SynId, traceability_status: TraceabilityStatus, last_proven_link: ProvenLink,
    missing_next_link: Option<MissingLink>, traceability_explanation: String });
record!(Tender {
    budget_id: SynId,
    tender_reference: String,
    title: String,
    status: TenderStatus,
    published_on: String,
    estimated_value_paise: Paise,
    scope_summary: String,
    location_description: String,
    street_geometry_available: bool
});
record!(Contract {
    tender_id: SynId,
    budget_id: SynId,
    vendor_id: SynId,
    display_title: String,
    contract_status: ContractStatus,
    awarded_on: String,
    value_paise: Paise
});
record!(WorkOrder { display_title: String, public_description: String, contract_id: SynId, asset_id: SynId,
    department_id: SynId, value_paise: Paise, started_on: String, completion_certified_on: Option<String>,
    dlp_ends_at: String, status: WorkStatus });
record!(DlpRecord { work_order_id: SynId, dlp_starts_on: String, explanation: String, warranty_path_note: String,
    synthetic_fresh_repair_estimate_paise: Option<Paise>, potential_spend_label: Option<PotentialSpendLabel> });
record!(Issue { title: String, public_description: String, category: IssueCategory, status: IssueStatus,
    public_status_explanation: String, reported_at: String, street_name: String, nearby_landmark: String,
    geometry: Geometry, asset_id: Option<SynId>, work_order_id: Option<SynId>, ward_candidate_id: Option<SynId>,
    responsible_department_id: SynId, responsible_post_title: String, escalation_post_title: String,
    parent_recurrence_id: Option<SynId>, journeys: Vec<JourneyTag> });
record!(Jurisdiction { issue_id: SynId, status: JurisdictionStatus, spatial_match_method: SpatialMatchMethod,
    distance_to_boundary_meters: Option<f64>, candidate_ward_id: Option<SynId>, external_agency_label: Option<String>,
    confirmation_basis: Option<String>, source_conflict_note: Option<String>, legal_ownership_asserted: AlwaysFalse,
    confidence_note: String, established_at: String });
record!(Evidence { issue_id: SynId, stage: EvidenceStage, caption: String, confidence: EvidenceConfidence,
    source_type: EvidenceSourceType, captured_at: String, location_confidence: LocationConfidence,
    distance_to_asset_meters: Option<f64>, media_status: MediaStatus, media_ref: String, sha256: String,
    hash_basis: HashBasis, verification_state: EvidenceVerificationState, processing_state: EvidenceProcessingState,
    caveat: String });
record!(CompletionClaim { issue_id: SynId, work_order_id: Option<SynId>, claimed_at: String, claimed_by_post_title: String,
    atr_summary: String, claimed_after_evidence_id: SynId, verification_window_ends_at: String, claim_note: String });
record!(Verification { issue_id: SynId, completion_claim_id: SynId, state: VerificationState, window_opens_at: String,
    window_ends_at: String, citizen_verdict: Option<CitizenVerdict>, verdict_at: Option<String>,
    dispute_evidence_id: Option<SynId>, silence_note: String });
record!(Correction { entity_id: SynId, field_path: String, prior_value: Value, proposed_value: Value,
    status: CorrectionStatus, reason: String, submitted_at: String, adjudication_note: Option<String>,
    appeal_note: Option<String>, prior_value_preserved: AlwaysTrue });
record!(LifecycleEvent { entity_id: SynId, sequence: u32, event_type: String, actor_role: ActorRole, occurred_at: String,
    summary: String, previous_hash: Option<String>, payload_hash: String });

#[cfg(test)]
mod tests {
    use super::*;
    use serde::de::DeserializeOwned;
    use std::path::Path;

    fn load<T: DeserializeOwned>(stem: &str) -> Vec<T> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../data/demo")
            .join(format!("{stem}.json"));
        let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{stem}: {e}"));
        serde_json::from_str(&text)
            .unwrap_or_else(|e| panic!("{stem}.json failed strict deserialization: {e}"))
    }

    #[test]
    fn every_seed_record_deserializes_strictly() {
        let counts = [
            ("wards", load::<Ward>("wards").len()),
            ("departments", load::<Department>("departments").len()),
            ("assets", load::<CivicAsset>("assets").len()),
            ("contractors", load::<Contractor>("contractors").len()),
            ("budgets", load::<Budget>("budgets").len()),
            ("tenders", load::<Tender>("tenders").len()),
            ("contracts", load::<Contract>("contracts").len()),
            ("work-orders", load::<WorkOrder>("work-orders").len()),
            ("dlp-status", load::<DlpRecord>("dlp-status").len()),
            ("issues", load::<Issue>("issues").len()),
            ("jurisdictions", load::<Jurisdiction>("jurisdictions").len()),
            ("evidence", load::<Evidence>("evidence").len()),
            (
                "completion-claims",
                load::<CompletionClaim>("completion-claims").len(),
            ),
            ("verifications", load::<Verification>("verifications").len()),
            ("corrections", load::<Correction>("corrections").len()),
            (
                "lifecycle-events",
                load::<LifecycleEvent>("lifecycle-events").len(),
            ),
        ];
        assert!(counts.iter().all(|(_, n)| *n >= 1), "{counts:?}");
        assert_eq!(
            counts.iter().map(|(_, n)| n).sum::<usize>(),
            3 + 5 + 4 + 1 + 2 + 2 + 1 + 1 + 1 + 6 + 6 + 3 + 1 + 1 + 2 + 27
        );
    }

    #[test]
    fn money_fields_hold_the_frozen_paise_values() {
        let b = load::<Budget>("budgets");
        let w = load::<WorkOrder>("work-orders");
        assert_eq!(b[0].amount_paise.get(), 250_000_000);
        assert_eq!(w[0].value_paise.get(), 180_000_000);
    }

    fn issue_json() -> Value {
        let text = std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data/demo/issues.json"),
        )
        .unwrap();
        serde_json::from_str::<Vec<Value>>(&text).unwrap().remove(0)
    }

    #[test]
    fn extra_and_invalid_fields_are_rejected() {
        let ok = issue_json();
        assert!(serde_json::from_value::<Issue>(ok.clone()).is_ok());
        let mut extra = ok.clone();
        extra["notInContract"] = Value::from(1);
        assert!(
            serde_json::from_value::<Issue>(extra).is_err(),
            "extra property"
        );
        let mut bad_enum = ok.clone();
        bad_enum["status"] = Value::from("AUTO_VERIFIED_BY_SILENCE");
        assert!(
            serde_json::from_value::<Issue>(bad_enum).is_err(),
            "invalid state"
        );
        let mut bad_id = ok.clone();
        bad_id["id"] = Value::from("REAL-ID-1");
        assert!(
            serde_json::from_value::<Issue>(bad_id).is_err(),
            "non-synthetic id"
        );
        let mut bad_nature = ok.clone();
        bad_nature["recordNature"] = Value::from("OFFICIAL_RECORD");
        assert!(
            serde_json::from_value::<Issue>(bad_nature).is_err(),
            "non-synthetic nature"
        );
        let mut swapped = ok.clone();
        swapped["geometry"]["coordinates"] = serde_json::json!([19.1197, 72.8315]);
        assert!(
            serde_json::from_value::<Issue>(swapped).is_err(),
            "[lat, lon] order"
        );
        let mut missing = ok;
        missing.as_object_mut().unwrap().remove("title");
        assert!(
            serde_json::from_value::<Issue>(missing).is_err(),
            "missing required field"
        );
    }

    #[test]
    fn negative_money_and_asserted_jurisdiction_are_rejected() {
        let text = std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data/demo/budgets.json"),
        )
        .unwrap();
        let mut b = serde_json::from_str::<Vec<Value>>(&text).unwrap().remove(0);
        b["amountPaise"] = Value::from(-1);
        assert!(serde_json::from_value::<Budget>(b.clone()).is_err());
        b["amountPaise"] = Value::from(1.5);
        assert!(serde_json::from_value::<Budget>(b).is_err());
        let text = std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data/demo/jurisdictions.json"),
        )
        .unwrap();
        let mut j = serde_json::from_str::<Vec<Value>>(&text).unwrap().remove(0);
        j["legalOwnershipAsserted"] = Value::from(true);
        assert!(serde_json::from_value::<Jurisdiction>(j).is_err());
    }
}
