import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const outputDirectory = path.join(process.cwd(), "desktop", "build");
const outputPath = path.join(outputDirectory, "icon.png");
const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <rect width="1024" height="1024" rx="220" fill="#d4ad32"/>
    <circle cx="512" cy="512" r="294" fill="none" stroke="#102c21" stroke-width="66"/>
    <path d="M636 388 570 570 388 636l66-182 182-66Z" fill="#102c21"/>
    <circle cx="512" cy="512" r="39" fill="#d4ad32"/>
  </svg>
`;

await fs.mkdir(outputDirectory, { recursive: true });
await sharp(Buffer.from(svg)).png().toFile(outputPath);
console.log(outputPath);
