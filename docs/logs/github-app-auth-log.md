# GitHub App authentication log

Recorded 2026-08-29 after implementing GitHub App authentication as an alternative to the existing
GitHub token path. Consumer-facing documentation is intentionally deferred until the integration
has been exercised with a real GitHub App installation.

## What was implemented

GitHub Actions sources may now use a `github_app` block naming three environment variables:
`app_id_env`, `private_key_env`, and `installation_id_env`. The board contains names only; values
are resolved by the server credential resolver at startup and never enter the browser, board API,
or normalized envelopes. `token_env` remains supported, and a source cannot configure both modes.

The server signs the short-lived RS256 JWT required by GitHub, exchanges it for an installation
access token at GitHub's installation endpoint, and attaches that token to workflow, pull-request,
and active-job requests. A valid installation token is retained only in disposable process memory;
concurrent requests share one in-flight exchange. No dependency was added: Node's built-in crypto
API handles signing.

## Consequential choices

Installation IDs are named through the same environment-variable mechanism as the app ID and
private key. This keeps the source configuration uniform and lets the existing Secrets Manager /
Parameter Store JSON credential map resolve all three values without introducing another secret
transport. The AWS release credential check recognizes GitHub App sources as credentialed while
preserving the existing diagnostic contract for token-backed boards.

The adapter's synchronous permitted-call functions remain URL/allowlist construction only. One
app-scoped GitHub client owns standard request headers, validators, PAT lookup, and App token
exchange immediately before the real fetch. A source chooses exactly one mode: a named PAT never
falls back to App credentials, and an App source never probes a PAT.

An App-authenticated GET that receives a 401 discards that installation's cached token, exchanges
once, and replays the identical request once. A second 401 is returned normally; PAT requests and
failed exchanges are never retried. Credential and exchange failures are typed internally and
become the stable public `unauthorized` envelope, without exposing names or values.

## Evidence and remaining uncertainty

Tests use a generated RSA key and cryptographically verify the JWT signature and claims. They also
exercise the token exchange and downstream GitHub request headers through the real adapter fetch
interface, including token reuse and missing-credential behavior. The full `npm run check` gate
passed, including unit tests, browser tests, the Docker image smoke test, board validation, and
published-package smoke checks.

No live GitHub App installation was available in this pass. Before consumer documentation or a
deployment recommendation, verify the permissions granted to the installed App, the production
private-key encoding supplied through the credential map, and GitHub's observed response shape and
expiry behavior against a real installation.
