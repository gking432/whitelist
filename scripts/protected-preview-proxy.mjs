import http from "node:http";

const accessToken = process.env.PREVIEW_ACCESS_TOKEN;
const upstreamPort = Number.parseInt(
  process.env.PREVIEW_UPSTREAM_PORT ?? "3000",
  10,
);
const listenPort = Number.parseInt(process.env.PREVIEW_PORT ?? "3001", 10);
const cookieName = "northstar_preview";

if (!accessToken) {
  throw new Error("PREVIEW_ACCESS_TOKEN is required.");
}

const publicPaths = [
  "/api/integrations/inbound/",
  "/api/jobs/run",
  "/api/chat/widget",
  "/widget/",
];

function cookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key]) => key),
  );
}

function isPublicPath(pathname) {
  return publicPaths.some((path) => pathname.startsWith(path));
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url ?? "/", "http://preview.local");

  if (
    requestUrl.pathname === "/__preview_login" &&
    requestUrl.searchParams.get("token") === accessToken
  ) {
    const requestedNext = requestUrl.searchParams.get("next") || "/";
    const next =
      requestedNext.startsWith("/") && !requestedNext.startsWith("//")
        ? requestedNext
        : "/";

    response.writeHead(307, {
      "Set-Cookie": `${cookieName}=${accessToken}; Path=/; HttpOnly; Secure; SameSite=Lax`,
      Location: next,
    });
    response.end();
    return;
  }

  if (
    !isPublicPath(requestUrl.pathname) &&
    cookies(request.headers.cookie)[cookieName] !== accessToken
  ) {
    response.writeHead(401, { "Content-Type": "text/plain" });
    response.end("Protected Northstar preview. Use the private access link.");
    return;
  }

  const headers = {
    ...request.headers,
    host: "localhost:3000",
    "x-forwarded-host": request.headers.host,
    "x-forwarded-proto": "https",
  };
  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: upstreamPort,
      path: request.url,
      method: request.method,
      headers,
    },
    (reply) => {
      const responseHeaders = { ...reply.headers };

      if (responseHeaders.location) {
        try {
          const location = new URL(responseHeaders.location);

          if (
            ["localhost", "0.0.0.0", "127.0.0.1"].includes(location.hostname)
          ) {
            responseHeaders.location = `https://${request.headers.host}${location.pathname}${location.search}`;
          }
        } catch {
          // Relative redirects already target the public preview host.
        }
      }

      response.writeHead(reply.statusCode ?? 502, responseHeaders);
      reply.pipe(response);
    },
  );

  upstream.on("error", () => {
    response.writeHead(502);
    response.end("Preview unavailable");
  });
  request.pipe(upstream);
});

server.listen(listenPort, "127.0.0.1", () => {
  console.log(`Protected preview proxy ready on ${listenPort}`);
});
