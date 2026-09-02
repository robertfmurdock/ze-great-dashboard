# Local GitLab CI functional experiment

This is a disposable, Docker-only compatibility exercise for the GitLab CI adapter. It runs a
private GitLab CE instance behind Caddy's internal HTTPS certificate, registers a project-scoped
Docker Runner, creates a passing pipeline, and verifies the dashboard's real `/api/panel` response.
It is not a supported deployment pattern or part of the normal test gate.

## Run it

From the repository root:

```sh
./experiments/gitlab-ci-functional/start.sh
```

The first run downloads roughly 1.3 GB for GitLab CE and needs several minutes plus at least 4 GB
of Docker memory. The script generates short-lived local root and API credentials in the ignored
`.state/` directory. It does not expose GitLab or Caddy on host ports; the entire check runs inside
the Compose network. Caddy's local CA is shared only with the Runner and dashboard containers, so
the adapter exercises HTTPS certificate verification rather than disabling TLS validation.

The disposable Docker Runner mounts the Docker socket. That gives its CI job containers elevated
control of the local Docker daemon, so use this experiment only with this reviewed sample project
and never with untrusted pipeline definitions.

To remove the containers, volumes, generated credentials, project, and local GitLab data:

```sh
./experiments/gitlab-ci-functional/down.sh
```

The adapter uses the created API token only through `PRIVATE-TOKEN`; the board references its
environment-variable name. The seed project is `root/dashboard-gitlab-functional`, restricted to
`main`, and its pipeline carries the `dashboard-functional` Runner tag. The Runner itself uses
the internal `http://gitlab` Docker-network clone URL so its disposable job container does not need
Caddy's development CA; the Runner control channel and the dashboard adapter both use verified
HTTPS through Caddy.
