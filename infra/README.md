# Published-service infrastructure

The files in this directory operate the project's public distribution and reference environment.
They are not the templates consumers use to deploy a dashboard.

To deploy your own dashboard:

1. Install `@continuous-excellence/ze-great-dashboard-aws` at an exact reviewed version.
2. Complete the [administrator bootstrap](../docs/aws-bootstrap.md).
3. Follow the [Lambda deployment guide](../docs/aws-setup.md), or use the package's ECS mode with
   consumer-owned networking and load balancing.

The installed package supplies the consumer bootstrap and application CloudFormation templates.
Do not copy account IDs, role names, domains, or stack names from this directory into a consumer
deployment.

## Public distribution resources

`stack.yml` defines the persistent infrastructure used to publish Ze Great Dashboard releases:

- A private, encrypted, versioned S3 asset bucket.
- A CloudFront distribution with signed access to that bucket.
- Restricted GitHub OIDC and CloudFormation roles for the named project stack.

CloudFormation retains its state in AWS; there is no Terraform state file or state bucket.
`public-assets.zegreatrob.com` is the public client-asset endpoint. Its ACM validation CNAME must
remain in DNS so the certificate can renew automatically.

The asset host is intentionally browser-readable and CORS-permissive. It may contain only immutable,
versioned browser artifacts with no credentials or environment-specific values. Dashboard runtime
configuration and source credentials must never be published there.

## Administrative boundaries

`bootstrap.yml` establishes the project's AWS deployment identity. It trusts only the immutable
GitHub owner/repository identity and approved branch, limits deployment to named resources, and
separates the GitHub role from the CloudFormation execution role. Pull requests, tags, and other
branches must not receive these AWS privileges.

`auth0-functional.yml` and the reference resources in `stack.yml` support the project's own
published-service validation. They are not required for consumer installations and must not be used
as credential or authentication templates. Consumer gateways, identity policy, source credentials,
and secret rotation remain consumer-owned.

Administrators changing this provider infrastructure should preview a CloudFormation change set and
review every IAM, replacement, deletion, and retained-resource effect before execution. Never delete
a retained bucket, role, OIDC provider, key, or secret as a repair shortcut.
