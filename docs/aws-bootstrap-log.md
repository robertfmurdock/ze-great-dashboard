# AWS consumer bootstrap implementation log

Recorded 2026-08-21 after implementing the security-focused consumer bootstrap path.

## What was implemented

The AWS package now ships versioned, consumer-owned bootstrap templates:

- `bootstrap/core-v1.yml` creates a retained Lambda-artifact bucket with bucket-owner-enforced
  ownership, all S3 public-access blocks, TLS-only access, and SSE-S3 or an optional customer CMK.
  It creates a restricted CloudFormation execution role for one application stack, function, log
  group, runtime role, artifact prefix, and optional runtime secret.
- `bootstrap/github-oidc-v2.yml` creates the GitHub Actions adapter role. It trusts an
  administrator-managed OIDC provider only for one repository, protected Environment, and
  `sts.amazonaws.com` audience, and is limited to one artifact prefix, stack, and execution role.
- Both templates expose `BootstrapContractVersion: 1` and stable outputs. Bootstrap bucket and role
  resources are retained so an upgrade cannot silently replace or delete them.

The application template is now private. It has no Lambda Function URL, `AuthType: NONE`, or
wildcard Lambda permission, and instead outputs `ServerFunctionArn` and `ServerFunctionName` for a
customer-owned gateway integration. The persistent consumer reference invokes the private Lambda
through an explicitly scoped test permission.

## Repeatable administration boundary

Consumer bootstrap commands deliberately do not execute AWS CLI commands. They validate local
inputs and produce parameter files, installed template paths, or structured `awsCommand` arrays.
`--format-shell` adds a safely quoted copy/paste representation. Administrator identity, approval,
logs, and all AWS side effects remain visible at the explicit AWS CLI call site.

The package includes `bootstrap/dashboard-bootstrap.example.json`. Consumers copy it as a
checked-in, non-secret manifest containing stable stack names, Region, bucket name, dashboard
function name, and GitHub Environment identity. The same manifest can generate both bootstrap and
application parameters. The runtime role name is derived as `<dashboardFunctionName>-server`, so it
is no longer another value to keep in sync.

For an adapter upgrade or creation, an administrator captures the core `describe-stacks` response
to a file. The CLI validates the core contract and derives its bucket, application-stack, and
execution-role outputs locally; the adapter manifest needs only GitHub-specific settings.

The full procedure, review criteria, recovery guidance, and upgrade flow are documented in
`docs/aws-bootstrap.md`. The repository-wide AWS command-boundary expectation is recorded in
`AGENTS.md`.

## Verification

- Template and CLI unit tests cover the bucket controls, exact OIDC trust, scoped permissions,
  private Lambda contract, required values, upgrade parameter preservation, and contract mismatch.
- `npm run check` passed: lint, type checks, 97 unit tests, and the browser test.
- `npm pack --dry-run` confirmed that the bootstrap templates and consumer manifest example are
  included in `@continuous-excellence/ze-great-dashboard-aws`.

## Validation preparation — 2026-08-21

The consumer deployment guide and GitHub Actions example now extract
`CloudFormationExecutionRoleArn` from the administrator-captured core `describe-stacks` JSON and
pass it as CloudFormation's explicit `--role-arn`. The generated GitHub deploy role remains the
caller identity; it can upload the artifact and pass only that restricted execution role.

Added `reference/consumer-bootstrap-validation.json` for account `174159267544`. The validation
Environment supplies the reviewed stack-output ARNs before the release gate requests AWS
credentials. The gate installs and verifies the exact candidate AWS-package tarball before
deploying the existing source-free reference board, and deliberately has no public invocation or
gateway smoke test.

## Real-account validation — completed 2026-08-21

An administrator created the separately named validation core stack, captured its contract outputs,
and created the GitHub OIDC adapter under the protected
`consumer-bootstrap-validation` Environment. The validation resources are intentionally retained for
inspection; no cleanup has been performed.

### Observed OIDC migration

The first protected validation dispatch installed the published package and reached
`sts:AssumeRoleWithWebIdentity`, but AWS denied the request before any artifact or application-stack
operation. The v1 adapter trusted GitHub's legacy mutable-name Environment subject; this repository
uses GitHub's immutable owner/repository-ID subject. The corrective adapter is `github-oidc-v2.yml`:
it adds immutable owner and repository IDs to the manifest and trust condition. The existing core
stack remained valid. The administrator reviewed and applied an `UPDATE` change set for only the
GitHub OIDC adapter stack; the generated deploy-role ARN remained the Environment variable value.

The v2 package `@continuous-excellence/ze-great-dashboard-aws@0.1.31` was then dispatched through
the protected Environment. The [validation workflow run 32507334638](https://github.com/robertfmurdock/ze-great-dashboard/actions/runs/32507334638)
installed that exact package, assumed only the generated GitHub deploy role, packaged the source-free
reference board, uploaded its Lambda artifact, and completed the validation application deployment.
It performed no public Lambda invocation and created no Function URL. This satisfies the end-to-end
consumer-bootstrap acceptance criteria; protected gateway/runtime smoke testing remains
consumer-owned.

## Pre-publication release gate — 2026-08-21

Consumer bootstrap validation now runs automatically in the `main` release pipeline after the
immutable candidate tarball and candidate client assets are produced, but before npm publication or
release tagging. The `consumer-bootstrap-validation` Environment remains restricted to `main` and
continues to scope the two reviewed ARN variables, but it has no required reviewer so the OIDC
boundary can serve as an automatic gate. The standalone dispatch workflow was removed.
