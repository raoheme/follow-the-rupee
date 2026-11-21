//! Response bodies for the read operations, mirroring `openapi/openapi.yaml` (`MapFeature`, `MapFeatureCollection`,
//! `IssueList`, the P4 `Kundali`, `WorkOrderDetail`, `BudgetTrace`, derived `DlpStatus` and the `{ data, correlationId }`
//! envelopes). Geometry keeps its GeoJSON `[longitude, latitude]` order and its original type.
use mcl_domain::dlp::DlpStatus;
use mcl_domain::money::Paise;
use mcl_domain::records::{
    Budget, CivicAsset, CompletionClaim, Contract, Contractor, Correction, Department, Evidence,
    Geometry, Issue, IssueCategory, Jurisdiction, LifecycleEvent, MissingLink, PotentialSpendLabel,
    ProvenLink, RecordNature, SourceTier, SynId, Tender, TraceabilityStatus, Verification, Ward,
    WorkOrder,
};
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum FeatureKind {
    #[serde(rename = "ISSUE")]
    Issue,
    #[serde(rename = "ASSET")]
    Asset,
    #[serde(rename = "PUBLIC_WORK")]
    PublicWork,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapFeatureProperties {
    pub kind: FeatureKind,
    pub record_id: SynId,
    pub title: String,
    pub category: Option<IssueCategory>,
    /// An issue status for `ISSUE`, the work-order status for `PUBLIC_WORK`, null for `ASSET`.
    pub status: Option<String>,
    pub ward_id: Option<SynId>,
    pub dlp_active: bool,
    pub record_nature: RecordNature,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MapFeature {
    #[serde(rename = "type")]
    pub feature_type: &'static str,
    pub id: SynId,
    pub geometry: Geometry,
    pub properties: MapFeatureProperties,
}

impl MapFeature {
    pub fn new(id: SynId, geometry: Geometry, properties: MapFeatureProperties) -> Self {
        MapFeature {
            feature_type: "Feature",
            id,
            geometry,
            properties,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MapFeatureCollection {
    #[serde(rename = "type")]
    pub collection_type: &'static str,
    pub features: Vec<MapFeature>,
}

impl MapFeatureCollection {
    pub fn new(features: Vec<MapFeature>) -> Self {
        MapFeatureCollection {
            collection_type: "FeatureCollection",
            features,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct IssueList {
    pub items: Vec<Issue>,
    pub total: usize,
}

impl IssueList {
    pub fn new(items: Vec<Issue>) -> Self {
        let total = items.len();
        IssueList { items, total }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Envelope<T: Serialize> {
    pub data: T,
    pub correlation_id: String,
}

/// The derived `DlpStatus` view. `status` and `evaluated_at` are computed per request from the stored start date, the work
/// order's `dlp_ends_at` and one evaluation instant; nothing here is ever persisted.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DlpView {
    pub id: SynId,
    pub record_nature: RecordNature,
    pub source_tier: SourceTier,
    pub record_version: u32,
    pub updated_at: String,
    pub work_order_id: SynId,
    pub dlp_starts_on: String,
    pub explanation: String,
    pub warranty_path_note: String,
    pub synthetic_fresh_repair_estimate_paise: Option<Paise>,
    pub potential_spend_label: Option<PotentialSpendLabel>,
    pub dlp_ends_at: String,
    pub evaluated_at: String,
    pub status: DlpStatus,
}

/// `BudgetTrace`: the chain from a budget line to street geometry, with an honest gap when a link is missing.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetTraceView {
    pub budget: Budget,
    pub tender: Option<Tender>,
    pub contract: Option<Contract>,
    pub contractor: Option<Contractor>,
    pub work_order: Option<WorkOrder>,
    pub asset: Option<CivicAsset>,
    pub traceability_status: TraceabilityStatus,
    pub last_proven_link: ProvenLink,
    pub missing_next_link: Option<MissingLink>,
    pub explanation: String,
}

/// `WorkOrderDetail`: a work order with its contract, contractor, asset, derived DLP view and linked issue ids.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkOrderDetailView {
    pub work_order: WorkOrder,
    pub contract: Contract,
    pub contractor: Contractor,
    pub asset: CivicAsset,
    pub dlp_status: Option<DlpView>,
    pub linked_issue_ids: Vec<SynId>,
}

pub const SYNTHETIC_BANNER: &str = "DEMONSTRATION - SYNTHETIC DATA - NOT AN OFFICIAL BMC PORTAL";

/// `Kundali`: the Civic Issue Kundali dossier. Every section is read from committed records; nothing is fabricated.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KundaliView {
    pub synthetic_banner: &'static str,
    pub canonical_demo_path: String,
    pub issue: Issue,
    pub ward: Option<Ward>,
    pub asset: Option<CivicAsset>,
    pub responsible_department: Department,
    pub jurisdiction: Jurisdiction,
    pub work_order: Option<WorkOrder>,
    pub dlp_status: Option<DlpView>,
    pub budget_trace: Option<BudgetTraceView>,
    pub evidence: Vec<Evidence>,
    pub completion_claim: Option<CompletionClaim>,
    pub verification: Option<Verification>,
    pub corrections: Vec<Correction>,
    pub audit_events: Vec<LifecycleEvent>,
}

/// `AuthorityDashboard`: queue identifiers and one count, all derived from stored records at one snapshot and one instant.
/// `uncertain_jurisdiction_issue_ids` lists open issues whose jurisdiction is still unknown, spatially inferred (provisional)
/// or disputed; it is a work queue, not a finding about ownership. No counts are fabricated: every list is a query result.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorityDashboardView {
    pub as_of: String,
    pub open_issue_count: u32,
    pub awaiting_verification_issue_ids: Vec<SynId>,
    pub uncertain_jurisdiction_issue_ids: Vec<SynId>,
    pub dlp_exception_issue_ids: Vec<SynId>,
    pub traceability_gap_budget_ids: Vec<SynId>,
}

/// `DlpExceptionItem`: an unlinked open issue on an asset whose certified work is inside its defect liability period at the
/// single evaluation instant. It is a potential warranty path, never a liability finding: `dlp_status.status` is derived and
/// the contractual applicability is pending verification.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DlpExceptionItem {
    pub issue_id: SynId,
    pub candidate_work_order_id: SynId,
    pub dlp_status: DlpView,
    pub warranty_path_note: String,
    pub potential_spend_label: PotentialSpendLabel,
    pub synthetic_fresh_repair_estimate_paise: Paise,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DlpExceptionList {
    pub items: Vec<DlpExceptionItem>,
}
