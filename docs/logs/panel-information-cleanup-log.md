# Panel information cleanup log

Recorded 2026-08-28 during the in-progress pipeline information cleanup and follow-up refactors.

## Intention

Pipeline panels should make the current work legible at a glance without changing their active-run
visual treatments. The intended hierarchy is:

- status as the dominant signal;
- one concise live-activity line, such as `build › integration tests`;
- branch as compact metadata;
- elapsed time and an estimate only while useful for an active run;
- duration and neutral run age for completed runs;
- dashboard check age as the one freshness signal that can become stale.

The source run's age must not be styled as stale merely because the run itself is old. The exact
clock time remains available in a title or accessible text while the wall-facing treatment stays
brief.

## What was implemented

The shared `pipeline-status` signal now accepts optional source-agnostic activity metadata:
`job`, `stage`, or `step`, with a name and optional parent. The named schema and type are exported
for future adapters.

The GitHub Actions adapter performs one bounded jobs lookup for an active run. It chooses an
in-progress job before a queued job, then an in-progress step within that job, falling back to the
job name. Jobs enrichment is best-effort: a failed or malformed lookup omits activity while
preserving the authoritative primary run status. Completed runs do not make the secondary request.

The client displays missing active detail as `Activity unavailable`, so an otherwise readable run
never becomes blank or an error. Activity formatting is isolated in a source-neutral pure helper.
Animation selection, timing, fields, progress treatments, and decorative rendering were left
unchanged.

## Refactors completed in the same area

- `pipelineActivitySchema` and `PipelineActivity` are named shared exports.
- `formatPipelineActivity` owns the concise parent/activity presentation and has direct tests.
- `ObservedAt`, `CheckedAt`, and `RunAge` share the `TimeAge` renderer while retaining their
  distinct visible contracts.
- GitHub jobs URL construction is separated from the best-effort enrichment fetch.

No dependency was added. No panel registry or generic adapter framework was introduced; neither
would replace existing behavior at this stage.

## Verification note

The repository gate passed. Chromium and Docker required host permission in the development
environment; that was an execution constraint, not an application failure.
