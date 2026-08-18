#!/usr/bin/env bash
set -euo pipefail

: "${ASSETS_BUCKET:?ASSETS_BUCKET is required}"
: "${ASSETS_BASE_URL:?ASSETS_BASE_URL is required}"
: "${FUNCTION_NAME:?FUNCTION_NAME is required}"
: "${VERSION:?VERSION is required}"

asset_path="${ASSETS_BASE_URL}/dashboard/${VERSION}"

aws s3 sync packages/client/dist "s3://${ASSETS_BUCKET}/dashboard/${VERSION}/" \
  --exclude index.html \
  --cache-control 'public, max-age=31536000, immutable'
aws s3 cp packages/client/dist/index.html "s3://${ASSETS_BUCKET}/dashboard/${VERSION}/index.html" \
  --cache-control 'public, max-age=60'

(cd packages/server/dist && zip -q -r ../../../lambda.zip .)
aws lambda update-function-code \
  --function-name "$FUNCTION_NAME" \
  --zip-file fileb://lambda.zip \
  --no-cli-pager > /dev/null
aws lambda wait function-updated --function-name "$FUNCTION_NAME"

aws lambda update-function-configuration \
  --function-name "$FUNCTION_NAME" \
  --environment "Variables={ASSET_PATH=${asset_path},BOARD_CONFIG_URL=./board.yaml,HOST=0.0.0.0}" \
  --no-cli-pager > /dev/null
aws lambda wait function-updated --function-name "$FUNCTION_NAME"
