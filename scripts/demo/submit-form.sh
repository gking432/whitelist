#!/usr/bin/env bash
# Simulates a website contact form submission hitting a client's intake
# webhook — a real "customer just filled out your form" event (docs/22).
#
# First connect a web-form / generic inbound source in the app (Setup → lead
# source wizard). The connection page shows the webhook URL and a token.
#
# Usage:
#   scripts/demo/submit-form.sh <intake_webhook_url> <token>
#   INTAKE_URL=... INTAKE_TOKEN=... scripts/demo/submit-form.sh
set -euo pipefail

URL="${1:-${INTAKE_URL:-}}"
TOKEN="${2:-${INTAKE_TOKEN:-}}"

if [ -z "$URL" ] || [ -z "$TOKEN" ]; then
  echo "usage: $0 <intake_webhook_url> <token>" >&2
  echo "  (or set INTAKE_URL and INTAKE_TOKEN)" >&2
  exit 1
fi

curl -sS -X POST "$URL" \
  -H "content-type: application/json" \
  -H "x-webhook-token: $TOKEN" \
  -d '{
    "event_type": "form.submitted",
    "idempotency_key": "demo-form-'"$(date +%s)"'",
    "data": {
      "name": "Dana Whitfield",
      "phone": "+15550100010",
      "email": "dana@example.com",
      "address": "77 Cedar Avenue",
      "message": "Hi, my kitchen sink is badly clogged and water is starting to back up. Can someone come out tomorrow?",
      "service_need": "Clogged kitchen drain",
      "urgency": "high",
      "appointment_preference": "Tomorrow morning"
    }
  }'
echo
echo "Submitted. Open the client in the app → Runs to watch it, then Approvals for the drafted reply and CRM for the new contact."
