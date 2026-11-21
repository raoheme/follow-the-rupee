//! Duplicate-detection policy, read from config/duplicate-policy.json (never hardcoded in code or SQL).
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Weights {
    pub same_asset_or_segment: u32,
    pub same_category: u32,
    pub within_configured_radius: u32,
    pub within_configured_window: u32,
    pub keyword_overlap: u32,
}

impl Weights {
    pub fn total(&self) -> u32 {
        self.same_asset_or_segment
            + self.same_category
            + self.within_configured_radius
            + self.within_configured_window
            + self.keyword_overlap
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Thresholds {
    pub likely_same: [u32; 2],
    pub possible: [u32; 2],
    pub probably_distinct: [u32; 2],
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CategoryPolicy {
    pub radius_meters: f64,
    pub window_hours: u32,
    #[serde(default)]
    pub consider_carriageway_side: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DuplicatePolicy {
    pub version: String,
    pub label: String,
    pub weights: Weights,
    pub thresholds: Thresholds,
    pub category_policies: BTreeMap<String, CategoryPolicy>,
    pub choices: Vec<String>,
    pub silent_rejection_forbidden: bool,
}

impl DuplicatePolicy {
    pub fn from_json(text: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(text)
    }

    pub fn radius_meters(&self, category: &str) -> Option<f64> {
        self.category_policies
            .get(category)
            .map(|c| c.radius_meters)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repository_policy_parses_and_is_consistent() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../config/duplicate-policy.json");
        let p = DuplicatePolicy::from_json(&std::fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(p.label, "DEMONSTRATION_HEURISTIC_V1");
        assert_eq!(p.weights.total(), 100);
        assert!(p.radius_meters("POTHOLE").unwrap() > 0.0);
        assert_eq!(p.choices.len(), 3);
        assert!(p.silent_rejection_forbidden);
    }

    #[test]
    fn unknown_policy_fields_are_rejected() {
        let bad = r#"{"version":"1","label":"x","weights":{"sameAssetOrSegment":1,"sameCategory":1,"withinConfiguredRadius":1,"withinConfiguredWindow":1,"keywordOverlap":1,"extra":1},"thresholds":{"likelySame":[1,2],"possible":[1,2],"probablyDistinct":[1,2]},"categoryPolicies":{},"choices":[],"silentRejectionForbidden":true}"#;
        assert!(DuplicatePolicy::from_json(bad).is_err());
    }
}
