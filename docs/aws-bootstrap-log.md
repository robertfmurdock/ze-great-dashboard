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

## Known next steps

No bootstrap stack has been applied to a real AWS account yet. The first administrator-reviewed
change set should validate CloudFormation/IAM service behavior and feed any findings back into the
runbook and tests.

Routine application deployment should consume the captured core execution-role ARN explicitly via
CloudFormation's `--role-arn`. That completes the handoff from the bootstrap security boundary to
the normal consumer deployment command and prevents an operator from accidentally deploying with a
different execution identity.
