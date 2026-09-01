# Local Azure DevOps Entra access

Use this guide to show Azure DevOps Services pipeline status locally with the delegated identity
from your Azure CLI session. It is for an interactive developer session—not a deployed identity
mechanism—and it does not support Azure DevOps Server.

> **Experimental / incubating:** this is a best-effort local convenience, with no live-tenant
> validation and no compatibility promise. Do not use it as a production identity design or rely on
> it for an operationally critical dashboard.

You need Azure CLI installed, an active `az login` session, and read access to the Azure DevOps
project and pipeline you want to show. The dashboard does not validate that tenant access until it
makes the configured Azure DevOps request.

## Host development

Create a board file, for example `board.yaml`:

```yaml
sources:
  ado:
    type: azure-devops
    organization: your-organization
    project: Your Project
    entra_token_file_env: ADO_ENTRA_TOKEN_FILE
boards:
  operations:
    panels:
      - id: service-build
        type: pipeline-status
        source: ado
        pipeline: 42 # Azure DevOps pipeline definition ID
```

Sign in and write a short-lived token, then start the dashboard with that board:

```sh
az login
npm run ado-entra-token
ADO_ENTRA_TOKEN_FILE="$PWD/.dashboard-entra/ado-token.json" BOARD_CONFIG_URL="$PWD/board.yaml" npm run dev
```

Open <http://localhost:3000>. The token command asks Azure CLI for an Azure DevOps delegated access
token and writes it atomically to an ignored local directory. Run `npm run ado-entra-token` again
before expiry to replace it; the server reads the file on every Azure DevOps request, so it does not
need a restart. Never place a token in the board file or `.env`.

## Docker Compose configuration

You do not need to clone this repository. First make an empty working directory and download the
small local broker helper:

```sh
mkdir dashboard-ado-entra && cd dashboard-ado-entra
curl --fail --location --output ado-entra-token.mjs https://raw.githubusercontent.com/robertfmurdock/ze-great-dashboard/main/scripts/ado-entra-token.mjs
```

Save the `board.yaml` from the host example in that directory, then save this as
`azure-devops-entra.compose.yml`:

```yaml
services:
  server:
    image: ${DASHBOARD_IMAGE:-ghcr.io/robertfmurdock/ze-great-dashboard:latest}
    ports:
      - '3000:3000'
    environment:
      BOARD_CONFIG_URL: /app/board.yaml
      ADO_ENTRA_TOKEN_FILE: /run/dashboard/ado-token.json
      HOST: 0.0.0.0
      PORT: 3000
      PROXY_PATH: /api
    volumes:
      - ./board.yaml:/app/board.yaml:ro
      - ./.dashboard-entra:/run/dashboard:ro
    restart: 'no'
```

Before using that configuration, sign in and write the mounted token:

```sh
az login
node ado-entra-token.mjs
```

Open <http://localhost:3000>. The Compose file mounts your `board.yaml` and the short-lived token
directory read-only, but does not install Azure CLI in the image or mount `~/.azure`. Pin the raw
download URL and `DASHBOARD_IMAGE` to reviewed release versions for a repeatable evaluation; the
default `main` and `latest` values are for trying the feature. Integrate the configuration into
your own Compose setup and launch it through your normal Docker workflow. Re-run
`node ado-entra-token.mjs` to refresh the mounted token; a running dashboard observes the
replacement on its next Azure DevOps request. Delete `.dashboard-entra` when you no longer need
the local token.

## Authentication modes and boundaries

An Azure DevOps source must use exactly one mode:

- `token_env`: a Build (read)-scoped PAT, sent using Basic authentication.
- `entra_token_file_env`: a local short-lived delegated Entra token file, sent using Bearer authentication.

The token file is read for every Azure DevOps request, so renewal does not require a dashboard
restart. If the file is absent, malformed, or expired, the affected panel shows `unauthorized`
without exposing the token or its file path.

This local flow deliberately does not define a production Entra identity. A service principal,
managed identity, or workload federation design needs its own deployment-specific security review.
