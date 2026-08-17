# GitHub Actions captures

These four files are redacted copies of real `GET /repos/{owner}/{repo}/actions/runs/{run_id}`
responses captured on 2026-08-17 from public community repositories. They retain the API's full
JSON shape and the real `status`/`conclusion` combinations, while repository names, user details,
commit identifiers, URLs, and email addresses have been replaced with shape-compatible examples.

| Fixture | Observed values |
| --- | --- |
| `workflow-run-success.json` | `status: completed`, `conclusion: success` |
| `workflow-run-failure.json` | `status: completed`, `conclusion: failure` |
| `workflow-run-in-progress.json` | `status: in_progress`, `conclusion: null` |
| `workflow-run-cancelled.json` | `status: completed`, `conclusion: cancelled` |

Every successful capture returned `200`, `Cache-Control: public, max-age=60, s-maxage=60`, a
weak `ETag`, and a `Date` header. Header values that identify a particular request are not
committed. The adapter tests should replay these bodies and separately exercise forwarded cache
validators with controlled headers.
