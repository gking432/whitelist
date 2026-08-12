import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { extractFile } from "@electron/asar";

const rootPackage = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const desktopPackage = JSON.parse(
  readFileSync(resolve("desktop/package.json"), "utf8"),
);
const productName = rootPackage.build?.productName;
const version = rootPackage.version;
const releaseDirectory = resolve("release");
const requireSignature = process.env.REQUIRE_SIGNED_DESKTOP === "true";
const expectedAppUrl = process.env.DESKTOP_APP_URL?.trim() ?? "";

function fail(message) {
  throw new Error(`Desktop bundle verification failed: ${message}`);
}

function requireFile(path, label) {
  if (!existsSync(path)) fail(`${label} is missing at ${path}`);
}

function updaterConfigurationIsValid(path) {
  const updater = readFileSync(path, "utf8");
  for (const expected of [
    `owner: ${rootPackage.build.publish[0].owner}`,
    `repo: ${rootPackage.build.publish[0].repo}`,
    "provider: github",
  ]) {
    if (!updater.includes(expected)) fail(`updater config lacks ${expected}`);
  }
}

function verifyApplicationArchive(asarPath) {
  requireFile(asarPath, "application archive");
  const asarCli = resolve("node_modules/@electron/asar/bin/asar.js");
  const bundledFiles = execFileSync(
    process.execPath,
    [asarCli, "list", asarPath],
    {
      encoding: "utf8",
    },
  )
    .split("\n")
    .map((path) => path.trim().replaceAll("\\", "/"));

  for (const required of [
    "/main.cjs",
    "/preload.cjs",
    "/runtime-config.cjs",
    "/build/runtime-default.json",
    "/setup.html",
    "/node_modules/electron-updater/package.json",
  ]) {
    if (!bundledFiles.includes(required)) fail(`${required} is not packaged`);
  }

  const bundledConfig = JSON.parse(
    extractFile(asarPath, "build/runtime-default.json").toString("utf8"),
  );
  if (expectedAppUrl && bundledConfig.appUrl !== new URL(expectedAppUrl).origin) {
    fail("bundled workspace origin does not match DESKTOP_APP_URL");
  }
  if (requireSignature && !bundledConfig.appUrl) {
    fail("signed release does not contain a default workspace origin");
  }
}

function releaseArtifact(extension, platform) {
  const artifact = releaseFiles.find(
    (name) =>
      name.startsWith(`${productName}-${version}-${platform}-`) &&
      name.endsWith(`.${extension}`),
  );
  if (!artifact) fail(`${extension.toUpperCase()} release artifact is missing`);
  return artifact;
}

function manifestReferencesArtifact(manifest, artifact) {
  const normalized = artifact.replaceAll(" ", "-");
  if (!manifest.includes(artifact) && !manifest.includes(normalized)) {
    fail(`update manifest does not reference ${artifact}`);
  }
}

if (!productName) fail("build.productName is not configured");
if (version !== desktopPackage.version) {
  fail(
    `root version ${version} differs from desktop version ${desktopPackage.version}`,
  );
}
if (!existsSync(releaseDirectory)) fail("release directory is missing");

const releaseFiles = readdirSync(releaseDirectory);
if (releaseFiles.some((name) => name.toLowerCase().includes("northstar"))) {
  fail("release output contains stale platform-branded artifacts");
}

