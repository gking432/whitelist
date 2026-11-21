import { notFound } from "next/navigation";
import Link from "next/link";
import { DailyBriefShell } from "@/components/business/daily-brief-shell";
import { DailyBrief } from "@/components/business/daily-brief";
import { TodoWorkspace } from "@/components/business/todo-workspace";
import { ConversationInbox } from "@/components/conversations/inbox";
import { BusinessManagerChat } from "@/components/agents/manager-chat";
import { PublicSourceArea } from "@/components/business/public-source-area";
import { OWNER_AREAS } from "@/lib/business/owner-navigation";
import { emptyDesignPreview } from "@/lib/business/design-preview";

export const metadata = {
  title: { absolute: "Business workspace · Preview" },
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
    (area[0] && !OWNER_AREAS.some((item) => item.href === `/client/${area[0]}`))
  )
    notFound();
  const data = emptyDesignPreview();
  const navigation = OWNER_AREAS.map((item) => ({
    ...item,
    href: item.href.replace("/client", "/preview"),
  }));
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
    ) : area[0] === "apps" || area[0] === "calendar" || area[0] === "money" ? (
      <PublicSourceArea area={area[0]} />
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
        <div className="border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div>
              <p className="text-sm font-medium text-slate-900">Make this your workspace</p>
              <p className="mt-1 max-w-xl text-xs leading-6 text-slate-500">Set up a private workspace to connect apps and use your business data. Owner access is required.</p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Link href="/start" prefetch={false} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">Set up your business</Link>
              <Link href="/preview" className="inline-flex min-h-11 items-center rounded-md text-xs text-slate-500 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">Browse preview</Link>
            </div>
          </div>
          <p className="mx-auto mt-2 max-w-7xl text-[11px] text-slate-500">Preview · No accounts connected</p>
        </div>
      }
    >
      <div data-public-review data-preview-area={area[0] || "today"}>{content}</div>
    </DailyBriefShell>
  );
}
