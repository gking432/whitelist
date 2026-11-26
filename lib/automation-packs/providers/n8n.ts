import {
  AutomationProviderError,
  type ExternalWorkflowDeployment,
} from "./types.ts";

type N8nWorkflow = {
  name: string;
  nodes: unknown[];
  connections: Record<string, unknown>;
  settings?: Record<string, unknown>;
};

function n8nApiUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, "")}/api/v1${path}`;
}

export async function deployN8nWorkflow(input: {
  baseUrl: string;
  apiKey: string;
  workflow: N8nWorkflow;
  fetcher?: typeof fetch;
}): Promise<ExternalWorkflowDeployment> {
  const fetcher = input.fetcher ?? fetch;
  const createResponse = await fetcher(
    n8nApiUrl(input.baseUrl, "/workflows"),
    {
      method: "POST",
      headers: {
        "X-N8N-API-KEY": input.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(input.workflow),
    },
  );
  const created = (await createResponse.json().catch(() => ({}))) as {
    id?: string;
    message?: string;
  };

  if (!createResponse.ok || !created.id) {
    throw new AutomationProviderError(
      created.message ??
        `n8n workflow creation failed (${createResponse.status}).`,
      createResponse.status,
    );
  }

  const activateResponse = await fetcher(
    n8nApiUrl(input.baseUrl, `/workflows/${created.id}/activate`),
    {
      method: "POST",
      headers: {
        "X-N8N-API-KEY": input.apiKey,
        "content-type": "application/json",
      },
    },
  );
  const activated = (await activateResponse.json().catch(() => ({}))) as {
    id?: string;
    active?: boolean;
    message?: string;
  };

  if (!activateResponse.ok) {
    throw new AutomationProviderError(
      activated.message ??
        `n8n workflow activation failed (${activateResponse.status}).`,
      activateResponse.status,
    );
  }

  return {
    platform: "n8n",
    externalId: created.id,
    enabled: activated.active ?? true,
    editorUrl: `${input.baseUrl.replace(/\/$/, "")}/workflow/${created.id}`,
    raw: { created, activated },
  };
}
