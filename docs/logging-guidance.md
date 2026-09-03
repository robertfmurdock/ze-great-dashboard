# Logging guidance

Chronological implementation and validation records live in [`docs/logs/`](logs/). They are an
append-oriented archaeological record: preserve what was believed and decided at the time, along
with the evidence and uncertainty around it. If later evidence supersedes an earlier conclusion,
append a clarification; do not rewrite history for consistency.

Use the logs to evaluate how the repository's philosophy evolved, how implementation reasoning held
up, and where agents followed or drifted from that philosophy. Keep current truth and current
philosophy in `AGENTS.md`, `CLAUDE.md`, `docs/implementation-status.md`, and the design documents.

## What belongs in a log

Write down non-obvious intent: architectural decisions, rejected alternatives, security or
operational constraints, discoveries from running the system, risks, and follow-up work. Logs are
for preserving context that a future contributor would otherwise have to reconstruct, not for
serving as current documentation or a test-results archive.

After a substantial work slice reaches a meaningful completion point, record the thinking before
context is lost. Logging is expected at that point even when nobody separately asks for it. Routine
fixes and routine passing checks do not require entries.

Routine verification is table stakes and does not need a transcript. Do not spend log space on test
counts, lists of passing commands, build/package success, commit hashes, or push status unless the
verification uncovered a meaningful environmental fact or changed a decision. A concise note that
the repository gate passed is enough when verification is relevant to the entry.

When an existing test prevents a real implementation mistake or reveals a meaningful contract gap,
record that testing win and what it protected. Do not manufacture “wins” from routine red/green
iteration, formatter fixes, or ordinary passing checks.

Record a **test miss** when release-relevant behavior was not protected because the test did not
exercise its intended interface or execution environment. This includes a test that passes locally
but fails under the actual CI, container, browser, deployment, or dependency topology. State the
unprotected condition, why the test differed, and the smallest correction that makes the evidence
representative. A test deliberately changed to match an intentional product change is not a test
miss; it is a contract change and should explain the decision instead.

When recording a completed work slice, use these as lightweight prompts rather than mandatory
headings:

- What were we trying to accomplish?
- What consequential choices or tradeoffs mattered?
- What did execution or review reveal?
- What remains uncertain, wrong, or intentionally deferred?
- What should a future contributor know?
