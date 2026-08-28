# Implementation logs

Chronological implementation and validation records live here. They preserve the decisions and
evidence behind the current documentation without interrupting the task-oriented guides.

## What belongs in a log

Write down non-obvious intent: architectural decisions, rejected alternatives, security or
operational constraints, discoveries from running the system, risks, and follow-up work. Logs are
for preserving context that a future contributor would otherwise have to reconstruct.

Routine verification is table stakes and does not need a transcript. Do not spend log space on test
counts, lists of passing commands, build/package success, commit hashes, or push status unless the
verification uncovered a meaningful environmental fact or changed a decision. A concise note that
the repository gate passed is enough when verification is relevant to the entry.

- [Initialization log](initialization-log.md) — original repository decisions, verified assumptions,
  and intentional quirks.
- [Stage 2 GitHub Actions log](stage2-github-actions-log.md) — the first data-plane slice and
  client polling follow-up.
- [Dashboard package and deployment log](dashboard-package-log.md) — the published AWS package and
  deployment boundary.
- [Stage 4 HTTP value log](stage4-http-value-log.md) — source-agnostic HTTP value panels.
- [AWS consumer bootstrap log](aws-bootstrap-log.md) — consumer-owned bootstrap infrastructure and
  its validation history.
- [Panel-scale animation log](panel-scale-animation-log.md) — active-run field redesign, visual
  review findings, falling-shapes geometry, and animation-demo timing configuration.
- [Layout resolution log](layout-resolution-log.md) — layout warnings, legal normalized downloads,
  and the example board's corrected coordinates.
- [Client-side GitHub consistency log](client-side-github-consistency-log.md) — stale-response
  protection, browser runtime history, durable incidents, and the follow-up refactors.
- [Panel information cleanup log](panel-information-cleanup-log.md) — live pipeline activity,
  honest check-age presentation, and the source-agnostic enrichment refactors.
