import { notFound } from "next/navigation";
import { DailyBriefShell } from "@/components/business/daily-brief-shell";
import { DailyBrief } from "@/components/business/daily-brief";
import { TodoWorkspace } from "@/components/business/todo-workspace";
import { ConversationInbox } from "@/components/conversations/inbox";
import { BusinessManagerChat } from "@/components/agents/manager-chat";
import { OwnerAreaHeader } from "@/components/business/owner-ui";
import { OWNER_AREAS } from "@/lib/business/owner-navigation";
import { emptyDesignPreview } from "@/lib/business/design-preview";

export const metadata = {
  title: { absolute: "Business workspace · Design preview" },
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
    (area[0] && !["messages", "todo", "manager", "apps"].includes(area[0]))
  )
    notFound();
  const data = emptyDesignPreview();
  const navigation = [
    ...OWNER_AREAS.map((item) => ({
      ...item,
      href: item.href.replace("/client", "/preview"),
    })),
    {
      label: "Apps & connections",
      href: "/preview/apps",
      group: "Your business",
      icon: "apps" as const,
    },
  ];
  const content =
    area[0] === "messages" ? (
      <ConversationInbox
        preview
        timeZone={data.timeZone}
        initialSnapshot={{
          conversations: [],
          messages: [],
          contacts: [],
          events: [],
          selectedId: null,
          canWrite: false,
          enabled: false,
          hasMore: false,
        }}
      />
    ) : area[0] === "todo" ? (
      <TodoWorkspace
        preview
        data={{
          workspace: data.workspace,
          tasks: [],
          work: [],
          timeZone: data.timeZone,
          generatedAt: data.generatedAt,
          errors: [],
          limited: false,
        }}
      />
    ) : area[0] === "manager" ? (
      <BusinessManagerChat
        preview
        initialSnapshot={{
          messages: [],
          active: false,
          aiConfigured: false,
          canWrite: false,
          hasMore: false,
        }}
      />
    ) : area[0] === "apps" ? (
      <div>
        <OwnerAreaHeader title="Apps & connections" />
        <p className="mt-6 max-w-lg text-sm leading-7 text-slate-500">
          No accounts are connected in this design preview. Connecting apps and
          running agents are available in the signed-in workspace.
        </p>
      </div>
    ) : (
      <DailyBrief preview data={data} />
    );
  return (
    <DailyBriefShell
      preview
      brandName="Business workspace"
      clientName=""
      email=""
      navigation={navigation}
      banner={
        <div className="border-b border-slate-100 bg-slate-50 px-6 py-2 text-center text-[11px] text-slate-500">
          Design preview · Read only · No accounts connected
        </div>
      }
    >
      <div data-preview-area={area[0] || "today"}>{content}</div>
    </DailyBriefShell>
  );
}
