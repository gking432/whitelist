import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { redactAuditValue } from "@/lib/audit/redact";
import { readProviderCredentials } from "@/lib/integrations/credentials";
import {
  completeTwilioCall,
  type TwilioCredentials,
} from "@/lib/integrations/providers/twilio";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadVoiceRuntimeBootstrap } from "@/lib/voice/runtime";
import { verifyVoiceStreamPayload } from "@/lib/voice/stream-signature";
import { executeVoiceTool } from "@/lib/voice/tools";

export const dynamic = "force-dynamic";

const BootstrapSchema = z.object({
  action: z.literal("bootstrap"),
  call_session_id: z.string().uuid(),
});
const ToolSchema = z.object({
  action: z.literal("tool"),
  call_session_id: z.string().uuid(),
  call_id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(100),
  arguments: z.record(z.string(), z.unknown()),
});
const EndSchema = z.object({
  action: z.literal("end"),
  call_session_id: z.string().uuid(),
});
const ControlSchema = z.discriminatedUnion("action", [
  BootstrapSchema,
  ToolSchema,
  EndSchema,
]);

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const secret = process.env.VOICE_STREAM_SHARED_SECRET?.trim();

  if (!secret) return json(503, { error: "Voice stream is not configured." });

  const body = await request.text();

  if (
    !verifyVoiceStreamPayload({
      secret,
      timestamp: request.headers.get("x-northstar-timestamp"),
      signature: request.headers.get("x-northstar-signature"),
      body,
    })
  ) {
    return json(401, { error: "Invalid voice stream signature." });
  }

  const parsed = ControlSchema.safeParse(
    (() => {
      try {
        return JSON.parse(body);
      } catch {
        return null;
      }
    })(),
  );

  if (!parsed.success) return json(400, { error: "Invalid control event." });

  const admin = createSupabaseAdminClient();

  if (!admin) return json(503, { error: "Data service unavailable." });

  const runtime = await loadVoiceRuntimeBootstrap(
    admin,
    parsed.data.call_session_id,
  );

  if (!runtime) return json(404, { error: "Active AI call not found." });

  if (parsed.data.action === "bootstrap") {
    return json(200, {
      instructions: runtime.instructions,
      initial_instruction: runtime.initialInstruction,
      model: runtime.model,
      voice: runtime.voice,
      transcription_model: runtime.transcriptionModel,
      tools: runtime.tools,
    });
  }

  if (parsed.data.action === "end") {
    if (!runtime.providerCallRef?.startsWith("CA")) {
      return json(503, { error: "The carrier call is not ready to end." });
    }

    const credentials = await readProviderCredentials<TwilioCredentials>(
      admin,
      runtime.connectionId,
    );

    if (!credentials?.accountSid || !credentials.authToken) {
      return json(503, { error: "Twilio credentials are unavailable." });
    }

    try {
      await completeTwilioCall(credentials, runtime.providerCallRef);
      return json(200, { ended: true });
    } catch {
      return json(502, { error: "Twilio could not end the call." });
    }
  }

  const { data: claimed, error: claimError } = await admin
    .from("voice_tool_executions")
    .insert({
      call_session_id: parsed.data.call_session_id,
      partner_id: runtime.toolContext.partnerId,
      client_id: runtime.toolContext.clientId,
      external_call_id: parsed.data.call_id,
      tool_name: parsed.data.name,
      arguments: redactAuditValue(parsed.data.arguments),
      status: "executing",
    })
    .select("id")
    .maybeSingle();

  if (claimError || !claimed) {
    if (claimError?.code !== "23505") {
      return json(503, { error: "Tool execution could not be claimed." });
    }

    const { data: existing } = await admin
      .from("voice_tool_executions")
      .select("status, result, end_call")
      .eq("call_session_id", parsed.data.call_session_id)
      .eq("external_call_id", parsed.data.call_id)
      .maybeSingle();

    if (existing?.status === "succeeded" || existing?.status === "failed") {
      return json(200, {
        result: existing.result ?? {},
        end_call: existing.end_call,
        duplicate: true,
      });
    }

    return json(409, { error: "Tool execution is already in progress." });
  }

  const outcome = await executeVoiceTool(admin, runtime.toolContext, {
    name: parsed.data.name,
    arguments: parsed.data.arguments,
  });
  const failed = typeof outcome.result.error === "string";

  await admin
    .from("voice_tool_executions")
    .update({
      status: failed ? "failed" : "succeeded",
      result: redactAuditValue(outcome.result),
      end_call: Boolean(outcome.endCall),
      completed_at: new Date().toISOString(),
    })
    .eq("id", claimed.id);

  return json(200, {
    result: outcome.result,
    end_call: Boolean(outcome.endCall),
  });
}
