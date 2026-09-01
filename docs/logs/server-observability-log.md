# Server observability and safe browser support references — 2026-09-01

Added a dependency-free JSON Lines logger for server lifecycle and failure paths, plus opaque server-generated request IDs for API responses. The browser receives only a fixed actionable reason and the opaque reference for failed panel observations; server logs retain the configured panel/source context and destination origin without paths or query strings.

The implementation deliberately rejected a logging package: a fixed event vocabulary written through `console` gives local output and CloudWatch the same contract without adding supply-chain surface. Adapter error messages are now allow-listed by error kind rather than copied from upstream exceptions, because those values can contain URLs, payload fragments, and credentials.

Browser diagnostics moved from v1 to v2. v1 storage is removed once on upgrade rather than migrated, because it could contain historic raw upstream error text. This intentional purge trades old local evidence for preserving the browser/server security boundary.

Follow-up review consolidated the server routes behind typed request and observation contexts. Adapter results now carry only safe optional failure metadata (upstream status and an allow-listed network code), so the route boundary logs an error once without reparsing browser-bound response bodies. Request IDs are a typed Hono request variable rather than closure state, and elapsed time begins before the adapter call. Route-level tests cover rejected operations, unexpected application exceptions, and body-free HTTP-status logging.
