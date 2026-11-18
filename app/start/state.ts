export type FirstOwnerFormState = { status: "idle" | "error"; message?: string; fields?: Record<string, string> };
export const initialFirstOwnerFormState: FirstOwnerFormState = { status: "idle" };
