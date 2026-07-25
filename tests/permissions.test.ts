import assert from "node:assert/strict";
import test from "node:test";

import { buildAccessContext } from "../lib/permissions/roles.ts";

test("managed-client partners can configure service but cannot operate customer actions", () => {
  const access = buildAccessContext({
    userId: "partner-user",
    role: "partner_owner",
    partnerId: "partner-id",
    clientId: "client-id",
    partnerCanEditClientData: true,
    accountKind: "managed_client",
  });

  assert.equal(access.canEditClientData, true);
  assert.equal(access.canManageIntegrations, true);
  assert.equal(access.canManageWorkflows, true);
  assert.equal(access.canResolveApprovals, false);
  assert.equal(access.canOperateCustomerActions, false);
  assert.equal(access.canEditCrmData, false);
});

test("partners can operate customer tools for their own agency business", () => {
  const access = buildAccessContext({
    userId: "partner-user",
    role: "partner_owner",
    partnerId: "partner-id",
    clientId: "agency-id",
    partnerCanEditClientData: true,
    accountKind: "partner_agency",
  });

  assert.equal(access.canResolveApprovals, true);
  assert.equal(access.canOperateCustomerActions, true);
  assert.equal(access.canEditCrmData, true);
});

test("authorized client staff retain control of their customer interactions", () => {
  const access = buildAccessContext({
    userId: "client-user",
    role: "client_manager",
    clientId: "client-id",
    accountKind: "managed_client",
  });

  assert.equal(access.canResolveApprovals, true);
  assert.equal(access.canOperateCustomerActions, true);
  assert.equal(access.canEditCrmData, true);
});

test("marketing staff only receive their assigned client sections", () => {
  const access = buildAccessContext({
    userId: "marketing-user",
    role: "client_staff",
    clientId: "client-id",
    accountKind: "managed_client",
    clientJobRole: "marketing",
  });

  assert.deepEqual(access.visibleClientSections, [
    "overview",
    "inbox",
    "marketing",
    "reports",
  ]);
  assert.equal(access.canViewActionCenter, false);
  assert.equal(access.canOperateCustomerActions, false);
  assert.equal(access.canEditCrmData, false);
});

test("client-owner overrides control authority as well as navigation", () => {
  const access = buildAccessContext({
    userId: "front-desk-user",
    role: "client_staff",
    clientId: "client-id",
    accountKind: "managed_client",
    clientJobRole: "front_desk",
    clientPermissions: {
      sections: ["inbox", "calls", "schedule", "approvals"],
      view_action_center: false,
      resolve_approvals: false,
      operate_customer_actions: true,
      edit_crm_data: true,
    },
  });

  assert.deepEqual(access.visibleClientSections, [
    "inbox",
    "calls",
    "schedule",
    "approvals",
  ]);
  assert.equal(access.canResolveApprovals, false);
  assert.equal(access.canOperateCustomerActions, true);
  assert.equal(access.canEditCrmData, true);
});

test("read-only support impersonation disables every mutation capability", () => {
  const access = buildAccessContext({
    userId: "owner-user",
    role: "platform_owner",
    partnerId: "partner-id",
    clientId: "client-id",
    partnerCanEditClientData: true,
    accountKind: "managed_client",
    impersonation: { id: "session-id", mode: "read_only" },
  });

  assert.equal(access.canEditClientData, false);
  assert.equal(access.canManageIntegrations, false);
  assert.equal(access.canManageWorkflows, false);
  assert.equal(access.canResolveApprovals, false);
  assert.equal(access.canOperateCustomerActions, false);
  assert.equal(access.canEditCrmData, false);
});

test("full sandbox client impersonation supports end-to-end test actions", () => {
  const access = buildAccessContext({
    userId: "owner-user",
    role: "client_owner",
    clientId: "test-client-id",
    accountKind: "managed_client",
    impersonation: { id: "session-id", mode: "sandbox_full" },
  });

  assert.equal(access.canResolveApprovals, true);
  assert.equal(access.canOperateCustomerActions, true);
  assert.equal(access.canEditCrmData, true);
});
