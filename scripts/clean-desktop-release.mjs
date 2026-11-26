import { rmSync } from "node:fs";
import { resolve } from "node:path";

const releaseDirectory = resolve("release");
rmSync(releaseDirectory, { recursive: true, force: true });
console.log(`Cleaned ${releaseDirectory}`);
