# Portable browser checks and stacked-card sizing — 2026-09-03

Browser checks now use the pinned Playwright Docker image by default, locally and in CI. Docker
Compose publishes the Playwright `run-server` port on an automatically selected loopback port;
the root runner waits for health, asks Compose for that mapping, rejects anything other than a
`127.0.0.1` endpoint, and passes the resulting WebSocket URL to Playwright. `PLAYWRIGHT_DOCKER=0`
remains the deliberate native-browser escape hatch.

The first portable run exposed a **test miss**. The earlier Linux host-network arrangement let the
browser container treat the host preview server as `127.0.0.1`; on Docker Desktop and an ordinary
bridge network, that address belongs to the container. The browser test was therefore not actually
testing its claimed portable container topology. The runner now gives the container Docker's
`host.docker.internal` host-gateway alias, while Vite permits that host only for its test preview.
The host-side preview remains local; the Playwright server's own port remains loopback-only.

The target browser command also revealed that forwarding options through the root wrapper was
incomplete: the client script consumed `--grep` instead of passing it to Playwright. The nested npm
script now has an explicit argument separator, so targeted browser tests exercise precisely their
requested scenario.

At narrow widths, the board retained the desktop's twelve explicit grid rows even though cards were
flowed into one column. Those tracks constrained stacked cards and could cut off evidence. The
narrow grid removes the explicit row template and uses intrinsic automatic rows. Stacked panel
content is no longer block-size contained, retains only inline-size containment for width queries,
and uses an integral narrow line height so browser layout rounding cannot hide the final evidence
pixel. The narrow browser contract reports the panel id and content/client measurements for any
future clipping failure.

No dependency was added. `npm run check` passed with the default Docker path, including the
containerized browser suite, image health validation, board validation, and published-package
smoke tests.

Follow-up refactoring consolidated process execution into one runner helper and reduced the
topology contract to one `PW_TEST_ORIGIN` value, from which the test base URL and immutable asset
path are derived. Docker is an intentional browser-test dependency: it is required by the default
check path for browser/version/topology parity, but adds neither an npm package nor an application
runtime dependency.
