# Pull-request health build-event evidence

Recorded 2026-10-13 after a deployed Ze Great Dashboard dependency-update PR rendered as unknown
despite a branch-push build run.

`pull-request-health` had treated a `pull_request` trigger as an implicit requirement. That was
too narrow: the panel already names the workflow and admits only configured update-PR branch
prefixes, and teams may deliberately run their expensive build on `push` or start it manually.
The default now accepts the newest run of the configured workflow on the authorized branch,
regardless of trigger, and renders the trigger in the evidence detail.

`build_events` is an optional GitHub Actions-specific restriction for boards that need a narrower
policy. Its curated, duplicate-free values fail validation at startup; it neither becomes a generic
panel feature nor changes the source, workflow, or branch allowlist. Existing boards need no
migration. The external deployed board was intentionally left untouched.

The original adapter test encoded the former `event=pull_request` query, so it could not protect a
push-only workflow. A new adapter-level reproduction returns no pull-request event but a failed
push event, verifies the prior unknown result before the change, and now verifies the failed build
is rendered. Focused schema and adapter coverage also protects explicit event restrictions.
