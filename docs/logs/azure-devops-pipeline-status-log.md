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

## Startup admission and release evidence (2026-09-01)

The ADO adapter was already capable of constructing its bounded Build API call, but the allowlist
silently omitted a syntactically valid panel that no adapter understood. That failure became a
browser-facing 404, which made a board configuration mistake look like a request problem. Startup
now validates every configured panel at the quarantined capability boundary before credential
resolution or upstream access. Errors identify the board, panel, configured source name and type,
and requested signal without disclosing a URL or credential.

The server image now carries its exact build release into the `server.ready` event. It is evidence
for operators investigating a mutable Docker tag, not a compatibility check: `ASSET_PATH` still
selects any valid immutable client version independently. Exact tagged images remain the release
unit; `latest` is promoted only after that image's smoke test and is documented as an explicitly
pulled evaluation convenience. ADO remains supported but incubating until legitimate redacted
fixtures replace the controlled adapter scenarios.

The startup admission follow-up made the exception shape explicit: the local
`pipeline-animation-demo` is a recognized client-only capability, while supported proxy panels
declare bounded named operations and everything else is unsupported. Startup now derives the
validated allowlist exactly once and supplies that same immutable map to the app. This keeps board
configuration and browser-addressable proxy capability atomic without introducing an adapter
registry before the next genuinely distinct adapter requires one.

Manual local verification on 2026-09-01 confirmed that a read-scoped Azure DevOps PAT works with a
running dashboard instance. This establishes that the real credential and Build API path operates
end-to-end; it does not replace the planned redacted response fixtures, which are still needed to
cover result and error variations reproducibly.

The first release candidate after strict admission exposed a CI-only board that used a synthetic
`release-reference` panel solely because the reference deployment invokes `/health`. That synthetic
type was correctly rejected at Lambda cold start. The smoke board now declares a bounded GitHub
`pipeline-status` operation, which remains uncalled by the health probe, and startup coverage uses
that actual board to prevent the deployment-only regression from returning.
