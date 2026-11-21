//! One normalized filter model for the two read endpoints.
//!
//! Semantics (all frozen by `openapi/openapi.yaml`, nothing here widens the contract):
//! * Parameters are case-sensitive. An omitted parameter means "no restriction".
//! * An empty value (`?ward=`), a repeated parameter (multiple values) and an unknown parameter name are rejected with a 400
//!   problem; the contract declares every parameter as a single scalar.
//! * `ward` is the ward **code** (`K/W`, pattern `^[A-Z](/[A-Z])?$`), never a ward record id or display name.
//! * `category` and `status` are the exact upper-case enum values of `CivicIssue`.
//! * `dlpOnly` accepts only `true` or `false`; `false` is identical to omitting it (no restriction).
//! * `bbox` is `minLon,minLat,maxLon,maxLat` in WGS 84, required on the map endpoint only. It must satisfy
//!   `minLon < maxLon`, `minLat < maxLat`, longitude in [-180, 180] and latitude in [-90, 90]. Matching uses
//!   `ST_Intersects` against the envelope in SRID 4326, so a feature that only touches the envelope edge is included.
use mcl_domain::records::{IssueCategory, IssueStatus};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Endpoint {
    MapFeatures,
    IssueList,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Bbox {
    pub min_lon: f64,
    pub min_lat: f64,
    pub max_lon: f64,
    pub max_lat: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct IssueFilter {
    /// Ward code such as `K/W`.
    pub ward: Option<String>,
    pub category: Option<IssueCategory>,
    pub status: Option<IssueStatus>,
    /// `true` restricts to records with an active defect liability period; `false` and omitted are the same.
    pub dlp_only: bool,
}

impl IssueFilter {
    pub fn category_wire(&self) -> Option<String> {
        self.category.map(wire)
    }
    pub fn status_wire(&self) -> Option<String> {
        self.status.map(wire)
    }
}

fn wire<T: serde::Serialize>(v: T) -> String {
    match serde_json::to_value(v) {
        Ok(Value::String(s)) => s,
        _ => String::new(),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedQuery {
    pub filter: IssueFilter,
    pub bbox: Option<Bbox>,
}

/// A client error. The detail never echoes caller-supplied text.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct QueryError(pub String);

fn err<T>(m: &str) -> Result<T, QueryError> {
    Err(QueryError(m.to_string()))
}

fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' => {
                let hex = s.get(i + 1..i + 3)?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

fn is_ward_code(s: &str) -> bool {
    let c: Vec<char> = s.chars().collect();
    let up = |x: char| x.is_ascii_uppercase();
    match c.as_slice() {
        [a] => up(*a),
        [a, '/', b] => up(*a) && up(*b),
        _ => false,
    }
}

fn is_decimal(s: &str) -> bool {
    let s = s.strip_prefix('-').unwrap_or(s);
    let mut parts = s.splitn(2, '.');
    let int = parts.next().unwrap_or("");
    let frac = parts.next();
    !int.is_empty()
        && int.chars().all(|c| c.is_ascii_digit())
        && frac.is_none_or(|f| !f.is_empty() && f.chars().all(|c| c.is_ascii_digit()))
}

pub fn parse_bbox(s: &str) -> Result<Bbox, QueryError> {
    let parts: Vec<&str> = s.split(',').collect();
    if parts.len() != 4 || !parts.iter().all(|p| is_decimal(p)) {
        return err("bbox must be minLon,minLat,maxLon,maxLat as plain decimal numbers");
    }
    let n: Vec<f64> = parts.iter().filter_map(|p| p.parse::<f64>().ok()).collect();
    if n.len() != 4 || n.iter().any(|v| !v.is_finite()) {
        return err("bbox must be minLon,minLat,maxLon,maxLat as plain decimal numbers");
    }
    let b = Bbox {
        min_lon: n[0],
        min_lat: n[1],
        max_lon: n[2],
        max_lat: n[3],
    };
    if !(-180.0..=180.0).contains(&b.min_lon) || !(-180.0..=180.0).contains(&b.max_lon) {
        return err("bbox longitude must be within [-180, 180]");
    }
    if !(-90.0..=90.0).contains(&b.min_lat) || !(-90.0..=90.0).contains(&b.max_lat) {
        return err("bbox latitude must be within [-90, 90]");
    }
    if b.min_lon >= b.max_lon || b.min_lat >= b.max_lat {
        return err("bbox must satisfy minLon < maxLon and minLat < maxLat (longitude first)");
    }
    Ok(b)
}

fn enum_value<T: serde::de::DeserializeOwned>(raw: &str, name: &str) -> Result<T, QueryError> {
    serde_json::from_value::<T>(Value::String(raw.to_string())).map_err(|_| {
        QueryError(format!(
            "{name} is not one of the values declared by the contract"
        ))
    })
}

pub fn parse_query(raw: Option<&str>, endpoint: Endpoint) -> Result<ParsedQuery, QueryError> {
    let allowed: &[&str] = match endpoint {
        Endpoint::MapFeatures => &["bbox", "ward", "category", "status", "dlpOnly"],
        Endpoint::IssueList => &["ward", "category", "status", "dlpOnly"],
    };
    let mut seen: Vec<(&str, String)> = Vec::new();
    for pair in raw.unwrap_or("").split('&').filter(|p| !p.is_empty()) {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let Some(key) = percent_decode(k) else {
            return err("query string is not valid percent-encoded UTF-8");
        };
        let Some(val) = percent_decode(v) else {
            return err("query string is not valid percent-encoded UTF-8");
        };
        let Some(name) = allowed.iter().find(|a| **a == key) else {
            return err("unsupported query parameter for this operation");
        };
        if seen.iter().any(|(n, _)| n == name) {
            return Err(QueryError(format!(
                "{name} was supplied more than once; multiple values are not supported"
            )));
        }
        if val.is_empty() {
            return Err(QueryError(format!("{name} must not be empty")));
        }
        seen.push((name, val));
    }
    let get = |n: &str| seen.iter().find(|(k, _)| *k == n).map(|(_, v)| v.as_str());

    let bbox = match (endpoint, get("bbox")) {
        (Endpoint::MapFeatures, Some(v)) => Some(parse_bbox(v)?),
        (Endpoint::MapFeatures, None) => return err("bbox is required"),
        _ => None,
    };
    let ward = match get("ward") {
        Some(w) if is_ward_code(w) => Some(w.to_string()),
        Some(_) => {
            return err("ward must be a ward code such as K/W (upper case); ids and display names are not accepted")
        }
        None => None,
    };
    let category = get("category")
        .map(|v| enum_value::<IssueCategory>(v, "category"))
        .transpose()?;
    let status = get("status")
        .map(|v| enum_value::<IssueStatus>(v, "status"))
        .transpose()?;
    let dlp_only = match get("dlpOnly") {
        Some("true") => true,
        Some("false") | None => false,
        Some(_) => return err("dlpOnly must be true or false"),
    };
    Ok(ParsedQuery {
        filter: IssueFilter {
            ward,
            category,
            status,
            dlp_only,
        },
        bbox,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(q: &str) -> Result<ParsedQuery, QueryError> {
        parse_query(Some(q), Endpoint::MapFeatures)
    }
    fn list(q: &str) -> Result<ParsedQuery, QueryError> {
        parse_query(Some(q), Endpoint::IssueList)
    }
    const BB: &str = "bbox=72.77,18.89,72.99,19.275";

    #[test]
    fn omitted_parameters_mean_no_restriction() {
        let p = map(BB).unwrap();
        assert_eq!(p.filter, IssueFilter::default());
        assert!(p.bbox.is_some());
        assert_eq!(
            parse_query(None, Endpoint::IssueList).unwrap().filter,
            IssueFilter::default()
        );
        assert_eq!(list("").unwrap().filter, IssueFilter::default());
    }

    #[test]
    fn dlp_only_false_equals_omitted_and_other_values_fail() {
        assert_eq!(
            list("dlpOnly=false").unwrap().filter,
            list("").unwrap().filter
        );
        assert!(list("dlpOnly=true").unwrap().filter.dlp_only);
        for bad in ["dlpOnly=TRUE", "dlpOnly=1", "dlpOnly=yes", "dlpOnly="] {
            assert!(list(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn ward_is_a_case_sensitive_code_not_an_id_or_name() {
        assert_eq!(
            list("ward=K/W").unwrap().filter.ward.as_deref(),
            Some("K/W")
        );
        assert_eq!(
            list("ward=K%2FW").unwrap().filter.ward.as_deref(),
            Some("K/W")
        );
        assert_eq!(list("ward=M").unwrap().filter.ward.as_deref(), Some("M"));
        for bad in [
            "ward=k/w",
            "ward=SYN-DEMO-WARD-KW",
            "ward=K/West",
            "ward=K/",
            "ward=K/W/X",
            "ward=%20",
        ] {
            assert!(list(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn category_and_status_are_exact_upper_case_enums() {
        assert!(list("category=POTHOLE&status=SUBMITTED_UNVERIFIED").is_ok());
        for bad in [
            "category=pothole",
            "category=Pothole",
            "category=ROAD",
            "status=open",
            "status=submitted_unverified",
        ] {
            assert!(list(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn empty_repeated_and_unknown_parameters_are_rejected_without_echo() {
        assert!(list("ward=").is_err());
        assert!(list("status=IN_PROGRESS&status=VERIFIED_COMPLETE").is_err());
        let e = list("secret-token-xyz=1").unwrap_err();
        assert!(!e.0.contains("secret-token-xyz"), "{e}");
        // bbox is declared on the map operation only
        assert!(list("bbox=72.77,18.89,72.99,19.275").is_err());
    }

    #[test]
    fn bbox_is_required_and_validated_on_the_map_endpoint() {
        assert!(parse_query(None, Endpoint::MapFeatures).is_err());
        assert!(map("ward=K/W").is_err());
        let ok = map("bbox=72.77%2C18.89%2C72.99%2C19.275")
            .unwrap()
            .bbox
            .unwrap();
        assert_eq!(
            (ok.min_lon, ok.min_lat, ok.max_lon, ok.max_lat),
            (72.77, 18.89, 72.99, 19.275)
        );
        for bad in [
            "bbox=1,2,3",
            "bbox=1,2,3,4,5",
            "bbox=a,b,c,d",
            "bbox=72.99,18.89,72.77,19.275", // min lon > max lon
            "bbox=72.77,19.275,72.99,18.89", // min lat > max lat
            "bbox=72.77,18.89,72.77,19.275", // degenerate
            "bbox=-181,0,0,1",
            "bbox=0,-91,1,0",
            "bbox=0,0,181,1",
            "bbox=0,0,1,91",
            "bbox=1e2,0,3,4",
            "bbox=+1,0,3,4",
            "bbox=.5,0,3,4",
            "bbox=NaN,0,3,4",
            "bbox=",
        ] {
            assert!(map(bad).is_err(), "{bad}");
        }
        assert!(map("bbox=-180,-90,180,90").is_ok());
    }

    #[test]
    fn invalid_percent_encoding_is_rejected() {
        assert!(list("ward=%ZZ").is_err());
        assert!(list("ward=%C3%28").is_err());
    }
}
