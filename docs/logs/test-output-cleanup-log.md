# Test output cleanup

Recorded 2026-08-29.

`npm run check` was passing while emitting warnings and expected-error stacks that made the gate
look unhealthy. The cleanup keeps diagnostic output for unexpected failures; it does not globally
suppress warnings or stderr.

Node 24's experimental process-level `localStorage` getter was being reached by browser-facing
Vitest tests when Happy DOM did not provide storage. It warns without a backing-file flag, and the
client's optional-storage fallback then hid the underlying mismatch. The client test setup now
installs an isolated in-memory `Storage` implementation and clears it after every scenario. This
exercises the normal browser-storage path deterministically while individual tests can still supply
their own store or a throwing store for fallback behavior.

The browser-test wrapper now translates a caller's `NO_COLOR` preference into Playwright's
plain-output setting. Playwright otherwise forces `FORCE_COLOR` in worker processes, which causes
Node to warn about the contradictory environment variables. The wrapper removes that contradiction
only for the Playwright child and does not alter other command output.

Two server tests also produced expected `TemplateFetchError` stacks through Hono's default error
reporting. The malformed-template response test silences only that deliberately exercised error
path. More importantly, the credential-boundary test had been requesting the entrypoint with a
GitHub API fixture as its template, so it received an error page and made its no-secret assertion
weaker than intended. Its fetch fixture now serves a valid template for the template URL and the
GitHub response for the panel request, so the test verifies the actual rendered document.

No dependencies were added. The repository gate passed after the changes.
