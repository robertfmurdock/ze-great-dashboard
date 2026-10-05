# Task: expose the source update timestamp

A pipeline panel currently tells viewers the result, source-run id, and canonical source link. It
must also expose the provider's update timestamp when one is available, so the client can tell how
old the source observation is.

Update the endpoint’s public success envelope so that `signal.sourceUpdatedAt` equals the upstream
run’s `updatedAt` value when supplied. When the upstream omits `updatedAt`, the public signal must
omit `sourceUpdatedAt` too. Preserve the existing public response, cache behavior, and canonical
link behavior.

Use the test style already present in this workspace. Run `npm run check` when finished.
