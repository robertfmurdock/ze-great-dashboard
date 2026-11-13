# Hosted deployments and the shared browser server

Multiple boards already shared a policy under one hostname. Host-based dispatch lets
independent configurations and immutable client versions coexist without changing API paths,
OIDC callbacks, or browser storage keys. Dispatch uses the actual request authority and has no
default deployment. Credential environment and bind posture remain process-wide.

Browser acceptance now exercises the packaged listener used by operators. The two-version
immutable-client proof moved to that listener. Browser-specific timing and synthetic OIDC
scenarios still own their per-page fixtures. Single-deployment Compose packaging and startup
failure tests retain their independent setup because they verify different launch contracts.

With a remote Chromium connection, the page's request context runs in the browser container.
Requests from the synthetic HTTPS origin use the Playwright worker's standalone request fixture
to fetch the packaged entrypoint and assets over host loopback. This keeps the synthetic origin
isolated and avoids relying on Docker Desktop's host DNS on Linux.
