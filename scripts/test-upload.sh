#!/usr/bin/env bash
set -euo pipefail

FILE="${1:-}"
if [ -z "$FILE" ]; then
  echo "Usage: $0 /path/to/image.jpg"
  exit 1
fi

DOMAIN="${DOMAIN:-https://images.stevengerner.com}"
TOKEN="${TOKEN:-CHANGE_ME}"

curl -f -X POST "$DOMAIN/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@${FILE}" \
  -F "title=Uploaded via script" \
  -F "tags=test,script" \
  | jq .