if (process.platform === "darwin") {
  const macOutput = releaseFiles.find(
    (name) =>
      name.startsWith("mac-") &&
      existsSync(join(releaseDirectory, name, `${productName}.app`)),
  );
  if (!macOutput) fail("packaged macOS application is missing");
  const appPath = join(releaseDirectory, macOutput, `${productName}.app`);
  const resourcesPath = join(appPath, "Contents", "Resources");
  const updaterPath = join(resourcesPath, "app-update.yml");
  const latestPath = join(releaseDirectory, "latest-mac.yml");
  const plistPath = join(appPath, "Contents", "Info.plist");

  for (const [path, label] of [
    [updaterPath, "packaged updater configuration"],
    [latestPath, "macOS update manifest"],
    [plistPath, "macOS application metadata"],
  ]) {
    requireFile(path, label);
  }
  verifyApplicationArchive(join(resourcesPath, "app.asar"));
  updaterConfigurationIsValid(updaterPath);

  const plistValue = (key) =>
    execFileSync("plutil", ["-extract", key, "raw", "-o", "-", plistPath], {
      encoding: "utf8",
    }).trim();
  if (plistValue("CFBundleDisplayName") !== productName) {
    fail("display name is incorrect");
  }
  if (plistValue("CFBundleIdentifier") !== rootPackage.build.appId) {
    fail("bundle identifier is incorrect");
  }
  if (plistValue("CFBundleShortVersionString") !== version) {
    fail("bundle version is incorrect");
  }

  const latest = readFileSync(latestPath, "utf8");
  if (!latest.includes(`version: ${version}`)) {
    fail("update manifest version is incorrect");
  }
  for (const extension of ["zip", "dmg"]) {
    const artifact = releaseArtifact(extension, "mac");
    manifestReferencesArtifact(latest, artifact);
    requireFile(
      join(releaseDirectory, `${artifact}.blockmap`),
      `${extension} blockmap`,
    );
  }

  const signatureResult = spawnSync(
    "codesign",
    ["-dv", "--verbose=2", appPath],
    { encoding: "utf8" },
  );
  const signature = `${signatureResult.stdout ?? ""}${signatureResult.stderr ?? ""}`;
  const isSigned =
    signatureResult.status === 0 &&
    !signature.includes("Signature=adhoc") &&
    !signature.includes("TeamIdentifier=not set");
  if (requireSignature && !isSigned) {
    fail("release verification requires a Developer ID signature");
  }

  console.log(
    `Desktop bundle verified: ${productName} ${version}, macOS updater metadata, ZIP/DMG blockmaps, required runtime files, ${isSigned ? "signed" : "unsigned local"} build.`,
  );
} else if (process.platform === "win32") {
  const unpackedDirectory = join(releaseDirectory, "win-unpacked");
  const executablePath = join(unpackedDirectory, `${productName}.exe`);
  const resourcesPath = join(unpackedDirectory, "resources");
  const updaterPath = join(resourcesPath, "app-update.yml");
  const latestPath = join(releaseDirectory, "latest.yml");

  for (const [path, label] of [
    [executablePath, "Windows application executable"],
    [updaterPath, "packaged updater configuration"],
    [latestPath, "Windows update manifest"],
  ]) {
    requireFile(path, label);
  }
  verifyApplicationArchive(join(resourcesPath, "app.asar"));
  updaterConfigurationIsValid(updaterPath);

  const latest = readFileSync(latestPath, "utf8");
  if (!latest.includes(`version: ${version}`)) {
    fail("update manifest version is incorrect");
  }
  const installer = releaseArtifact("exe", "win");
  manifestReferencesArtifact(latest, installer);
  requireFile(
    join(releaseDirectory, `${installer}.blockmap`),
    "Windows blockmap",
  );

  const escapedInstaller = join(releaseDirectory, installer).replaceAll(
    "'",
    "''",
  );
  const signatureResult = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-AuthenticodeSignature -LiteralPath '${escapedInstaller}').Status`,
    ],
    { encoding: "utf8" },
  );
  const signatureStatus = signatureResult.stdout?.trim() ?? "Unknown";
  const isSigned = signatureStatus === "Valid";
  if (requireSignature && !isSigned) {
    fail(
      `release verification requires a valid Authenticode signature (${signatureStatus})`,
    );
  }

  console.log(
    `Desktop bundle verified: ${productName} ${version}, Windows updater metadata, NSIS blockmap, required runtime files, ${isSigned ? "signed" : "unsigned CI"} build.`,
  );
} else {
  fail(`unsupported verification platform ${process.platform}`);
}
