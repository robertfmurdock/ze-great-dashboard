# Immutable client artifact boundary — 2026-09-11

## Decision

The browser now consumes a browser-specific shared entrypoint. It exposes browser runtime schemas
and helpers plus type-only board contracts; source-adapter validation and operational defaults stay
on the server/shared root path. The published board schema deliberately omits parser defaults.

## Reasoning

An immutable client artifact is public deployment material. It must not disclose source adapter
implementation details such as a hosted-provider fallback URL. Server validation still resolves an
omitted GitLab CI URL to its hosted default, while consumer documentation remains the place to
describe that behavior.
