# CDN React singleton log

2026-10-21

The deployed authenticated dashboard failed before rendering with React's null-hook-dispatcher
error. The browser import map pinned the application's `react` module, but esm.sh resolved
`react-oidc-context`'s broad React peer range to a second module URL. Its `AuthProvider` therefore
called hooks from a different React instance than ReactDOM's renderer.

The existing authenticated Auth0 browser acceptance mounts the OIDC provider against the production
bundle and asserts that the authenticated board renders. Its October 6 release evidence passed,
before the esm.sh resolution drift was observed. After the drift, I reran that exact existing test
against the pre-fix commit in an isolated worktree: it failed because the `auth0-browser` heading
never rendered. The same test passed against the corrected import map. This confirms the existing
test is the regression evidence; no duplicate browser test is needed.

CDN externalization now gives esm.sh's peer dependencies to the import map as bare imports, using
the exact lockfile-resolved instances. Query parameters apply only to exact package mappings:
subpath mappings intentionally omit them, since import maps append subpaths literally and would
otherwise turn `react-dom/client` into a malformed `external` parameter. Focused CDN graph tests now
assert peer externalization and valid subpath mappings, contracts not covered by the browser
acceptance. The full repository gate passed with the correction.
