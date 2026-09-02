# Local GitLab CI functional experiment

Implemented 2026-09-02.

The adapter was exercised against a real, private GitLab CE 19.3.1 instance rather than a mocked
HTTP server. The disposable Compose environment places that instance behind Caddy's internal HTTPS
CA, uses a project-scoped Runner to execute a minimal `main` pipeline, and asks the dashboard over
its normal bounded panel route. The observed successful response carried GitLab's pipeline ID,
`success` raw status normalized to `passed`, branch, timestamps, and returned pipeline `web_url`.
This gives the adapter a one-off compatibility check for a self-managed-style destination in
addition to its unit contract tests.

Caddy is deliberately the TLS boundary: GitLab itself serves HTTP only inside the private Compose
network, while the dashboard trusts Caddy's generated local root via `NODE_EXTRA_CA_CERTS`. The
Runner control channel also uses that verified HTTPS route. Its job container uses GitLab's internal
HTTP clone URL solely to avoid turning this adapter experiment into a general CI-job CA-distribution
exercise. That Runner has Docker-socket access and is therefore intentionally limited to the
reviewed, disposable sample project.

Execution exposed three local-environment details worth retaining. Giving both GitLab and Caddy the
same `gitlab.test` network alias made Docker DNS select either service, so GitLab retains the plain
`gitlab` hostname and Caddy owns the public name. GitLab's health endpoint was not usable as Caddy's
external readiness check in this configuration, although the sign-in page was; the script waits for
the latter. Finally, GitLab Runner's `clone_url` belongs in the `[[runners]]` section, not
`[runners.docker]`, and Docker job containers require the Compose network to resolve the experiment
host. The committed template records both requirements.

This remains an opt-in compatibility experiment, not part of `npm run check`: GitLab's image size,
startup time, Docker privilege, and resource use would break the project's fast feedback-loop
budget. Its source stays under `experiments/gitlab-ci-functional/` for deliberate reruns and is
cleaned with its explicit teardown script.
