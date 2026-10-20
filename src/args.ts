import { parseArgs } from "node:util";
import type { ScanOptions } from "./scan.js";

export const HELP = `Count how often your AI coding agents stepped on each other's files.

Usage: npx agentmash-scan [path] [options]

  --days <n>          period to scan (default 90)
  --window <time>     how close two changes must be: 6h, 24h, 3d, 90m (default 24h)
  --branch <name>     branch or commit to scan (default the current branch)
  --json              print the numbers as JSON
  --card              save scan.png (1200x675, X) and scan-1080x1350.png (Instagram, LinkedIn)
  --share             open a post on X with your number
  --show-repo         put the repository name on the card and in the post
  --agent-bot <name>  count a bot author as an agent, e.g. --agent-bot "keppo-bot[bot]"
  -v, --version       print the version
  -h, --help          print this help

Runs on your machine. Reads git history only; nothing leaves the machine.
`;

export class UsageError extends Error {}

export function parseWindow(text: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(m|h|d)?$/i.exec(text.trim());
  if (!m) throw new UsageError(`--window must look like 6h, 24h, 3d or 90m (got "${text}")`);
  const n = Number(m[1]);
  const unit = (m[2] ?? "h").toLowerCase();
  const hours = unit === "m" ? n / 60 : unit === "d" ? n * 24 : n;
  if (!(hours > 0)) throw new UsageError("--window must be longer than zero");
  return hours;
}

export function parseDays(text: string): number {
  const n = Number(text);
  if (!/^\d+(\.\d+)?$/.test(text.trim()) || !(n > 0)) throw new UsageError(`--days must be a positive number (got "${text}")`);
  return n;
}

export interface Cli {
  options: ScanOptions;
  json: boolean;
  card: boolean;
  share: boolean;
  showRepo: boolean;
  help: boolean;
  version: boolean;
}

export function parseCli(argv: readonly string[]): Cli {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        days: { type: "string" },
        window: { type: "string" },
        branch: { type: "string" },
        json: { type: "boolean" },
        card: { type: "boolean" },
        share: { type: "boolean" },
        "show-repo": { type: "boolean" },
        "agent-bot": { type: "string", multiple: true },
        version: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
  const { values, positionals } = parsed;
  if (positionals.length > 1) throw new UsageError("give at most one repository path");
  const options: ScanOptions = {};
  if (positionals[0] !== undefined) options.cwd = positionals[0];
  if (values.days !== undefined) options.days = parseDays(values.days);
  if (values.window !== undefined) options.windowHours = parseWindow(values.window);
  if (values.branch !== undefined) options.branch = values.branch;
  if (values["agent-bot"]?.length) options.agentBots = values["agent-bot"];
  const now = process.env["AGENTMASH_SCAN_NOW"];
  if (now) options.now = new Date(now);
  return {
    options,
    json: values.json ?? false,
    card: values.card ?? false,
    share: values.share ?? false,
    showRepo: values["show-repo"] ?? false,
    help: values.help ?? false,
    version: values.version ?? false,
  };
}
