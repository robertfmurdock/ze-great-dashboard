# Immutable asset-path routing

Recorded 2026-08-31.

Deployment now selects the browser client with one complete immutable `AssetPath`, rather than
combining an asset host and dashboard release version in CloudFormation or Docker. The package owns
that choice because it also writes the board schema modeline: allowing a later stack override would
let the running client and the board's schema URL silently diverge. Release versions remain package
and artifact identity, but are no longer routing inputs.

The public S3 layout remains the default for compatibility. `--asset-domain` is retained as a
deprecated shorthand for that layout; `--asset-path` is the portable interface for an existing S3
prefix, internal CDN, or external CDN. Both selectors together fail loudly. The structural package
test exercised a jsDelivr-style exact URL through release metadata, the archived board modeline,
CloudFormation defaults, parameters, and handoff. It deliberately did not fetch jsDelivr: packaging
validates the immutable URL binding and document contract, while availability remains an operator
deployment responsibility.

`window.env` and `/api/client` now expose only `assetPath`. The compiled client embeds its own
release label during exact-release packaging, avoiding URL-segment inference and making the display
truthful for arbitrary paths. Update polling continues to reload only when the server-selected path
changes.

The Docker image's default selector is likewise an explicit `ASSET_PATH` build argument. This does
not put browser assets into the image or alter its independent server-image version.

Verification: `npm run check` passed, including browser, Docker, and exact npm-tarball staging
checks; the staged client bundle was asserted to contain its baked release version.

### Follow-up correction

The initial implementation changed Docker's build argument but left the release workflow and local
Compose overlay supplying the retired `RELEASE_VERSION` argument. That would have published server
images with an empty default selector. Both now pass the complete canonical `ASSET_PATH`; the
workflow assertion names that exact handoff. Package assembly also now rejects non-HTTP(S) paths and
URLs with credentials, query strings, or fragments before it writes any release artifact.

### jsDelivr smoke verification

Recorded 2026-09-01.

The external-CDN option was exercised end to end against the published, exact client release
`0.21.0` at jsDelivr: the checked-out server fetched its template and schema, rewrote the
entrypoint for a temporary credential-free board, and Chromium loaded the resulting cross-origin
hashed assets without browser, page, or request failures. This turns jsDelivr from a
jsDelivr-shaped structural fixture into a documented known alternative for consumers. It does not
turn a moving tag into a supported selector: administrators must continue to choose an exact,
reviewed client release.

### Consumer documentation boundary

Recorded 2026-09-01.

Consumer setup now consistently asks an application owner to select an exact reviewed package and
client release. The top-level README keeps the evaluated published-image path separate from source
build workflow, which belongs in contributor material. Alternate-host instructions now name the
operational contract behind the immutable-client design: the server reaches the entrypoint and
schema; browsers retrieve hashed assets across CORS; and a versioned asset directory is never
changed in place. The AWS guide also links bootstrap upgrade decisions to the administrator runbook
instead of leaving its procedure after troubleshooting.
