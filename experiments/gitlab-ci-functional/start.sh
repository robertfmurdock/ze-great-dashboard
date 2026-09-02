#!/bin/sh
set -eu

directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
state="$directory/.state"
mkdir -p "$state"

if [ ! -f "$state/credentials.env" ]; then
  umask 077
  root_password=$(openssl rand -hex 24)
  dashboard_token=$(openssl rand -hex 32)
  printf 'GITLAB_ROOT_PASSWORD=%s\nGITLAB_DASHBOARD_TOKEN=%s\n' "$root_password" "$dashboard_token" > "$state/credentials.env"
fi

compose="docker compose --env-file $state/credentials.env -f $directory/compose.yaml"
$compose up -d caddy gitlab assets

echo 'Waiting for GitLab to become ready (first start commonly takes several minutes) …'
until $compose exec -T caddy wget -q --no-check-certificate -O /dev/null https://gitlab.test/users/sign_in; do
  sleep 10
done
until $compose exec -T caddy test -f /data/caddy/pki/authorities/local/root.crt; do sleep 1; done
$compose exec -T caddy chmod 755 /data/caddy/pki /data/caddy/pki/authorities /data/caddy/pki/authorities/local
$compose exec -T caddy chmod 644 /data/caddy/pki/authorities/local/root.crt

token=$(sed -n 's/^GITLAB_DASHBOARD_TOKEN=//p' "$state/credentials.env")
$compose exec -T -e DASHBOARD_TOKEN="$token" gitlab gitlab-rails runner '
  user = User.find_by_username("root")
  token = user.personal_access_tokens.find_or_initialize_by(name: "dashboard-functional")
  token.scopes = ["api"]
  token.expires_at = 7.days.from_now
  token.set_token(ENV.fetch("DASHBOARD_TOKEN"))
  token.save!
'

if [ ! -f "$state/project.json" ]; then $compose run --rm seed; fi
if ! $compose run --rm --entrypoint test runner-register -f /etc/gitlab-runner/config.toml; then
  $compose run --rm runner-register
fi
$compose up -d runner dashboard
$compose run --rm retry
$compose run --rm probe
