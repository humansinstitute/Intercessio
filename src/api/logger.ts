import chalk from "chalk";

export const log = {
  info: (message: string, extra?: string) => {
    console.log(`${chalk.cyan("[info]")} ${message}${extra ? ` ${extra}` : ""}`);
  },
  warn: (message: string) => console.log(`${chalk.yellow("[warn]")} ${message}`),
  success: (message: string) => console.log(`${chalk.green("[ok]")} ${message}`),
  error: (message: string) => console.error(`${chalk.red("[err]")} ${message}`),
};
