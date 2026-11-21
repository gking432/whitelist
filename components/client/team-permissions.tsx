"use client";

import { useState, useTransition } from "react";
import { ShieldCheck, UserPlus } from "lucide-react";

import {
  inviteClientTeamMember,
  updateClientTeamMemberAccess,
} from "@/app/client/team/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  CLIENT_JOB_ROLES,
  CLIENT_SECTION_KEYS,
  CLIENT_SECTION_LABELS,
  permissionsForJobRole,
  resolveClientPermissions,
  type ClientJobRole,
  type ClientSectionKey,
} from "@/lib/permissions/client-sections";
import type { ClientRole } from "@/lib/permissions/types";

export type ClientTeamMember = {
  id: string;
  user_id: string;
  role: ClientRole;
  status: string;
  client_job_role: string | null;
  client_permissions: Record<string, unknown> | null;
  profile: {
    email: string | null;
    full_name: string | null;
  } | null;
};

const EDITABLE_JOB_ROLES = CLIENT_JOB_ROLES.filter(
  (role) => role !== "owner",
);
const SECTION_OPTIONS = CLIENT_SECTION_KEYS.filter(
  (section) => section !== "action-center",
);

const JOB_ROLE_LABELS: Record<ClientJobRole, string> = {
  owner: "Owner",
  manager: "Manager",
  sales: "Sales",
  front_desk: "Front desk",
  marketing: "Marketing",
  staff: "Staff",
  viewer: "Viewer",
};

function Toggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-primary"
      />
      <span>{label}</span>
    </label>
  );
}

function MemberAccessForm({ member }: { member: ClientTeamMember }) {
  const resolved = resolveClientPermissions({
    role: member.role,
    jobRole: member.client_job_role,
    stored: member.client_permissions ?? {},
  });
  const [jobRole, setJobRole] = useState<ClientJobRole>(resolved.jobRole);
  const [status, setStatus] = useState(
    member.status === "disabled" ? "disabled" : "active",
  );
  const [sections, setSections] = useState<ClientSectionKey[]>(
    resolved.visibleSections.filter(
      (section) => section !== "action-center",
    ),
  );
  const [canViewActionCenter, setCanViewActionCenter] = useState(
    resolved.canViewActionCenter,
  );
  const [canResolveApprovals, setCanResolveApprovals] = useState(
    resolved.canResolveApprovals,
  );
  const [canOperateCustomerActions, setCanOperateCustomerActions] = useState(
    resolved.canOperateCustomerActions,
  );
  const [canEditCrmData, setCanEditCrmData] = useState(
    resolved.canEditCrmData,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const applyTemplate = (nextRole: ClientJobRole) => {
    const defaults = permissionsForJobRole(nextRole);
    setJobRole(nextRole);
    setSections(
      defaults.visibleSections.filter(
        (section) => section !== "action-center",
      ),
    );
    setCanViewActionCenter(defaults.canViewActionCenter);
    setCanResolveApprovals(defaults.canResolveApprovals);
    setCanOperateCustomerActions(defaults.canOperateCustomerActions);
    setCanEditCrmData(defaults.canEditCrmData);
  };

  const toggleSection = (section: ClientSectionKey, checked: boolean) => {
    setSections((current) =>
      checked
        ? [...new Set([...current, section])]
        : current.filter((candidate) => candidate !== section),
    );
  };

  return (
    <form
      className="border-t px-4 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const response = await updateClientTeamMemberAccess({
            membershipId: member.id,
            jobRole,
            status,
            sections,
            canViewActionCenter,
            canResolveApprovals,
            canOperateCustomerActions,
            canEditCrmData,
          });
          setMessage(response.message ?? null);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium">
          Role
          <Select
            value={jobRole}
            onChange={(event) =>
              applyTemplate(event.target.value as ClientJobRole)
            }
          >
            {EDITABLE_JOB_ROLES.map((role) => (
              <option key={role} value={role}>
                {JOB_ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 text-xs font-medium">
          Account status
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </Select>
        </label>
      </div>

      <p className="mt-4 text-[10px] font-semibold uppercase text-muted-foreground">
        Visible CRM sections
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {SECTION_OPTIONS.map((section) => (
          <Toggle
            key={section}
            checked={sections.includes(section)}
            label={CLIENT_SECTION_LABELS[section]}
            onChange={(checked) => toggleSection(section, checked)}
          />
        ))}
      </div>

      <p className="mt-4 text-[10px] font-semibold uppercase text-muted-foreground">
        Authority
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Toggle
          checked={canViewActionCenter}
          label="View Action Center"
          onChange={setCanViewActionCenter}
        />
        <Toggle
          checked={canResolveApprovals}
          label="Resolve approvals"
          onChange={setCanResolveApprovals}
        />
        <Toggle
          checked={canOperateCustomerActions}
          label="Perform customer actions"
          onChange={setCanOperateCustomerActions}
        />
        <Toggle
          checked={canEditCrmData}
          label="Edit CRM records"
          onChange={setCanEditCrmData}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{message}</p>
        <Button type="submit" size="sm" disabled={pending}>
          <ShieldCheck aria-hidden="true" />
          {pending ? "Saving..." : "Save access"}
        </Button>
      </div>
    </form>
  );
}

export function ClientTeamPermissions({
  members,
  canManage,
}: {
  members: ClientTeamMember[];
  canManage: boolean;
}) {
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="border-b px-5 py-4">
        <h2 className="text-sm font-semibold">Team access</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Roles control both visible sections and customer-facing authority.
        </p>
      </div>

      {canManage ? (
        <form
          className="grid gap-3 border-b bg-secondary/20 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_12rem_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            const formElement = event.currentTarget;
            const form = new FormData(formElement);

            startTransition(async () => {
              const response = await inviteClientTeamMember({
                fullName: String(form.get("full_name") ?? ""),
                email: String(form.get("email") ?? ""),
                jobRole: String(form.get("job_role") ?? ""),
              });
              setInviteMessage(response.message ?? null);
              if (response.status === "success") formElement.reset();
            });
          }}
        >
          <Input name="full_name" placeholder="Employee name" required />
          <Input
            name="email"
            type="email"
            placeholder="Work email"
            required
          />
          <Select name="job_role" defaultValue="staff">
            {EDITABLE_JOB_ROLES.map((role) => (
              <option key={role} value={role}>
                {JOB_ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
          <Button type="submit" disabled={pending}>
            <UserPlus aria-hidden="true" />
            Invite
          </Button>
          {inviteMessage ? (
            <p className="text-xs text-muted-foreground sm:col-span-full">
              {inviteMessage}
            </p>
          ) : null}
        </form>
      ) : null}

      {members.length === 0 ? (
        <p className="px-5 py-8 text-sm text-muted-foreground">
          Team members will appear here after they are added.
        </p>
      ) : (
        <div className="divide-y">
          {members.map((member) => (
            <div key={member.id}>
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">
                    {member.profile?.full_name ?? "Team member"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {member.profile?.email ?? "No email available"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">
                    {JOB_ROLE_LABELS[resolveClientPermissions({
                      role: member.role,
                      jobRole: member.client_job_role,
                      stored: member.client_permissions ?? {},
                    }).jobRole]}
                  </Badge>
                  <Badge variant="outline">{member.status}</Badge>
                </div>
              </div>
              {canManage && member.role !== "client_owner" ? (
                <MemberAccessForm member={member} />
              ) : null}
              {member.role === "client_owner" ? (
                <p className="border-t px-4 py-3 text-xs text-muted-foreground">
                  The business owner always retains full access.
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
