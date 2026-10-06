# Task: preserve cached evidence when refresh fails

A pipeline refresh service keeps the most recently observed pipeline evidence and publishes each
successful observation. A provider transport failure after an earlier success must be rendered as a
public error outcome without destroying the evidence viewers already have.

Make a provider transport failure after a prior successful `refresh()` return the public error
outcome, retain the prior cached observation unchanged, and avoid publishing a new update. Preserve
the service's lease behavior. Use the test style already present in this workspace. Run `npm run
check` when finished.
