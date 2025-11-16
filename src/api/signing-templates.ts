import { getSigningTemplate, listSigningTemplates, DEFAULT_TEMPLATE_ID } from "../signingTemplates/index.js";
import type { SigningTemplate } from "../signingTemplates/types.js";

export { DEFAULT_TEMPLATE_ID };

export type SigningTemplateSummary = {
  id: string;
  label: string;
  description: string;
};

export function getTemplateById(id?: string): SigningTemplate {
  return getSigningTemplate(id ?? DEFAULT_TEMPLATE_ID);
}

export function listTemplateSummaries(): SigningTemplateSummary[] {
  return listSigningTemplates().map(({ id, label, description }) => ({ id, label, description }));
}

export { type SigningTemplate };
