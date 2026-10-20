#!/usr/bin/env node
import { GitError } from "./git/run.js";
import { DEFAULT_COMMAND, formatReport, toJSON } from "./report.js";
import { HELP, parseCli, UsageError, type Cli } from "./args.js";
import { scan } from "./scan.js";
import { VERSION } from "./version.js";

const useColor = (): boolean => process.stdout.isTTY === true && !("NO_COLOR" in process.env) && process.env["TERM"] !== "dumb";

export async function main(argv: readonly string[]): Promise<number> {
  let cli: Cli;
  try {
    cli = parseCli(argv);
  } catch (e) {
    process.stderr.write(`agentmash-scan: ${(e as Error).message}\nRun with --help for the options.\n`);
    return 2;
  }
  if (cli.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (cli.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  try {
    const result = await scan(cli.options);
    process.stdout.write(cli.json ? toJSON(result) : formatReport(result, { color: useColor(), command: DEFAULT_COMMAND }));
    return 0;
  } catch (e) {
    if (e instanceof GitError) {
      const hint = e.message === "not a git repository" ? " (run it inside a repo, or pass the repo's path)" : "";
      process.stderr.write(`agentmash-scan: ${e.message}${hint}\n`);
      return 1;
    }
    if (e instanceof RangeError || e instanceof UsageError) {
      process.stderr.write(`agentmash-scan: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`agentmash-scan: unexpected error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    process.exitCode = 1;
  },
);
