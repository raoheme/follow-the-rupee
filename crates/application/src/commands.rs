//! Request bodies for the three P5 command operations (`submitIssue`, `checkDuplicates`, `addEvidence`), mirroring
//! `SubmitIssueCommand`, `CheckDuplicatesCommand` and `AddEvidenceCommand` in `openapi/openapi.yaml`.
//!
//! Two failure classes, matching the contract's two client-error responses:
//! * structurally wrong JSON (not JSON, a missing or unknown member, a wrong type, an unknown enum value, an identifier or
//!   position that does not match its pattern) is rejected by serde and reported as 400;
//! * a well-formed body that breaks a value rule (length, control characters, ring shape, `recordVersion` below 1) fails
//!   `validate()` and is reported as 422.
//!
//! Error text here is fixed wording that never contains caller input, so it is safe to return and to log.
use mcl_domain::records::{EvidenceSourceType, EvidenceStage, Geometry, IssueCategory, SynId};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeSet;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct Invalid(pub String);

fn invalid<T>(m: &str) -> Result<T, Invalid> {
    Err(Invalid(m.to_string()))
}

/// A member that must be present but may be `null` (the contract lists it as required with a nullable type).
fn required_nullable<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(d)
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Command<P> {
    pub record_version: i64,
    pub payload: P,
}

impl<P> Command<P> {
    pub fn check_version(&self) -> Result<u32, Invalid> {
        if self.record_version < 1 || self.record_version > i64::from(i32::MAX) {
            return invalid("recordVersion must be an integer from 1");
        }
        Ok(self.record_version as u32)
    }
}

pub const TITLE_MAX: usize = 160;
pub const DESCRIPTION_MAX: usize = 400;
pub const LANDMARK_MAX: usize = 160;
pub const CAPTION_MAX: usize = 300;
pub const KEYWORD_MAX: usize = 40;
pub const KEYWORDS_MAX_COUNT: usize = 20;

/// Trim, then require 1..=`max` characters (Unicode scalar values, the same unit as `char_length`) and no control
/// character. Nothing else is rewritten: the civic content is kept exactly as the citizen wrote it.
pub fn clean_text(raw: &str, max: usize, what: &str) -> Result<String, Invalid> {
    let t = raw.trim();
    let n = t.chars().count();
    if n == 0 || n > max {
        return Err(Invalid(format!("{what} must be 1 to {max} characters")));
    }
    if t.chars().any(char::is_control) {
        return Err(Invalid(format!(
            "{what} must not contain control characters"
        )));
    }
    Ok(t.to_string())
}

