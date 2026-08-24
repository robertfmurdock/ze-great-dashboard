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
configured prefixes. It combines the latest run of each declared update workflow with the latest
`pull_request` build run for every matching open pull request.

The aggregate passes only when all required observations pass. Running, failed, cancelled, or
unknown observations remain visible in the summary. No matching pull requests is valid, but the
panel says so explicitly. Request and parsing failures are error envelopes, still returned as HTTP
200 because the upstream fact failed, not the dashboard proxy.

The first version does not implement review age, stale detection, mergeability, ownership, arbitrary
branch selection, mutations, persistence, or historical trends.
