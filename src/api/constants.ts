import os from "node:os";
import path from "node:path";

export const DEFAULT_RELAYS = ["wss://relay.nsec.app", "wss://nos.lol"];
export const CONFIG_DIR = path.join(os.homedir(), ".intercessio");
export const KEY_FILE = path.join(CONFIG_DIR, "key.json");
