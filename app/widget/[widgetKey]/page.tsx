import { ChatWidget } from "@/components/widget/chat-widget";
import { findConnectionByWidgetKey } from "@/lib/chat/widget";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const metadata = {
  title: "Chat",
};

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ widgetKey: string }>;
};

// Hosted widget page. Embedded in an iframe on the client business's
// website (or linked directly). Shows ONLY the client business's name —
// homeowners never see partner or platform branding (docs/12).
export default async function WidgetPage({ params }: PageProps) {
  const { widgetKey } = await params;
  const admin = createSupabaseAdminClient();
  const connection = admin
    ? await findConnectionByWidgetKey(admin, widgetKey)
    : null;

  if (!connection) {
    return (
      <main className="flex h-dvh items-center justify-center bg-background p-6 text-center text-sm text-muted-foreground">
        This chat is not available right now.
      </main>
    );
  }

  return (
    <main className="flex h-dvh flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center border-b bg-card px-4">
        <p className="text-sm font-semibold">{connection.client_name}</p>
        <p className="ml-auto text-[11px] text-muted-foreground">
          AI assistant · a human confirms everything
        </p>
      </header>
      <div className="min-h-0 flex-1">
        <ChatWidget widgetKey={widgetKey} clientName={connection.client_name} />
      </div>
    </main>
  );
}
