import { DEFAULT_RELAYS } from "./constants.js";

function cleanupRelay(url: string) {
  let value = url.trim();
  if (!value) return "";
  if (!/^wss?:\/\//i.test(value)) value = `wss://${value}`;
  return value.replace(/\/+$/, "");
}

export function normalizeRelays(relays?: string[]): string[] {
  const list = relays?.length ? relays : DEFAULT_RELAYS;
  const cleaned = list.map(cleanupRelay).filter(Boolean);
  return Array.from(new Set(cleaned));
}
