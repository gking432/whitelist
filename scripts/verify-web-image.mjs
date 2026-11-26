import { spawnSync } from "node:child_process";

const image = "northstar-app-verify";
const container = `northstar-app-smoke-${process.pid}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    const detail = options.capture
      ? `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
      : "";
    throw new Error(
      `${command} ${args.join(" ")} failed${detail ? `:\n${detail}` : "."}`,
    );
  }
  return result.stdout?.trim() ?? "";
}

function cleanup() {
  spawnSync("docker", ["rm", "--force", container], { stdio: "ignore" });
  spawnSync("docker", ["image", "rm", "--force", image], {
    stdio: "ignore",
  });
}

try {
  run("docker", [
    "build",
    "--build-arg",
    "NEXT_PUBLIC_SUPABASE_URL=https://release-check.supabase.co",
    "--build-arg",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY=release-verification-public-key",
    "--tag",
    image,
    ".",
  ]);
  run("docker", [
    "run",
    "--detach",
    "--name",
    container,
    "--publish",
    "127.0.0.1::3000",
    image,
  ]);

  const binding = run("docker", ["port", container, "3000/tcp"], {
    capture: true,
  });
  const port = binding.match(/:(\d+)$/)?.[1];
  if (!port)
    throw new Error(`Could not parse the container port from ${binding}.`);

  const url = `http://127.0.0.1:${port}`;
  let response;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) break;
    } catch {
      // The standalone server can take a moment to bind on slower builders.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (!response?.ok) {
    const logs = run("docker", ["logs", container], { capture: true });
    throw new Error(`Web image did not become ready.\n${logs}`);
  }
  const html = await response.text();
  if (!html.includes("AI operations layer")) {
    throw new Error("Web image served an unexpected root document.");
  }

  console.log(`Web image verified: clean build and standalone boot at ${url}.`);
} finally {
  cleanup();
}
