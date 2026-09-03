# Client refresh cache experiment

This is a repeatable local reproduction of the production symptom where the client notices a new
deployment but a normal reload receives the old `index.html`.

It builds the real client, serves two versioned prefixes containing that build's immutable assets,
and runs a local same-origin server that behaves like the dashboard entrypoint and `/api/client`.
The experiment can intentionally cache only the HTML entrypoint while keeping `/api/client` live.

Run it from the repository root:

```sh
node experiments/client-refresh-cache/experiment.mjs
```

The browser scenario shortens the production updater's 60-second interval only inside the test
page, so the production code path is exercised without waiting a minute. It reports:

- the cached-entrypoint case: the identity changes to B, but reloads continue to initialize A;
- the no-store control case: one reload initializes B and then stabilizes.

If Chromium cannot launch in the current environment, run the same command on a normal local
machine. The repository's existing browser checks use the same Playwright browser dependency.
