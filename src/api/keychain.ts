import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { createHash, randomBytes, createCipheriv, createDecipheriv, scrypt } from "node:crypto";
import { hostname, platform, userInfo } from "node:os";

const execFileAsync = promisify(execFile);
const SERVICE_NAME = "intercessio";

// Fallback storage for systems without native key managers
const FALLBACK_DIR = path.join(process.env.HOME || process.env.USERPROFILE || "", ".intercessio");
const FALLBACK_FILE = path.join(FALLBACK_DIR, "secrets.json");
const SALT_FILE = path.join(FALLBACK_DIR, "salt");

// Proper encryption with PBKDF2 for fallback storage
async function encrypt(text: string, key: string): Promise<string> {
  const salt = await getOrCreateSalt();
  const iv = randomBytes(16);
  const derivedKey = await deriveKey(key, salt);
  const cipher = createCipheriv('aes-256-cbc', derivedKey, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return salt.toString('hex') + ':' + iv.toString('hex') + ':' + encrypted;
}

async function decrypt(encryptedText: string, key: string): Promise<string> {
  const parts = encryptedText.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted data format');
  
  const salt = Buffer.from(parts[0], 'hex');
  const iv = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  const derivedKey = await deriveKey(key, salt);
  const decipher = createDecipheriv('aes-256-cbc', derivedKey, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Derive encryption key using scrypt with salt
async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

// Get or create a random salt for key derivation
async function getOrCreateSalt(): Promise<Buffer> {
  try {
    await fs.mkdir(FALLBACK_DIR, { recursive: true });
    const existingSalt = await fs.readFile(SALT_FILE);
    return existingSalt;
  } catch {
    const salt = randomBytes(32);
    await fs.writeFile(SALT_FILE, salt);
    return salt;
  }
}

// Get a machine-specific key for encryption (still deterministic but better than before)
function getMachineKey(): string {
  const host = hostname() || 'unknown';
  const plat = platform() || 'unknown';
  const user = userInfo().username || 'unknown';
  const uid = process.getuid?.() || process.env.USERID || 'unknown';
  return createHash('sha256').update(`${host}-${plat}-${user}-${uid}-intercessio-v1`).digest('hex');
}

async function runSecurity(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("security", args);
    return stdout?.toString() ?? "";
  } catch (error: any) {
    if (error) {
      error.message =
        error?.stderr?.toString().trim() ||
        error?.stdout?.toString().trim() ||
        error.message ||
        "Unknown security command error";
    }
    throw error;
  }
}

// Fallback file-based storage functions
async function readFallbackSecrets(): Promise<Record<string, string>> {
  try {
    await fs.mkdir(FALLBACK_DIR, { recursive: true });
    const data = await fs.readFile(FALLBACK_FILE, 'utf8');
    const encrypted = JSON.parse(data);
    const machineKey = getMachineKey();
    const decrypted: Record<string, string> = {};
    
    for (const [account, encryptedSecret] of Object.entries(encrypted)) {
      try {
        decrypted[account] = await decrypt(encryptedSecret as string, machineKey);
      } catch {
        // Skip if decryption fails
      }
    }
    
    return decrypted;
  } catch {
    return {};
  }
}

async function writeFallbackSecrets(secrets: Record<string, string>): Promise<void> {
  await fs.mkdir(FALLBACK_DIR, { recursive: true });
  const machineKey = getMachineKey();
  const encrypted: Record<string, string> = {};
  
  for (const [account, secret] of Object.entries(secrets)) {
    encrypted[account] = await encrypt(secret, machineKey);
  }
  
  await fs.writeFile(FALLBACK_FILE, JSON.stringify(encrypted, null, 2), 'utf8');
}

// Check if we're on macOS and security command is available
async function isMacOSKeychainAvailable(): Promise<boolean> {
  return process.platform === 'darwin';
}

// Check if KDE Wallet (kwallet) is available
async function isKWalletAvailable(): Promise<boolean> {
  if (process.platform !== 'linux') return false;
  try {
    // Check if kwallet-query is available
    await execFileAsync("which", ["kwallet-query"]);
    return true;
  } catch {
    return false;
  }
}

// Check if GNOME Keyring (secret-tool) is available
async function isGnomeKeyringAvailable(): Promise<boolean> {
  if (process.platform !== 'linux') return false;
  try {
    // Check if secret-tool is available
    await execFileAsync("which", ["secret-tool"]);
    return true;
  } catch {
    return false;
  }
}

// KDE Wallet functions
async function runKWallet(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("kwallet-query", args);
    return stdout?.toString() ?? "";
  } catch (error: any) {
    if (error) {
      error.message =
        error?.stderr?.toString().trim() ||
        error?.stdout?.toString().trim() ||
        error.message ||
        "Unknown kwallet-query command error";
    }
    throw error;
  }
}

// GNOME Keyring functions
async function runSecretTool(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("secret-tool", args);
    return stdout?.toString() ?? "";
  } catch (error: any) {
    if (error) {
      error.message =
        error?.stderr?.toString().trim() ||
        error?.stdout?.toString().trim() ||
        error.message ||
        "Unknown secret-tool command error";
    }
    throw error;
  }
}

export async function storeSecretInKeychain(account: string, secret: string): Promise<void> {
  if (await isMacOSKeychainAvailable()) {
    try {
      await runSecurity(["add-generic-password", "-a", account, "-s", SERVICE_NAME, "-w", secret, "-U"]);
      return;
    } catch (error) {
      // Fallback to file storage if keychain fails
      console.warn('Failed to store in macOS keychain, falling back to encrypted file storage');
    }
  }
  
  // Fallback to encrypted file storage
  const secrets = await readFallbackSecrets();
  secrets[account] = secret;
  await writeFallbackSecrets(secrets);
}

export async function getStorageType(): Promise<"keychain" | "file"> {
  return (await isMacOSKeychainAvailable()) ? "keychain" : "file";
}

export async function fetchSecretFromKeychain(account: string): Promise<string> {
  if (await isMacOSKeychainAvailable()) {
    try {
      const stdout = await runSecurity(["find-generic-password", "-a", account, "-s", SERVICE_NAME, "-w"]);
      return stdout.trim();
    } catch (error) {
      // Fallback to file storage if keychain fails
      console.warn('Failed to fetch from macOS keychain, falling back to encrypted file storage');
    }
  }
  
  // Fallback to encrypted file storage
  const secrets = await readFallbackSecrets();
  const secret = secrets[account];
  if (!secret) {
    throw new Error(`Secret not found for account: ${account}`);
  }
  return secret;
}

export async function deleteSecretFromKeychain(account: string): Promise<void> {
  if (await isMacOSKeychainAvailable()) {
    try {
      await runSecurity(["delete-generic-password", "-a", account, "-s", SERVICE_NAME]);
      return;
    } catch (error: any) {
      if (error?.code !== 44) {
        // If it's not a "not found" error, try fallback
        console.warn('Failed to delete from macOS keychain, falling back to encrypted file storage');
      } else {
        // Item not found in keychain, try fallback
        console.warn('Secret not found in macOS keychain, checking fallback storage');
      }
    }
  }
  
  // Fallback to encrypted file storage
  const secrets = await readFallbackSecrets();
  delete secrets[account];
  await writeFallbackSecrets(secrets);
}
