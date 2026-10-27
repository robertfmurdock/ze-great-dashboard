# GitHub Actions test-count panels

GitHub Actions exposes workflow runs and artifacts but no normalized test-total API. The dashboard
therefore reads a single configured ZIP artifact server-side and accepts only a bounded JSON
summary that identifies its workflow run, attempt, and commit. The browser receives the normalized
test-count envelope rather than GitHub's artifact transport.

The board chooses the artifact and root JSON entry so teams can retain their own reporting setup,
while the versioned manifest fixes the meaning of the public `total`. Missing reporting is visible,
not zero; an active run is pending; malformed, expired, or mismatched evidence is an error.

## Consolidation follow-up

The initial implementation revealed two sources of drift risk: pipeline-status and test-count
each selected a workflow run, and application dispatch duplicated allowlist admission. Both now
resolve through small shared server boundaries. The adapter registry remains explicit and is used
only to connect a known panel/source pair to its bounded operation; it does not make arbitrary
providers or URLs configurable from the browser.

The archive reader is isolated from GitHub API logic and uses fflate's browser-safe streaming ZIP
entry point. That preserves the size and entry guards while avoiding the Node worker import that
had required a renamed `createRequire` bundler banner in every packaging path. Test evidence stays
synthetic by deliberate choice: generated archives exercise the bounded archive and route
contracts, while no live artifact capture source has been designated.

## Dashboard workflow producer

The Build workflow now creates a separate `ci-evidence` artifact after the aggregate check. Its
single `test-summary.json` binds the GitHub run ID, attempt, and commit to totals from the Node,
Vitest, and Playwright JUnit reports. The existing `check-evidence` artifact remains the 90-day
diagnostic archive; it is intentionally not reused because the dashboard reader accepts one small,
bounded entry rather than raw reports and coordinator details.

The summary is withheld when any aggregate report is absent. A partial total would look precise
while silently omitting a suite, so an incomplete run remains visibly unreported instead. No
reporting dependency was added: the project already produces the authoritative JUnit files during
`npm run check`.
