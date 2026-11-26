import { mkdir, writeFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

const origin = new URL(
  process.env.DESIGN_PREVIEW_ORIGIN || "http://localhost:3210",
);
if (!["127.0.0.1", "localhost"].includes(origin.hostname))
  throw Error("Export the public design routes from a local app only.");
const output = path.resolve("out/design-preview");
await mkdir(output, { recursive: true });
// This directory is generated only by this exporter; do not accumulate old pages/assets.
for (const entry of await readdir(output))
  await rm(path.join(output, entry), { recursive: true, force: true });
const assetQueue = new Map();
const saved = new Set();
const attr = (tag, name) =>
  tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"))?.[1];
function queueAsset(value, base = origin) {
  const url = new URL(value.replaceAll("&amp;", "&"), base);
  if (
    url.origin !== origin.origin ||
    !/^\/(?:_next\/static\/|favicon\.ico$)/.test(url.pathname)
  )
    throw Error("Unexpected public asset URL");
  assetQueue.set(url.pathname, url);
}
for (const area of ["", "messages", "todo", "manager", "apps"]) {
  const route = `/preview${area ? `/${area}` : ""}`;
  const response = await fetch(new URL(route, origin), {
    headers: { "User-Agent": "Googlebot" },
    redirect: "manual",
    signal: AbortSignal.timeout(60000),
  });
  if (response.status !== 200 || response.headers.getSetCookie().length)
    throw Error(`Preview export failed for ${route}: HTTP ${response.status}`);
  let html = await response.text();
  if (!html.includes("data-preview-area=") || !html.includes("Design preview"))
    throw Error("Expected the read-only preview page");
  if (/<div[^>]*hidden[^>]*id=["']S:/.test(html))
    throw Error(
      "Preview HTML is still streamed; do not publish incomplete markup",
    );
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const href = attr(tag, "href");
    if (attr(tag, "as") === "script" || (href && /\.js(?:\?|$)/.test(href)))
      return "";
    if (href && ["stylesheet", "preload", "icon"].includes(attr(tag, "rel")))
      queueAsset(href);
    return tag;
  });
  for (const tag of html.match(/<a\b[^>]*>/gi) || []) {
    const href = attr(tag, "href");
    if (href && !href.startsWith("/preview") && !href.startsWith("#"))
      throw Error(`Unexpected preview navigation: ${href}`);
  }
  if (
    /\/api\/|supabase\.co|service_role|@northstar\.test|NEXT_PUBLIC_|\bauthorization\b/i.test(
      html,
    )
  )
    throw Error("Unexpected application data or API configuration in preview");
  html = html.replace(
    "</body>",
    '<script src="/preview-clock.js" defer></script></body>',
  );
  const destination = path.join(output, "preview", area, "index.html");
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, html);
}
while (assetQueue.size) {
  if (saved.size > 100) throw Error("Unexpected number of design assets");
  const [assetPath, url] = assetQueue.entries().next().value;
  assetQueue.delete(assetPath);
  if (saved.has(assetPath)) continue;
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error(`Asset export failed: ${assetPath}`);
  let bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 2_000_000) throw Error("Unexpected asset size");
  if (assetPath.endsWith(".css")) {
    let css = bytes
      .toString("utf8")
      .replace(/\/\*[#@]\s*sourceMappingURL=[\s\S]*?\*\//g, "");
    for (const match of css.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)) {
      if (!match[1].startsWith("data:")) queueAsset(match[1], url);
    }
    bytes = Buffer.from(css);
  }
  const destination = path.join(output, assetPath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  saved.add(assetPath);
}
await writeFile(
  path.join(output, "preview-clock.js"),
  `(() => {
  const date = new Date();
  const zone = "America/Chicago";
  const label = document.querySelector("[data-preview-date]");
  if (label) label.textContent = new Intl.DateTimeFormat("en-US", {timeZone:zone, weekday:"long",month:"long",day:"numeric"}).format(date);
  const heading = document.querySelector('[data-preview-area="today"] h1');
  const hour = Number(new Intl.DateTimeFormat("en-US",{timeZone:zone,hour:"numeric",hourCycle:"h23"}).format(date));
  if (heading) heading.textContent = (hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening") + ".";
})();\n`,
);
await writeFile(
  path.join(output, "index.html"),
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta http-equiv="refresh" content="0;url=/preview/"><title>Business workspace preview</title></head><body><a href="/preview/">Open the design preview</a></body></html>',
);
await writeFile(
  path.join(output, "robots.txt"),
  "User-agent: *\nDisallow: /\n",
);
await writeFile(
  path.join(output, "vercel.json"),
  JSON.stringify(
    {
      framework: null,
      installCommand: "",
      buildCommand: "",
      outputDirectory: ".",
      cleanUrls: true,
      trailingSlash: true,
      headers: [
        {
          source: "/(.*)",
          headers: [
            { key: "X-Robots-Tag", value: "noindex, nofollow" },
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "Referrer-Policy", value: "no-referrer" },
            {
              key: "Content-Security-Policy",
              value:
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
            },
          ],
        },
      ],
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ output, pages: 5, assets: saved.size }));
