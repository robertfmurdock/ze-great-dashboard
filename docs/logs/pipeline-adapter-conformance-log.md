# Shared CI-adapter conformance baseline

Implemented 2026-10-05.

`pipeline-status` adapters now enter through a common controlled contract at the real bounded
panel route. The suite exercises the public envelope and schema, source-run identity, cache and
validator relay, upstream `304`, non-disclosing unauthorized failures, and rejection of an
undeclared panel before any upstream call. It deliberately uses minimal deterministic responses:
these are route-contract inputs, not claims about a provider's full response shape.

The common contract compares each provider's canonical source-run link rather than imposing a URL
grammar. Query strings and fragments can be required, safe parts of a provider's direct-run link;
the non-disclosure requirement concerns credentials and raw upstream failure detail, not URL
syntax. The shared non-disclosure case covers server-only credentials and unauthorized error
envelopes; it does not certify arbitrary upstream URL fields as safe. Provider-focused tests remain
the authority for each provider's URL construction and any link-field validation it needs.

Provider-focused adapter tests remain the authority for normalization vocabulary, URL construction,
authentication, activity/timeline reads, and unusual provider statuses. Turning those into a
lowest-common-denominator suite would obscure the provider behavior that needs separate review.

Fixture evidence is now explicitly separate from controlled conformance. A new adapter must pass
the shared controlled suite before it is registered, but consumer support wording remains bounded
by the provider's fixture-qualification row. GitLab is the next useful qualification target;
capturing its responses should promote concrete lifecycle and failure scenarios without relabeling
synthetic inputs as captures.
