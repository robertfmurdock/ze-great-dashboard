# Upstream response fixtures

Fixtures preserve real upstream API shapes for adapter tests. Capture a response from the real API,
redact identifying values without changing its structure, and commit one file per scenario.

## Required scenarios

For each signal source, capture distinct responses for:

- a successful run;
- warning or partial-success states such as Azure DevOps `succeededWithIssues`;
- cancelled and in-progress runs;
- a completed run with no test results;
- authentication failure, rate limiting, and a missing pipeline when available.

These states have different dashboard meanings and upstream response shapes. Adapter tests should
replay the captured bodies through the adapter interface.

## Redaction

Remove tokens, internal hostnames, and personal information. Preserve fields and value types,
replacing identifying values with shape-compatible examples where a test depends on them. Keep
useful protocol metadata such as status codes, cache headers, and error envelopes.

## Current captures

`github-actions/` contains redacted workflow-run responses for `success`, `failure`, `in_progress`,
and `cancelled`; its README records the capture details.

Azure DevOps captures still require a read-scoped token and a suitable project and pipeline. Add
them only after recording real responses, including the distinct `succeededWithIssues` result.
