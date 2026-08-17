# Infrastructure

Terraform for the assets bucket, its CloudFront distribution, the server Lambda, and the GitHub
Actions deploy role. Account `174159267544`.

Applied **manually**, from a session with write access. CI never runs Terraform: the deploy role can
publish assets and update one function, and cannot create infrastructure. Publishing artifacts and
provisioning are different privileges and only one of them belongs in a pipeline.

State is local and gitignored. Fine for one operator on a prototype; worth a state bucket the moment
that stops being true.

## What gets created

| Resource | Notes |
|---|---|
| `s3://ze-great-dashboard-assets` | Private, encrypted, CORS `*` for GET/HEAD |
| CloudFront distribution | OAC to the bucket; the only way in |
| ACM certificate (us-east-1) | Only if `assets_domain` is set; DNS-validated by hand |
| Lambda `ze-great-dashboard` + Function URL | `nodejs22.x`, arm64, auth `NONE` |
| IAM role `ZeGreatDashboardDeploy` | OIDC, scoped to `repo:robertfmurdock/ze-great-dashboard:*` |

The CORS policy is `Access-Control-Allow-Origin: *`, which is deliberate and safe *because of what
is in the bucket*: immutable build artifacts holding zero environment values and zero secrets. It
has to be that wide because the server fetches `index.html` cross-origin from wherever it runs —
localhost, Lambda, anywhere later — and enumerating those would mean editing infrastructure to add a
developer.

## The two-phase apply

`zegreatrob.com` is served by GoDaddy nameservers. There is no Route53 hosted zone, so Terraform can
neither create the alias record nor validate its own certificate. Two records get added by hand.

**1. Create the certificate and read its validation record.**

```sh
terraform apply -target=aws_acm_certificate.assets
terraform output certificate_validation_record
```

**2. Add that CNAME at GoDaddy.** Name and value come from the output above. GoDaddy appends the
zone automatically, so strip the trailing `.zegreatrob.com.` from the name it gives you. Then wait
for the certificate to reach `ISSUED` — usually a few minutes:

```sh
aws acm describe-certificate --region us-east-1 \
  --certificate-arn "$(terraform state show -no-color 'aws_acm_certificate.assets[0]' \
    | awk '/^ *arn *=/ {print $3; exit}' | tr -d '"')" \
  --query 'Certificate.Status' --output text
```

**3. Apply everything else.**

```sh
terraform apply
```

**4. Add the alias CNAME at GoDaddy**: `assets.dashboard` → the value of
`terraform output alias_record`.

Those two records live outside Terraform. They are named here so that in six months it is a
documented gap rather than a mystery.

### Skipping DNS entirely

Set `assets_domain = ""` and there is no certificate, no alias, and no GoDaddy involvement — assets
serve from the `d*.cloudfront.net` name. Everything works; `ASSET_PATH` just points there instead.
That this is a real option rather than a degraded mode is the one-variable property doing its job.

## First apply expects a broken function

The server refuses to start without a reachable client template, and on a fresh apply nothing has
been published yet. So the function exists and fails until the first CI deploy overwrites its code
and `ASSET_PATH`. That is accurate — there is no client — rather than a bug to work around.

Terraform `ignore_changes` covers the function's code and environment for the same reason: CI owns
those, Terraform owns the shape of the function. Otherwise every plan after a deploy would propose
reverting production to the placeholder.

## After the first apply

Confirm the workflow's hardcoded values match the outputs — `ASSETS_BUCKET`, `FUNCTION_NAME`,
`role-to-assume`, and `ASSET_BASE` in `.github/workflows/main.yml`.
