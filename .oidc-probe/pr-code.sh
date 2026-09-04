#!/usr/bin/env bash
set -euo pipefail

mkdir -p "$PROBE_OUTPUT"
jq -n \
  --arg source "trusted-base-control" \
  '{source: $source, oidc_requested: false}' \
  > "$PROBE_OUTPUT/pr-code-result.json"
