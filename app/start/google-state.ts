export type GoogleWorkspaceState = {
  status: "idle" | "error" | "complete";
  message?: string;
  destination?: "/client/onboarding" | "/client" | "/partner" | "/control";
  clearGuest?: boolean;
};
export const initialGoogleWorkspaceState: GoogleWorkspaceState = { status: "idle" };
