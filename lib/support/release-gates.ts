export function codeRequestReadyForValidation(status: string | null | undefined) {
  return status == null || status === "ready";
}

export function supportReleaseCanComplete(input: {
  releaseStatus: string | null | undefined;
  codeRequestStatus: string | null | undefined;
}) {
  return (
    input.releaseStatus === "requester_approved" &&
    codeRequestReadyForValidation(input.codeRequestStatus)
  );
}
