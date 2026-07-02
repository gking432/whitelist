# Roles, Permissions, And Tenancy

## Tenancy Summary

The platform has three internal access scopes:

1. Platform scope.
2. Partner scope.
3. Client scope.

Homeowners/customers are not authenticated app users in the first build.

## Access Rule

No server action, route handler, loader, or database query should trust a `partnerId` or `clientId` from the browser without verifying membership.

Use helper functions like:

```ts
requirePlatformRole(userId, allowedRoles)
requirePartnerAccess(userId, partnerId, allowedRoles)
requireClientAccess(userId, clientId, allowedRoles)
requirePartnerClientAccess(userId, partnerId, clientId, allowedRoles)
```

All helpers should return a normalized access context:

```ts
interface AccessContext {
  userId: string;
  role: MembershipRole;
  partnerId?: string;
  clientId?: string;
  canEditClientData: boolean;
  canManageIntegrations: boolean;
  canManageWorkflows: boolean;
  canResolveApprovals: boolean;
  canViewSensitiveLogs: boolean;
}
```

## Roles

### Platform Roles

#### platform_owner

Can:

- create/manage partners.
- assign plans.
- view all partner/client health.
- publish workflow templates.
- access platform audit logs.
- suspend partners/clients.
- impersonate with audit trail.

#### platform_admin

Can:

- manage partners and support configuration.
- view most system health and audit data.
- cannot change platform billing settings unless explicitly allowed.

#### platform_support

Can:

- view partner/client health for support.
- inspect logs if permitted.
- cannot change billing, secrets, or high-risk workflow settings.
- cannot impersonate without explicit permission.

### Partner Roles

#### partner_owner

Can:

- manage partner settings and branding.
- manage partner users.
- create/manage client businesses.
- enable client portal access.
- configure integrations.
- enable/disable workflows.
- view usage and margin.
- resolve approvals if client allows.
- edit client operational data only if client has granted permission.

#### partner_admin

Can:

- manage clients.
- configure integrations/workflows.
- invite implementers/viewers.
- view usage and operational reports.
- resolve approvals according to client policy.

#### partner_implementer

Can:

- configure integrations.
- map fields.
- run tests/dry-runs.
- inspect event logs.
- retry failed workflow runs.
- manage workflow instances.
- cannot manage billing/partner ownership.

#### partner_viewer

Can:

- view client health.
- view reports.
- view run logs if allowed.
- cannot mutate integrations, workflows, approvals, or users.

### Client Roles

#### client_owner

Can:

- view client business workspace.
- manage client users.
- grant/revoke partner edit permission.
- approve/reject approval items.
- view reports and integration health.
- configure limited client-side settings.

#### client_manager

Can:

- view integrations and workflow activity.
- resolve assigned approval items.
- view reports.
- report/escalate issues.

#### client_staff

Can:

- view assigned approvals/tasks.
- approve/reject if granted.
- view limited activity relevant to their role.

#### client_viewer

Can:

- read-only access to dashboards/reports allowed by client owner.

## Permission Matrix

| Capability | Platform Owner | Partner Owner | Partner Admin | Partner Implementer | Partner Viewer | Client Owner | Client Manager |
|---|---:|---:|---:|---:|---:|---:|---:|
| Manage partners | Yes | No | No | No | No | No | No |
| Manage partner branding | Yes | Yes | Limited | No | No | No | No |
| Manage client businesses | Yes | Yes | Yes | Limited | No | No | No |
| View client health | Yes | Yes | Yes | Yes | Yes | Own only | Own only |
| Configure integrations | Yes | Yes | Yes | Yes | No | Limited | No |
| Configure workflows | Yes | Yes | Yes | Yes | No | Limited | No |
| View run logs | Yes | Yes | Yes | Yes | Limited | Own only | Own only |
| View sensitive payloads | Yes | Yes | Yes | Limited | No | Limited | No |
| Resolve approvals | Yes | Yes | Yes | Limited | No | Yes | Yes |
| Edit client data | Yes | If granted | If granted | If granted | No | Yes | Limited |
| Manage billing/margin | Yes | Yes | Limited | No | No | No | No |
| View audit log | Yes | Partner only | Partner only | Limited | No | Client only | No |

## Partner Editing Client Data

Default:

- partner users can inspect and troubleshoot.
- partner users cannot edit client operational data unless permission is granted.

Client setting:

- `partner_can_edit_client_data`.

If enabled:

- partner owner/admin/implementer can make permitted client data changes.
- every edit creates an audit event.
- UI must label edits as performed by partner user.

If disabled:

- partner can still configure integrations/workflows.
- partner can still inspect logs.
- partner cannot change client-owned CRM/operational records.

## Client Portal Access

Client portal should be optional per client business:

- `client_portal_enabled = false` by default.

When disabled:

- client users cannot log into client routes.
- partner remains the primary operator.

When enabled:

- client users see only their client business.
- partner branding may appear in header/footer/report/support areas.
- advanced integration settings are hidden unless explicitly granted.

## Branding Visibility By Audience

### Platform Owner

Can see platform brand and all partner/client names.

### Partner

Sees platform enough to use the product unless white-labeling requires otherwise.

### Client Business

Should see partner branding in appropriate app surfaces:

- login/client portal header.
- footer.
- reports.
- support contact.
- exported PDFs/emails.

Client business brand should appear where the client is the subject of the workspace.

### Homeowner

Sees only the client business brand.

No partner brand. No platform brand.

## Impersonation

If implemented, impersonation must be audited.

Audit:

- actor user.
- target partner/client/user.
- reason.
- started_at.
- ended_at.
- actions taken during impersonation.

Avoid implementing impersonation in first code pass unless needed for support.

## RLS Verification Scenarios

Before considering tenancy done, verify:

1. Partner A user cannot access Partner B clients through UI.
2. Partner A user cannot fetch Partner B rows through direct server action/API call.
3. Client A user cannot access Client B rows under the same partner.
4. Client user cannot view partner settings, margin, or other clients.
5. Partner viewer cannot mutate integrations/workflows.
6. Partner implementer cannot manage billing/owner settings.
7. Partner cannot edit client operational records unless `partner_can_edit_client_data` is true.
8. Integration secrets never return to browser responses.
9. Audit logs are scoped correctly.

## Server-Side Rules

Every mutation should:

1. Resolve authenticated user.
2. Resolve membership/access context.
3. Validate input schema.
4. Confirm target row belongs to accessible partner/client.
5. Apply mutation.
6. Write audit event if sensitive.
7. Return only safe response fields.

## UI Rules

Do not show controls the user cannot use.

Also enforce permission on the server, because hidden buttons are not security.

For disabled controls, prefer clear explanations:

- "Client permission required."
- "Partner owner access required."
- "Live mode is paused."
- "Integration secrets can only be managed by admins."

