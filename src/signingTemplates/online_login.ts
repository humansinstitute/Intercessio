import { SigningTemplate } from "./types.js";

const loginOnly: SigningTemplate = {
  id: "online_login",
  label: "Logins only",
  description: "Only approve Nostr Connect login requests. All other kinds are rejected.",
  evaluate: ({ event }) => {
    if (event.kind === 22242) return "SIGN";
    return "REJECT";
  },
};

export default loginOnly;
