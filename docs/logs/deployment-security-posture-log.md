# Deployment security posture — 2026-09-11

The dashboard now gives board authors a top-level security policy: the backward-compatible
`warn`, fail-closed `required`, and explicit-public-access `unsecured`. This keeps the existing
non-loopback definition of deployment while making an authless public dashboard visible as a
deliberate operating decision rather than an easy omission.

Required mode serves a small, no-store visible error instead of refusing startup. Health checks can
therefore distinguish a running, safely blocked instance from an unavailable process, and operators
receive a direct remediation message without exposing board configuration, credentials, or upstream
data. Its API surface returns no-store 503 responses and startup stops before credential resolution,
OIDC setup, template loading, or adapter initialization.

The server-only `ALLOW_UNPROTECTED_DASHBOARD=true` flag suppresses only the soft warning. It cannot
override required mode: an environment variable is useful for intentional production-shaped local
runs, but is too easy to inherit accidentally to bypass a board’s explicit fail-closed contract.

The implementation keeps policy resolution and the blocked server in small separate modules. The
normal app never receives a blocked request, making the absence of template, credential, OIDC, and
adapter capability structural rather than dependent on an early conditional. The browser-visible
warning now directly says to take down a publicly reachable, sensitive authless deployment and
links to the OIDC operator guide, while retaining `security: unsecured` as the explicit route for
intentionally public boards.
