# AWS consumer bootstrap implementation log

Recorded 2026-08-21 after implementing the security-focused consumer bootstrap path.

## What was implemented

The AWS package now ships versioned, consumer-owned bootstrap templates:

- `bootstrap/core-v1.yml` creates a retained Lambda-artifact bucket with bucket-owner-enforced
  ownership, all S3 public-access blocks, TLS-only access, and SSE-S3 or an optional customer CMK.
  It creates a restricted CloudFormation execution role for one application stack, function, log
  group, runtime role, artifact prefix, and optional runtime secret.
- `bootstrap/github-oidc-v1.yml` creates the GitHub Actions adapter role. It trusts an
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

Added `reference/consumer-bootstrap-validation.json` and the manually dispatched
`consumer-bootstrap-validation` workflow for account `174159267544`. The workflow requires the
protected GitHub Environment and its reviewed stack-output ARNs before it requests AWS credentials.
It installs and verifies the exact published AWS package version before deploying the existing
source-free reference board, and deliberately has no public invocation or gateway smoke test.

## Real-account validation remains administrator-owned

No validation stack has been applied from this repository session. An AWS administrator must create,
inspect, and execute both change sets, capture the core output, configure the protected Environment
variables from the reviewed outputs, and dispatch the validation workflow. Record the observed
CloudFormation/IAM behavior and any required service-policy adjustment here before closing issue #1.
