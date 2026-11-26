import { execFile } from "node:child_process";
import { access, mkdir, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ConnectorWorkerPaths = {
  workspace: string;
  worktreeRoot: string;
};

type ConnectorWorkerEnv = Partial<
  Record<
    | "ENABLE_CODEX_CONNECTOR_WORKER"
    | "CODEX_CONNECTOR_WORKSPACE_PATH"
    | "CODEX_CONNECTOR_WORKTREE_ROOT",
    string | undefined
  >
>;

export function configuredConnectorWorkerPaths(
  env: ConnectorWorkerEnv = process.env as unknown as ConnectorWorkerEnv,
): ConnectorWorkerPaths | null {
  if (env.ENABLE_CODEX_CONNECTOR_WORKER !== "true") return null;
  const workspace = env.CODEX_CONNECTOR_WORKSPACE_PATH;
  const worktreeRoot = env.CODEX_CONNECTOR_WORKTREE_ROOT;
  if (
    !workspace ||
    !worktreeRoot ||
    !isAbsolute(workspace) ||
    !isAbsolute(worktreeRoot)
  ) {
    return null;
  }
  return { workspace, worktreeRoot };
}

export async function verifyConnectorWorkerWorkspace(
  paths: ConnectorWorkerPaths,
) {
  await mkdir(paths.worktreeRoot, { recursive: true });
  const [{ stdout }, worktreeRoot] = await Promise.all([
    execFileAsync("git", [
      "-c",
      `safe.directory=${paths.workspace}`,
      "-C",
      paths.workspace,
      "rev-parse",
      "--show-toplevel",
    ]),
    realpath(resolve(paths.worktreeRoot)),
    access(paths.workspace, constants.R_OK | constants.W_OK),
    access(paths.worktreeRoot, constants.R_OK | constants.W_OK),
  ]);
  const repository = await realpath(stdout.trim());
  const rootRelativeToRepository = relative(repository, worktreeRoot);
  if (
    worktreeRoot === repository ||
    (!rootRelativeToRepository.startsWith("..") &&
      !isAbsolute(rootRelativeToRepository))
  ) {
    throw new Error(
      "CODEX_CONNECTOR_WORKTREE_ROOT must be outside the source repository.",
    );
  }
  return { repository, worktreeRoot };
}