/// Structural checks the GeoJSON types cannot express. Validity against PostGIS (`ST_IsValid`) is checked in the database layer.
pub fn check_geometry(g: &Geometry) -> Result<(), Invalid> {
    match g {
        Geometry::Point { .. } => Ok(()),
        Geometry::LineString { coordinates } => {
            if coordinates.len() < 2 || coordinates.len() > 500 {
                return invalid("a LineString needs 2 to 500 positions");
            }
            Ok(())
        }
        Geometry::Polygon { coordinates } => {
            if coordinates.is_empty() || coordinates.len() > 8 {
                return invalid("a Polygon needs 1 to 8 rings");
            }
            for ring in coordinates {
                if ring.len() < 4 || ring.len() > 500 || ring.first() != ring.last() {
                    return invalid(
                        "each Polygon ring must be closed and have at least 4 positions",
                    );
                }
            }
            Ok(())
        }
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SubmitIssuePayload {
    pub category: IssueCategory,
    pub geometry: Geometry,
    pub title: String,
    pub public_description: String,
    #[serde(deserialize_with = "required_nullable")]
    pub nearby_landmark: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub asset_id: Option<SynId>,
}

impl SubmitIssuePayload {
    /// The payload with text trimmed; the returned value is also what the idempotency fingerprint is computed from.
    pub fn validated(self) -> Result<SubmitIssuePayload, Invalid> {
        check_geometry(&self.geometry)?;
        let landmark = match self.nearby_landmark {
            Some(l) => Some(clean_text(&l, LANDMARK_MAX, "nearbyLandmark")?),
            None => None,
        };
        Ok(SubmitIssuePayload {
            title: clean_text(&self.title, TITLE_MAX, "title")?,
            public_description: clean_text(
                &self.public_description,
                DESCRIPTION_MAX,
                "publicDescription",
            )?,
            nearby_landmark: landmark,
            ..self
        })
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CheckDuplicatesPayload {
    pub category: IssueCategory,
    pub geometry: Geometry,
    pub description_keywords: Vec<String>,
}

impl CheckDuplicatesPayload {
    /// Keywords are trimmed, lower-cased, de-duplicated and sorted so equal requests have one canonical form.
    pub fn validated(self) -> Result<CheckDuplicatesPayload, Invalid> {
        check_geometry(&self.geometry)?;
        if self.description_keywords.len() > KEYWORDS_MAX_COUNT {
            return Err(Invalid(format!(
                "descriptionKeywords may hold at most {KEYWORDS_MAX_COUNT} items"
            )));
        }
        let mut set = BTreeSet::new();
        for k in &self.description_keywords {
            set.insert(clean_text(k, KEYWORD_MAX, "a keyword")?.to_lowercase());
        }
        Ok(CheckDuplicatesPayload {
            description_keywords: set.into_iter().collect(),
            ..self
        })
    }
}

/// `duplicateChoice` is a closed enum plus `null` (a plain evidence attachment with no duplicate decision).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub enum DuplicateChoice {
    #[serde(rename = "ENDORSE_EXISTING")]
    EndorseExisting,
    #[serde(rename = "ADD_EVIDENCE_TO_EXISTING")]
    AddEvidenceToExisting,
    #[serde(rename = "CREATE_SEPARATE_ISSUE")]
    CreateSeparateIssue,
}

impl DuplicateChoice {
    pub fn wire(self) -> &'static str {
        match self {
            DuplicateChoice::EndorseExisting => "ENDORSE_EXISTING",
            DuplicateChoice::AddEvidenceToExisting => "ADD_EVIDENCE_TO_EXISTING",
            DuplicateChoice::CreateSeparateIssue => "CREATE_SEPARATE_ISSUE",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AddEvidencePayload {
    pub stage: EvidenceStage,
    pub caption: String,
    pub source_type: EvidenceSourceType,
    pub captured_at: String,
    pub media_ref: String,
    pub sha256: String,
    #[serde(deserialize_with = "required_nullable")]
    pub duplicate_choice: Option<DuplicateChoice>,
}

/// `^fixtures/evidence/SYN-DEMO-[A-Z0-9-]+\.svg$`, written without a regex dependency.
pub fn is_fixture_media_ref(s: &str) -> bool {
    s.len() <= 200
        && s.strip_prefix("fixtures/evidence/SYN-DEMO-")
            .and_then(|r| r.strip_suffix(".svg"))
            .is_some_and(|mid| {
                !mid.is_empty()
                    && mid
                        .chars()
                        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '-')
            })
}

pub fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

impl AddEvidencePayload {
    pub fn validated(self) -> Result<AddEvidencePayload, Invalid> {
        if !is_fixture_media_ref(&self.media_ref) {
            return invalid("mediaRef must be a fixtures/evidence/SYN-DEMO-*.svg reference");
        }
        if !is_sha256_hex(&self.sha256) {
            return invalid("sha256 must be 64 lowercase hexadecimal characters");
        }
        Ok(AddEvidencePayload {
            caption: clean_text(&self.caption, CAPTION_MAX, "caption")?,
            ..self
        })
    }
}

// ---------------------------------------------------------------------------------------------------- P6 authority commands

/// Words that would turn an institutional rationale into an accusation against a person or a contractor. The authority
/// rationale is stored in the append-only audit trail, so it is screened before it is written. The screen is a bounded
/// guardrail, not a moderation system: it rejects the listed stems and says so in fixed wording that never echoes input.
const ACCUSATORY_STEMS: &[&str] = &[
    "corrupt",
    "bribe",
    "fraud",
    "embezzl",
    "kickback",
    "theft",
    "stole",
    "negligen",
    "culpab",
    "guilty",
    "criminal",
    "blame",
    "liable",
    "liability",
    "scam",
];

/// The defined contractual term is not an accusation: "defect liability period" names the DLP itself, so it is removed
/// before the screen runs. Any other use of "liable" or "liability" is still refused.
const PERMITTED_TERM: &str = "liability period";

/// The first accusatory stem found in `text` (case-insensitive), if any.
pub fn accusatory_stem(text: &str) -> Option<&'static str> {
    let lower = text.to_lowercase().replace(PERMITTED_TERM, " ");
    ACCUSATORY_STEMS.iter().copied().find(|s| lower.contains(s))
}

fn screened_rationale(raw: &str) -> Result<String, Invalid> {
    let r = clean_text(raw, DESCRIPTION_MAX, "rationale")?;
    if accusatory_stem(&r).is_some() {
        return invalid(
            "rationale must state the institutional basis without accusing a person or a contractor or asserting liability",
        );
    }
    Ok(r)
}

pub const AGENCY_LABEL_MAX: usize = 160;

/// `ResolveJurisdictionPayload.targetStatus`. `CONFLICT_DISPUTED` and the first spatial inference are not commandable: the
/// contract offers only these three targets, and the committed machine reaches them from the provisional or disputed state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub enum JurisdictionTarget {
    #[serde(rename = "CONFIRMED_BMC_WARD")]
    ConfirmedBmcWard,
    #[serde(rename = "EXTERNAL_AGENCY_ASSIGNED")]
    ExternalAgencyAssigned,
    #[serde(rename = "HANDOFF_LOGGED")]
    HandoffLogged,
}

impl JurisdictionTarget {
    pub fn status(self) -> mcl_domain::records::JurisdictionStatus {
        use mcl_domain::records::JurisdictionStatus as S;
        match self {
            JurisdictionTarget::ConfirmedBmcWard => S::ConfirmedBmcWard,
            JurisdictionTarget::ExternalAgencyAssigned => S::ExternalAgencyAssigned,
            JurisdictionTarget::HandoffLogged => S::HandoffLogged,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ResolveJurisdictionPayload {
    pub target_status: JurisdictionTarget,
    #[serde(deserialize_with = "required_nullable")]
    pub external_agency_label: Option<String>,
    pub rationale: String,
}

impl ResolveJurisdictionPayload {
    /// Trims text, screens the rationale and applies the cross-field rules: a confirmed ward carries no agency label, an
    /// external-agency assignment names one, and a handoff may restate the assigned label but never replace it.
    pub fn validated(self) -> Result<ResolveJurisdictionPayload, Invalid> {
        let label = match self.external_agency_label {
            Some(l) => Some(clean_text(&l, AGENCY_LABEL_MAX, "externalAgencyLabel")?),
            None => None,
        };
        match (self.target_status, &label) {
            (JurisdictionTarget::ConfirmedBmcWard, Some(_)) => {
                return invalid("externalAgencyLabel must be null when confirming a BMC ward")
            }
            (JurisdictionTarget::ExternalAgencyAssigned, None) => {
                return invalid("externalAgencyLabel is required when assigning an external agency")
            }
            _ => {}
        }
        Ok(ResolveJurisdictionPayload {
            target_status: self.target_status,
            external_agency_label: label,
            rationale: screened_rationale(&self.rationale)?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LinkWorkPayload {
    pub work_order_id: SynId,
    pub rationale: String,
}

impl LinkWorkPayload {
    pub fn validated(self) -> Result<LinkWorkPayload, Invalid> {
        Ok(LinkWorkPayload {
            work_order_id: self.work_order_id,
            rationale: screened_rationale(&self.rationale)?,
        })
    }
}

pub type SubmitIssueCommand = Command<SubmitIssuePayload>;
pub type CheckDuplicatesCommand = Command<CheckDuplicatesPayload>;
pub type AddEvidenceCommand = Command<AddEvidencePayload>;
pub type ResolveJurisdictionCommand = Command<ResolveJurisdictionPayload>;
pub type LinkWorkCommand = Command<LinkWorkPayload>;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn submit(v: serde_json::Value) -> Result<SubmitIssueCommand, serde_json::Error> {
        serde_json::from_value(v)
    }

    fn good() -> serde_json::Value {
        json!({"recordVersion": 1, "payload": {
            "category": "POTHOLE",
            "geometry": {"type": "Point", "coordinates": [72.8316, 19.1198]},
            "title": "  Surface break near the junction ",
            "publicDescription": "Synthetic description.",
            "nearbyLandmark": null,
            "assetId": "SYN-DEMO-AST-ROAD-001"
        }})
    }

    #[test]
    fn a_contract_shaped_body_parses_and_text_is_trimmed() {
        let c = submit(good()).unwrap();
        assert_eq!(c.check_version().unwrap(), 1);
        let p = c.payload.validated().unwrap();
        assert_eq!(p.title, "Surface break near the junction");
        assert!(p.nearby_landmark.is_none());
    }

    #[test]
    fn structural_problems_fail_parsing() {
        let mut unknown = good();
        unknown["payload"]["extra"] = json!(1);
        assert!(submit(unknown).is_err());
        let mut missing = good();
        missing["payload"]
            .as_object_mut()
            .unwrap()
            .remove("nearbyLandmark");
        assert!(
            submit(missing).is_err(),
            "required nullable member must be present"
        );
        let mut bad_enum = good();
        bad_enum["payload"]["category"] = json!("ROADWORKS");
        assert!(submit(bad_enum).is_err());
        let mut swapped = good();
        swapped["payload"]["geometry"]["coordinates"] = json!([19.1198, 72.8316]);
        assert!(
            submit(swapped).is_err(),
            "lat/lon order and Mumbai bounds are enforced"
        );
        let mut bad_id = good();
        bad_id["payload"]["assetId"] = json!("asset-1");
        assert!(submit(bad_id).is_err());
        assert!(submit(json!({"payload": good()["payload"]})).is_err());
    }

    #[test]
    fn value_rules_fail_validation() {
        let mut c = submit(good()).unwrap();
        c.payload.title = "x".repeat(161);
        assert!(c.payload.clone().validated().is_err());
        c.payload.title = "   ".into();
        assert!(c.payload.clone().validated().is_err());
        c.payload.title = "ok\u{0007}bell".into();
        assert!(c.payload.clone().validated().is_err());
        c.payload.title = "line\nbreak".into();
        assert!(c.payload.clone().validated().is_err());
        c.payload.title = "x".repeat(160);
        c.payload.public_description = "d".repeat(401);
        assert!(c.payload.clone().validated().is_err());
        let zero = Command {
            record_version: 0,
            payload: (),
        };
        assert!(zero.check_version().is_err());
    }

    #[test]
    fn keywords_are_canonical_lowercase_sorted_and_bounded() {
        let p = CheckDuplicatesPayload {
            category: IssueCategory::Pothole,
            geometry: Geometry::Point {
                coordinates: serde_json::from_value(json!([72.8316, 19.1198])).unwrap(),
            },
            description_keywords: vec!["Paliram".into(), " pothole ".into(), "PALIRAM".into()],
        };
        assert_eq!(
            p.clone().validated().unwrap().description_keywords,
            ["paliram", "pothole"]
        );
        let mut many = p.clone();
        many.description_keywords = (0..21).map(|i| format!("k{i}")).collect();
        assert!(many.validated().is_err());
        let mut long = p;
        long.description_keywords = vec!["k".repeat(41)];
        assert!(long.validated().is_err());
    }

    #[test]
    fn evidence_references_are_fixture_only() {
        assert!(is_fixture_media_ref(
            "fixtures/evidence/SYN-DEMO-EVD-R1A2B3C4D.svg"
        ));
        for bad in [
            "https://example.com/x.svg",
            "fixtures/evidence/SYN-DEMO-.svg",
            "fixtures/evidence/SYN-DEMO-evd-1.svg",
            "fixtures/evidence/../SYN-DEMO-EVD-1.svg",
            "fixtures/evidence/SYN-DEMO-EVD-1.png",
        ] {
            assert!(!is_fixture_media_ref(bad), "{bad}");
        }
        assert!(is_sha256_hex(&"a".repeat(64)));
        assert!(!is_sha256_hex(&"A".repeat(64)));
        assert!(!is_sha256_hex("abc"));
    }

    #[test]
    fn duplicate_choice_accepts_only_the_enum_or_null() {
        let ok: Result<AddEvidencePayload, _> = serde_json::from_value(json!({
            "stage": "BEFORE", "caption": "c", "sourceType": "CITIZEN_FIXTURE",
            "capturedAt": "2026-11-21T04:00:00Z", "mediaRef": "fixtures/evidence/SYN-DEMO-EVD-1.svg",
            "sha256": "a".repeat(64), "duplicateChoice": null
        }));
        assert!(ok.is_ok());
        let bad: Result<AddEvidencePayload, _> = serde_json::from_value(json!({
            "stage": "BEFORE", "caption": "c", "sourceType": "CITIZEN_FIXTURE",
            "capturedAt": "2026-11-21T04:00:00Z", "mediaRef": "fixtures/evidence/SYN-DEMO-EVD-1.svg",
            "sha256": "a".repeat(64), "duplicateChoice": "MERGE"
        }));
        assert!(bad.is_err());
    }
}

#[cfg(test)]
mod p6_tests {
    use super::*;
    use serde_json::json;

    fn resolve(v: serde_json::Value) -> Result<ResolveJurisdictionCommand, serde_json::Error> {
        serde_json::from_value(v)
    }

    fn body(target: &str, label: serde_json::Value, rationale: &str) -> serde_json::Value {
        json!({"recordVersion": 1, "payload": {
            "targetStatus": target, "externalAgencyLabel": label, "rationale": rationale
        }})
    }

    #[test]
    fn a_contract_shaped_jurisdiction_command_parses_and_validates() {
        let c = resolve(body(
            "CONFIRMED_BMC_WARD",
            json!(null),
            "  Ward office record reviewed.  ",
        ))
        .unwrap();
        let p = c.payload.validated().unwrap();
        assert_eq!(p.rationale, "Ward office record reviewed.");
        assert!(p.external_agency_label.is_none());
        let c = resolve(body(
            "EXTERNAL_AGENCY_ASSIGNED",
            json!("Synthetic metro agency"),
            "Corridor belongs to a non-ward agency.",
        ))
        .unwrap();
        assert!(c.payload.validated().is_ok());
    }

    #[test]
    fn structural_problems_in_the_jurisdiction_command_fail_parsing() {
        // an unknown or non-commandable target
        assert!(resolve(body("CONFLICT_DISPUTED", json!(null), "r")).is_err());
        assert!(resolve(body("UNKNOWN", json!(null), "r")).is_err());
        // the nullable label must be present
        assert!(resolve(json!({"recordVersion": 1, "payload": {"targetStatus": "CONFIRMED_BMC_WARD", "rationale": "r"}})).is_err());
        // unknown member, missing rationale
        let mut extra = body("CONFIRMED_BMC_WARD", json!(null), "r");
        extra["payload"]["legalOwner"] = json!("x");
        assert!(resolve(extra).is_err());
        assert!(resolve(json!({"recordVersion": 1, "payload": {"targetStatus": "HANDOFF_LOGGED", "externalAgencyLabel": null}})).is_err());
    }

    #[test]
    fn cross_field_rules_follow_the_machine_meaning_of_each_target() {
        let confirm_with_label =
            resolve(body("CONFIRMED_BMC_WARD", json!("Some agency"), "r")).unwrap();
        assert!(confirm_with_label.payload.validated().is_err());
        let assign_without_label =
            resolve(body("EXTERNAL_AGENCY_ASSIGNED", json!(null), "r")).unwrap();
        assert!(assign_without_label.payload.validated().is_err());
        let handoff_without_label = resolve(body("HANDOFF_LOGGED", json!(null), "r")).unwrap();
        assert!(handoff_without_label.payload.validated().is_ok());
    }

    #[test]
    fn rationale_and_label_are_bounded_and_clean() {
        for bad in ["", "   ", "line\nbreak", &"x".repeat(401)] {
            let c = resolve(body("HANDOFF_LOGGED", json!(null), bad)).unwrap();
            assert!(c.payload.validated().is_err(), "{bad:?}");
        }
        let c = resolve(body(
            "EXTERNAL_AGENCY_ASSIGNED",
            json!("a".repeat(161)),
            "r",
        ))
        .unwrap();
        assert!(c.payload.validated().is_err());
        let c = resolve(body("HANDOFF_LOGGED", json!(null), &"x".repeat(400))).unwrap();
        assert!(c.payload.validated().is_ok());
    }

    #[test]
    fn an_accusatory_rationale_is_rejected_without_echoing_it() {
        for bad in [
            "The contractor was negligent on this segment",
            "Clear FRAUD by the department",
            "contractor is liable for the repair",
            "someone took a bribe",
        ] {
            let c = resolve(body("HANDOFF_LOGGED", json!(null), bad)).unwrap();
            let e = c.payload.validated().unwrap_err();
            assert!(
                !e.0.contains("negligent") && !e.0.to_lowercase().contains("fraud"),
                "{}",
                e.0
            );
        }
        let c = resolve(body(
            "HANDOFF_LOGGED",
            json!(null),
            "Handed to the corridor agency for its review.",
        ))
        .unwrap();
        assert!(c.payload.validated().is_ok());
        // the defined term "defect liability period" is allowed; any other liability wording is not
        assert!(accusatory_stem("Certified work inside its Defect Liability Period.").is_none());
        assert!(accusatory_stem("Liability period noted; the contractor is liable.").is_some());
        assert!(accusatory_stem("The contractor accepts liability.").is_some());
    }

    #[test]
    fn link_work_requires_a_synthetic_work_order_id_and_a_clean_rationale() {
        let ok: LinkWorkCommand = serde_json::from_value(json!({"recordVersion": 2, "payload": {
            "workOrderId": "SYN-DEMO-WO-001", "rationale": "Same road segment; certified work inside its defect liability period."}})).unwrap();
        assert!(ok.payload.validated().is_ok());
        let bad_id: Result<LinkWorkCommand, _> =
            serde_json::from_value(json!({"recordVersion": 2, "payload": {
            "workOrderId": "work-1", "rationale": "r"}}));
        assert!(bad_id.is_err());
        let accuse: LinkWorkCommand =
            serde_json::from_value(json!({"recordVersion": 2, "payload": {
            "workOrderId": "SYN-DEMO-WO-001", "rationale": "Contractor is guilty of poor work."}}))
            .unwrap();
        assert!(accuse.payload.validated().is_err());
    }
}
