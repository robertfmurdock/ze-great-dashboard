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
`174159267544`. The administrator also creates `ZeGreatDashboardCloudFormationExecution`, which
CloudFormation—not GitHub—assumes to operate the resources in `stack.yml`. The provisioning role can
operate only the `ze-great-dashboard` stack and pass only that execution role. It must not trust pull
requests, tags, or other branches.

This role is the sole bootstrap boundary. The stack creates a narrower `ZeGreatDashboardDeploy`
role, which the workflow assumes only for publishing immutable client assets.

The two bootstrap roles are declared in `bootstrap.yml`. Upload that file in AWS CloudShell and run:

```sh
aws cloudformation deploy \
  --region us-east-1 \
  --stack-name ze-great-dashboard-bootstrap \
  --template-file bootstrap.yml \
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

## One-time consumer reference bootstrap

The release workflow deploys the exact pre-publish tarball to one persistent consumer reference stack:
`ze-great-dashboard-reference`. Its checked-in consumer inputs are under `../reference/`; it has no
runtime secrets or third-party source. An administrator must create its bootstrap stack once:

```sh
aws cloudformation deploy \
  --region us-east-1 \
  --stack-name ze-great-dashboard-reference-bootstrap \
  --template-file reference-bootstrap.yml \
  --parameter-overrides \
    GitHubRepository=robertfmurdock/ze-great-dashboard \
    GitHubOwnerId=6215634 \
    GitHubRepositoryId=1338375095 \
  --capabilities CAPABILITY_NAMED_IAM \
  --tags Project=ze-great-dashboard ManagedBy=cloudformation
```

`reference-bootstrap.yml` retains a private, encrypted, versioned
`ze-great-dashboard-reference-artifacts` bucket; a main-branch-only GitHub OIDC role can upload only
there and operate only the reference stack. CloudFormation assumes a separate execution role scoped to
the reference Lambda, its log group, and `ze-great-dashboard-reference-*` runtime roles.

## Manual inspection

To preview an infrastructure change without applying it, create a CloudFormation change set in AWS
or run the workflow from a branch after temporarily adding a separate read-only planning job. Normal
branch pushes deliberately receive no AWS credentials.
