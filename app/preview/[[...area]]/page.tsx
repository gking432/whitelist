import { notFound } from "next/navigation";
import { OWNER_AREAS, PREVIEW_EXTRA_AREAS, previewAreaHref } from "@/lib/business/owner-navigation";
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
    (area[0] && !(PREVIEW_EXTRA_AREAS as readonly string[]).includes(area[0]) && !OWNER_AREAS.some((item) => previewAreaHref(item.href) === `/preview/${area[0]}`))
  ) notFound();
  return <SamplePreviewApp area={area[0] || "today"} />;
}
