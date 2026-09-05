"use client";

import { useState, useTransition } from "react";
import { MessageSquareText } from "lucide-react";

import { enableChatWidget } from "@/app/partner/clients/[clientId]/integrations/actions";
import { Button } from "@/components/ui/button";

// Widget enable/rotate + embed snippet for a Northstar web chat connection.

export function ChatWidgetSetup({
  clientId,
  connectionId,
  widgetKey,
  appUrl,
  canManage,
}: {
  clientId: string;
  connectionId: string;
  widgetKey: string | null;
  appUrl: string;
  canManage: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const widgetUrl = widgetKey ? `${appUrl}/widget/${widgetKey}` : null;
  const snippet = widgetUrl
    ? `<!-- Northstar chat widget -->\n<iframe\n  src="${widgetUrl}"\n  title="Chat with us"\n  style="position:fixed;bottom:16px;right:16px;width:360px;height:520px;max-height:80vh;border:1px solid #ddd;border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.18);z-index:9999;background:#fff"\n  loading="lazy"></iframe>`
    : null;

  return (
    <section className="rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <MessageSquareText
            className="size-4 text-primary"
            aria-hidden="true"
          />
          Website chat widget
        </h3>
        {canManage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await enableChatWidget(clientId, connectionId);
                setMessage(result.message ?? null);
              })
            }
          >
            {isPending
              ? "Working…"
              : widgetKey
                ? "Rotate widget key"
                : "Enable widget"}
          </Button>
        ) : null}
      </div>

      {widgetUrl ? (
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Hosted chat page (share or test directly)
            </p>
            <code className="mt-1 block overflow-x-auto rounded bg-secondary/60 px-3 py-2 font-mono text-xs">
              {widgetUrl}
            </code>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Embed snippet — paste before {"</body>"} on the client&apos;s site
            </p>
            <pre className="mt-1 overflow-x-auto rounded bg-secondary/60 px-3 py-2 font-mono text-xs leading-5">
              {snippet}
            </pre>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            The widget key is public by design — it only lets visitors start
            a chat. Completed conversations with contact details become
            normal intake events: AI routing, lead workflows, approvals, and
            CRM sync. Rotating the key disables previously embedded widgets.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Enable the widget to get a hosted chat page and an embed snippet.
          The assistant answers only from this client&apos;s approved AI
          knowledge (Knowledge tab) and always identifies itself as an AI.
        </p>
      )}

      {message ? (
        <p className="mt-2 text-xs text-muted-foreground">{message}</p>
      ) : null}
    </section>
  );
}
