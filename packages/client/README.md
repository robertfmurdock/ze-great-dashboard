# Ze Great Dashboard client

`@continuous-excellence/ze-great-dashboard-client` is the immutable browser artifact for Ze Great
Dashboard. It is not an importable JavaScript API.

Use an exact version and serve the files in its `client/` directory from any static host. For
example, jsDelivr exposes version `1.2.3` at:

```text
https://cdn.jsdelivr.net/npm/@continuous-excellence/ze-great-dashboard-client@1.2.3/client
```

That directory contains `index.html`, hashed assets, source maps, Vite's manifest, and
`board-config.schema.json`. It has no environment values or credentials. Point the dashboard
server's `ASSET_PATH` (or the AWS package's `--asset-path`) at the directory; the server fetches
and configures `index.html` at runtime.

The normal AWS deployment uses its versioned S3/CloudFront asset path. This package is the
portable alternative for npm CDNs, internal CDNs, and other static hosts.
