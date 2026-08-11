import {
  northstarEventEnvelope,
  type AutomationPack,
} from "./catalog.ts";

export type AutomationExportFormat = "n8n" | "make" | "zapier";

export function n8nWorkflow(pack: AutomationPack) {
  return {
    name: `Northstar - ${pack.name}`,
    nodes: [
      {
        parameters: {
          httpMethod: "POST",
          path: `northstar-${pack.key}`,
          responseMode: "lastNode",
          options: {},
        },
        id: "SourceWebhook",
        name: "Source Event",
        type: "n8n-nodes-base.webhook",
        typeVersion: 2,
        position: [240, 300],
      },
      {
        parameters: {
          method: "POST",
          url: "={{ $env.NORTHSTAR_WEBHOOK_URL }}",
          sendHeaders: true,
          headerParameters: {
            parameters: [
              {
                name: "x-webhook-token",
                value: "={{ $env.NORTHSTAR_WEBHOOK_TOKEN }}",
              },
            ],
          },
          sendBody: true,
          contentType: "json",
          specifyBody: "json",
          jsonBody:
            `={{ { "event_type": "${pack.eventType}", "event_version": "1.0", ` +
            `"idempotency_key": (($json.body && $json.body.id) || $json.id || $execution.id) + "-${pack.key}", ` +
            `"occurred_at": $now.toISO(), "source": "n8n", "data": ($json.body || $json) } }}`,
          options: {},
        },
        id: "SendToNorthstar",
        name: "Send to Northstar",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [540, 300],
      },
      {
        parameters: {
          respondWith: "json",
          responseBody:
            '={{ { "ok": true, "northstar": $json, "message": "Event accepted by Northstar" } }}',
          options: {},
        },
        id: "Respond",
        name: "Return Northstar Result",
        type: "n8n-nodes-base.respondToWebhook",
        typeVersion: 1.4,
        position: [840, 300],
      },
    ],
    connections: {
      "Source Event": {
        main: [[{ node: "Send to Northstar", type: "main", index: 0 }]],
      },
      "Send to Northstar": {
        main: [[{ node: "Return Northstar Result", type: "main", index: 0 }]],
      },
    },
    settings: { executionOrder: "v1" },
    pinData: {},
    meta: {
      description: pack.description,
      northstar_event_type: pack.eventType,
      setup:
        "Set NORTHSTAR_WEBHOOK_URL and NORTHSTAR_WEBHOOK_TOKEN in n8n, then map the Source Event fields in Send to Northstar.",
    },
  };
}

export function makeBlueprint(pack: AutomationPack) {
  return {
    name: `Northstar - ${pack.name}`,
    flow: [
      {
        id: 1,
        module: "gateway:CustomWebHook",
        version: 1,
        parameters: { hook: 0 },
        mapper: {},
        metadata: {
          designer: { x: 0, y: 0 },
          restore: {
            parameters: {
              hook: { label: `Source - ${pack.name}`, data: { editable: "true" } },
            },
          },
        },
      },
      {
        id: 2,
        module: "http:ActionSendData",
        version: 3,
        parameters: { handleErrors: true, useNewZLibDeCompress: true },
        mapper: {
          url: "PASTE_NORTHSTAR_WEBHOOK_URL",
          method: "post",
          headers: [
            {
              name: "x-webhook-token",
              value: "PASTE_NORTHSTAR_WEBHOOK_TOKEN",
            },
            { name: "content-type", value: "application/json" },
          ],
          bodyType: "raw",
          contentType: "application/json",
          data: JSON.stringify(northstarEventEnvelope(pack), null, 2),
        },
        metadata: { designer: { x: 320, y: 0 } },
      },
    ],
    metadata: {
      instant: true,
      version: 1,
      scenario: {
        roundtrips: 1,
        maxErrors: 3,
        autoCommit: true,
        autoCommitTriggerLast: true,
        sequential: false,
        confidential: false,
        dataloss: false,
        dlq: false,
      },
      northstar: {
        event_type: pack.eventType,
        required_fields: pack.requiredFields,
        setup:
          "Import the blueprint, create the Source webhook, paste the client-specific Northstar URL/token, and map source fields into the JSON body.",
      },
    },
  };
}

export function zapierRecipe(pack: AutomationPack) {
  return {
    name: `Northstar - ${pack.name}`,
    platform: "Zapier",
    version: "1.0",
    trigger: {
      app: "Choose the client's source app",
      event: `Event that corresponds to ${pack.eventType}`,
      test_record: "Use a real or test customer record.",
    },
    action: {
      app: "Webhooks by Zapier",
      event: "POST",
      url: "PASTE_NORTHSTAR_WEBHOOK_URL",
      payload_type: "json",
      headers: {
        "x-webhook-token": "PASTE_NORTHSTAR_WEBHOOK_TOKEN",
        "content-type": "application/json",
      },
      data: northstarEventEnvelope(pack),
    },
    test: {
      expected_http_status: 202,
      verify_in_northstar:
        "Open Health & Logs and confirm the event plus every matched workflow run.",
      expected_outcome: pack.outcome,
    },
    fields: {
      required: pack.requiredFields,
      optional: pack.optionalFields,
    },
  };
}

export function exportAutomationPack(
  pack: AutomationPack,
  format: AutomationExportFormat,
) {
  if (format === "n8n") return n8nWorkflow(pack);
  if (format === "make") return makeBlueprint(pack);
  return zapierRecipe(pack);
}
