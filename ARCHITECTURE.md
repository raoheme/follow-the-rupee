# Architecture
Browser PWA → Axum REST API `:8080` → application/domain modules → SQLx repositories → PostgreSQL/PostGIS. OpenAPI controls the API/client boundary. Lifecycle events are append-only and hash-linked, not claimed immutable. Evidence is synthetic fixture metadata.
