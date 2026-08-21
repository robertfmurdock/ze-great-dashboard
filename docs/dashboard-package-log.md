# Dashboard Consumer Package and Deployment Log

Recorded 2026-08-18; release administration completed 2026-08-19.

## Objective

Prepare this repository to publish one public AWS Lambda adapter as a self-contained npm package
that another system can install and deploy. Core and shared remain internal workspace/build
packages.

## Implemented

- Added `@continuous-excellence/ze-great-dashboard` under `packages/core`.
  - Validates consumer board YAML using the shared schema.
  - Normalizes board YAML for deterministic artifacts.
  - Resolves immutable client asset URLs under the public custom domain at
    `https://public-assets.zegreatrob.com/dashboard/<version>`.
  - Emits release metadata, runtime compatibility, and SHA-256 checksums.
  - Provides `validate` and `package` CLI commands.
- Added `@continuous-excellence/ze-great-dashboard-aws` under `packages/aws`.
  - Bundles the existing Lambda runtime with a supplied board file.
  - Creates the Lambda deployment archive and release metadata.
  - Provides AWS-specific package and deploy commands.
  - Includes a parameterized CloudFormation template for Lambda, logging, IAM, Function URL,
    runtime settings, concurrency, and read-only secret references.
- Removed the Lambda build's production dependence on `boards/example.yaml`; local development may
  still use that file as its convenience default.
- Added an explicit API authorization insertion boundary while retaining the intentionally public,
  authless initial deployment.
- Updated the GitHub release workflow to validate with core, package with the AWS adapter, and
  deploy through the AWS adapter.
- Parameterized the existing infrastructure handoff and preserved compatibility with the existing
  bootstrap role names.
- Built normal JavaScript and declaration artifacts for the shared, core, and AWS packages; npm
  packages do not depend on this repository's TypeScript source tree.
- Made the AWS package self-contained by publishing the client assets, bundled Lambda, board release
  files, checksums, and CloudFormation template.
- Added a deployment dry run that validates the Lambda archive and client entrypoint without calling
  AWS.
- Added npm trusted publishing through GitHub Actions after the successful `main` release job.
  Release versions are applied only to temporary staging manifests, leaving the repository
  manifests at `0.0.0-dev`.
- Centralized package layout and declaration-build configuration to keep build, publish, and
  verification paths consistent.
- Simplified the public boundary to exactly `@continuous-excellence/ze-great-dashboard-aws`.
  `shared` and `core` are now private internal packages, and the AWS adapter bundles its release
  assembly plus the shared board-schema runtime it needs. Its public `ReleaseMetadata` type is
  self-contained and its runtime manifest has no unpublished workspace dependency.

## Assurance

The repository now tests the package boundary directly. The AWS test bundles the published Lambda
runtime, embeds the example board as a consumer input, creates `lambda.zip` and client assets, and
checks the release metadata. The publish dry run stages exactly one package, checks its manifest and
files for unpublished dependencies and TypeScript, then imports it and exercises package/deploy
dry-run behavior without AWS credentials.

Verified locally:

- `npm run check`
- `npm run build:release`
- `npm run test:published`
- `npm run typecheck`
- AWS staged-package import and package/deploy dry run
- AWS adapter Lambda packaging smoke test
- 83 unit tests passing across 13 test files
- Clean temporary consumer installation and package/deploy dry run
- `git diff --check`

## Published setup dogfood

Recorded 2026-08-19: the repository's publish job now installs its exact newly published AWS package
into an isolated temporary consumer, follows the documented `parameters` and `package` CLI path,
checks the generated CloudFormation handoff, and fetches that release's hosted client. The staging
test follows the same CLI path before publication, so command-level regressions fail before release
and registry/package/CDN integration failures fail after publication.

The first run exposed two setup frictions:

- Lambda archives originally depended on the system `zip` command. Packaging now uses bundled
  `fflate`, stable entry ordering, and a fixed archive timestamp, so repeated builds are
  byte-identical and consumers need no additional archive tool.
- The consumer default used `assets.zegreatrob.com`, while this repository publishes to its generated
  CloudFront hostname. Provider releases masked the mismatch by injecting the stack output. The
  package, template, documentation, and contract tests now use the live distribution origin.

The local automation shell also surfaced a stale `/usr/local/bin/npm` ahead of the Homebrew npm in
`PATH`, plus an unwritable default npm cache. The dogfood script avoids depending on `npm init` and
uses an isolated temporary cache, keeping the consumer check reproducible across developer and CI
machines.

## Shipped-package reference deployment

Recorded 2026-08-20: the `main` release now treats one exact-version npm tarball as the release
artifact. It first publishes that tarball's immutable client assets to the public CDN, then
clean-installs the same tarball as a consumer and runs the documented `parameters`, `package`, S3
upload, and CloudFormation deployment path against one persistent reference stack. The reference
resources are part of the existing infrastructure provision, so there is no second bootstrap stack.
The reference checks both `/health` and `/` before npm publishes that unchanged tarball. Publication
is followed only by a lightweight exact-version registry visibility check before tagging.

