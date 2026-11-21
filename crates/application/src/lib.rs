//! Application layer: the single normalized read-filter model shared by `GET /v1/map/features` and `GET /v1/issues`,
//! the strict query parser, the response DTOs (P3/P4), the deterministic duplicate scorer and the strict command request
//! bodies (P5). No I/O happens here.
pub mod commands;
pub mod dedup;
pub mod dto;
pub mod filter;

pub use dto::{
    BudgetTraceView, DlpView, Envelope, FeatureKind, IssueList, KundaliView, MapFeature,
    MapFeatureCollection, MapFeatureProperties, WorkOrderDetailView,
};
pub use filter::{parse_query, Bbox, Endpoint, IssueFilter, ParsedQuery, QueryError};
