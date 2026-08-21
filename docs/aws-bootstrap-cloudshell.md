# CloudShell: consumer bootstrap

This is a consumer-run guide for an exact installed package version and a caller-owned manifest. It
is not an automation script: every AWS command remains an explicit administrator action, and every
change set must be reviewed before it is executed.

## Prepare an exact tool and manifest

Open CloudShell in the intended Region with an approved administrator identity. Install a trusted,
exact package version under your organization’s npm policy and provide a non-secret manifest:

```sh
export DASHBOARD_AWS_VERSION=1.2.3
npm install --prefix .bootstrap-tools --ignore-scripts --save-exact \
  "@continuous-excellence/ze-great-dashboard-aws@$DASHBOARD_AWS_VERSION"
export BOOTSTRAP_CLI=.bootstrap-tools/node_modules/.bin/ze-great-dashboard-aws
export BOOTSTRAP_CONFIG=dashboard-bootstrap.json
```

The manifest names the Region, stacks, bucket, function, OIDC provider, repository, immutable IDs,
and GitHub Environment. It contains no credentials. At every pause, ask the navigator what is next:

```sh
"$BOOTSTRAP_CLI" bootstrap handoff --config "$BOOTSTRAP_CONFIG" | jq .
```

The JSON result includes argument arrays for parameter generation, change-set creation, waiting,
review, execution, and stack capture. Copy each command into the administrator shell deliberately;
the package never invokes AWS CLI itself.

## Core and OIDC phases

For the `core` phase, use the handoff commands to generate `core-bootstrap.json`, create a `CREATE`
change set, wait, and inspect it. Review every expanded IAM action, `CAPABILITY_NAMED_IAM`, resource
replacement, retained bucket/role, and the bucket’s TLS-only policy. Execute only the reviewed
change set, then redirect the listed capture command to `core-deployed-stack.json`.

Pass that capture back to the navigator for the `github-oidc` phase:

```sh
"$BOOTSTRAP_CLI" bootstrap handoff --config "$BOOTSTRAP_CONFIG" \
  --core-stack-json core-deployed-stack.json | jq .
```

Generate the adapter parameters from the captured core output, then repeat the explicit create,
wait, review, execute, and capture sequence. Confirm the exact immutable OIDC subject, audience,
one `lambda/*` prefix, application stack, and execution role. Do not execute a replacement of a
retained role or bucket. Capture the completed adapter as `github-oidc-deployed-stack.json`.

The navigator’s optional `gh api` lookup is read-only. If it reports
`immutable-subject-required`, coordinate the migration: inventory and temporarily make existing
name-based trust policies compatible, enable immutable subjects as a separate GitHub-admin action,
verify existing deployments, then retire legacy trust. `unverified` means the CLI, authorization,
permission, or network was unavailable; it does not invalidate offline planning.

## Verify and hand off

Validate both captures before configuring the GitHub Environment:

```sh
"$BOOTSTRAP_CLI" bootstrap verify --config "$BOOTSTRAP_CONFIG" \
  --core-stack-json core-deployed-stack.json \
  --github-oidc-stack-json github-oidc-deployed-stack.json | jq .
```

The output has the exact GitHub Environment variable names and reviewed ARN values, plus an optional
copy/paste `gh variable set` command. It does not mutate GitHub. A GitHub administrator owns the
Environment, branch policy, and setting those values.

Gateway selection, private Lambda permission, authentication, and runtime smoke tests remain the
consumer’s responsibility. This bootstrap intentionally creates none of them.
