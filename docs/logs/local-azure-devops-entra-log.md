# Local Azure DevOps Entra access

Azure DevOps Services sources now support two mutually exclusive runtime authentication modes:
`token_env` preserves the existing read-scoped PAT Basic-auth flow, while
`entra_token_file_env` names an environment variable that holds a path to a short-lived delegated
token file. The board file still names no credential value. The adapter reads that file on every
upstream request, so a renewed token becomes visible without restarting the dashboard; missing,
malformed, and expired files are the same non-disclosing `unauthorized` panel state.

The local broker deliberately has no package dependency. It asks the host's existing Azure CLI
session for the Azure DevOps delegated scope, writes only an access token and expiry in an ignored
directory with restrictive permissions, refreshes before expiry, and removes that directory when
its child command exits. Docker Compose has a dedicated local overlay which receives only that
directory read-only at `/run/dashboard`. It does not install Azure CLI in the image or mount the
host Azure CLI profile, so the distroless published image never receives a refresh token or CLI
credential cache.

This is an intentionally local, interactive Azure DevOps Services convenience, not a deployed
identity design. No live tenant or Azure DevOps API call was made for this work; deterministic
contracts cover configuration exclusivity, PAT preservation, Bearer authentication, token-file
refresh visibility, failed-file disclosure, and the Compose mount. Deployed service principal,
managed identity, and federation support remain separate work.

The initial setup detail made the README carry an optional operational special case. The consumer
path is now split deliberately: the README remains a short discovery pointer, the board
configuration guide defines only the schema boundary, and `docs/local-azure-devops-entra.md` owns
the complete local host and Compose walkthrough plus its security limits.

The original Compose walkthrough still assumed a repository checkout because its overlay depended
on the root Compose file. The guide now embeds a consumer Compose example that mounts a sibling
`board.yaml` and the same short-lived token directory; users only download the broker helper. This
retains the no-Azure-CLI-in-image and no-`~/.azure` rules without turning a clone into a prerequisite
for trying the published image.

The first broker also started and stopped a child dashboard command. That coupled token issuance to
Compose lifecycle and obscured the simple boundary: Azure CLI is the host credential authority,
while Compose merely reads a mounted token file. It was replaced with a one-shot, atomic token
writer. Users independently start Compose and explicitly run the writer again before expiry; the
server sees the replacement on its next upstream request. The token directory is now deliberately
removed by the user when it is no longer needed rather than by an unrelated child-process exit.

The feature remains deliberately experimental and incubating. Its documentation now says plainly
that no Azure tenant was validated, no compatibility promise is made, and it is neither a production
identity design nor an operationally critical dashboard path.
