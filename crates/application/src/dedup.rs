//! Deterministic duplicate scoring (`DEMONSTRATION_HEURISTIC_V1`).
//!
//! The only authority for factors, weights, thresholds, radii and windows is `config/duplicate-policy.json`, embedded at build
//! time and parsed once at startup. Nothing below hard-codes a weight, a radius, a window or a band boundary. The score is a
//! demonstration heuristic: it is not a probability, not an AI confidence, not a legal conclusion, and it never merges or
//! rejects a report. No wall clock is read here; every input (including the hours between two reports) is supplied by the caller.
use mcl_domain::policy::DuplicatePolicy;
use mcl_domain::records::SynId;
use serde::Serialize;
use std::collections::BTreeSet;

/// The committed policy file, embedded so the running binary and the file in the repository cannot disagree.
pub const POLICY_JSON: &str = include_str!("../../../config/duplicate-policy.json");

/// The label the contract fixes (`DuplicateCandidates.policyLabel`).
pub const CONTRACT_POLICY_LABEL: &str = "DEMONSTRATION_HEURISTIC_V1";

/// Parse and sanity-check the committed policy. Startup fails on any inconsistency instead of scoring with a wrong policy.
pub fn load_policy() -> Result<DuplicatePolicy, String> {
    let p = DuplicatePolicy::from_json(POLICY_JSON).map_err(|e| e.to_string())?;
    validate_policy(&p)?;
    Ok(p)
}

