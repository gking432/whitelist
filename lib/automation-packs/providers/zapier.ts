import {
  AutomationProviderError,
  type ExternalWorkflowDeployment,
} from "./types.ts";

export type ZapierWorkflowStep = {
  action: string;
  authentication?: string;
  alias?: string;
  inputs?: Record<string, unknown>;
};

export function buildZapierWorkflowRequest(input: {
  title: string;
  steps: ZapierWorkflowStep[];
  enabled?: boolean;
}) {
  if (input.steps.length < 2) {
    throw new Error("A Zapier workflow requires a trigger and an action.");
  }

  return {
    data: {
      enabled: input.enabled ?? true,
      title: input.title,
      steps: input.steps.map((step) => ({
        action: step.action,
        ...(step.authentication
          ? { authentication: step.authentication }
          : {}),
        ...(step.alias ? { alias: step.alias } : {}),
        inputs: step.inputs ?? {},
      })),
    },
  };
}

export async function deployZapierWorkflow(input: {
  accessToken: string;
  title: string;
  steps: ZapierWorkflowStep[];
  apiBaseUrl?: string;
  fetcher?: typeof fetch;
}): Promise<ExternalWorkflowDeployment> {
  const fetcher = input.fetcher ?? fetch;
  const baseUrl = (input.apiBaseUrl ?? "https://api.zapier.com").replace(
    /\/$/,
    "",
  );
  const response = await fetcher(`${baseUrl}/v2/zaps`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(
      buildZapierWorkflowRequest({
        title: input.title,
        steps: input.steps,
        enabled: true,
      }),
    ),
  });
  const body = (await response.json().catch(() => ({}))) as {
    data?: { id?: string; enabled?: boolean; links?: { html_editor?: string } };
    errors?: Array<{ detail?: string }>;
  };

  if (!response.ok || !body.data?.id) {
    throw new AutomationProviderError(
      body.errors?.[0]?.detail ??
        `Zapier workflow creation failed (${response.status}).`,
      response.status,
    );
  }

  return {
    platform: "zapier",
    externalId: body.data.id,
    enabled: body.data.enabled ?? true,
    editorUrl: body.data.links?.html_editor ?? null,
    raw: body,
  };
}
