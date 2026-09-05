import fs from "node:fs/promises";
import path from "node:path";

import runtimeConfig from "./runtime-config.cjs";

const { normalizeAppUrl } = runtimeConfig;
const input = process.env.DESKTOP_APP_URL ?? "";
const appUrl = normalizeAppUrl(input);
const required = process.env.REQUIRE_DESKTOP_APP_URL === "true";

if (!appUrl && required) {
  throw new Error("DESKTOP_APP_URL must be a public HTTPS origin for a production desktop release.");
}
if (input && !appUrl) {
  throw new Error("DESKTOP_APP_URL is not a valid public HTTPS origin.");
}

const outputPath = path.join(process.cwd(), "desktop", "build", "runtime-default.json");
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(
  outputPath,
  `${JSON.stringify({ appUrl: appUrl ?? null }, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 },
);
console.log(outputPath);
