# Infrastructure

`stack.yml` is the complete application stack. CloudFormation keeps its state in AWS; there is no
Terraform state file or state bucket.

The release workflow deploys this stack before publishing the client and server. It then reads the
bucket, CDN URL, function name, and release-role ARN from stack outputs, so deployment configuration
does not duplicate infrastructure names.

## One-time bootstrap

GitHub cannot create the AWS identity it needs to authenticate as. Before the first release, an AWS
administrator must create `ZeGreatDashboardProvision` and allow GitHub OIDC tokens matching exactly:

```text
repo:robertfmurdock@6215634/ze-great-dashboard@1338375095:ref:refs/heads/main
```

The shared OIDC provider `token.actions.githubusercontent.com` already exists in account
`174159267544`. The administrator also creates `ze-great-dashboard-cloudformation`, which
CloudFormation—not GitHub—assumes to operate the resources in `stack.yml`. The provisioning role can
operate only the `ze-great-dashboard` stack and pass only that execution role. It must not trust pull
requests, tags, or other branches.

This role is the sole bootstrap boundary. The stack creates narrower roles for publishing candidate
client assets and running the ephemeral Docker smoke test.

The bootstrap roles are declared in `bootstrap.yml`. Upload that file in AWS CloudShell and run:

```sh
aws cloudformation deploy \
  --region us-east-1 \
  --stack-name ze-great-dashboard-bootstrap \
  --template-file bootstrap.yml \
  --parameter-overrides \
    GitHubRepository=robertfmurdock/ze-great-dashboard \
    GitHubOwnerId=6215634 \
    GitHubRepositoryId=1338375095 \
    StackName=ze-great-dashboard \
    AssetsBucketName=ze-great-dashboard-assets \
    FunctionName=ze-great-dashboard \
    ServerRoleName=ze-great-dashboard-server \
    DeployRoleName=ZeGreatDashboardDeploy \
  --capabilities CAPABILITY_NAMED_IAM \
  --tags Project=ze-great-dashboard ManagedBy=cloudformation
```

This command is safe to rerun. It assumes the account's shared GitHub OIDC provider already exists.

## Resources

- Private, encrypted, versioned `ze-great-dashboard-assets` S3 bucket, retained on stack deletion
- CloudFront distribution with signed origin access to that bucket
- Main-branch-only GitHub asset-publishing role `ZeGreatDashboardDeploy`

`public-assets.zegreatrob.com` is the live CloudFront custom domain and the stable public package
contract. Keep its ACM validation CNAME in DNS so the certificate can renew automatically.

## Consumer reference

The normal infrastructure provision creates the persistent consumer reference resources alongside
the asset CDN: a private, encrypted, versioned `ze-great-dashboard-reference-artifacts` bucket, a
main-branch-only GitHub OIDC deployment role, and its scoped CloudFormation execution role. It also
creates one fixed-name Secrets Manager value containing only a fake credential map. Because
CloudFormation cannot create a Parameter Store `SecureString`, the narrowly scoped reference
deployment role maintains one fixed-name fake SecureString too. The release workflow deploys the
exact pre-publish tarball to `ze-great-dashboard-reference` first with each ARN and the credentialed
smoke board, then invokes `/health` after each deployment to prove both cold-start credential paths.
This is test infrastructure only; consumer credentials remain consumer-owned.

The existing provider bootstrap boundary must be updated once before the first release containing
this change: an AWS administrator reruns the **existing** `ze-great-dashboard-bootstrap` deployment
with the updated `bootstrap.yml`. This extends its CloudFormation execution role only to the named
reference bucket, three named reference roles, and the fixed fake credential smoke secret; it does
not add another bootstrap stack or give GitHub broader access. The consumer core bootstrap is now
revision `1.3`; its normal revision-check upgrade installs the matching ComputeMode, Parameter Store and
KMS-context permissions alongside the existing Secrets Manager contract.

The release workflow also assumes `ZeGreatDashboardReferenceSmoke` for an ephemeral ECS Fargate
task. That task probes `/health` from inside the container and is stopped, deregistered, and removed
from its temporary cluster by an unconditional cleanup trap. No ECS service or load balancer is
left running after the smoke test.

Before provisioning, the workflow performs a read-only provider bootstrap check against the
CloudFormation execution-role policy. If that policy cannot manage the smoke-test role, the
workflow stops with an explicit bootstrap remediation message instead of attempting the
infrastructure update.

### Repair the consumer-bootstrap validation stack

This repository-owned release gate uses fixed core and GitHub OIDC consumer bootstrap stacks. The
release gate is deliberately a three-step workflow: a pushed release first performs a read-only
consistency check; a stale bootstrap fails with the actual mismatches and this repair link; after an
approved administrator updates every affected stack, rerunning the same action must pass. A code
change is not required between the repair and the rerun.

Use the package's capture-and-reviewed-change-set path for both stacks. Run these commands from the
repository revision named by the failed action, with the exact package version used by that action:

```sh
npm exec -- ze-great-dashboard-aws bootstrap parameters \
  --bootstrap-config reference/consumer-bootstrap-validation.json \
  --kind core --deployed-stack-json core-deployed-stack.json \
  --output core-bootstrap-parameters.json
npm exec -- ze-great-dashboard-aws bootstrap change-set \
  --bootstrap-config reference/consumer-bootstrap-validation.json \
  --kind core --parameters core-bootstrap-parameters.json \
  --stack-name ze-great-dashboard-consumer-validation-bootstrap \
  --change-set-name repair-core-bootstrap --format-shell

npm exec -- ze-great-dashboard-aws bootstrap parameters \
  --bootstrap-config reference/consumer-bootstrap-validation.json \
  --kind github-oidc --core-stack-json core-deployed-stack.json \
  --deployed-stack-json github-bootstrap-deployed-stack.json \
  --output github-bootstrap-parameters.json
npm exec -- ze-great-dashboard-aws bootstrap change-set \
  --bootstrap-config reference/consumer-bootstrap-validation.json \
  --kind github-oidc --parameters github-bootstrap-parameters.json \
  --stack-name ze-great-dashboard-consumer-validation-github-bootstrap \
  --change-set-name repair-github-bootstrap --format-shell
```

Capture each live stack first with `aws cloudformation describe-stacks`, inspect the generated
templates, parameters, and change sets, then execute both reviewed change sets. Capture both stacks
again and rerun the failed action. The action should now succeed without another source change.
These commands are an administrator handoff, not hidden automation; they do not execute AWS
mutations themselves.

## Manual inspection

To preview an infrastructure change without applying it, create a CloudFormation change set in AWS
or run the workflow from a branch after temporarily adding a separate read-only planning job. Normal
branch pushes deliberately receive no AWS credentials.
