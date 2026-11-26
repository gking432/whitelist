import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  encryptProviderCredentials,
  PROVIDER_CREDENTIALS_KIND,
} from "../lib/integrations/credentials";
import { computeTwilioSignature } from "../lib/integrations/twilio-signature";
async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname));
  const origin = process.env.VERIFY_APP_URL ?? "http://localhost:3210";
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const partnerId = randomUUID(),
    clientId = randomUUID();
  function unwrap<T>(r: {
    data: T;
    error: { message: string } | null;
  }): NonNullable<T> {
    if (r.error) throw new Error(r.error.message);
    return r.data as NonNullable<T>;
  }
  try {
    unwrap(
      await db
        .from("partners")
        .insert({
          id: partnerId,
          name: "Temporary webhook verification",
          slug: `verify-${partnerId}`,
          is_test_account: true,
          status: "active",
        }),
    );
    unwrap(
      await db
        .from("client_businesses")
        .insert({
          id: clientId,
          partner_id: partnerId,
          name: "Temporary webhook verification",
          slug: `verify-${clientId}`,
          is_test_account: true,
          status: "active",
        }),
    );
    unwrap(
      await db
        .from("agent_team_settings")
        .insert({
          client_id: clientId,
          partner_id: partnerId,
          status: "paused",
          conversations_enabled: true,
        }),
    );
    async function connection(
      key: string,
      credentials: Record<string, string>,
    ) {
      const provider = unwrap(
        await db
          .from("integration_providers")
          .select("id")
          .eq("provider_key", key)
          .single(),
      );
      const c = unwrap(
        await db
          .from("integration_connections")
          .insert({
            partner_id: partnerId,
            client_id: clientId,
            provider_id: provider.id,
            display_name: "Webhook verification",
            status: "connected",
            runtime_mode: "dry_run",
            credential_status: "configured",
          })
          .select("id")
          .single(),
      );
      unwrap(
        await db
          .from("integration_secrets")
          .insert({
            partner_id: partnerId,
            client_id: clientId,
            connection_id: c.id,
            secret_kind: PROVIDER_CREDENTIALS_KIND,
            ...encryptProviderCredentials(credentials),
          }),
      );
      return c.id as string;
    }
    const twilio = {
      accountSid: "AC" + randomUUID().replaceAll("-", ""),
      authToken: "test-only-" + randomUUID(),
      fromNumber: "+15555550202",
    };
    const smsId = await connection("twilio", twilio),
      smsUrl = `${origin}/api/integrations/inbound/twilio/${smsId}`;
    const form = {
      AccountSid: twilio.accountSid,
      MessageSid: "SM" + randomUUID().replaceAll("-", ""),
      From: "+15555550101",
      To: twilio.fromNumber,
      Body: "TEST FIXTURE incoming SMS",
    };
    async function sms(signature: string, params = form) {
      return fetch(smsUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "x-twilio-signature": signature,
        },
        body: new URLSearchParams(params),
      });
    }
    assert.equal((await sms("bad")).status, 403);
    const signature = computeTwilioSignature(twilio.authToken, smsUrl, form);
    assert.equal((await sms(signature)).status, 200);
    assert.equal((await sms(signature)).status, 200);
    const wrong = { ...form, To: "+15555550303" };
    assert.equal(
      (
        await sms(
          computeTwilioSignature(twilio.authToken, smsUrl, wrong),
          wrong,
        )
      ).status,
      403,
    );
    const ig = {
      accessToken: "test-only-token",
      instagramAccountId: "123456789",
      appSecret: "test-only-" + randomUUID(),
      verifyToken: randomUUID(),
      apiVersion: "v24.0",
    };
    const igId = await connection("instagram_messaging", ig),
      igUrl = `${origin}/api/integrations/inbound/instagram/${igId}`;
    const challenge = await fetch(
      `${igUrl}?hub.mode=subscribe&hub.verify_token=${ig.verifyToken}&hub.challenge=test-challenge`,
    );
    assert.equal(await challenge.text(), "test-challenge");
    assert.equal(
      (
        await fetch(
          `${igUrl}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=test`,
        )
      ).status,
      403,
    );
    const timestamp = Date.now() - 25 * 3600000;
    const raw = JSON.stringify({
      object: "instagram",
      entry: [
        {
          id: ig.instagramAccountId,
          messaging: [
            {
              sender: { id: "987654321" },
              recipient: { id: ig.instagramAccountId },
              timestamp,
              message: {
                mid: "test-" + randomUUID(),
                text: "TEST FIXTURE incoming Instagram message",
              },
            },
          ],
        },
      ],
    });
    const igSignature =
      "sha256=" + createHmac("sha256", ig.appSecret).update(raw).digest("hex");
    async function instagram(body: string) {
      return fetch(igUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": igSignature,
        },
        body,
      });
    }
    assert.equal((await instagram(raw + " ")).status, 403);
    assert.equal((await instagram(raw)).status, 200);
    assert.equal((await instagram(raw)).status, 200);
    let rows: { id: string; channel: string }[] = [];
    for (let i = 0; i < 40; i++) {
      rows = unwrap(
        await db
          .from("business_conversations")
          .select("id,channel")
          .eq("client_id", clientId),
      );
      if (rows.length === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(
      rows.length,
      2,
      "Both signed channels must reach the durable conversation ledger",
    );
    assert.deepEqual(rows.map((r) => r.channel).sort(), ["instagram", "sms"]);
    const messages = unwrap(
      await db
        .from("business_conversation_messages")
        .select("created_at")
        .eq("client_id", clientId),
    );
    assert.equal(
      messages.length,
      2,
      "Provider redelivery must not duplicate CRM messages",
    );
    assert.ok(
      messages.some((m) => Date.parse(m.created_at) === timestamp),
      "Instagram source timestamp must survive the queue",
    );
    assert.equal(
      unwrap(
        await db
          .from("agent_work_items")
          .select("id")
          .eq("client_id", clientId),
      ).length,
      0,
      "Paused team still receives messages without executing AI",
    );
    console.log(
      "PASS: signed SMS and Instagram HTTP ingress, invalid signatures, wrong phone routing, webhook challenge, duplicate provider events, source timestamps, durable CRM messages, paused-team intake. No external delivery or model calls.",
    );
  } finally {
    // Only the newly-created local verification tenant is removed.
    unwrap(
      await db.from("agent_work_items").delete().eq("client_id", clientId),
    );
    unwrap(
      await db
        .from("business_conversations")
        .delete()
        .eq("client_id", clientId),
    );
    unwrap(await db.from("client_businesses").delete().eq("id", clientId));
    unwrap(await db.from("partners").delete().eq("id", partnerId));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
