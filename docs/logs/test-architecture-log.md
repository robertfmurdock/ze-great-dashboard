# Test architecture baseline

On 2026-11-13, we used Coupling's testing guide as the structure for a current-state map
ahead of a later comparison. The dashboard document distinguishes in-process, browser,
packaged HTTP, and release-candidate evidence because each crosses a different boundary.
The executable commands also surfaced two distinctions worth preserving in the map. The
commit hook runs `verify`, which adds builds after `check`, and the standalone unit command
and the CI gate enumerate different Node script tests. This pass records the wiring as it
exists and leaves changes to the later comparison.

The follow-up made `check` the shared hook and CI gate. The package build already produces the
production client and the AWS package's Lambda. The standalone server Lambda command still
deserves a stage because it produces a minified entry point and stages the board separately.
The Node suite now uses the union of the previous entry points so consolidation preserves coverage.

The startup review kept Chromium evidence for CDN module loading, hosted HTTP evidence for
hostname routing and version-specific entrypoints, and container evidence for the packaged
server's upstream request-to-signal path. The hosted browser test still proves the value reaches
the page. Its HTTP status assertion duplicated the hosted HTTP check.

Playwright requires file scope for its trace setting, so the reload scenario moved into its own
spec. A temporarily blocked production JavaScript request prevented the public board from
rendering, and the retained trace named the failed asset. The credential-backed browser cases
run outside that trace scope.

The auth review kept missing-bearer rejection at one representative protected hosted board.
Separate valid reads still prove the shared policy reaches both boards, and the public-host request
still checks that a forwarded host cannot expose the private board. The fixture and real-provider
checks exercise different token and session boundaries.

The packaging review kept staging, installation, and deployment evidence. They exercise
different inputs and failure modes. Within staging, an exact list already proves its count or
excludes unlisted dependencies. The release assembly scenario now relies on its generated files
for evidence, since checking the pre-call parameters array afterward only checked test-owned data.

The Testmints review found two inputs that needed stronger links to their observable outputs.
The forwarded-host request now uses an eligible token, so a 404 isolates the host boundary.
The staged CLI scenario compares its supplied secret reference with the named output parameter.
The reload scenario starts with a rendered board and advances the browser clock after advertising
a new identity. It observes main-frame navigation and the recovered board. With the clock installed,
navigation timing entries were unavailable in Chromium, so the scenario waits for Playwright's
navigation event. The negative controls selected the authenticated host, supplied a different
secret reference, and left the client identity unchanged. Each failed at the expected boundary.

The first CI run after unifying the Node suite hit the dev-watcher test's five-second kill
timer. The check graph had started that suite alongside the build that recreates its package
inputs. The local test also passed with shared dist moved aside, so missing shared output alone
did not reproduce the CI failure. The gate now orders the suite after the build, matching the
focused command, and the test allows for slower startup while still waiting on actual process
exit. On timeout it kills the process group and includes the captured output and exit signal.
