# API request completion logging

Recorded 2026-11-24.

## Context

An investigation of a KMS decrypt burst showed that Lambda and API Gateway metrics could establish
request volume and concurrency, but the application emitted no completion event for successful API
requests. API Gateway access logging was also not enabled in the investigated deployment. Operators
could see startup and selected failure diagnostics, but could not group traffic by route, status, or
latency.

## Decision

Add one `api.request_completed` JSON event for each `/api/*` request. It records the opaque request
ID, method, a fixed route template, HTTP status, and elapsed milliseconds. Dynamic path segments and
query parameters are omitted. Existing `panel.observation_failed` events remain the authority for
upstream health details; the completion event reports HTTP status, so an upstream panel error that
correctly returns HTTP 200 is not mislabeled as an HTTP failure.

The event does not record client IP, user agent, raw path, query, headers, or bodies. Those fields
can reveal identifiers or credentials and were not necessary to answer traffic-volume questions.
API Gateway access logging remains an operator deployment choice for cases requiring network-level
caller attribution.

## Evidence and limits

The route label is derived from the app's bounded API path shapes and tested to exclude a dynamic
board segment and a query value. Existing request IDs correlate the new event with response support
references and failure diagnostics. No request-body or response-body inspection is performed.

The focused server test passed. The unified `npm run check` passed typecheck, package and Lambda
builds, unit tests, browser tests, container endpoint checks, board validation, and published-package
checks. Its lint stage remains blocked by the repository's Biome schema URL at 2.6.5 while the
installed CLI is 2.6.8; targeted checks on changed TypeScript files pass.
