import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import chalk from "chalk";

export interface PromptSession {
  input(question: string, defaultValue?: string): Promise<string>;
  confirm(question: string, defaultValue?: boolean): Promise<boolean>;
  close(): void;
}

export function createPromptSession(): PromptSession {
  const rl = readline.createInterface({ input, output, terminal: true });

  return {
    async input(question: string, defaultValue?: string) {
      const suffix = defaultValue ? chalk.dim(` (${defaultValue}) `) : " ";
      const answer = (await rl.question(`${question}${suffix}`)).trim();
      if (!answer && typeof defaultValue === "string") return defaultValue;
      return answer;
    },
    async confirm(question: string, defaultValue = false) {
      const suffix = defaultValue ? chalk.dim(" [Y/n] ") : chalk.dim(" [y/N] ");
      const answer = (await rl.question(`${question}${suffix}`)).trim().toLowerCase();
      if (!answer) return defaultValue;
      return ["y", "yes"].includes(answer);
    },
    close() {
      rl.close();
    },
  };
}

export function parseListInput(input: string, fallback: string[]): string[] {
  const entries = input
    .split(/[, \n]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  return entries.length ? Array.from(new Set(entries)) : fallback;
}
