# Testmints refresh-failure boundary-comprehension study

This separate synthetic A/B study tests whether Testmints' explicit setup → exercise → verify
shape helps agents distinguish a real public call that prepares state from the following call that
is the subject under test. It is research instrumentation, not dashboard release evidence.

Both conditions use the same standalone pipeline-refresh service, dependencies, fixture values, and
observable assertions. The first successful `refresh()` seeds and publishes evidence; the second
encounters a provider transport failure. Native Vitest keeps this sequence linear. Testmints makes
only the first call `setup`, the failing second call `exercise`, and the public outcome, cache,
publication count, and lease state `verify`. Testmints reporting stays disabled and no test-owned
scope is used because the service lease is production behavior under test.

The coordinator uses the completed pilot's fixed handoff, tool policy, anonymous identifiers,
GPT-6.1 Sol medium/high allocation, deterministic 16-run design, baseline snapshots, hidden
verifier, telemetry, and blind review workflow.

```sh
node experiments/testmints-refresh-failure-comprehension/create-task.mjs --preflight
node experiments/testmints-refresh-failure-comprehension/create-task.mjs --prepare --install
```

Preflight proves for each condition that the visible baseline passes, hidden acceptance fails,
the minimal production-and-test correction passes both boundaries, and a generated task contains
neither the alternate test template nor the verifier. The hidden verifier drives both refreshes
through the public service interface and checks that the failed second call returns the public
error outcome, does not alter the serialized prior observation, does not publish again, and leaves
the lease released.

Record and blind-score runs with the same coordinator commands documented by `--help`. Reviewers
score four binary explanation claims: first refresh is priming setup; failed second refresh is the
subject; cached evidence is retained; and failure neither publishes nor leaks a lease. Report raw
outcomes by cell before aggregating by representation, and advance only if Testmints improves
completion or boundary-focused explanations without materially worse median time or weaker endpoint
evidence. The result remains directional even if it again shows no advantage.
