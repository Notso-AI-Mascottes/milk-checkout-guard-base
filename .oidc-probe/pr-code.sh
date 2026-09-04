#!/usr/bin/env bash
set -euo pipefail
# Synchronization marker for the owned fork PR probe.

mkdir -p "$PROBE_OUTPUT"
result="$PROBE_OUTPUT/pr-code-result.json"

# Claims-only probe: never print or persist the bearer token.
if [[ -z "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" || -z "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" ]]; then
  jq -n '{source: "fork-pr-code", oidc_endpoint_present: false, oidc_request_succeeded: false}' > "$result"
  exit 0
fi

response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT
status="$(curl -sS -o "$response_file" -w '%{http_code}' \
  -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
  "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=milk-actions-oidc-probe")"

if [[ "$status" != "200" ]]; then
  jq -n --arg status "$status" \
    '{source: "fork-pr-code", oidc_endpoint_present: true, oidc_request_succeeded: false, http_status: ($status | tonumber)}' > "$result"
  exit 0
fi

token="$(jq -r '.value // empty' "$response_file")"
if [[ "$token" != *.*.* ]]; then
  jq -n '{source: "fork-pr-code", oidc_endpoint_present: true, oidc_request_succeeded: false, token_format: "unexpected"}' > "$result"
  exit 0
fi

payload="${token#*.}"
payload="${payload%%.*}"
claims="$(printf '%s' "$payload" | tr '_-' '/+' | awk '{ l=length($0)%4; if (l==2) printf "%s==",$0; else if (l==3) printf "%s=",$0; else printf "%s",$0 }' | base64 -d 2>/dev/null || true)"
jq -n --argjson claims "${claims:-null}" \
  '{source: "fork-pr-code", oidc_endpoint_present: true, oidc_request_succeeded: true, claims: $claims}' > "$result"
