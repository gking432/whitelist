import { Codex } from "@openai/codex-sdk";

export type CodexConnectorRun = {
  threadId: string;
  finalResponse: string;
};

export function codexConnectorWorkerReady(): boolean {
  return Boolean(
    process.env.ENABLE_CODEX_CONNECTOR_WORKER === "true" &&
      process.env.CODEX_CONNECTOR_WORKSPACE_PATH,
  );
}

export async function runCodexConnectorTask(prompt: string): Promise<CodexConnectorRun> {
  const workspace = process.env.CODEX_CONNECTOR_WORKSPACE_PATH;
  if (!codexConnectorWorkerReady() || !workspace) {
    throw new Error("The Codex connector worker is not configured.");
  }

  const codex = new Codex();
  const thread = codex.startThread({
    workingDirectory: workspace,
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    networkAccessEnabled: true,
    webSearchMode: "live",
  });
  const result = await thread.run(prompt);
  if (!thread.id) throw new Error("Codex completed without returning a thread id.");
  return { threadId: thread.id, finalResponse: result.finalResponse };
}
