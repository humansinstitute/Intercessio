import { SigningTemplate } from "./types.js";

const loginRequiresApproval: SigningTemplate = {
  id: "login_requires_approval",
  label: "Login auto, others review",
  description: "Automatically approves kind 22242 login events while referring all other kinds for manual approval.",
  evaluate: ({ event }) => {
    if (event.kind === 22242) return "SIGN";
    return "REFER";
  },
};

export default loginRequiresApproval;
