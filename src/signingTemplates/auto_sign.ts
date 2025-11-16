import { SigningTemplate } from "./types.js";

const autoSign: SigningTemplate = {
  id: "auto_sign",
  label: "Auto sign everything",
  description: "Always approve every signing request without additional checks.",
  evaluate: () => "SIGN",
};

export default autoSign;
