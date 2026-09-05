#!/usr/bin/env bash
# Simulates an inbound TEXT MESSAGE from a customer hitting a client's intake
# webhook (docs/22). This exercises the universal AI intake router: the AI
# classifies the message (sales / service / scheduling / urgent) and records
# it. Note: a drafted reply comes from the lead / missed-call workflows —
# see submit-form.sh and missed-call.sh for the "AI writes a reply" path.
#
# Usage:
#   scripts/demo/send-text.sh <intake_webhook_url> <token> ["message text"]
set -euo pipefail

URL="${1:-${INTAKE_URL:-}}"
TOKEN="${2:-${INTAKE_TOKEN:-}}"
BODY="${3:-Hey, do you all do water heater replacements? Mine is 12 years old and leaking a little.}"

if [ -z "$URL" ] || [ -z "$TOKEN" ]; then
  echo "usage: $0 <intake_webhook_url> <token> [\"message text\"]" >&2
  exit 1
fi

curl -sS -X POST "$URL" \
  -H "content-type: application/json" \
  -H "x-webhook-token: $TOKEN" \
  -d '{
    "event_type": "sms.received",
    "idempotency_key": "demo-text-'"$(date +%s)"'",
    "data": {
      "name": "Jamie Fox",
      "phone": "+15550100012",
      "message": "'"${BODY//\"/\\\"}"'",
      "channel": "sms"
    }
  }'
echo
echo "Submitted. Open the client → Runs to see how the AI classified the message, and the Assistant console for the live event."
