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
role, which the workflow assumes for publishing assets and updating Lambda code.

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
- ARM64 Node.js 22 Lambda `ze-great-dashboard`
- Public Lambda Function URL
- Lambda execution role and 14-day CloudWatch log group
- Main-branch-only GitHub release role `ZeGreatDashboardDeploy`

The distribution initially uses its generated `d*.cloudfront.net` HTTPS hostname. To use
`public-assets.zegreatrob.com`, request an ACM certificate in `us-east-1`, validate it with a CNAME
at GoDaddy, then record its ARN in the `AssetsCertificateArn` parameter default in `stack.yml`.
The release workflow's infrastructure step attaches the certificate and waits for CloudFront before
the client is published and tested at the custom hostname. Both parameters remain overridable for a
different deployment.

After CloudFront finishes deploying the hostname, add a second GoDaddy CNAME with name
`public-assets` and value equal to the `AssetsDistributionDomain` stack output. Keep the ACM
validation CNAME permanently so ACM can renew the certificate automatically.

## Manual inspection

To preview an infrastructure change without applying it, create a CloudFormation change set in AWS
or run the workflow from a branch after temporarily adding a separate read-only planning job. Normal
branch pushes deliberately receive no AWS credentials.
