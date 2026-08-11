import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const rootPackage = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const desktopPackage = JSON.parse(readFileSync(resolve("desktop/package.json"), "utf8"));
const productName = rootPackage.build?.productName;
const version = rootPackage.version;
const releaseDirectory = resolve("release");

function fail(message) {
  throw new Error(`Desktop bundle verification failed: ${message}`);
}

function requireFile(path, label) {
  if (!existsSync(path)) fail(`${label} is missing at ${path}`);
}

if (!productName) fail("build.productName is not configured");
if (version !== desktopPackage.version) {
  fail(`root version ${version} differs from desktop version ${desktopPackage.version}`);
}

const releaseFiles = readdirSync(releaseDirectory);
if (releaseFiles.some((name) => name.toLowerCase().includes("northstar"))) {
  fail("release output contains stale platform-branded artifacts");
}

if (process.platform !== "darwin") {
  console.log("Desktop bundle inventory verification currently runs on macOS; version check passed.");
  process.exit(0);
}

const macOutput = releaseFiles.find(
  (name) => name.startsWith("mac-") && existsSync(join(releaseDirectory, name, `${productName}.app`)),
);
if (!macOutput) fail("packaged macOS application is missing");
const appPath = join(releaseDirectory, macOutput, `${productName}.app`);
const resourcesPath = join(appPath, "Contents", "Resources");
const asarPath = join(resourcesPath, "app.asar");
const updaterPath = join(resourcesPath, "app-update.yml");
const latestPath = join(releaseDirectory, "latest-mac.yml");
const plistPath = join(appPath, "Contents", "Info.plist");

for (const [path, label] of [
  [asarPath, "application archive"],
  [updaterPath, "packaged updater configuration"],
  [latestPath, "macOS update manifest"],
  [plistPath, "macOS application metadata"],
]) {
  requireFile(path, label);
}

const plistValue = (key) =>
  execFileSync("plutil", ["-extract", key, "raw", "-o", "-", plistPath], {
    encoding: "utf8",
  }).trim();

if (plistValue("CFBundleDisplayName") !== productName) fail("display name is incorrect");
if (plistValue("CFBundleIdentifier") !== rootPackage.build.appId) fail("bundle identifier is incorrect");
if (plistValue("CFBundleShortVersionString") !== version) fail("bundle version is incorrect");

const asarCli = resolve("node_modules/@electron/asar/bin/asar.js");
const bundledFiles = execFileSync(process.execPath, [asarCli, "list", asarPath], {
  encoding: "utf8",
});
for (const required of [
  "/main.cjs",
  "/preload.cjs",
  "/runtime-config.cjs",
  "/setup.html",
  "/node_modules/electron-updater/package.json",
]) {
  if (!bundledFiles.split("\n").includes(required)) fail(`${required} is not packaged`);
}

const updater = readFileSync(updaterPath, "utf8");
for (const expected of [
  `owner: ${rootPackage.build.publish[0].owner}`,
  `repo: ${rootPackage.build.publish[0].repo}`,
  "provider: github",
]) {
  if (!updater.includes(expected)) fail(`updater config lacks ${expected}`);
}

const latest = readFileSync(latestPath, "utf8");
if (!latest.includes(`version: ${version}`)) fail("update manifest version is incorrect");
for (const extension of ["zip", "dmg"]) {
  const artifact = releaseFiles.find(
    (name) => name.startsWith(`${productName}-${version}-mac-`) && name.endsWith(`.${extension}`),
  );
  if (!artifact) fail(`${extension.toUpperCase()} release artifact is missing`);
  if (!latest.includes(artifact.replaceAll(" ", "-"))) {
    fail(`update manifest does not reference ${artifact}`);
  }
  requireFile(join(releaseDirectory, `${artifact}.blockmap`), `${extension} blockmap`);
}

const signatureResult = spawnSync("codesign", ["-dv", "--verbose=2", appPath], {
  encoding: "utf8",
});
const signature = `${signatureResult.stdout ?? ""}${signatureResult.stderr ?? ""}`;
const isSigned = !signature.includes("Signature=adhoc") && !signature.includes("TeamIdentifier=not set");
if (process.env.REQUIRE_SIGNED_DESKTOP === "true" && !isSigned) {
  fail("release verification requires a Developer ID signature");
}

console.log(
  `Desktop bundle verified: ${productName} ${version}, updater metadata, ZIP/DMG blockmaps, required runtime files, ${isSigned ? "signed" : "unsigned local"} build.`,
);
