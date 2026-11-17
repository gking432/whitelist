import { redirect } from "next/navigation";
import { TodoWorkspace } from "@/components/business/todo-workspace";
import { loadClientPortal } from "@/lib/clients/portal";
import { canReadBusinessWorkspace } from "@/lib/business/access";
import { loadTodoSnapshot } from "@/lib/business/todo-data";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "To-do" } };
export default async function TodoPage() {
  const portal = await loadClientPortal();
  if (portal.kind !== "ok") return null;
  if (!canReadBusinessWorkspace(portal.access)) redirect("/client");
  return <TodoWorkspace data={await loadTodoSnapshot(portal)} />;
}
