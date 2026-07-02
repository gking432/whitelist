export type LoginActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export const initialLoginActionState: LoginActionState = {
  status: "idle",
  message: "",
};
