# Direct OIDC authentication

## 2026-09-10

The first dashboard authentication mode is direct browser OIDC using Authorization Code with PKCE. The access-token audience is a separately registered API resource, so ID tokens cannot become proxy credentials by accident. The authorization rule is an explicit stable `sub` allowlist; groups, roles, custom claims, and gateway mode remain deferred because their meaning is not portable across providers.

`oidc-client-ts` was added in the client for discovery, PKCE, provider callback/logout, and renewal behavior; its in-memory stores keep both access and refresh tokens out of browser storage. `react-oidc-context` owns the React lifecycle, callback processing, and renewal state rather than a dashboard-specific auth boundary. Dashboard code receives an explicit, narrow authenticated-request capability—there is no module-global token holder. `jose` was added server-side for standards-compliant JWT verification and remote JWKS rotation. These replace bespoke security-sensitive protocol code, at the cost of small audited runtime dependencies.

Auth0 was selected as the intended acceptance provider because its SPA and API registrations exercise the standard flow, not because it is a runtime dependency. Operators must still run the documented two-user acceptance check against their own tenant before enabling this mode.
