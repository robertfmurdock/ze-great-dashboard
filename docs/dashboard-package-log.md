# Dashboard Consumer Package and Deployment Log

Recorded 2026-08-18.

## Objective

Prepare this repository to publish the provider-neutral dashboard package and the AWS Lambda
adapter as self-contained npm packages that another system can install and deploy.

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
- Added npm trusted publishing through GitHub Actions. Release versions are applied only to
  temporary staging manifests, leaving the repository manifests at `0.0.0-dev`.
- Centralized package layout and declaration-build configuration to keep build, publish, and
  verification paths consistent.

## Assurance

The repository now tests the package boundaries directly. The AWS test bundles the published Lambda
runtime, embeds the example board as a consumer input, creates `lambda.zip` and client assets, and
checks the release metadata. The publish dry run checks matching staged versions and verifies that
checked-in package manifests are unchanged.

Verified locally:

- `npm run check`
- `npm run build:release`
- `npm run test:published`
- AWS adapter Lambda packaging smoke test
- 83 unit tests passing across 13 test files
- Clean temporary consumer installation and package/deploy dry run
- `git diff --check`

## Explicitly deferred

The remaining release prerequisite is repository administration: npm trusted publishing must be
enabled for these package names and the GitHub Actions identity. AWS infrastructure ownership and
credentials remain consumer/deployment concerns; the repository's existing deployment workflow
continues to use its configured AWS roles.
