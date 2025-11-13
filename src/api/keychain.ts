import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SERVICE_NAME = "intercessio";

async function runSecurity(args: string[]) {
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

export async function storeSecretInKeychain(account: string, secret: string) {
  await runSecurity(["add-generic-password", "-a", account, "-s", SERVICE_NAME, "-w", secret, "-U"]);
}

export async function fetchSecretFromKeychain(account: string) {
  const stdout = await runSecurity(["find-generic-password", "-a", account, "-s", SERVICE_NAME, "-w"]);
  return stdout.trim();
}

export async function deleteSecretFromKeychain(account: string) {
  try {
    await runSecurity(["delete-generic-password", "-a", account, "-s", SERVICE_NAME]);
  } catch (error: any) {
    if (error?.code !== 44) throw error;
  }
}
