# Durable check evidence — 2026-09-11

`npm run check` now produces a fresh ignored `check-results/` directory for every aggregate run.
It holds native JUnit XML from Node, Vitest, and Playwright, Playwright's failure attachments, and
a small versioned coordinator ledger in JSON and Markdown. The Build workflow appends that ledger to
the job summary and retains the complete directory as a 90-day `check-evidence` artifact whether the
check passes or fails.

The choice is deliberately limited to reporters already built into the three test runners and
GitHub's native artifact facility. A reporting dependency or a check-reporting Action would add
supply-chain and execution surface without improving the release evidence: the runner-produced XML
remains the authority for individual tests, while the coordinator ledger records the separate fixed
graph contract (including blocked and interrupted stages). The ledger intentionally contains only
stage status, duration, and safe startup/exit details; buffered child output remains out of both the
summary and artifact metadata.

Focused test commands remain unchanged. Only the aggregate check supplies report configuration, so
normal development output and targeted Playwright use keep their existing behavior. The coordinator
contract tests cover fresh-output replacement and passing, failed, blocked, and interrupted graphs.

Follow-up refactoring put the report names and paths behind one small shared module. The browser
wrapper consumes the same aggregate-only option builder that the coordinator tests exercise, making
the boundary between ordinary browser runs and evidence-producing aggregate runs explicit.
