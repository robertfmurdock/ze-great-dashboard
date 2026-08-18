# Dashboard Consumer Package and Deployment Log

Recorded 2026-08-18.

## Objective

Prepare this repository to be its own first consumer of the provider-neutral dashboard package and
the AWS Lambda adapter. npm module publishing is intentionally not part of this change; the package
names and package boundaries are implemented locally so the release workflow can prove them before
anything is published.

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

## Assurance

The repository now tests the package boundaries directly. The AWS test bundles this repository's
Lambda entrypoint, embeds the example board as a consumer input, creates `lambda.zip`, and checks
the release metadata. The release workflow runs the same core validation and AWS packaging commands
used by the tests and then performs the AWS deployment.

Verified locally:

- `npm run check`
- `npm run build:release`
- AWS adapter Lambda packaging smoke test
- 80 tests passing across 12 test files
- `git diff --check`

## Explicitly deferred

npm publishing is not wired up yet. No `npm publish`, registry authentication, provenance setup, or
public package release automation was added. A follow-up should first decide package versioning,
registry ownership, and whether the published AWS adapter should carry the internal server runtime
or consume a separately published runtime artifact.
