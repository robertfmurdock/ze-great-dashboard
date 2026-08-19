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
  - Resolves immutable client asset URLs under `https://assets.zegreatrob.com/dashboard/<version>`.
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
