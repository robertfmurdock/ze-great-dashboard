# Testmints agent-comprehension pilot harness

2026-10-05

The dashboard now carries an opt-in synthetic evaluation harness for a narrow question: does Testmints' explicit setup → exercise → verify shape help an agent understand and implement a route contract? It remains outside `npm run check`; it is research instrumentation, not dashboard release evidence.

The native-Vitest and Testmints task templates model the same Hono pipeline route. They receive the same exact direct dependencies, production code, behavior request, and hidden endpoint-level acceptance check. The intentional difference is only test representation. The task requires an optional provider update time to be reflected in a public signal and omitted when unavailable, while retaining the public link and cache contract.

The harness generates only one condition per assigned workspace and keeps the hidden verifier with the coordinator. A baseline task passes its visible check but fails hidden acceptance; the intended minimal implementation makes both native and Testmints tasks pass their full checks and hidden acceptance. This establishes the measurement boundary without treating either condition as superior before agent results exist.

`@continuous-excellence/testmints-js@0.0.1` is an exact root development dependency only because it is the evaluated subject. Its early API is an explicit experimental maintenance cost, while its Vitest 5 peer range matches the repository's Vitest 5.0.3. Phase reporting is not enabled because the first pilot measures agent comprehension rather than failure diagnostics.
