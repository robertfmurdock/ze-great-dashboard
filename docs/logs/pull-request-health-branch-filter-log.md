# Pull-request-health update-run branch filtering

The update-workflow portion of `pull-request-health` previously used GitHub's single latest run for
each workflow. That was broader than the panel's configured `branch_prefixes`: a newer default-branch
run could stand in for an automated update run and report unrelated health.

Update workflows now request up to GitHub's maximum page of recent runs and select the first one whose
`head_branch` matches that workflow's configured prefix. The existing PR discovery continues to use
`base_branch` only to select PR targets; it does not determine a workflow run's branch. This keeps the
panel's two observations aligned with its authored branch-selection policy without adding state or a
new dependency.

This page is intentionally bounded to 100 runs, matching the GitHub API's page limit. If update
workflows become active enough that a matching branch could fall beyond that window, pagination or a
more specific source-side selector should be designed deliberately rather than silently treating an
unbounded API scan as cheap.

The aggregate panel also highlights a caching boundary. A single panel response combines several
independently changing GitHub resources, so it has no one upstream ETag or cache directive to pass
through without misrepresenting the aggregate. The intentionally deferred direction is documented in
`docs/change-health.md`: have the browser compose named, cacheable component observations fetched
through the credentialed and allowlisted server proxy. This preserves the browser-cache model without
moving credentials, raw GitHub access, or source-specific authorization into the client.
