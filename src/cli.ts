#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { contribution, contributeUrl, isYes, QUESTION, shouldAsk } from "./contribute.js";
import { GitError } from "./git/run.js";
import { DEFAULT_COMMAND, formatReport, toJSON } from "./report.js";
import { HELP, parseCli, UsageError, type Cli } from "./args.js";
import { scan } from "./scan.js";
import { openUrl, shareText, shareUrl } from "./share.js";
import { VERSION } from "./version.js";

const useColor = (): boolean => process.stdout.isTTY === true && !("NO_COLOR" in process.env) && process.env["TERM"] !== "dumb";

/** one line from the terminal; Enter, Ctrl+D or Ctrl+C all mean no */
async function question(prompt: string): Promise<string | null> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await Promise.race([rl.question(prompt), new Promise<null>((resolve) => rl.once("close", () => resolve(null)))]);
  } catch {
    return null;
  } finally {
    rl.close();
  }
}

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
    // with --json, stdout stays pure JSON and everything else goes to stderr
    const say = (s: string): void => {
      (cli.json ? process.stderr : process.stdout).write(s);
    };
    const look = { showRepo: cli.showRepo, command: DEFAULT_COMMAND };
    if (cli.card) {
      const { writeCards } = await import("./card/render.js");
      const [landscape, portrait] = await writeCards(result, process.cwd(), look);
      say(`\nCard saved: ${landscape} (1200x675, X) and ${portrait} (1080x1350, Instagram, LinkedIn)\n`);
    }
    const open = async (url: string): Promise<boolean> => process.env["BROWSER"] !== "none" && (await openUrl(url));
    if (cli.share) {
      const url = shareUrl(shareText(result, look));
      say((await open(url)) ? `\nYour post is open in the browser. If it isn't: ${url}\n` : `\nPost it from here: ${url}\n`);
    }
    const ask = shouldAsk({ stdinTTY: process.stdin.isTTY === true, stdoutTTY: process.stdout.isTTY === true, env: process.env, json: cli.json, contribute: cli.contribute });
    if (cli.contribute || (ask && isYes(await question(`\n${QUESTION}`)))) {
      const url = contributeUrl(contribution(result));
      const opened = await open(url);
      say(
        `${opened ? "\nOpened agentmash.dev with your counts." : `\nYour counts are ready here: ${url}`}\n` +
          "It holds commits per agent, overlaps, conflicted merges and the period. No paths, repo names or people.\n" +
          "Nothing is sent until you press Send on that page.\n",
      );
    }
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
