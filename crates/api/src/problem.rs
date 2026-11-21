//! RFC 9457 `application/problem+json` bodies shaped exactly like the contract's `Problem` schema.
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    #[serde(rename = "type")]
    pub problem_type: String,
    pub title: String,
    pub status: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub correlation_id: String,
}

impl Problem {
    pub fn new(
        status: StatusCode,
        title: &str,
        detail: Option<&str>,
        correlation_id: &str,
    ) -> Self {
        Problem {
            problem_type: "about:blank".to_string(),
            title: title.to_string(),
            status: status.as_u16(),
            detail: detail.map(str::to_string),
            correlation_id: correlation_id.to_string(),
        }
    }

    /// A malformed request. `detail` must never contain caller-supplied text (the parser guarantees this).
    pub fn bad_request(detail: &str, correlation_id: &str) -> Self {
        let mut p = Problem::new(
            StatusCode::BAD_REQUEST,
            "Invalid request",
            Some(detail),
            correlation_id,
        );
        p.problem_type = "/problems/invalid-request".to_string();
        p
    }
}

impl IntoResponse for Problem {
    fn into_response(self) -> Response {
        let status = StatusCode::from_u16(self.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        let body = serde_json::to_vec(&self).unwrap_or_else(|_| b"{}".to_vec());
        let mut r = (status, body).into_response();
        r.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/problem+json"),
        );
        r.headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        r
    }
}
