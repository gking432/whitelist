import type { AutomationPlatformKey } from "../catalog.ts";

export type ExternalWorkflowDeployment = {
  platform: Exclude<AutomationPlatformKey, "northstar" | "make">;
  externalId: string;
  enabled: boolean;
  editorUrl?: string | null;
  raw: unknown;
};

export class AutomationProviderError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "AutomationProviderError";
    this.status = status;
  }
}
