import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  configuredConnectorWorkerPaths,
  verifyConnectorWorkerWorkspace,
} from "./connector-worker-config.ts";

const execFileAsync = promisify(execFile);

export type CodexConnectorRun = {
  threadId: string;
  finalResponse: string;
  worktreePath: string;
};

export function codexConnectorWorkerReady(): boolean {
  return configuredConnectorWorkerPaths() !== null;
}

export function validConnectorBranchName(branchName: string) {
  return /^codex\/connector-[a-z0-9-]{1,80}$/.test(branchName);
}

async function prepareWorktree(workspace: string, branchName: string) {
  if (!validConnectorBranchName(branchName)) {
    throw new Error("The assigned connector branch is invalid.");
  }

  const configured = configuredConnectorWorkerPaths();
  if (!configured || configured.workspace !== workspace) {
    throw new Error("The Codex connector worker is not configured.");
  }
  const { repository, worktreeRoot } =
    await verifyConnectorWorkerWorkspace(configured);

  const directory = `${branchName.replaceAll("/", "-")}-${randomUUID().slice(0, 8)}`;
  const worktreePath = resolve(worktreeRoot, directory);
  const branchExists = await execFileAsync(
    "git",
    ["-c", `safe.directory=${repository}`, "-C", repository, "show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
  ).then(() => true, () => false);
  const args = branchExists
    ? ["-c", `safe.directory=${repository}`, "-C", repository, "worktree", "add", worktreePath, branchName]
    : ["-c", `safe.directory=${repository}`, "-C", repository, "worktree", "add", "-b", branchName, worktreePath, "HEAD"];

  await execFileAsync("git", args);
  return worktreePath;
}

export async function runCodexConnectorTask(
  prompt: string,
  branchName: string,
): Promise<CodexConnectorRun> {
  const workspace = process.env.CODEX_CONNECTOR_WORKSPACE_PATH;
  if (!codexConnectorWorkerReady() || !workspace) {
    throw new Error("The Codex connector worker is not configured.");
  }

  const worktreePath = await prepareWorktree(workspace, branchName);
  const { Codex } = await import("@openai/codex-sdk");
  const codex = new Codex();
  const thread = codex.startThread({
    workingDirectory: worktreePath,
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    networkAccessEnabled: true,
    webSearchMode: "live",
  });
  const result = await thread.run(prompt);
  if (!thread.id) throw new Error("Codex completed without returning a thread id.");
  return {
    threadId: thread.id,
    finalResponse: result.finalResponse,
    worktreePath,
  };
}
