//! infrastructure boundary: PostgreSQL/PostGIS migrations, the deterministic CP-00 seed/reset and the P3 read path.
pub const PACKAGE_VERSION: &str = "1.2.3";

pub mod command;
pub mod demo;
pub mod read;
