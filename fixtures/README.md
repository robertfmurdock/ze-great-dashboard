# Fixtures

Captured upstream responses, used to build adapters against reality instead of against an
imagination of it. **Nothing here yet** — this directory is Stage 0, and Stage 0 has not happened.

## The rule: captured, never invented

A fabricated fixture is worse than no fixture. It tests that the adapter handles the shape you
already believed in, passes, and tells you nothing. The bugs in this kind of integration all live in
the shapes nobody pictured.

So: hit the real API, save the real response, redact the identifiers, commit that.

## What Stage 0 must capture

The design doc names these because each one has burned somebody. For every signal source, capture:

- **The happy path** — a green build, a passing test run.
- **`succeededWithIssues`** — Azure DevOps' third state. Not success, not failure. A dashboard that
  maps it to either one is lying, and which way it lies matters.
- **Cancelled** — distinct from failed. Someone pressed stop; nothing is broken.
- **In progress** — a build with no result yet. The panel has to say something honest about a
  pipeline that hasn't finished.
- **No test results** — a pipeline that ran and published no test data. Zero tests passing and no
  test run at all are different facts, and a naive read shows 0% either way.

Also worth having, cheap to grab while you are in there: an auth failure (401/403), a rate-limit
response with its headers, and a 404 for a pipeline id that no longer exists. Those are the error
envelope's `kind` values arriving from the real thing.

## Redaction

Strip tokens, internal hostnames, and anything identifying a person. Keep the response *shape*
exactly as it arrived — reformatting or trimming fields defeats the purpose. If a field's real value
matters to a test, replace it with something equally real in shape (`repo-name`, not `REDACTED`).

## Layout, once populated

```
fixtures/
  azure-devops/
    build-succeeded.json
    build-succeeded-with-issues.json
    build-cancelled.json
    build-in-progress.json
    test-run-empty.json
  github-actions/
    ...
```

One response per file, named for the case it demonstrates.
