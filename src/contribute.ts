import type { ScanResult } from "./scan.js";

/** the page that shows the counts and sends them only when the person presses Send */
export const CONTRIBUTE_URL = "https://agentmash.dev/scan/report";

export const QUESTION = "Add your anonymous counts to the monthly agent collision report? (y/N) ";

/** aggregates only: no paths, no repo name, no people, not even bot names */
export interface Contribution {
  v: 1;
  tool: string;
  rules: string;
  days: number;
  windowHours: number;
  commits: { total: number; agent: number; unattributed: number; automation: number; unknownBots: number };
  agents: Record<string, number>;
  overlaps: { agentAgent: number; agentHuman: number };
  merges: { total: number; conflicted: number };
}

export function contribution(r: ScanResult): Contribution {
  return {
    v: 1,
    tool: r.tool.version,
    rules: r.tool.rules,
    days: r.period.days,
    windowHours: r.overlaps.windowHours,
    commits: {
      total: r.commits.nonMerge,
      agent: r.commits.agent,
      unattributed: r.commits.unattributed,
      automation: r.commits.automation,
      unknownBots: r.commits.unknownBots.reduce((n, b) => n + b.commits, 0),
    },
    // only agents from the bundled rules; a --agent-bot name could identify a company
    agents: Object.fromEntries(r.agents.filter((a) => !a.id.startsWith("bot:")).map((a) => [a.name, a.commits])),
    overlaps: { agentAgent: r.overlaps.agentAgent, agentHuman: r.overlaps.agentHuman },
    merges: { total: r.merges.total, conflicted: r.merges.conflicted },
  };
}

/** the counts ride in the URL fragment, which browsers never send to a server */
export function contributeUrl(c: Contribution): string {
  return `${CONTRIBUTE_URL}#${Buffer.from(JSON.stringify(c)).toString("base64url")}`;
}

export interface AskContext {
  stdinTTY: boolean;
  stdoutTTY: boolean;
  env: Record<string, string | undefined>;
  json: boolean;
  contribute: boolean;
}

/** ask once, at the end, only when a person is at the keyboard */
export function shouldAsk(ctx: AskContext): boolean {
  return ctx.stdinTTY && ctx.stdoutTTY && !ctx.json && !ctx.contribute && !ctx.env["CI"] && ctx.env["AGENTMASH_SCAN_NO_ASK"] === undefined;
}

export const isYes = (answer: string | null): boolean => answer !== null && /^\s*y(es)?\s*$/i.test(answer);