pub fn validate_policy(p: &DuplicatePolicy) -> Result<(), String> {
    if p.label != CONTRACT_POLICY_LABEL {
        return Err("policy label differs from the contract label".into());
    }
    if p.weights.total() != 100 {
        return Err("policy weights must total 100".into());
    }
    if !p.silent_rejection_forbidden {
        return Err("policy must forbid silent rejection".into());
    }
    for c in [
        "ENDORSE_EXISTING",
        "ADD_EVIDENCE_TO_EXISTING",
        "CREATE_SEPARATE_ISSUE",
    ] {
        if !p.choices.iter().any(|x| x == c) {
            return Err(format!("policy choices must include {c}"));
        }
    }
    let t = &p.thresholds;
    if t.probably_distinct[0] != 0
        || t.possible[0] != t.probably_distinct[1] + 1
        || t.likely_same[0] != t.possible[1] + 1
        || t.likely_same[1] != 100
    {
        return Err("policy bands must be contiguous and cover 0..=100".into());
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Band {
    #[serde(rename = "LIKELY_SAME")]
    LikelySame,
    #[serde(rename = "POSSIBLE_MATCH")]
    PossibleMatch,
    #[serde(rename = "PROBABLY_DISTINCT")]
    ProbablyDistinct,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Breakdown {
    pub same_asset_or_segment: u32,
    pub same_category: u32,
    pub within_configured_radius: u32,
    pub within_configured_window: u32,
    pub keyword_overlap: u32,
}

impl Breakdown {
    pub fn total(&self) -> u32 {
        self.same_asset_or_segment
            + self.same_category
            + self.within_configured_radius
            + self.within_configured_window
            + self.keyword_overlap
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub issue_id: SynId,
    pub score: u32,
    pub band: Band,
    pub breakdown: Breakdown,
    pub possible_recurrence: bool,
}

/// What is known about the report being checked.
#[derive(Debug, Clone)]
pub struct Subject {
    pub category: String,
    pub asset_id: Option<String>,
    /// Normalised keyword tokens (see [`keyword_tokens`]).
    pub keywords: BTreeSet<String>,
}

/// What is known about one previously reported issue, as measured by the database.
#[derive(Debug, Clone)]
pub struct CandidateFacts {
    pub id: String,
    pub category: String,
    pub status: String,
    pub asset_id: Option<String>,
    /// PostGIS geography distance in metres between the two geometries; `None` when it could not be measured.
    pub distance_meters: Option<f64>,
    /// Absolute hours between the two `reportedAt` instants (never a wall-clock reading).
    pub hours_apart: f64,
    /// Title and description of the candidate, used only for keyword overlap.
    pub text: String,
}

/// Lower-cased alphanumeric runs. Used for both the submitted keywords and the candidate text so they compare identically.
pub fn keyword_tokens<'a>(texts: impl IntoIterator<Item = &'a str>) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for t in texts {
        let mut cur = String::new();
        for ch in t.chars() {
            if ch.is_alphanumeric() {
                cur.extend(ch.to_lowercase());
            } else if !cur.is_empty() {
                out.insert(std::mem::take(&mut cur));
            }
        }
        if !cur.is_empty() {
            out.insert(cur);
        }
    }
    out
}

pub fn band_for(policy: &DuplicatePolicy, score: u32) -> Band {
    if score >= policy.thresholds.likely_same[0] {
        Band::LikelySame
    } else if score >= policy.thresholds.possible[0] {
        Band::PossibleMatch
    } else {
        Band::ProbablyDistinct
    }
}

/// Score one candidate. Every factor is all-or-nothing except keyword overlap, which is `floor(weight * matched / submitted)`
/// in integer arithmetic. A category with no entry in `categoryPolicies` has no committed radius or window, so those two
/// factors stay 0 for it: the policy defines no default and none is invented here.
pub fn score_candidate(
    policy: &DuplicatePolicy,
    subject: &Subject,
    c: &CandidateFacts,
) -> Option<Candidate> {
    let w = &policy.weights;
    let cat_policy = policy.category_policies.get(&subject.category);

    let same_asset = matches!((&subject.asset_id, &c.asset_id), (Some(a), Some(b)) if a == b);
    let same_category = subject.category == c.category;
    let in_radius = match (cat_policy, c.distance_meters) {
        (Some(p), Some(d)) => d <= p.radius_meters,
        _ => false,
    };
    let in_window = cat_policy.is_some_and(|p| c.hours_apart <= f64::from(p.window_hours));
    let keyword_points = if subject.keywords.is_empty() {
        0
    } else {
        let tokens = keyword_tokens([c.text.as_str()]);
        let matched = subject.keywords.intersection(&tokens).count() as u64;
        (u64::from(w.keyword_overlap) * matched / subject.keywords.len() as u64) as u32
    };

    let breakdown = Breakdown {
        same_asset_or_segment: if same_asset {
            w.same_asset_or_segment
        } else {
            0
        },
        same_category: if same_category { w.same_category } else { 0 },
        within_configured_radius: if in_radius {
            w.within_configured_radius
        } else {
            0
        },
        within_configured_window: if in_window {
            w.within_configured_window
        } else {
            0
        },
        keyword_overlap: keyword_points,
    };
    let score = breakdown.total();
    Some(Candidate {
        issue_id: SynId::try_from(c.id.clone()).ok()?,
        score,
        band: band_for(policy, score),
        breakdown,
        // A verified-complete match is surfaced as a possible recurrence, never merged (policy safety rule).
        possible_recurrence: c.status == "VERIFIED_COMPLETE",
    })
}

/// Deterministic order: score descending, then issue id ascending.
pub fn rank(mut v: Vec<Candidate>) -> Vec<Candidate> {
    v.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| a.issue_id.as_str().cmp(b.issue_id.as_str()))
    });
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> DuplicatePolicy {
        load_policy().unwrap()
    }

    fn subject(kw: &[&str]) -> Subject {
        Subject {
            category: "POTHOLE".into(),
            asset_id: Some("SYN-DEMO-AST-ROAD-001".into()),
            keywords: keyword_tokens(kw.iter().copied()),
        }
    }

    fn facts(id: &str) -> CandidateFacts {
        CandidateFacts {
            id: id.into(),
            category: "POTHOLE".into(),
            status: "SUBMITTED_UNVERIFIED".into(),
            asset_id: Some("SYN-DEMO-AST-ROAD-001".into()),
            distance_meters: Some(9.513),
            hours_apart: 24.0,
            text: "Pothole near the S.V. Road junction on Paliram Road".into(),
        }
    }

    #[test]
    fn the_committed_policy_loads_and_every_weight_comes_from_it() {
        let p = policy();
        assert_eq!(p.label, CONTRACT_POLICY_LABEL);
        assert_eq!(p.weights.total(), 100);
        let c = score_candidate(&p, &subject(&["pothole"]), &facts("SYN-DEMO-KND-001")).unwrap();
        assert_eq!(
            c.breakdown.same_asset_or_segment,
            p.weights.same_asset_or_segment
        );
        assert_eq!(c.breakdown.same_category, p.weights.same_category);
        assert_eq!(
            c.breakdown.within_configured_radius,
            p.weights.within_configured_radius
        );
        assert_eq!(
            c.breakdown.within_configured_window,
            p.weights.within_configured_window
        );
        assert_eq!(c.breakdown.keyword_overlap, p.weights.keyword_overlap);
        assert_eq!(c.score, 100);
        assert_eq!(c.band, Band::LikelySame);
    }

    #[test]
    fn a_policy_with_other_weights_changes_the_result_proving_nothing_is_hard_coded() {
        let mut p = policy();
        p.weights.same_asset_or_segment = 30;
        p.weights.same_category = 30;
        let c = score_candidate(&p, &subject(&["pothole"]), &facts("SYN-DEMO-KND-001")).unwrap();
        assert_eq!(c.breakdown.same_asset_or_segment, 30);
        assert_eq!(c.breakdown.same_category, 30);
        assert_eq!(c.score, 100);
        p.thresholds.likely_same[0] = 101;
        assert_ne!(band_for(&p, 100), Band::LikelySame);
    }

    #[test]
    fn radius_and_window_boundaries_are_inclusive_and_use_the_category_policy() {
        let p = policy();
        let radius = p.category_policies["POTHOLE"].radius_meters;
        let window = f64::from(p.category_policies["POTHOLE"].window_hours);
        let mut f = facts("SYN-DEMO-KND-001");
        f.distance_meters = Some(radius);
        f.hours_apart = window;
        let c = score_candidate(&p, &subject(&[]), &f).unwrap();
        assert_eq!(
            c.breakdown.within_configured_radius,
            p.weights.within_configured_radius
        );
        assert_eq!(
            c.breakdown.within_configured_window,
            p.weights.within_configured_window
        );
        f.distance_meters = Some(radius + 0.001);
        f.hours_apart = window + 0.001;
        let c = score_candidate(&p, &subject(&[]), &f).unwrap();
        assert_eq!(c.breakdown.within_configured_radius, 0);
        assert_eq!(c.breakdown.within_configured_window, 0);
    }

    #[test]
    fn a_category_without_a_committed_policy_earns_no_radius_or_window_points() {
        let p = policy();
        let s = Subject {
            category: "DRAIN_BLOCKAGE".into(),
            asset_id: None,
            keywords: BTreeSet::new(),
        };
        let mut f = facts("SYN-DEMO-KND-006");
        f.category = "DRAIN_BLOCKAGE".into();
        let c = score_candidate(&p, &s, &f).unwrap();
        assert_eq!(c.breakdown.within_configured_radius, 0);
        assert_eq!(c.breakdown.within_configured_window, 0);
        assert_eq!(c.breakdown.same_asset_or_segment, 0);
        assert_eq!(c.breakdown.same_category, p.weights.same_category);
    }

    #[test]
    fn keyword_points_are_integer_floor_of_the_matched_share() {
        let p = policy();
        let f = facts("SYN-DEMO-KND-001");
        let one_of_three =
            score_candidate(&p, &subject(&["pothole", "zebra", "crane"]), &f).unwrap();
        assert_eq!(
            one_of_three.breakdown.keyword_overlap,
            p.weights.keyword_overlap / 3
        );
        let none = score_candidate(&p, &subject(&["zebra"]), &f).unwrap();
        assert_eq!(none.breakdown.keyword_overlap, 0);
        let empty = score_candidate(&p, &subject(&[]), &f).unwrap();
        assert_eq!(empty.breakdown.keyword_overlap, 0);
    }

    #[test]
    fn bands_follow_the_policy_thresholds_at_every_boundary() {
        let p = policy();
        let t = &p.thresholds;
        assert_eq!(band_for(&p, t.likely_same[1]), Band::LikelySame);
        assert_eq!(band_for(&p, t.likely_same[0]), Band::LikelySame);
        assert_eq!(band_for(&p, t.possible[1]), Band::PossibleMatch);
        assert_eq!(band_for(&p, t.possible[0]), Band::PossibleMatch);
        assert_eq!(band_for(&p, t.probably_distinct[1]), Band::ProbablyDistinct);
        assert_eq!(band_for(&p, 0), Band::ProbablyDistinct);
    }

    #[test]
    fn a_verified_complete_match_is_a_possible_recurrence_and_is_still_scored() {
        let p = policy();
        let mut f = facts("SYN-DEMO-KND-001");
        f.status = "VERIFIED_COMPLETE".into();
        let c = score_candidate(&p, &subject(&[]), &f).unwrap();
        assert!(c.possible_recurrence);
        f.status = "IN_PROGRESS".into();
        assert!(
            !score_candidate(&p, &subject(&[]), &f)
                .unwrap()
                .possible_recurrence
        );
    }

    #[test]
    fn ranking_is_score_descending_then_id_ascending_and_repeatable() {
        let p = policy();
        let mut a = facts("SYN-DEMO-KND-009");
        let mut b = facts("SYN-DEMO-KND-002");
        a.hours_apart = 1.0;
        b.hours_apart = 1.0;
        let mut low = facts("SYN-DEMO-KND-001");
        low.distance_meters = None;
        low.asset_id = None;
        let s = subject(&["pothole"]);
        let build = || {
            rank(vec![
                score_candidate(&p, &s, &a).unwrap(),
                score_candidate(&p, &s, &low).unwrap(),
                score_candidate(&p, &s, &b).unwrap(),
            ])
        };
        let first = build();
        let ids: Vec<&str> = first.iter().map(|c| c.issue_id.as_str()).collect();
        assert_eq!(
            ids,
            ["SYN-DEMO-KND-002", "SYN-DEMO-KND-009", "SYN-DEMO-KND-001"]
        );
        assert_eq!(first, build());
    }

    #[test]
    fn tokenisation_is_case_insensitive_and_alphanumeric() {
        let t = keyword_tokens(["Pothole-like surface, Paliram Road!"]);
        assert!(t.contains("pothole") && t.contains("like") && t.contains("paliram"));
        assert!(!t.iter().any(|x| x.contains('-') || x.contains(',')));
    }

    #[test]
    fn inconsistent_policies_are_rejected() {
        let mut p = policy();
        p.weights.keyword_overlap += 1;
        assert!(validate_policy(&p).is_err());
        let mut p = policy();
        p.thresholds.possible[0] += 1;
        assert!(validate_policy(&p).is_err());
        let mut p = policy();
        p.silent_rejection_forbidden = false;
        assert!(validate_policy(&p).is_err());
    }
}
