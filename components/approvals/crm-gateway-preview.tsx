import { readCrmGatewayPreview } from "@/lib/crm/gateway-presentation";

const propertyLabels = { firstname: "First name", lastname: "Last name", email: "Email", phone: "Phone", address: "Address" };

export function CrmGatewayPreview({ payload }: { payload: unknown }) {
  const proposal = readCrmGatewayPreview(payload);
  if (!proposal) return <p role="alert" className="mt-4 text-sm text-destructive">The exact HubSpot target and proposal are unavailable. Reject this approval and prepare a fresh source review.</p>;
  return <section className="mt-4 space-y-3 rounded-md border bg-secondary/30 p-4 text-sm" aria-label="HubSpot proposal source review">
    <h3 className="font-medium">{proposal.operation === "note.create" ? "Add a note to an exact HubSpot contact" : "Create a deliberately new HubSpot customer"}</h3>
    <dl className="space-y-2"><div><dt className="font-medium">HubSpot account</dt><dd className="break-all">{proposal.account_id}</dd></div>
      {proposal.operation === "note.create" ? <><div><dt className="font-medium">Exact source contact</dt><dd className="break-all">{proposal.external_id}</dd></div><div><dt className="font-medium">Note to add</dt><dd className="whitespace-pre-wrap break-words">{proposal.note_body}</dd></div></> : (Object.keys(propertyLabels) as (keyof typeof propertyLabels)[]).flatMap((field) => proposal.properties[field] ? [<div key={field}><dt className="font-medium">{propertyLabels[field]}</dt><dd className="whitespace-pre-wrap break-words">{proposal.properties[field]}</dd></div>] : [])}
    </dl>
    <p className="text-xs leading-6 text-muted-foreground">Approve this exact target and content, or reject it and prepare a new proposal. Current account grants, source versions and pause controls are checked before execution. Approval is separate from a verified HubSpot result; no outreach or customer merge is authorized.</p>
  </section>;
}
