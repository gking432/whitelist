"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AutomationPack } from "@/lib/automation-packs/catalog";
import type { FieldMapping } from "@/lib/integrations/embedded/mapping";
import type {
  ZapierApp,
  ZapierAction,
  ZapierField,
} from "@/lib/integrations/embedded/zapier";

type Binding = {
  id: string;
  connection_id: string;
  direction: "inbound" | "outbound";
  pack_key: string;
  event_type: string;
  template_key: string | null;
  action_key: string;
  action_title: string;
  status: string;
  verified_at: string | null;
  last_error: string | null;
  field_mapping: FieldMapping;
};
type Overview = {
  configured: boolean;
  clientLive: boolean;
  connections: Array<{ id: string; app_title: string }>;
  bindings: Binding[];
  packs: AutomationPack[];
  instances: Array<{ template: { template_key: string; name: string } }>;
  runs: Array<{
    id: string;
    summary: string;
    template: { template_key: string };
  }>;
};
const inputStyle =
  "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";
const label = (key: string) => key.replaceAll("_", " ");

export function ConnectedApps({ clientId }: { clientId: string }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [apps, setApps] = useState<ZapierApp[]>([]);
  const [offset, setOffset] = useState(0);
  const [connectionId, setConnectionId] = useState("");
  const [direction, setDirection] = useState<"inbound" | "outbound">("inbound");
  const [packKey, setPackKey] = useState("");
  const [eventType, setEventType] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [actions, setActions] = useState<ZapierAction[]>([]);
  const [actionKey, setActionKey] = useState("");
  const [fields, setFields] = useState<ZapierField[]>([]);
  const [inputs, setInputs] = useState<Record<string, unknown>>({});
  const [choices, setChoices] = useState<
    Record<string, Array<{ id: string; label: string }>>
  >({});
  const [bindingId, setBindingId] = useState("");
  const [mappingDirty, setMappingDirty] = useState(false);
  const [mapping, setMapping] = useState<FieldMapping>({});
  const [paths, setPaths] = useState<string[]>([
    "input.name",
    "input.email",
    "input.phone",
    "input.message",
    "summary",
  ]);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [runId, setRunId] = useState("");
  const popupCleanup = useRef<(() => void) | null>(null);
  const pack = overview?.packs.find((item) => item.key === packKey);
  const binding = overview?.bindings.find((item) => item.id === bindingId);

  async function call<T>(body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`/api/integrations/embedded/${clientId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Could not complete setup.");
    return data as T;
  }
  async function refresh() {
    setOverview(await call<Overview>({ op: "list" }));
  }
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Setup failed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    fetch(`/api/integrations/embedded/${clientId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "list" }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        return data;
      })
      .then((data) => {
        if (active) setOverview(data);
      })
      .catch((error) => {
        if (active) setMessage(error.message);
      });
    return () => {
      active = false;
      popupCleanup.current?.();
    };
  }, [clientId]);

  async function connect(app: ZapierApp) {
    popupCleanup.current?.();
    const popup = window.open(
      "about:blank",
      "connected-app-authorization",
      "width=980,height=700",
    );
    if (!popup) {
      setMessage("Allow a popup to connect your app account.");
      return;
    }
    await task(async () => {
      try {
        const result = await call<{ url: string; flowId: string }>({
          op: "connect",
          appId: app.id,
        });
        const url = new URL(result.url);
        if (url.origin !== "https://connect.zapier.com")
          throw new Error("Invalid connection address.");
        let finishing = false;
        const listener = (event: MessageEvent) => {
          if (
            event.origin !== "https://connect.zapier.com" ||
            event.source !== popup ||
            finishing
          )
            return;
          if (event.data?.type === "authenticationSuccess") {
            finishing = true;
            cleanup();
            popup.close();
            void task(async () => {
              await call({
                op: "finish",
                flowId: result.flowId,
                authenticationId: String(event.data.authId),
              });
              await refresh();
              setMessage(`${app.title} connected. Choose a solution below.`);
            });
          } else if (event.data?.type === "authenticationError") {
            cleanup();
            popup.close();
            setMessage("The account was not connected. You can try again.");
          }
        };
        const timer = window.setInterval(() => {
          if (popup.closed) {
            cleanup();
            if (!finishing)
              setMessage(
                "Connection window closed. Your existing setup is unchanged.",
              );
          }
        }, 500);
        const expiry = window.setTimeout(() => {
          cleanup();
          popup.close();
          setMessage(
            "Connection session expired. Start again to connect the account.",
          );
        }, 360_000);
        function cleanup() {
          window.removeEventListener("message", listener);
          window.clearInterval(timer);
          window.clearTimeout(expiry);
          popupCleanup.current = null;
        }
        popupCleanup.current = () => {
          cleanup();
          popup.close();
        };
        window.addEventListener("message", listener);
        popup.location.href = url.toString();
      } catch (error) {
        popup.close();
        throw error;
      }
    });
  }

  function resetOperation() {
    setActionKey("");
    setActions([]);
    setFields([]);
    setInputs({});
    setChoices({});
  }
  async function loadFields(values = inputs, selectedAction = actionKey) {
    const result = await call<{ fields: ZapierField[] }>({
      op: "fields",
      connectionId,
      direction,
      actionKey: selectedAction,
      inputs: values,
    });
    setFields(result.fields);
    setChoices({});
    for (const field of result.fields.filter(
      (item) => item.format === "SELECT",
    )) {
      const result = await call<{ data: Array<{ id: string; label: string }> }>(
        {
          op: "choices",
          connectionId,
          direction,
          actionKey: selectedAction,
          fieldId: field.id,
          inputs: values,
        },
      );
      setChoices((current) => ({ ...current, [field.id]: result.data }));
    }
  }
  function readValue(field: ZapierField, value: string) {
    if (field.format === "SELECT" || !value) return value;
    if (["NUMBER", "INTEGER"].includes(field.value_type ?? ""))
      return Number(value);
    if (["ARRAY", "OBJECT"].includes(field.value_type ?? ""))
      return JSON.parse(value);
    return value;
  }
  async function changeField(field: ZapierField, value: string) {
    const next = { ...inputs, [field.id]: readValue(field, value) };
    for (const item of fields)
      if (
        item.depends_on?.includes(field.id) ||
        (field.invalidates_input_fields &&
          item.id !== field.id &&
          !item.invalidates_input_fields)
      )
        delete next[item.id];
    setInputs(next);
    if (
      field.invalidates_input_fields ||
      fields.some((item) => item.depends_on?.includes(field.id))
    )
      await loadFields(next);
  }
  const mappingKeys =
    binding?.direction === "outbound"
      ? fields
          .filter((field) => field.format !== "READONLY")
          .map((field) => field.id)
      : Array.from(
          new Set([
            ...(
              overview?.packs.find((item) => item.key === binding?.pack_key)
                ?.requiredFields ?? []
            ).flatMap((item) =>
              item === "phone or email"
                ? ["phone", "email"]
                : item === "appointment preference"
                  ? ["appointment_preference"]
                  : item === "customer"
                    ? ["name", "customer_id"]
                    : [item],
            ),
            "name",
            "phone",
            "email",
            "message",
            "transcript",
            "appointment_time",
            "estimate_id",
            "job_id",
            "source_id",
          ]),
        );

  return (
    <section
      id="connected-apps"
      className="space-y-5 rounded-xl border bg-card p-6"
    >
      <header>
        <h2 className="text-xl font-semibold">Connect your existing apps</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Keep the tools your business uses. Connect an account, choose what it
          should do with your solutions, and test a sample before enabling it.
          Phone conversations and live scheduling use their direct connections.
        </p>
      </header>
      <p role="status" aria-live="polite" className="text-sm">
        {busy ? "Working…" : message}
      </p>
      {!overview ? (
        <Button disabled={busy} variant="outline" onClick={() => task(refresh)}>
          Reload connections
        </Button>
      ) : !overview.configured ? (
        <div className="rounded-lg bg-secondary p-4 text-sm">
          Expanded app connections are awaiting platform activation. Your
          partner can continue using the direct connection wizard.
        </div>
      ) : (
        <>
          <fieldset disabled={busy} className="space-y-3">
            <legend className="font-medium">1. Find and connect an app</legend>
            <form
              className="flex items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void task(async () => {
                  setApps(
                    (await call<{ data: ZapierApp[] }>({ op: "search", query }))
                      .data,
                  );
                  setOffset(0);
                });
              }}
            >
              <label className="flex-1 text-sm">
                App name
                <input
                  className={inputStyle}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search your CRM, forms, accounting or other software"
                />
              </label>
              <Button type="submit">Search</Button>
            </form>
            <ul className="grid gap-2 sm:grid-cols-2">
              {apps.map((app) => (
                <li
                  key={app.id}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <span className="text-sm font-medium">{app.title}</span>
                  <Button variant="outline" onClick={() => connect(app)}>
                    Connect
                  </Button>
                </li>
              ))}
            </ul>
            {apps.length >= 20 ? (
              <Button
                variant="outline"
                onClick={() =>
                  task(async () => {
                    const next = offset + 20;
                    const result = await call<{ data: ZapierApp[] }>({
                      op: "search",
                      query,
                      offset: next,
                    });
                    setApps((current) => [...current, ...result.data]);
                    setOffset(next);
                  })
                }
              >
                More apps
              </Button>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Authorization opens a secure connection window. Each app offers
              its own supported events and actions.
            </p>
          </fieldset>
          {overview.connections.length ? (
            <fieldset disabled={busy} className="space-y-3 border-t pt-5">
              <legend className="font-medium">
                2. Choose a solution and an app operation
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  Connected account
                  <select
                    className={inputStyle}
                    value={connectionId}
                    onChange={(e) => {
                      setConnectionId(e.target.value);
                      resetOperation();
                    }}
                  >
                    <option value="">Choose an account</option>
                    {overview.connections.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.app_title} · {item.id.slice(0, 6)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  How it connects
                  <select
                    className={inputStyle}
                    value={direction}
                    onChange={(e) => {
                      setDirection(e.target.value as "inbound" | "outbound");
                      resetOperation();
                    }}
                  >
                    <option value="inbound">
                      An app event starts our solution
                    </option>
                    <option value="outbound">
                      Our solution prepares an action in the app
                    </option>
                  </select>
                </label>
                <label className="text-sm">
                  Solution
                  <select
                    className={inputStyle}
                    value={packKey}
                    onChange={(e) => {
                      const item = overview.packs.find(
                        (p) => p.key === e.target.value,
                      );
                      setPackKey(e.target.value);
                      setEventType(item?.eventType ?? "");
                      setTemplateKey("");
                    }}
                  >
                    <option value="">Choose a solution</option>
                    {overview.packs.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.name}
                        {!overview.instances.some((i) =>
                          item.workflowTemplates.includes(
                            i.template.template_key,
                          ),
                        )
                          ? " — install workflow first"
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {pack ? (
                  <label className="text-sm">
                    Business event
                    <select
                      className={inputStyle}
                      value={eventType}
                      onChange={(e) => setEventType(e.target.value)}
                    >
                      {pack.eventTypes.map((item) => (
                        <option key={item} value={item}>
                          {label(item.replaceAll(".", " "))}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {direction === "outbound" && pack ? (
                  <label className="text-sm">
                    After this workflow prepares its result
                    <select
                      className={inputStyle}
                      value={templateKey}
                      onChange={(e) => setTemplateKey(e.target.value)}
                    >
                      <option value="">Choose an installed workflow</option>
                      {overview.instances
                        .filter((item) =>
                          pack.workflowTemplates.includes(
                            item.template.template_key,
                          ),
                        )
                        .map((item) => (
                          <option
                            key={item.template.template_key}
                            value={item.template.template_key}
                          >
                            {item.template.name}
                          </option>
                        ))}
                    </select>
                  </label>
                ) : null}
              </div>
              <Button
                variant="outline"
                disabled={!connectionId}
                onClick={() =>
                  task(async () => {
                    setActions(
                      (
                        await call<{ data: ZapierAction[] }>({
                          op: "operations",
                          connectionId,
                          direction,
                        })
                      ).data,
                    );
                  })
                }
              >
                Show available operations
              </Button>
              {actions.length ? (
                <label className="block text-sm">
                  App operation
                  <select
                    className={inputStyle}
                    value={actionKey}
                    onChange={(e) => {
                      setActionKey(e.target.value);
                      setInputs({});
                      void task(() => loadFields({}, e.target.value));
                    }}
                  >
                    <option value="">Choose an operation</option>
                    {actions.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.title}
                        {direction === "inbound" && !item.is_instant
                          ? " (checks periodically)"
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {fields.map((field) => (
                <label key={field.id} className="block text-sm">
                  {field.title}
                  {field.is_required ? " *" : ""}
                  {field.format === "READONLY" ? (
                    <span className="ml-2 text-muted-foreground">
                      Provided by the app
                    </span>
                  ) : ["PASSWORD", "CODE"].includes(field.format ?? "") ||
                    field.type === "fieldset" ? (
                    <p>Requires managed setup through support.</p>
                  ) : field.format === "SELECT" ? (
                    <select
                      className={inputStyle}
                      value={String(inputs[field.id] ?? "")}
                      onChange={(e) =>
                        task(() => changeField(field, e.target.value))
                      }
                    >
                      <option value="">Choose a value</option>
                      {choices[field.id]?.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className={inputStyle}
                      value={
                        typeof inputs[field.id] === "object"
                          ? JSON.stringify(inputs[field.id])
                          : String(inputs[field.id] ?? "")
                      }
                      onChange={(e) => {
                        try {
                          setInputs((current) => ({
                            ...current,
                            [field.id]: readValue(field, e.target.value),
                          }));
                        } catch {
                          setMessage(
                            "Use a valid list or object for this field.",
                          );
                        }
                      }}
                      placeholder={
                        direction === "outbound"
                          ? "Optional fixed value; customer fields can be mapped in step 3"
                          : "Enter the app setting"
                      }
                    />
                  )}
                </label>
              ))}
              {actionKey ? (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => task(() => loadFields())}
                  >
                    Refresh fields
                  </Button>
                  <Button
                    disabled={
                      !packKey ||
                      !eventType ||
                      (direction === "outbound" && !templateKey)
                    }
                    onClick={() =>
                      task(async () => {
                        const result = await call<{
                          bindingId: string;
                          message: string;
                        }>({
                          op: "create",
                          connectionId,
                          direction,
                          actionKey,
                          packKey,
                          eventType,
                          ...(direction === "outbound" ? { templateKey } : {}),
                          inputs,
                          mapping:
                            direction === "outbound"
                              ? Object.fromEntries(
                                  Object.entries(inputs).map(([key, value]) => [
                                    key,
                                    { value },
                                  ]),
                                )
                              : {},
                        });
                        setBindingId(result.bindingId);
                        setMappingDirty(true);
                        setMapping(
                          Object.fromEntries(
                            Object.entries(inputs).map(([key, value]) => [
                              key,
                              { value },
                            ]),
                          ),
                        );
                        setPreview(null);
                        await refresh();
                        setMessage(result.message);
                      })
                    }
                  >
                    Save setup
                  </Button>
                </div>
              ) : null}
            </fieldset>
          ) : null}
          {overview.bindings.length ? (
            <fieldset disabled={busy} className="space-y-3 border-t pt-5">
              <legend className="font-medium">3. Map, test and enable</legend>
              <label className="block text-sm">
                Saved setup
                <select
                  className={inputStyle}
                  value={bindingId}
                  onChange={(e) => {
                    const item = overview.bindings.find(
                      (b) => b.id === e.target.value,
                    );
                    setBindingId(e.target.value);
                    setMapping(item?.field_mapping ?? {});
                    setMappingDirty(false);
                    setPaths(
                      Object.values(item?.field_mapping ?? {}).flatMap(
                        (rule) => ("path" in rule ? [rule.path] : []),
                      ),
                    );
                    setPreview(null);
                    if (item) {
                      setConnectionId(item.connection_id);
                      setDirection(item.direction);
                      setActionKey(item.action_key);
                      void task(async () => {
                        const result = await call<{ fields: ZapierField[] }>({
                          op: "fields",
                          connectionId: item.connection_id,
                          direction: item.direction,
                          actionKey: item.action_key,
                          inputs: Object.fromEntries(
                            Object.entries(item.field_mapping)
                              .filter(([, r]) => "value" in r)
                              .map(([k, r]) => [
                                k,
                                "value" in r ? r.value : null,
                              ]),
                          ),
                        });
                        setFields(result.fields);
                      });
                    }
                  }}
                >
                  <option value="">Choose a setup</option>
                  {overview.bindings.map((item) => (
                    <option key={item.id} value={item.id}>
                      {
                        overview.packs.find((p) => p.key === item.pack_key)
                          ?.name
                      }{" "}
                      → {item.action_title} · {label(item.status)}
                    </option>
                  ))}
                </select>
              </label>
              {binding ? (
                <>
                  <p className="text-sm">
                    {binding.last_error ||
                      (binding.verified_at
                        ? "Sample validated. External actions always enter your approval queue."
                        : "Load a real sample, choose its fields, then test again. Testing does not run a solution or submit an action.")}
                  </p>
                  {binding.direction === "outbound" ? (
                    <label className="block text-sm">
                      Sample workflow run
                      <select
                        className={inputStyle}
                        value={runId}
                        onChange={(e) => setRunId(e.target.value)}
                      >
                        <option value="">Choose a recent result</option>
                        {overview.runs
                          .filter(
                            (run) =>
                              run.template.template_key ===
                              binding.template_key,
                          )
                          .map((run) => (
                            <option key={run.id} value={run.id}>
                              {run.summary?.slice(0, 110) || run.id}
                            </option>
                          ))}
                      </select>
                    </label>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Create a sample event in the source app if none is
                      available. The sample stays queued and may be processed
                      after you enable this setup.
                    </p>
                  )}
                  {binding.status !== "enabled" ? (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {mappingKeys.map((key) => (
                          <label key={key} className="text-sm">
                            {fields.find((f) => f.id === key)?.title ||
                              label(key)}
                            <select
                              className={inputStyle}
                              value={
                                mapping[key] && "path" in mapping[key]
                                  ? mapping[key].path
                                  : mapping[key]
                                    ? "__fixed"
                                    : ""
                              }
                              onChange={(e) => (
                                setMappingDirty(true),
                                setMapping((current) => {
                                  const next = { ...current };
                                  if (e.target.value === "__fixed")
                                    return current;
                                  if (e.target.value)
                                    next[key] = { path: e.target.value };
                                  else delete next[key];
                                  return next;
                                })
                              )}
                            >
                              <option value="">Leave unmapped</option>
                              {mapping[key] && "value" in mapping[key] ? (
                                <option value="__fixed">
                                  Fixed: {String(mapping[key].value)}
                                </option>
                              ) : null}
                              {paths.map((path) => (
                                <option key={path} value={path}>
                                  {label(path)}
                                </option>
                              ))}
                            </select>
                          </label>
                        ))}
                      </div>
                      <Button
                        variant="outline"
                        disabled={binding.direction === "outbound" && !runId}
                        onClick={() =>
                          task(async () => {
                            const result = await call<{
                              paths: string[];
                              fields?: ZapierField[];
                              preview: Record<string, unknown>;
                              message: string;
                            }>({
                              op: "test",
                              bindingId,
                              mapping,
                              ...(binding.direction === "outbound"
                                ? { runId }
                                : {}),
                            });
                            setPaths(result.paths);
                            setMappingDirty(false);
                            if (result.fields) setFields(result.fields);
                            setPreview(result.preview);
                            await refresh();
                            setMessage(result.message);
                          })
                        }
                      >
                        Load sample and test mapping
                      </Button>
                    </>
                  ) : null}
                  {preview ? (
                    <dl className="space-y-2 rounded-lg bg-secondary p-4 text-sm">
                      {Object.entries(preview).map(([key, value]) => (
                        <div key={key}>
                          <dt className="font-medium">{label(key)}</dt>
                          <dd className="break-words whitespace-pre-wrap">
                            {typeof value === "object"
                              ? JSON.stringify(value)
                              : String(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  <div>
                    <Button
                      disabled={
                        binding.status !== "enabled" &&
                        (!binding.verified_at || mappingDirty)
                      }
                      onClick={() =>
                        task(async () => {
                          const result = await call<{ message: string }>({
                            op:
                              binding.status === "enabled" ? "pause" : "enable",
                            bindingId,
                          });
                          await refresh();
                          setMessage(result.message);
                        })
                      }
                    >
                      {binding.status === "enabled"
                        ? "Pause processing"
                        : "Enable for this client"}
                    </Button>
                  </div>
                  {!overview.clientLive ? (
                    <p className="text-xs text-muted-foreground">
                      The client launch checklist must be complete before
                      enabling live processing.
                    </p>
                  ) : null}
                </>
              ) : null}
            </fieldset>
          ) : null}
        </>
      )}
    </section>
  );
}
