# Ze Great Dashboard client

`@continuous-excellence/ze-great-dashboard-client` is the immutable browser artifact for Ze Great
Dashboard. It is not an importable JavaScript API.

Use an exact version and serve the files in its `client/` directory from any static host. jsDelivr
is a known alternative CDN for this package; for example, it exposes version `0.21.0` at:

```text
https://cdn.jsdelivr.net/npm/@continuous-excellence/ze-great-dashboard-client@0.21.0/client
```

That directory contains `index.html`, hashed assets, source maps, Vite's manifest, and
`board-config.schema.json`. It has no environment values or credentials. Point the dashboard
server's `ASSET_PATH` (or the AWS package's `--asset-path`) at the directory; the server fetches
and configures `index.html` at runtime.

The server must be able to reach `index.html` and `board-config.schema.json`. Browsers load the
hashed assets directly, so a non-jsDelivr host must serve them over HTTPS with CORS that permits the
dashboard origin; `Access-Control-Allow-Origin: *` is suitable because the files are public and
environment-free. Do not replace files at a published version path.

The normal AWS deployment uses its versioned S3/CloudFront asset path. This package is the
portable alternative for jsDelivr, other npm CDNs, internal CDNs, and other static hosts. Select a
reviewed exact version, never a moving tag.
