# Standalone immutable client package

The browser artifact now has its own public package,
`@continuous-excellence/ze-great-dashboard-client`, while
`@continuous-excellence/ze-great-dashboard-aws` contains only the server runtime and AWS deployment
tooling. This preserves the immutable-web-app boundary: `index.html` is still fetched only from the
selected `ASSET_PATH`, and `index.mjs` in the Lambda ZIP remains the server handler.

Each release stages, verifies, and packs both artifacts at the same exact version. Candidate S3
publication extracts the client tarball directly, so the S3/CloudFront default and npm CDN source
distribute identical browser files. The AWS tarball remains the independently installed consumer
deployment interface. Both tarballs use their own immutable npm integrity-collision check and are
published with provenance before the release tag; snapshot releases stay dry-run only.

The client package deliberately exposes files rather than an import API and carries no runtime
dependencies. It is useful for npm or internal CDNs, but S3/CloudFront remains the AWS package's
default asset path.