Publication is safe to rerun. If the calculated version already exists, the release compares the
registry integrity with the local tarball and skips publication only for an exact match. A differing
tarball at the immutable version fails the release rather than silently accepting a collision.

The AWS CLI now derives omitted deploy version and client asset arguments from its installed
package. Its provider-only `publish-assets` command publishes the immutable client without updating
a Lambda; the repository then uses the public CloudFormation consumer flow for its one reference
Lambda. The read-only `doctor` command remains available for consumer diagnostics.

Repository packaging no longer invokes the system `zip` executable. Bundled `fflate` creates ZIPs
with stable entry ordering and a fixed 1980 timestamp; tests assert byte-identical archives,
checksums, artifact keys, entries, and readable contents. Repository development is pinned to npm
`11.19.0` through `packageManager`, the root npm engine policy, and explicit CI installation and
version verification. The published consumer package retains only its Node engine requirement.

Verified locally for this slice:

- TypeScript typecheck and Biome lint
- 87 unit tests across 14 test files
- Playwright production-client browser smoke test
- npm publish staging, registry integrity rerun/collision behavior, and `git diff --check`
- Exact tarball install in a clean consumer with parameters, package validation, ZIP inspection,
  and deploy dry run

The release gate is the consumer reference smoke test; it exercises the public package contract
before publication without rebuilding the archive or updating a second Lambda.

## Candidate verification and release boundary

Recorded 2026-08-21: the workflow now separates release-candidate verification from release
publication. The `Build and check` job builds and tests the repository, calculates the version,
creates one exact npm tarball, provisions required infrastructure, publishes that candidate's
versioned client assets, and deploys and checks it through the persistent consumer reference. It
then saves that verified tarball as the only handoff to the `Release` job.

`Release` restores that exact artifact, publishes it to npm with provenance, waits for the registry
to expose it, and creates the Git tag. It does not rebuild or redeploy the candidate. This makes the
reference deployment an explicit build-and-check gate rather than a release action.

The assets and reference-artifact buckets now suspend S3 versioning. AWS buckets that have already
had versioning enabled cannot return to an unversioned state; suspension stops creation of new object
versions, while any historical versions remain until separately cleaned up.

The first run of this split (`32434574146`) proved the candidate phase but failed at publication
because npm provenance requires `id-token: write` on the job running `npm publish`. The follow-up
run (`32434854784`) restored that permission and completed both jobs: it released and tagged
`0.1.26` after the reference `/health` and root checks passed.

## Registry propagation during acceptance

Recorded 2026-08-19: release run `32264792126` successfully built and installed the `0.1.16`
tarball, provisioned infrastructure, deployed production, passed `/health` and `/` smoke tests,
passed every deployment-doctor check, and published the exact tarball with npm provenance. The
final clean registry install then failed with `ETARGET` because the newly published version was not
yet visible from the registry endpoint. As intended, the workflow stopped before creating the Git
tag.

The original consumer check retried five times over roughly twenty seconds, but reused one npm
cache. That window was too short for this publication, and cached package metadata could preserve
the initial miss. Registry installs now use `--prefer-online` and retry only propagation-shaped
`ETARGET` or `E404` failures for up to roughly one minute; unrelated install errors still fail
immediately, and local tarball checks do not retry. A subsequent clean consumer install of
`@continuous-excellence/ze-great-dashboard-aws@0.1.16`, including package validation, deploy dry
run, and hosted-client fetch, passed locally.

## Explicitly deferred

AWS infrastructure ownership and credentials remain consumer/deployment concerns; the repository's
existing deployment workflow continues to build internal packages, package/deploy AWS, and publish
the one public package through its configured AWS roles.

## Release administration follow-up

The first real release exposed the one-time npm bootstrap sequence:

- The first `main` run (`32204395844`) passed checks, packaging, AWS provisioning, deployment, smoke
  tests, and tagging at `0.1.12`. Only npm publication failed because the package did not yet exist.
- The package was manually staged and published as `0.0.0` using npm account authentication and a
  one-time password. This bootstrap version was subsequently unpublished after Trusted Publishing
  was configured; npm now reports `0.1.13` as the only version and `latest`.
- npm Trusted Publishing was configured for `@continuous-excellence/ze-great-dashboard-aws` with
  GitHub repository `robertfmurdock/ze-great-dashboard`, workflow `main.yml`, and `npm publish`
  permission. The GitHub publish job must retain `id-token: write`.
- npm's failed Trusted Publishing attempts returned a misleading `E404` on the package PUT even
  though OIDC provenance was successfully signed. The package manifest therefore includes an exact
  public repository URL in `packages/aws/package.json`:
  `git+https://github.com/robertfmurdock/ze-great-dashboard.git`.
- The follow-up `main` run (`32205432049`) successfully produced the `0.1.13` release and deployed
  the application. Registry verification confirmed `latest: 0.1.13`.

For future repositories using npm Trusted Publishing, publish one manual public version first,
configure the package's trusted publisher, ensure the package manifest identifies the matching public
GitHub repository, and then let the main-branch workflow publish subsequent versions.
