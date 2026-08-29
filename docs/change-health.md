# Change Health

`pull-request-health` is the first small step toward a broader change-health widget. The dashboard
should eventually help a team see the current health of branches and pull requests without becoming
a work tracker or a second source of truth.

## Design vector

The durable concept is a **change**, not a particular GitHub workflow. A change may eventually be
described by observations such as build status, age, review state, mergeability, deployment health,
and grouped failure reasons.

The data flow keeps three concerns separate:

```text
candidate discovery -> source observations -> configured rollup policy
```

Candidate discovery may begin with generated update branches, then grow to all pull requests,
target branches, labels, ownership, or other source-supported queries. Observations retain
structured facts about each change. A panel applies a policy such as “all generated update PR builds
pass” without making that policy the data model.

This remains a lens, not a ledger. The server reads current state from primary sources, stores
nothing durably, links back to the authority, and reports incomplete or stale knowledge honestly.
Large organizations will eventually need pagination, bounded result sets, source-side filtering,
rate-limit-aware refresh, grouped summaries, and possibly shared caching for many viewers. Those
are future scaling concerns, not reasons to put one tile per pull request on the board.

## First version

`pull-request-health` covers automated update jobs and open pull requests whose head branches match
configured prefixes. It combines the latest matching run of each declared update workflow with the
latest `pull_request` build run for every matching open pull request. A workflow run on an unrelated
branch, including the default branch, is not evidence for the panel.

The aggregate passes only when all required observations pass. Running, failed, cancelled, or
unknown observations remain visible in the summary. No matching pull requests is valid, but the
panel says so explicitly. Request and parsing failures are error envelopes, still returned as HTTP
200 because the upstream fact failed, not the dashboard proxy.

The first version does not implement review age, stale detection, mergeability, ownership, arbitrary
branch selection, mutations, persistence, or historical trends.

## Intended evolution: cacheable component observations

`pull-request-health` currently fetches and aggregates all of its GitHub observations in the server
on each panel refresh. That keeps the first version compact, but the aggregate has no single upstream
validator: it combines workflow runs, a PR list, and a build run for each matching PR. Consequently,
it cannot use the dashboard's normal passthrough HTTP revalidation as precisely as a one-call panel.

When its fan-out becomes a measured operational concern, evolve it into client-composed, server-
authorized component observations. The browser should request named, normalized observations through
the dashboard proxy—such as the filtered PR list, an update-workflow result, and a PR build result—
and compose their presentation-level rollup. The server must continue to own credentials, configuration
validation, branch filtering, URL construction, source normalization, and the allowlist; this is not a
direct browser-to-GitHub design and must never become a generic GitHub proxy.

Each component may then relay its own source validators and cache directives to the browser, allowing
unchanged PR builds to remain cached while the PR list or another component revalidates. The client
must render partial or differently-aged observations honestly rather than implying an atomic snapshot.
Do not introduce this complexity before fan-out volume warrants it.
