# Testmints agent-comprehension pilot harness

2026-10-05

The dashboard now carries an opt-in synthetic evaluation harness for a narrow question: does Testmints' explicit setup → exercise → verify shape help an agent understand and implement a route contract? It remains outside `npm run check`; it is research instrumentation, not dashboard release evidence.

The native-Vitest and Testmints task templates model the same Hono pipeline route. They receive the same exact direct dependencies, production code, behavior request, and hidden endpoint-level acceptance check. The intentional difference is only test representation. The task requires an optional provider update time to be reflected in a public signal and omitted when unavailable, while retaining the public link and cache contract.

The harness generates only one condition per assigned workspace and keeps the hidden verifier with the coordinator. A baseline task passes its visible check but fails hidden acceptance; the intended minimal implementation makes both native and Testmints tasks pass their full checks and hidden acceptance. This establishes the measurement boundary without treating either condition as superior before agent results exist.

`@continuous-excellence/testmints-js@0.0.1` is an exact root development dependency only because it is the evaluated subject. Its early API is an explicit experimental maintenance cost, while its Vitest 5 peer range matches the repository's Vitest 5.0.3. Phase reporting is not enabled because the first pilot measures agent comprehension rather than failure diagnostics.

## Coordinator refinement, 2026-10-06

The pilot now has a deterministic coordinator: a fixed seed creates sixteen anonymous, installed
workspaces with four runs in every native/Testmints × GPT-6.1 Sol medium/high cell. The coordinator
owns the condition manifest, hidden endpoint verifier, baseline snapshots, telemetry/result records,
and blinded reviewer packets; agents receive only their single workspace, `TASK.md`, and the same
handoff. The paired visible tests now make the same request and assert the same status, cache
header, and public envelope. Testmints' `setup` explicitly returns `{ app }`; `exercise` makes the
one request; `verify` parses and asserts the response. No lifecycle scope or phase-reporting plugin
was added because the route test acquires no external resource and reporting would introduce an
unmeasured condition difference.

Coordinator preflight runs both representations through the intended evidence boundary: the visible
baseline passes, hidden acceptance fails before the implementation, and the smallest production and
visible-test update passes both. Its initial implementation copied a baseline workspace into the
intended-change workspace. That also copied Vitest's transformed-module cache, which made a
Testmints registration fail for a cache artifact rather than a source behavior. Preflight now creates
a fresh installed intended workspace for each condition. This retains the experiment's standalone
workspace contract and makes the check evidence about the task change rather than cache topology.

## Synthetic pilot result, 2026-10-06

All sixteen locked runs completed: every agent-reported `npm run check` and every independent hidden
endpoint verifier passed. Two condition- and profile-blind reviewers agreed on all four explanation
claims for every run, so each explanation received 4/4 and no adjudication was needed. At high
reasoning, native/Testmints median times were 30.5/26 seconds; at medium, 23.5/26.5 seconds.
Aggregated by representation only after that check, the medians were 26 seconds native and 26.5
seconds Testmints, with 8/8 completion in both conditions.

This is directional evidence, not a performance claim: Testmints did not improve completion or
explanation quality, and its aggregate median time was not lower. Do not advance to a real-dashboard
change on this result. Keep the opt-in harness for a revised task or hypothesis; the exact raw
records, reviewer inputs, and summary remain in ignored experiment state rather than release
evidence.

## Refresh-failure boundary-comprehension study, 2026-10-06

A separate sibling study now tests the more specific question the first pilot could not answer:
whether explicit phases help an agent distinguish a real public call that primes state from the
following call that is the subject under test. Its standalone service intentionally clears a prior
pipeline observation when a provider transport failure follows success. The required correction
retains that observation while returning the public error outcome, avoiding a second publication,
and releasing the production lease.

The two templates have identical fixture values and observable assertions. Native Vitest makes the
two calls linearly; Testmints makes the successful priming call `setup`, the failing second call
`exercise`, and cache/publication/lease assertions `verify`. As in the first pilot, phase reporting
is disabled and no test-owned scope is used: the lease is behavior the service itself must release.
The coordinator retains the 16-run deterministic allocation, isolation, hidden public-interface
verifier, baseline snapshots, telemetry, and representation/profile-blind explanation review. Its
preflight proves both visible baselines pass while hidden acceptance fails, then that the minimal
production-and-visible-test correction passes both boundaries. No outcome has been collected, so
this is instrumentation rather than evidence that either representation is better.
