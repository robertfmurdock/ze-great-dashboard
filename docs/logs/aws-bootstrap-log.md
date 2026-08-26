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
- The core template exposes `BootstrapContractVersion: 1`; the GitHub OIDC v2 template exposes
  `BootstrapContractVersion: 2` and its template revision. Both have stable outputs. Bootstrap
  bucket and role resources are retained so an upgrade cannot silently replace or delete them.

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

### First observed gated release

The first `main` release through this gate was commit `e4ede5d` on 2026-08-21. Its
[workflow run 32508530061](https://github.com/robertfmurdock/ze-great-dashboard/actions/runs/32508530061)
completed `Build and check`, `Validate consumer bootstrap candidate`, and `Release` successfully in
that order. It published immutable client assets and
`@continuous-excellence/ze-great-dashboard-aws@0.1.32`, confirmed the npm version was visible, and
created the verified release tag. The validation job required no reviewer prompt.

## Guided consumer bootstrap — completed 2026-08-21

Issue #2 is closed by commit `e071442` (`[minor] add guided AWS bootstrap`). The AWS package now
provides a non-secret `bootstrap init` manifest scaffold, read-only `bootstrap preflight` checks,
and a human-readable `bootstrap guide`; the existing JSON `handoff` remains the automation
contract. The guide preserves explicit change-set review and administrator-run AWS commands, while
`verify` alone emits optional GitHub Environment variable instructions after both stack captures
validate. Handoff phases now name the expected core and GitHub OIDC outputs.

The release workflow for that commit, [run 32521500732](https://github.com/robertfmurdock/ze-great-dashboard/actions/runs/32521500732),
passed `Build and check`, `Validate consumer bootstrap candidate`, and `Release`. A separate
immutable-OIDC migration in the Coupling repository remains consumer-owned administration; it is
not a remaining dashboard-repository defect or bootstrap action.

## Package-owned template visibility — completed 2026-08-24

The bootstrap source-of-truth decision was clarified. Consumer repositories check in the exact AWS
package version and their non-secret `dashboard-bootstrap.json` manifest. They do not copy or
symlink the package's CloudFormation templates, and they do not treat `describe-stacks` JSON as
desired configuration. This avoids requiring a package upgrade and a second synchronization step.

The AWS package now exposes `bootstrap plan --config <path>` in JSON or text form. The read-only
plan reports the installed package version, each template's package path, contract version,
template revision, SHA-256, CloudFormation resources, and IAM actions. It explicitly states that
the plan performs no AWS or GitHub mutations, making a package upgrade visible in a consumer pull
request or CI summary without duplicating the security-sensitive templates.

The guided handoff now includes the same package version and template provenance, while the text
plan labels its action list as declared actions because it includes intentional deny statements as
well as allows. `npm run check` passed after the change: 120 unit tests, the browser test, and the
published-package smoke test. The remaining follow-up is to simplify the handoff's temporary-file
lifecycle and make the plan a standard step in consumer CI where appropriate.

## Disposable bootstrap work directory — completed 2026-08-24

The guided handoff now accepts `--work-dir`. When supplied, generated core/OIDC parameter files and
captured stack JSON are placed under that directory, keeping the checked-in manifest separate from
temporary deployment artifacts. The bootstrap and CloudShell guides use `.bootstrap-work` and
state that it should not be treated as source configuration.

The handoff retains its existing defaults for compatibility, and explicit capture paths still take
precedence. Added regression coverage for work-directory paths. `npm run check` passed with 121 unit
tests, the browser test, and the published-package smoke test.

## Checked-in validation configuration — completed 2026-08-24

The consumer-bootstrap validation workflow now reads its AWS Region and application stack name from
the checked-in `reference/consumer-bootstrap-validation.json` manifest instead of duplicating those
values in workflow YAML. The GitHub Environment and reviewed role ARNs remain explicit deployment
boundary inputs. The workflow test protects this single-source behavior, and `npm run check` passed
with 121 unit tests, the browser test, and the published-package smoke test.

## Progress checkpoint — 2026-08-24

The current implementation now has a single-source configuration model: consumer repositories check
in the package pin and non-secret bootstrap manifest, while templates remain package-owned. The
read-only `bootstrap plan` exposes package version, template revisions, hashes, resources, and
declared actions. The guided handoff exposes the same provenance and supports `--work-dir` so
generated parameters and stack captures stay disposable. The validation workflow reads its Region
and application stack name from the checked-in validation manifest. All changes are covered by the
repository gate, currently passing 121 unit tests, the browser test, and the published-package smoke
test.

## Canonical pipeline consistency check — implementation completed 2026-08-24

The overlapping `bootstrap status` experiment was removed. `bootstrap plan` is now strictly the
offline package/template review, while `bootstrap check --config <path>` is the one live, blocking
pipeline gate. It checks both bootstrap stacks against the manifest and installed package, including
identity, Region, stable status, required outputs, every parameter, contracts, and template
revisions. Optional manifest values compare with their CloudFormation empty defaults, so removing a
secret, KMS key, or gateway reference cannot be reported as consistent while the old value remains
deployed.

Both templates now expose compatible revision markers: core revision `1.1` and GitHub OIDC revision
`2.2`. The GitHub deploy role can run drift diagnostics only for its exact core and OIDC bootstrap
stacks and can inspect only the exact bootstrap bucket and roles whose properties CloudFormation
evaluates. The token-based detection-status read is the one AWS-required wildcard.
`bootstrap check --resource-drift` adds the slower CloudFormation resource-drift diagnostic and
reports drifted logical resources and property differences. The normal release gate runs the fast
consistency check before packaging, while full resource drift is intended for a scheduled or
manually dispatched audit.

The disposable-work-directory journey was completed at the same time: capture commands now render
real shell redirection, every follow-up path remains under `.bootstrap-work`, and that directory is
ignored locally. The repository gate passes with 127 unit tests, the browser test, and the
published-package smoke test.

AWS rollout remains deliberately pending. An administrator must review and apply the core `1.1` and
GitHub OIDC `2.2` template updates in the validation account before the new live release gate can
pass. No successful live `bootstrap check` workflow run is recorded yet, and the package never
performs the bootstrap update itself.

## Coupling credential-path validation — 2026-08-26

The Coupling integration appears to have proven that a minimally scoped GitHub fine-grained PAT is
working as intended through the Parameter Store `SecureString` path: the token is held in the
parameter-backed JSON credential map, the board refers only to `token_env: GITHUB_TOKEN`, and the
consumer can use the resulting GitHub source without placing the PAT in Git, the board, or Lambda
environment variables. This is evidence for the credential wiring and scope, not a change to the
dashboard's rule that credentials remain consumer-owned.
