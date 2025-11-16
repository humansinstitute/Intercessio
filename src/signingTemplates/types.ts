import { EventTemplate } from "nostr-tools";

export type SigningDecision = "SIGN" | "REFER" | "REJECT";

export type SessionSummary = {
  id: string;
  alias?: string;
  type: "bunker" | "nostr-connect";
};

export type SigningContext = {
  event: EventTemplate;
  client: string;
  session: SessionSummary;
};

export type SigningTemplate = {
  id: string;
  label: string;
  description: string;
  evaluate: (context: SigningContext) => SigningDecision;
};
