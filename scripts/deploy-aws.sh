#!/usr/bin/env bash
set -euo pipefail

: "${ASSETS_BUCKET:?ASSETS_BUCKET is required}"
: "${ASSETS_BASE_URL:?ASSETS_BASE_URL is required}"
: "${FUNCTION_NAME:?FUNCTION_NAME is required}"
: "${VERSION:?VERSION is required}"
: "${ARTIFACT_DIR:?ARTIFACT_DIR is required}"
: "${ASSETS_DIR:?ASSETS_DIR is required}"

npx tsx packages/aws/src/cli.ts deploy \
  --artifact-dir "$ARTIFACT_DIR" \
  --assets-dir "$ASSETS_DIR" \
  --assets-bucket "$ASSETS_BUCKET" \
  --assets-base-url "$ASSETS_BASE_URL" \
  --function-name "$FUNCTION_NAME" \
  --version "$VERSION"
