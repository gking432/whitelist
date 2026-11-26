import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { checkRateLimit } from "@/lib/integrations/rate-limit";
import { recordPlatformError } from "@/lib/monitoring/server";

export const dynamic = "force-dynamic";

const ClientErrorSchema = z.object({
  source: z.enum(["browser", "desktop"]).default("browser"),
  name: z.string().max(160).optional(),
  message: z.string().min(1).max(2_000),
  stack: z.string().max(8_000).optional(),
  path: z.string().max(500).optional(),
  digest: z.string().max(200).optional(),
  version: z.string().max(100).optional(),
});

export async function POST(request: NextRequest) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 16_384) {
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }

  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0];
  const rate = await checkRateLimit(
    `client-error:${forwarded?.trim() || "unknown"}`,
    { limit: 10, windowSeconds: 60 },
  );
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many reports." },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = ClientErrorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid error report." }, { status: 400 });
  }

  const data = parsed.data;
  await recordPlatformError({
    source: data.source,
    error: Object.assign(new Error(data.message), {
      name: data.name ?? "ClientError",
      stack: data.stack,
    }),
    routePath: data.path,
    digest: data.digest,
    metadata: { version: data.version ?? null },
  });

  return new NextResponse(null, { status: 204 });
}
