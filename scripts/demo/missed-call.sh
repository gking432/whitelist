#!/usr/bin/env bash
# Simulates a MISSED CALL hitting a client's intake webhook (docs/22). This
# triggers the "missed call rescue" workflow: the AI drafts a callback text
# so the business doesn't lose the job — the speed-to-lead story. The draft
# waits for approval; nothing is sent (dry run) until a provider is
# connected and switched to live.
#
# Usage:
#   scripts/demo/missed-call.sh <intake_webhook_url> <token>
set -euo pipefail

URL="${1:-${INTAKE_URL:-}}"
TOKEN="${2:-${INTAKE_TOKEN:-}}"

if [ -z "$URL" ] || [ -z "$TOKEN" ]; then
  echo "usage: $0 <intake_webhook_url> <token>" >&2
  exit 1
fi

curl -sS -X POST "$URL" \
  -H "content-type: application/json" \
  -H "x-webhook-token: $TOKEN" \
  -d '{
    "event_type": "missed_call.created",
    "idempotency_key": "demo-missedcall-'"$(date +%s)"'",
    "data": {
      "name": "Alex Moreno",
      "phone": "+15550100011",
      "message": "Missed call from an unknown local number. No voicemail.",
      "channel": "phone",
      "urgency": "medium"
    }
  }'
echo
echo "Submitted. Open the client → Approvals to see the AI-drafted callback text waiting for a human."
