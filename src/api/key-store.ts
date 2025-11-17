import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { nip19, generateSecretKey, getPublicKey } from "nostr-tools";
import { normalizeToSecretKey } from "applesauce-core/helpers";

import { CONFIG_DIR } from "./constants.js";
import { PromptSession } from "./prompts.js";
import { log } from "./logger.js";
import { fetchSecretFromKeychain, storeSecretInKeychainWithStorageType, getStorageType, deleteSecretFromKeychain } from "./keychain.js";

const KEY_LIST_FILE = path.join(CONFIG_DIR, "keys.json");
const STATE_FILE = path.join(CONFIG_DIR, "state.json");

export type KeyStorageType = "keychain" | "kwallet" | "gnome-keyring" | "file";

export type KeyMetadata = {
  id: string;
  label: string;
  npub: string;
  createdAt: string;
  keychainAccount: string;
  storage: KeyStorageType;
};

type KeyState = {
  activeKeyId?: string;
};

async function ensureConfigDir() {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

async function readJsonFile<T>(file: string): Promise<T | null> {
  try {
    const data = await fs.readFile(file, "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(file: string, data: any) {
  await ensureConfigDir();
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf-8");
}

export async function listKeys(): Promise<KeyMetadata[]> {
  const keys = (await readJsonFile<KeyMetadata[]>(KEY_LIST_FILE)) ?? [];
  return keys.map((key) => ({
    ...key,
    storage: key.storage ?? "keychain",
  }));
}

async function saveKeys(keys: KeyMetadata[]) {
  await writeJsonFile(KEY_LIST_FILE, keys);
}

async function readState(): Promise<KeyState> {
  return (await readJsonFile<KeyState>(STATE_FILE)) ?? {};
}

async function writeState(state: KeyState) {
  await writeJsonFile(STATE_FILE, state);
}

export async function getActiveKeyId(): Promise<string | undefined> {
  const state = await readState();
  return state.activeKeyId;
}

export async function setActiveKeyId(id: string) {
  await writeState({ activeKeyId: id });
}

async function persistSecret(secretKey: Uint8Array, label: string, storage?: KeyStorageType) {
  const keys = await listKeys();
  const id = nanoid(10);
  const npub = nip19.npubEncode(getPublicKey(secretKey));
  const nsec = nip19.nsecEncode(secretKey);
  const keychainAccount = `intercessio-${id}`;

  // Store the secret and get the actual storage type used
  const { storageType } = await storeSecretInKeychainWithStorageType(keychainAccount, nsec);

  // Use the actual storage type if not specified, otherwise use what was actually used
  const actualStorage = storage || storageType;

  const metadata: KeyMetadata = {
    id,
    label,
    npub,
    createdAt: new Date().toISOString(),
    keychainAccount,
    storage: actualStorage,
  };
  await saveKeys([...keys, metadata]);
  await setActiveKeyId(metadata.id);

  log.success("Stored key material");
  console.log(`  label: ${metadata.label}`);
  console.log(`  npub: ${metadata.npub}`);
  return metadata;
}

export async function createKey(label?: string): Promise<KeyMetadata> {
  const keys = await listKeys();
  const defaultLabel = `Key ${keys.length + 1}`;
  const finalLabel = label?.trim() || defaultLabel;
  log.success("Generated new key pair");
  return persistSecret(generateSecretKey(), finalLabel);
}

export async function importKey(secretInput: string, label?: string): Promise<KeyMetadata> {
  const trimmed = secretInput.trim();
  if (!trimmed) throw new Error("Private key material is required.");
  const secretKey = normalizeToSecretKey(trimmed);
  const keys = await listKeys();
  const defaultLabel = `Imported Key ${keys.length + 1}`;
  const finalLabel = label?.trim() || defaultLabel;
  log.success("Imported provided key");
  return persistSecret(secretKey, finalLabel);
}

export async function createKeyInteractive(prompter: PromptSession): Promise<KeyMetadata> {
  const keys = await listKeys();
  const defaultLabel = `Key ${keys.length + 1}`;
  const label = (await prompter.input("Label for this key", defaultLabel)).trim() || defaultLabel;
  return createKey(label);
}

export async function importKeyInteractive(prompter: PromptSession): Promise<KeyMetadata> {
  const keys = await listKeys();
  const defaultLabel = `Imported Key ${keys.length + 1}`;
  const label = (await prompter.input("Label for this key", defaultLabel)).trim() || defaultLabel;

  let input = (await prompter.input("Enter your private key (nsec... or 64-char hex)", "")).trim();
  while (!input) {
    input = (await prompter.input("Private key is required. Paste it", "")).trim();
  }

  return importKey(input, label);
}

export async function getKeyRecordById(id: string): Promise<{ meta: KeyMetadata; secret: string } | null> {
  const keys = await listKeys();
  const meta = keys.find((k) => k.id === id);
  if (!meta) return null;
  const secret = await fetchSecretFromKeychain(meta.keychainAccount);
  return { meta, secret };
}

export async function getActiveKeyRecord(): Promise<{ meta: KeyMetadata; secret: string } | null> {
  const activeId = await getActiveKeyId();
  if (!activeId) return null;
  const record = await getKeyRecordById(activeId);
  if (record) return record;
  const keys = await listKeys();
  if (keys.length === 0) return null;
  const fallback = keys[0];
  await setActiveKeyId(fallback.id);
  const secret = await fetchSecretFromKeychain(fallback.keychainAccount);
  return { meta: fallback, secret };
}

export async function showStoredKeyStatus() {
  const keys = await listKeys();
  if (keys.length === 0) {
    log.warn("No keys stored yet.");
    return;
  }
  const activeId = await getActiveKeyId();
  console.log("Stored keys:");
  for (const key of keys) {
    const activeMarker = key.id === activeId ? "*" : " ";
    const storageLabel = key.storage === "keychain" ? "Keychain" :
                        key.storage === "kwallet" ? "KDE Wallet" :
                        key.storage === "gnome-keyring" ? "GNOME Keyring" :
                        key.storage === "file" ? "File" : key.storage;
    console.log(`${activeMarker} [${storageLabel}] ${key.label} (${key.npub}) - created ${key.createdAt}`);
  }
  console.log("* indicates the active key used by subcommands.");
}

export async function deleteKey(id: string): Promise<void> {
  const keys = await listKeys();
  const keyIndex = keys.findIndex((k) => k.id === id);
  if (keyIndex === -1) {
    throw new Error(`Key with id ${id} not found`);
  }
  
  const keyToDelete = keys[keyIndex];
  
  // Delete the secret from keychain
  await deleteSecretFromKeychain(keyToDelete.keychainAccount);
  
  // Remove from key list
  keys.splice(keyIndex, 1);
  await saveKeys(keys);
  
  // If this was the active key, clear the active selection
  const activeId = await getActiveKeyId();
  if (activeId === id) {
    // If there are other keys, set the first one as active
    if (keys.length > 0) {
      await setActiveKeyId(keys[0].id);
    } else {
      // No keys left, clear active key
      const state = await readState();
      delete state.activeKeyId;
      await writeState(state);
    }
  }
  
  log.success(`Deleted key: ${keyToDelete.label} (${keyToDelete.npub})`);
}

export function formatPubkey(pubkey: string) {
  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return pubkey;
  }
}
