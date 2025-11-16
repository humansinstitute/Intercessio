import fs from "node:fs";
import path from "node:path";

import type { SigningTemplate } from "./types.js";

const EXCLUDED_BASENAMES = new Set(["index", "types"]);
const ALLOWED_EXTENSIONS = new Set([".js", ".ts"]);
const DEFAULT_FALLBACK_ID = "auto_sign";

function isSigningTemplate(candidate: any): candidate is SigningTemplate {
  return (
    candidate &&
    typeof candidate.id === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.description === "string" &&
    typeof candidate.evaluate === "function"
  );
}

async function loadTemplates(): Promise<SigningTemplate[]> {
  const dir = path.resolve(import.meta.dir);
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .filter((entry) => ALLOWED_EXTENSIONS.has(path.extname(entry.name)))
    .filter((entry) => !EXCLUDED_BASENAMES.has(path.parse(entry.name).name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const imports = await Promise.all(
    files.map(async (entry) => {
      const modulePath = new URL(entry.name, `file://${dir}/`).href;
      try {
        const mod = await import(modulePath);
        return isSigningTemplate(mod.default) ? mod.default : null;
      } catch {
        return null;
      }
    }),
  );

  const templates = imports.filter((tpl): tpl is SigningTemplate => Boolean(tpl));
  if (!templates.length) {
    throw new Error("No signing templates found.");
  }
  return templates;
}

const templates = await loadTemplates();
const templateMap = new Map(templates.map((template) => [template.id, template]));
const defaultTemplate = templateMap.get(DEFAULT_FALLBACK_ID) ?? templates[0]!;

export const DEFAULT_TEMPLATE_ID = defaultTemplate.id;

export function listSigningTemplates() {
  return templates.map((template) => ({ ...template }));
}

export function getSigningTemplate(id: string): SigningTemplate {
  return templateMap.get(id) ?? defaultTemplate;
}

export type { SigningTemplate };
