#!/usr/bin/env bash
set -euo pipefail

echo 'PAYLOAD_SOURCE=FORK'
echo 'FORK_CODE_EXECUTED=true'

if [[ -z "${MILK_CANARY:-}" ]]; then
  echo 'CANARY_AVAILABLE=false'
  exit 2
fi

canary_digest="$(printf '%s' "$MILK_CANARY" | sha256sum | cut -d' ' -f1)"
token_can_push="$(gh api "repos/$GITHUB_REPOSITORY" --jq '.permissions.push')"

echo 'CANARY_AVAILABLE=true'
printf 'CANARY_SHA256=%s\n' "$canary_digest"
printf 'TOKEN_CONTENTS_WRITE=%s\n' "$token_can_push"
