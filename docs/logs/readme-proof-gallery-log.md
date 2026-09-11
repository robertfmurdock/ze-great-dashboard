# README proof gallery

Implemented 2026-09-11.

The README gallery is deliberately evidence rather than a feature catalog: each still is tied to a
named, source-free fixture scenario and asserts the public wording it is meant to show before its
PNG is accepted. Status vocabulary is one complete frame rather than a scroll-dependent collection;
attention and security are separated because they answer different operational questions. The
existing GIF remains the one motion-specific artifact.

The capture runner uses the ordinary Vite/server path but intercepts every API response in the
browser, fixes time, asks for reduced motion, and aborts non-loopback requests. This keeps visual
evidence deterministic without adding a capture or image dependency. The blocked security scenario
starts from a tiny `security: required` board solely so the real server computes the fail-closed
browser boundary.

The repository gate passed after the implementation. This environment could not regenerate the
checked-in PNGs: native Chromium is denied its macOS rendezvous port by the execution sandbox, and
the Linux Playwright container cannot use the host's platform-specific Vite/esbuild dependency.
Run the documented capture commands in a normal local desktop checkout before committing the new
gallery assets; their assertions provide the intended release evidence.

Clarification, 2026-09-11: the full `capture:readme:gallery` command completed successfully in a
normal desktop checkout before commit. All four generated PNGs were inspected and their dimensions
and format were verified. The authless-warning image now exercises the real deployed-host security
state; the server entrypoint test also protects that state crossing from startup into `window.env`.

Test miss, 2026-09-11: the authless-deployment warning had tests for policy resolution and for the
client notice, but neither exercised the production handoff from `startup()` into the rendered
entrypoint. Startup computed `securityState === "warning"`, logged it, and then omitted it from
the `createApp()` dependencies, so deployed browser configuration silently lacked the warning.
The smallest representative correction is the new startup-to-`app.request("/")` regression test:
it uses deployed host settings, starts the server through its actual startup interface, and asserts
the rendered public configuration contains `security: "warning"`.

Test miss, 2026-09-11: the published-package smoke test uses a fixed staging directory in the
repository so its unpacked packages can resolve the test installation's dependencies. Its cleanup
was correct on normal completion, but a concurrent `git add .` could stage the generated packages
before cleanup, while repository-wide lint could treat the generated bundle as source. That made the
release gate depend on incidental workspace timing rather than the package contract it was intended
to verify. The existing staging directory is now ignored by Git and Biome, preserving the package
test's real dependency-resolution interface while establishing it as disposable test state.
