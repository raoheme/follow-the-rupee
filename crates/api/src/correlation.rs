//! `X-Correlation-Id` handling.
//!
//! The contract bounds the header to 8..=128 characters. A caller value is accepted only when it is visible ASCII
//! (0x21..=0x7E, so no space, control character or CR/LF) inside that bound; anything else is replaced by a server-generated
//! UUID. The id that is logged, echoed in the response header and placed in problem bodies is always the sanitized one.
use axum::extract::Request;
use axum::http::{HeaderName, HeaderValue};
use axum::middleware::Next;
use axum::response::Response;

pub const HEADER: &str = "x-correlation-id";
pub const MIN_LEN: usize = 8;
pub const MAX_LEN: usize = 128;

#[derive(Debug, Clone)]
pub struct CorrelationId(pub String);

/// The caller's value when it is acceptable, else `None`.
pub fn sanitize(raw: &[u8]) -> Option<String> {
    if raw.len() < MIN_LEN || raw.len() > MAX_LEN {
        return None;
    }
    if !raw.iter().all(|b| (0x21..=0x7E).contains(b)) {
        return None;
    }
    String::from_utf8(raw.to_vec()).ok()
}

pub fn generate() -> String {
    uuid::Uuid::now_v7().to_string()
}

pub async fn correlation(mut req: Request, next: Next) -> Response {
    let id = req
        .headers()
        .get(HEADER)
        .and_then(|v| sanitize(v.as_bytes()))
        .unwrap_or_else(generate);
    req.extensions_mut().insert(CorrelationId(id.clone()));
    let mut res = next.run(req).await;
    if let Ok(v) = HeaderValue::from_str(&id) {
        res.headers_mut().insert(HeaderName::from_static(HEADER), v);
    }
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_bounded_visible_ascii_only() {
        assert_eq!(sanitize(b"abcd1234").as_deref(), Some("abcd1234"));
        assert_eq!(sanitize(&[b'a'; 128]).map(|s| s.len()), Some(128));
        assert!(sanitize(b"short").is_none());
        assert!(sanitize(&[b'a'; 129]).is_none());
        assert!(sanitize(b"has space here").is_none());
        assert!(sanitize(b"abcd\r\nInjected: 1").is_none());
        assert!(sanitize(b"abcd\x01efgh").is_none());
        assert!(sanitize(&[b'a', b'b', b'c', b'd', b'e', b'f', b'g', 0xFF]).is_none());
        assert_eq!(generate().len(), 36);
    }
}
