import { redirect } from "next/navigation";
import { z } from "zod";
export const dynamic = "force-dynamic";
export const metadata = { title: "Messages" };
export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  redirect(
    `/client/messages${z.uuid().safeParse(id).success ? `?id=${encodeURIComponent(id!)}` : ""}`,
  );
}
