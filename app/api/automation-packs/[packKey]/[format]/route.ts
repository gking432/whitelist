import { NextResponse } from "next/server";

import {
  exportAutomationPack,
  type AutomationExportFormat,
} from "@/lib/automation-packs/exports";
import { getAutomationPack } from "@/lib/automation-packs/catalog";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  {
    params,
  }: { params: Promise<{ packKey: string; format: string }> },
) {
  const { packKey, format } = await params;
  const pack = getAutomationPack(packKey);

  if (
    !pack ||
    !["n8n", "make", "zapier"].includes(format)
  ) {
    return NextResponse.json({ error: "Unknown automation pack." }, { status: 404 });
  }

  const content = exportAutomationPack(
    pack,
    format as AutomationExportFormat,
  );
  const filename = `northstar-${pack.key}-${format}.json`;

  return new NextResponse(JSON.stringify(content, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}

