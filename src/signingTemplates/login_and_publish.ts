import { SigningTemplate } from "./types.js";

const loginAndPublish: SigningTemplate = {
  id: "login_and_publish",
  label: "Login + publish",
  description:
    "Always sign login events and kind 1 notes. Profile updates are rejected. All other kinds require manual review.",
  evaluate: ({ event }) => {
    if (event.kind === 22242) return "SIGN";
    if (event.kind === 1) return "SIGN";
    if (event.kind === 0) return "REJECT";
    return "REFER";
  },
};

export default loginAndPublish;
