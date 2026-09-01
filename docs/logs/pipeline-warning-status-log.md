# Pipeline warning status

Azure DevOps reports a completed build with `partiallySucceeded` when compilation completed with
other errors. It is normalized as the public `warning` status rather than `unknown`: the dashboard
has definite, degraded evidence and retains the source term in `rawStatus`.

`warning` is a shared pipeline-status value, so adapters, panel memory, reconciliation,
diagnostics, and pull-request health all use the same vocabulary. Pull-request aggregation ranks it
below `failed` and above running, unknown, cancelled, and passed; compact evidence calls the item a
warning, not a failure. GitHub's existing conclusions are intentionally unchanged.

The pipeline presentation reuses the established amber token with an explicit `⚠ Warning` label.
It is a completed run: it has a normal duration and source link, and never starts a running
animation.

The deterministic README gallery now includes that state. Its capture waits for the rendered
seventh panel after DOM availability rather than relying on development-server network-idle, which
is not a stable readiness condition.
