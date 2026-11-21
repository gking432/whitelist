import { zapierJwks } from "@/lib/integrations/embedded/zapier";
export const dynamic = "force-dynamic";
export function GET() {
  try {
    return Response.json(zapierJwks(), {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch {
    return Response.json(
      { error: "Connection signing is unavailable." },
      { status: 503 },
    );
  }
}
