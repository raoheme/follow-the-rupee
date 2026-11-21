//! The committed jurisdiction state machine (`config/jurisdiction-state-machine.json`), embedded so the running binary and the
//! file in the repository cannot disagree. Jurisdiction is a workflow status in the demonstration, never a legal determination:
//! spatial inference stays `SPATIALLY_INFERRED_PROVISIONAL` until an authorized command resolves it.
use crate::records::JurisdictionStatus;
use serde::Deserialize;

pub const MACHINE_JSON: &str = include_str!("../../../config/jurisdiction-state-machine.json");

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Transition {
    pub from: JurisdictionStatus,
    pub to: JurisdictionStatus,
    pub allowed_roles: Vec<String>,
    pub preconditions: Vec<String>,
    pub required_evidence: Vec<String>,
    pub emitted_event: String,
    pub idempotency: String,
    pub concurrency: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Machine {
    pub machine_id: String,
    pub version: String,
    pub transitions: Vec<Transition>,
}

/// The wire spelling of a status (the same string the database CHECK constraint and the contract use).
pub fn wire(s: JurisdictionStatus) -> String {
    serde_json::to_value(s)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

impl Machine {
    /// Parse and sanity-check the committed machine. Startup fails on any inconsistency instead of running a wrong machine.
    pub fn load() -> Result<Machine, String> {
        let m: Machine = serde_json::from_str(MACHINE_JSON).map_err(|e| e.to_string())?;
        if m.machine_id != "JURISDICTION" || m.version != crate::PACKAGE_VERSION {
            return Err("jurisdiction machine id or version is not the committed one".into());
        }
        for t in &m.transitions {
            if t.idempotency != "REQUIRED" || t.concurrency != "RECORD_VERSION_REQUIRED" {
                return Err(
                    "every jurisdiction transition must require idempotency and recordVersion"
                        .into(),
                );
            }
            if t.emitted_event != format!("JURISDICTION_{}", wire(t.to)) {
                return Err("an emitted event must be JURISDICTION_<target status>".into());
            }
            if t.allowed_roles.is_empty() {
                return Err("a transition without an allowed role cannot be authorised".into());
            }
        }
        Ok(m)
    }

    pub fn find(&self, from: JurisdictionStatus, to: JurisdictionStatus) -> Option<&Transition> {
        self.transitions
            .iter()
            .find(|t| t.from == from && t.to == to)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use JurisdictionStatus as S;

    #[test]
    fn the_committed_machine_loads_and_is_consistent() {
        let m = Machine::load().unwrap();
        assert_eq!(m.transitions.len(), 7);
        assert!(m
            .transitions
            .iter()
            .all(|t| t.allowed_roles == ["authority"]));
    }

    #[test]
    fn only_the_committed_transitions_are_legal() {
        let m = Machine::load().unwrap();
        for (a, b) in [
            (S::SpatiallyInferredProvisional, S::ConfirmedBmcWard),
            (S::SpatiallyInferredProvisional, S::ExternalAgencyAssigned),
            (S::ConflictDisputed, S::ConfirmedBmcWard),
            (S::ConflictDisputed, S::ExternalAgencyAssigned),
            (S::ExternalAgencyAssigned, S::HandoffLogged),
        ] {
            assert!(m.find(a, b).is_some(), "{a:?} -> {b:?}");
        }
        for (a, b) in [
            // spatial inference cannot jump straight to a logged handoff
            (S::SpatiallyInferredProvisional, S::HandoffLogged),
            // a confirmed ward is final in this machine
            (S::ConfirmedBmcWard, S::ExternalAgencyAssigned),
            (S::ConfirmedBmcWard, S::ConflictDisputed),
            (S::HandoffLogged, S::ConfirmedBmcWard),
            (S::ExternalAgencyAssigned, S::ConfirmedBmcWard),
            (S::Unknown, S::ConfirmedBmcWard),
            (S::ConflictDisputed, S::HandoffLogged),
            (S::ConfirmedBmcWard, S::ConfirmedBmcWard),
        ] {
            assert!(m.find(a, b).is_none(), "{a:?} -> {b:?} must be illegal");
        }
    }

    #[test]
    fn emitted_events_are_named_after_the_target() {
        let m = Machine::load().unwrap();
        let t = m
            .find(S::ConflictDisputed, S::ExternalAgencyAssigned)
            .unwrap();
        assert_eq!(t.emitted_event, "JURISDICTION_EXTERNAL_AGENCY_ASSIGNED");
    }
}
