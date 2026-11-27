import type { ActionJobRecord } from "../jobs/record";
/** A conversation reply written by a signed-in person, not prepared by an agent assignment. */
export function isPersonAuthoredReply(job: Pick<ActionJobRecord, "kind" | "approval_id" | "payload">) {
  return job.kind === "conversation.send" &&
    !!job.approval_id &&
    job.payload.human_authored === true &&
    (job.payload.agent_work_id === null || job.payload.agent_work_id === undefined);
}
