# Packaging and runtime configuration admission

The AWS package copied the shared schema and credential-name helper to avoid a published private-workspace dependency. That copy drifted: five HTTP facts could be packaged even though runtime accepts only four. Packaging also skipped adapter admission. Bundle the authoritative shared definitions and an internal server export instead; no new dependency or AWS access is needed. Admission stays in the quarantined allowlist module.

The consumer evidence missed the packaged-configuration-to-handler path. A schema-only compatibility test could not catch acceptance by packaging followed by runtime rejection. The standalone CLI regression now checks invalid Lambda/ECS inputs before artifacts exist, and exercises the four-fact archive’s handler against a local template server. It also verifies startup diagnostics, reference correlation, sanitization and recovery. Strict admission exposed the reference board’s unsupported placeholder and an incomplete credential fixture; both now use supported configurations.

Production configuration failures carry fixed corrective constraints and sanitized locations, while local packaging retains detailed validation messages. Lambda returns a support reference and retries failed bootstrap; containers retain unsuccessful exit. External availability, credentials and independently selected ECS image compatibility remain runtime concerns.

## Follow-up: cohesive failures and precise locations

Startup now wraps failures at the failing step in one typed object carrying the safe diagnostic and support reference. Concurrent template/config reads retain their own categories; classification no longer depends on exception text, and Lambda uses the same object that startup logs. The local error retains its cause without serializing it into production diagnostics.

The field-name whitelist also obscured legitimate adapter fields and attributed source errors to panels. Adapter validation now preserves a schema-owned panel/source root. Diagnostics replace authored board/source keys with ordinal indexes and keep static schema field names, so a missing repository points at the source that needs correction. Custom rules declare public corrective constraints alongside their validation rule; dynamic duplicate-id messages stay private. YAML syntax failures preserve numeric line/column locations. The AWS schema compatibility tests were removed because shared schema tests and packaged consumer tests own those distinct contracts.
