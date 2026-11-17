import { readCalendarMutationPayload } from "@/lib/scheduling/calendar-mutation-rules";

const time = (value: string) => new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium", timeStyle: "short", timeZone: "UTC",
}).format(new Date(value));

export function CalendarChangePreview({ payload }: { payload: unknown }) {
  const change = readCalendarMutationPayload(payload);
  if (!change) return <p role="alert" className="mt-4 text-sm text-destructive">The appointment change details are unavailable. Reject this proposal and prepare a fresh review.</p>;
  return (
    <div className="mt-4 space-y-3 rounded-md border bg-secondary/30 p-4 text-sm">
      <dl className="space-y-2">
        <div><dt className="font-medium">Current appointment (UTC)</dt><dd>{time(change.old_slot.start_iso)} – {time(change.old_slot.end_iso)}</dd></div>
        {change.new_slot ? <div><dt className="font-medium">Proposed appointment (UTC)</dt><dd>{time(change.new_slot.start_iso)} – {time(change.new_slot.end_iso)}</dd></div>
          : <div><dt className="font-medium">Proposed change</dt><dd>Cancel this appointment.</dd></div>}
        <div><dt className="font-medium">Calendar</dt><dd>{change.provider === "northstar_internal" ? "Business calendar" : change.provider === "microsoft_365" ? "Microsoft calendar" : "Google Calendar"}</dd></div>
      </dl>
      <p className="text-muted-foreground">Approval authorizes this exact change. Current customer instructions, permissions and the source event are checked again before execution. Check the saved result before trying another change.</p>
    </div>
  );
}
