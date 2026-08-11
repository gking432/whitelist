import { Codex } from "@openai/codex-sdk";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CodexConnectorRun = {
  threadId: string;
  finalResponse: string;
  worktreePath: string;
};

export function codexConnectorWorkerReady(): boolean {
  return Boolean(
    process.env.ENABLE_CODEX_CONNECTOR_WORKER === "true" &&
      process.env.CODEX_CONNECTOR_WORKSPACE_PATH &&
      process.env.CODEX_CONNECTOR_WORKTREE_ROOT,
  );
}

export function validConnectorBranchName(branchName: string) {
  return /^codex\/connector-[a-z0-9-]{1,80}$/.test(branchName);
}

async function prepareWorktree(workspace: string, branchName: string) {
  if (!validConnectorBranchName(branchName)) {
    throw new Error("The assigned connector branch is invalid.");
  }

  const configuredRoot = process.env.CODEX_CONNECTOR_WORKTREE_ROOT;
  if (!configuredRoot || !isAbsolute(configuredRoot)) {
    throw new Error("CODEX_CONNECTOR_WORKTREE_ROOT must be an absolute path.");
  }

  const [{ stdout: repoOutput }] = await Promise.all([
    execFileAsync("git", ["-C", workspace, "rev-parse", "--show-toplevel"]),
    mkdir(configuredRoot, { recursive: true }),
  ]);
  const repository = await realpath(repoOutput.trim());
  const worktreeRoot = await realpath(resolve(configuredRoot));
  const rootRelativeToRepository = relative(repository, worktreeRoot);

  if (
    worktreeRoot === repository ||
    (!rootRelativeToRepository.startsWith("..") &&
      !isAbsolute(rootRelativeToRepository))
  ) {
    throw new Error("The Codex worktree root must be outside the source repository.");
  }

  const directory = `${branchName.replaceAll("/", "-")}-${randomUUID().slice(0, 8)}`;
  const worktreePath = resolve(worktreeRoot, directory);
  const branchExists = await execFileAsync(
    "git",
    ["-C", repository, "show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
  ).then(() => true, () => false);
  const args = branchExists
    ? ["-C", repository, "worktree", "add", worktreePath, branchName]
    : ["-C", repository, "worktree", "add", "-b", branchName, worktreePath, "HEAD"];

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
