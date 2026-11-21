import test from "node:test";
import assert from "node:assert/strict";
import {
  ContextRequestError,
  fetchBusinessContext,
  isDirectManagerControl,
  sendBusinessContextCommand,
} from "../components/business/context-client.ts";
import type { BusinessContextCommand } from "../lib/business/context-contract.ts";

const command: BusinessContextCommand = {
  action: "manager_control",
  key: "00000000-0000-4000-8000-000000000001",
  expectedRevision: 8,
  command: "resume team",
};

test("paused manager bypasses its assignment queue only for explicit supported controls", () => {
  for (const text of ["pause team", "resume team", "Resume TEAM!", " Stop using Instagram. ", "stop using SMS", "stop using calendar"])
    assert.equal(isDirectManagerControl(text), true, text);
  for (const text of ["can we stop Instagram?", "resume team and email everyone", "stop using marketing", "pause", "do not stop using email"])
    assert.equal(isDirectManagerControl(text), false, text);
});

test("context reads carry no-store and propagate cancellation", async () => {
  const controller = new AbortController();
  const fetcher = (async (url, init) => {
    assert.equal(url, "/api/business/context");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.signal, controller.signal);
    return Response.json({ version: 1, revision: "profile-1" });
  }) as typeof fetch;
  assert.equal((await fetchBusinessContext(fetcher, controller.signal)).revision, "profile-1");
});

test("a stale authority revision stays an actionable failure rather than saved success", async () => {
  const fetcher = (async () => Response.json({ error: "Permissions changed. Refresh before retrying." }, { status: 409 })) as typeof fetch;
  await assert.rejects(sendBusinessContextCommand(command, fetcher), (error) => {
    assert.ok(error instanceof ContextRequestError);
    assert.equal(error.status, 409);
    assert.match(error.message, /Refresh/);
    return true;
  });
});

test("a successful HTTP response without a durable result cannot claim a saved change", async () => {
  const fetcher = (async () => Response.json({ message: "Saved" })) as typeof fetch;
  await assert.rejects(sendBusinessContextCommand(command, fetcher), /did not confirm/);
});

test("retrying a control sends its original idempotency key and revision", async () => {
  const requests: string[] = [];
  let count = 0;
  const fetcher = (async (_url, init) => {
    requests.push(String(init?.body));
    count++;
    if (count === 1) throw new Error("Connection lost after commit");
    return Response.json({ result: { id: "saved-command", revision: 9, message: "Team resumed.", replayed: true, cancelledWork: 0 }, snapshot: { version: 1 } });
  }) as typeof fetch;
  await assert.rejects(sendBusinessContextCommand(command, fetcher), /Connection lost/);
  const result = await sendBusinessContextCommand(command, fetcher);
  assert.equal(result.result.replayed, true);
  assert.equal(requests[0], requests[1]);
  assert.deepEqual(JSON.parse(requests[0]), command);
});

test("unavailable context does not create a substitute local business snapshot", async () => {
  const fetcher = (async () => Response.json({ error: "Data service unavailable." }, { status: 503 })) as typeof fetch;
  await assert.rejects(fetchBusinessContext(fetcher), /Data service unavailable/);
});
