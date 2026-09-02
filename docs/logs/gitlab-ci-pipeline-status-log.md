# GitLab CI pipeline-status adapter

Implemented 2026-09-02.

GitLab CI joins `pipeline-status` as a server-side, read-only source. Its instance URL is a
configuration value, never a browser input: GitLab.com is the default and an HTTPS self-managed
base path is permitted, but credentials, query strings, and fragments are rejected before startup.
The access token remains a server-only environment value and is sent solely in GitLab's
`PRIVATE-TOKEN` header. The source/run links are derived from that reviewed configuration or the
API response, rather than accepting a browser-supplied destination.

The adapter intentionally makes one `GET /api/v4/projects/{encoded-project}/pipelines?per_page=1`
call, adding `ref` only when configured. This preserves validator/cache-metadata passthrough and
keeps the proxy operation easy to review. The tradeoff is deliberate: this first slice has no
per-job or per-stage activity, duration, child-pipeline selection, or test-count evidence.

GitLab's current pipeline API documentation confirms the project-list response is an array and
uses URL-encoded project paths, `ref`, and `per_page`; it also documents that child pipelines are
excluded unless a separate `source=parent_pipeline` filter is requested. We do not request that
filter, so the panel retains GitLab's normal project-pipeline view. GitLab documents `read_api` as
the read-only API scope available to personal, project, and group access tokens, which is the
minimum documented scope in the consumer configuration guide. No live GitLab instance was queried
while implementing this slice; compatibility beyond the documented GitLab.com and self-managed
API contract remains to be learned from consumer use.
