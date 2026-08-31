# Azure DevOps pipeline-status adapter

Implemented an Azure DevOps source branch for the existing `pipeline-status` signal without
changing the browser envelope or extracting a generic adapter framework. The explicit allowlist
and route dispatch now admit only a configured ADO pipeline definition; source URLs, PAT Basic
authentication, build-result normalization, source links, and optional active timeline detail stay
server-side.

The adapter uses the Build List API 7.1 with one newest-build request ordered by queue time so a
current build remains newer than its completed predecessor, forwarding browser
validators and relaying the primary response's cache metadata and 304 status. Active timeline
lookup is deliberately best effort: failing to read it cannot hide an otherwise readable running
build. Upstream and configuration failures remain visible HTTP-200 error envelopes linked to the
configured pipeline definition. ADO configuration requires a positive numeric definition ID and a
named runtime credential, intended to hold a Build (read)-scoped PAT.

The tests exercise the documented Build List and Timeline boundary with controlled response
scenarios, including result normalization, authorization, cache revalidation, error disclosure,
and route isolation. They are not captured production ADO fixtures. Do not make a consumer support
claim from this slice until redacted responses for successful, failed, cancelled, active, empty,
and unusual-result builds have been captured from a legitimate read-scoped ADO project and replace
those controlled scenarios. Azure Repos pull-request health remains intentionally deferred because
its build-validation association needs a separate fixture-backed rollup policy.

Follow-up refactoring extracted the repeated adapter-result route response, validator forwarding,
upstream timestamp parsing, error-envelope construction, and upstream status classification into a
small server-internal helper. Source dispatch remains explicit in `app.ts`, and adapters still own
their bounded calls, authentication, links, and normalization. That removes mechanical drift across
the existing sources without introducing an adapter registry before a third CI source provides a
real common contract to extract.
