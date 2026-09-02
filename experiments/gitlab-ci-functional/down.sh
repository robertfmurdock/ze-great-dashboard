#!/bin/sh
set -eu

directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
state="$directory/.state"

if [ -f "$state/credentials.env" ]; then
  docker compose --env-file "$state/credentials.env" -f "$directory/compose.yaml" down --volumes
else
  docker compose -f "$directory/compose.yaml" down --volumes
fi
rm -rf "$state"
