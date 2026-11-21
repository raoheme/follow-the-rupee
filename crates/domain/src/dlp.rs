//! Defect liability period (DLP) status is derived, never stored. The evaluation instant is always explicit.
use serde::{Deserialize, Serialize};
use time::{Date, OffsetDateTime, Time};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
pub enum DlpStatus {
    #[serde(rename = "NOT_STARTED")]
    NotStarted,
    #[serde(rename = "ACTIVE")]
    Active,
    #[serde(rename = "EXPIRED")]
    Expired,
}

/// `starts_on` begins at UTC midnight; `ends_at` is the work order's `dlpEndsAt` and is inclusive.
pub fn dlp_status_at(starts_on: Date, ends_at: OffsetDateTime, at: OffsetDateTime) -> DlpStatus {
    let starts = starts_on.with_time(Time::MIDNIGHT).assume_utc();
    if at < starts {
        DlpStatus::NotStarted
    } else if at <= ends_at {
        DlpStatus::Active
    } else {
        DlpStatus::Expired
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::format_description::well_known::{Iso8601, Rfc3339};

    fn at(s: &str) -> OffsetDateTime {
        OffsetDateTime::parse(s, &Rfc3339).unwrap()
    }

    #[test]
    fn derives_status_from_explicit_instants() {
        let starts = Date::parse("2026-04-01", &Iso8601::DATE).unwrap();
        let ends = at("2027-03-31T18:29:59Z");
        assert_eq!(
            dlp_status_at(starts, ends, at("2026-03-31T23:59:59Z")),
            DlpStatus::NotStarted
        );
        assert_eq!(
            dlp_status_at(starts, ends, at("2026-04-01T00:00:00Z")),
            DlpStatus::Active
        );
        // CAP-0 evaluation date used by the tests; never the wall clock
        assert_eq!(
            dlp_status_at(starts, ends, at("2026-11-20T00:00:00Z")),
            DlpStatus::Active
        );
        assert_eq!(
            dlp_status_at(starts, ends, at("2027-03-31T18:29:59Z")),
            DlpStatus::Active
        );
        assert_eq!(
            dlp_status_at(starts, ends, at("2027-03-31T18:30:00Z")),
            DlpStatus::Expired
        );
    }
}
