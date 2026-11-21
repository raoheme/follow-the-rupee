//! Process configuration. Defaults are the safe local ones: loopback only, port 8080, one exact CORS origin.
use std::net::{IpAddr, Ipv4Addr, SocketAddr};

pub const DEFAULT_HOST: &str = "127.0.0.1";
pub const DEFAULT_PORT: u16 = 8080;
/// The one frontend origin allowed by default (the Vite dev server).
pub const DEFAULT_CORS_ORIGIN: &str = "http://localhost:5173";

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct ConfigError(pub String);

fn bad<T>(m: &str) -> Result<T, ConfigError> {
    Err(ConfigError(m.to_string()))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    pub bind: SocketAddr,
    /// Exact origins allowed by CORS: the default plus at most one validated local extra.
    pub cors_origins: Vec<String>,
}

/// `API_HOST`, `API_PORT`, `API_ALLOW_NON_LOOPBACK` and `API_CORS_EXTRA_ORIGIN` as plain optional strings.
#[derive(Debug, Clone, Default)]
pub struct RawConfig {
    pub host: Option<String>,
    pub port: Option<String>,
    pub allow_non_loopback: Option<String>,
    pub cors_extra_origin: Option<String>,
}

impl RawConfig {
    pub fn from_env() -> Self {
        let get = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
        RawConfig {
            host: get("API_HOST"),
            port: get("API_PORT"),
            allow_non_loopback: get("API_ALLOW_NON_LOOPBACK"),
            cors_extra_origin: get("API_CORS_EXTRA_ORIGIN"),
        }
    }
}

pub fn parse_port(raw: Option<&str>) -> Result<u16, ConfigError> {
    match raw {
        None => Ok(DEFAULT_PORT),
        Some(p) => match p.trim().parse::<u16>() {
            Ok(n) if n >= 1 => Ok(n),
            _ => bad("API_PORT must be an integer from 1 to 65535"),
        },
    }
}

fn parse_host(raw: Option<&str>) -> Result<IpAddr, ConfigError> {
    match raw.map(str::trim) {
        None => Ok(IpAddr::V4(Ipv4Addr::LOCALHOST)),
        Some("localhost") => Ok(IpAddr::V4(Ipv4Addr::LOCALHOST)),
        Some(h) => h
            .parse::<IpAddr>()
            .or_else(|_| bad("API_HOST must be an IP address literal or localhost")),
    }
}

/// A validated local CORS origin: `http(s)://localhost|127.0.0.1[:port]` only. No wildcard, path, query or userinfo.
pub fn validate_local_origin(o: &str) -> Result<String, ConfigError> {
    let Some((scheme, rest)) = o.split_once("://") else {
        return bad("API_CORS_EXTRA_ORIGIN must look like http://localhost:4173");
    };
    if scheme != "http" && scheme != "https" {
        return bad("API_CORS_EXTRA_ORIGIN scheme must be http or https");
    }
    let (host, port) = match rest.split_once(':') {
        Some((h, p)) => (h, Some(p)),
        None => (rest, None),
    };
    if host != "localhost" && host != "127.0.0.1" {
        return bad("API_CORS_EXTRA_ORIGIN host must be localhost or 127.0.0.1");
    }
    if let Some(p) = port {
        if p.is_empty()
            || p.len() > 5
            || !p.chars().all(|c| c.is_ascii_digit())
            || p.parse::<u16>().map_or(true, |n| n == 0)
        {
            return bad("API_CORS_EXTRA_ORIGIN port is invalid");
        }
    }
    Ok(o.to_string())
}

impl Config {
    pub fn from_raw(raw: &RawConfig) -> Result<Config, ConfigError> {
        let host = parse_host(raw.host.as_deref())?;
        let port = parse_port(raw.port.as_deref())?;
        if !host.is_loopback() && raw.allow_non_loopback.as_deref() != Some("true") {
            return bad("a non-loopback API_HOST requires API_ALLOW_NON_LOOPBACK=true; the default is 127.0.0.1");
        }
        let mut cors_origins = vec![DEFAULT_CORS_ORIGIN.to_string()];
        if let Some(extra) = raw.cors_extra_origin.as_deref() {
            let v = validate_local_origin(extra)?;
            if !cors_origins.contains(&v) {
                cors_origins.push(v);
            }
        }
        Ok(Config {
            bind: SocketAddr::new(host, port),
            cors_origins,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(h: Option<&str>, p: Option<&str>, a: Option<&str>, c: Option<&str>) -> RawConfig {
        RawConfig {
            host: h.map(Into::into),
            port: p.map(Into::into),
            allow_non_loopback: a.map(Into::into),
            cors_extra_origin: c.map(Into::into),
        }
    }

    #[test]
    fn defaults_are_loopback_8080_and_the_single_frontend_origin() {
        let c = Config::from_raw(&RawConfig::default()).unwrap();
        assert_eq!(c.bind.to_string(), "127.0.0.1:8080");
        assert_eq!(c.cors_origins, vec!["http://localhost:5173".to_string()]);
    }

    #[test]
    fn non_loopback_needs_an_explicit_opt_in_and_never_defaults_to_all_interfaces() {
        assert!(Config::from_raw(&raw(Some("0.0.0.0"), None, None, None)).is_err());
        assert!(Config::from_raw(&raw(Some("0.0.0.0"), None, Some("yes"), None)).is_err());
        assert!(Config::from_raw(&raw(Some("192.168.1.5"), None, None, None)).is_err());
        assert!(Config::from_raw(&raw(Some("0.0.0.0"), None, Some("true"), None)).is_ok());
        assert!(Config::from_raw(&raw(Some("::1"), None, None, None)).is_ok());
        assert!(Config::from_raw(&raw(Some("localhost"), None, None, None)).is_ok());
        assert!(Config::from_raw(&raw(Some("example.com"), None, Some("true"), None)).is_err());
    }

    #[test]
    fn port_is_validated() {
        assert_eq!(parse_port(None).unwrap(), 8080);
        assert_eq!(parse_port(Some("9090")).unwrap(), 9090);
        for bad in ["0", "65536", "-1", "abc", "80.5", ""] {
            assert!(parse_port(Some(bad)).is_err(), "{bad}");
        }
    }

    #[test]
    fn extra_cors_origin_is_a_validated_local_origin() {
        let c = Config::from_raw(&raw(None, None, None, Some("http://localhost:4173"))).unwrap();
        assert_eq!(c.cors_origins.len(), 2);
        let same = Config::from_raw(&raw(None, None, None, Some("http://localhost:5173"))).unwrap();
        assert_eq!(same.cors_origins.len(), 1);
        for bad in [
            "*",
            "http://*",
            "http://example.com",
            "http://localhost:4173/",
            "http://localhost:4173/path",
            "http://user@localhost",
            "ftp://localhost",
            "localhost:4173",
            "http://localhost:0",
            "http://localhost:99999",
            "http://localhost:",
            "http://evil.localhost",
        ] {
            assert!(
                Config::from_raw(&raw(None, None, None, Some(bad))).is_err(),
                "{bad}"
            );
        }
    }
}
