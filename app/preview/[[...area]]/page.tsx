import { notFound } from "next/navigation";
import { OWNER_AREAS } from "@/lib/business/owner-navigation";
import { SamplePreviewApp } from "../sample-preview-app";

export const metadata = {
  title: { absolute: "Meridian · Sample workspace" },
  robots: { index: false, follow: false },
};

export default async function DesignPreviewPage({
  params,
}: {
  params: Promise<{ area?: string[] }>;
}) {
  const { area = [] } = await params;
  if (
    area.length > 1 ||
    (area[0] && area[0] !== "report" && !OWNER_AREAS.some((item) => item.href === `/client/${area[0]}`))
  ) notFound();
  return <SamplePreviewApp area={area[0] || "today"} />;
}
