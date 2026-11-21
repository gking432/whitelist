export function ExternalActionPreview({
  payload,
}: {
  payload: Record<string, unknown> | null;
}) {
  const values = payload?.input;
  if (!values || typeof values !== "object" || Array.isArray(values))
    return null;
  return (
    <div className="mt-4 rounded-lg border bg-secondary/30 p-4">
      <h3 className="text-sm font-medium">
        Fields to send to the connected app
      </h3>
      <dl className="mt-3 space-y-3 text-sm">
        {Object.entries(values).map(([field, value]) => (
          <div key={field}>
            <dt className="font-medium">{field.replaceAll("_", " ")}</dt>
            <dd className="break-words whitespace-pre-wrap text-muted-foreground">
              {typeof value === "object"
                ? JSON.stringify(value, null, 2)
                : String(value ?? "")}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        Approve these exact fields, or reject and ask for a corrected proposal.
        Completion is confirmed separately by the connected app.
      </p>
    </div>
  );
}
