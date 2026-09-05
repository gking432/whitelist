export function agencyLaunchSteps(input: {
  branded: boolean;
  packageCount: number;
  firstClient: { id: string; name: string; live: boolean } | null;
}) {
  return [
    {
      title: "Make it your agency",
      detail:
        "Upload your logo, choose your colors and set the name clients will see.",
      done: input.branded,
      href: "/partner/settings",
      action: "Set up your brand",
    },
    {
      title: "Choose what you sell",
      detail:
        "Use a ready-made offer, then rename it and adapt the services to your clients.",
      done: input.packageCount > 0,
      href: "/partner/packages",
      action: "Choose an offer",
    },
    {
      title: "Invite your first business",
      detail:
        "Tell us what the business uses today. They keep their CRM or choose the built-in one.",
      done: Boolean(input.firstClient),
      href: "/partner/clients/new",
      action: "Add your first client",
    },
    {
      title: "Guide the client to launch",
      detail: input.firstClient
        ? `Finish ${input.firstClient.name}’s connections, try the workflows and review the launch checklist together.`
        : "The client connects their own accounts and approves customer-facing actions; you guide the setup.",
      done: input.firstClient?.live ?? false,
      href: input.firstClient
        ? `/partner/clients/${input.firstClient.id}/setup`
        : "/partner/clients/new",
      action: "Continue client setup",
    },
  ];
}
