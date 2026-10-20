import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import { branchAgent, classify, type Commit } from "./attribute.js";
import { readLog } from "./git/log.js";
import { gitVersion, repoInfo, resolveRef, runGit, type RepoInfo } from "./git/run.js";
import { countOverlaps, generatedPaths, type OverlapResult } from "./overlaps.js";
import { compileRules, loadRulesFile, type Rules, type RulesFile } from "./rules.js";
import { VERSION } from "./version.js";

export interface ScanOptions {
  /** repository directory; default process.cwd() */
  cwd?: string;
  /** period in days; default 90 */
  days?: number;
  /** overlap window in hours; default 24 */
  windowHours?: number;
  /** branch or commit to scan; default the current HEAD */
  branch?: string;
  /** "now" for the period; tests pin it */
  now?: Date;
  /** read the newest N commits instead of a period (speed checks) */
  limit?: number;
  /** rules file; default the bundled data/attribution.json */
  rules?: RulesFile;
  /** bot author names to count as agents */
  agentBots?: readonly string[];
}

export interface AgentCount {
  id: string;
  name: string;
  commits: number;
}

export interface ScanResult {
  schema: 1;
  tool: { name: "agentmash-scan"; version: string; rules: string };
  repo: { name: string; branch: string; shallow: boolean };
  period: { days: number; since: string; until: string };
  commits: {
    total: number;
    merges: number;
    nonMerge: number;
    agent: number;
    unattributed: number;
    automation: number;
    unknownBots: { name: string; commits: number }[];
    multiAgent: number;
    shallowBoundary: number;
  };
  agents: AgentCount[];
  overlaps: OverlapResult;
  timingsMs: Record<string, number>;
}

export interface ScanContext {
  cwd: string;
  info: RepoInfo;
  rules: Rules;
  commits: Commit[];
}

export async function collect(opts: ScanOptions = {}): Promise<ScanContext & { result: ScanResult }> {
  const t0 = performance.now();
  const cwd = resolve(opts.cwd ?? process.cwd());
  const days = opts.days ?? 90;
  if (!(days > 0)) throw new RangeError("days must be a positive number");
  const windowHours = opts.windowHours ?? 24;
  if (!(windowHours > 0)) throw new RangeError("the window must be a positive number of hours");
  const now = opts.now ?? new Date();
  const until = Math.floor(now.getTime() / 1000);
  const since = opts.limit !== undefined ? 0 : until - Math.round(days * 86400);
  const rules = compileRules(opts.rules ?? loadRulesFile(), opts.agentBots ?? []);

  const [info, ref] = await Promise.all([repoInfo(cwd), resolveRef(cwd, opts.branch), gitVersion(cwd)]);
  const t1 = performance.now();
  const raw = await readLog(cwd, {
    sha: ref.sha,
    since,
    shallowBoundary: info.shallowBoundary,
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
  });
  const t2 = performance.now();

  // commits brought in by merges of agent-prefixed branches (codex/…, claude/…)
  const inWindow = new Set(raw.map((c) => c.sha));
  const branchAgents = new Map<string, string>();
  for (const c of raw) {
    if (c.parents.length !== 2) continue;
    const agent = branchAgent(c.message.split("\n", 1)[0] ?? "", rules);
    if (!agent) continue;
    const { stdout } = await runGit(["rev-list", `${c.parents[0]}..${c.parents[1]}`, "--"], { cwd });
    for (const sha of stdout.split("\n")) {
      if (sha && inWindow.has(sha) && !branchAgents.has(sha)) branchAgents.set(sha, agent);
    }
  }
  const commits = classify(raw, rules, { branchAgents });
  const t3 = performance.now();

  // only files an agent touched can be in an overlap, so only those need the .gitattributes lookup
  const agentFiles = commits.filter((c) => c.bucket === "agent" && !c.isMerge).flatMap((c) => c.files);
  const generated = info.bare ? new Set<string>() : await generatedPaths(info.root, agentFiles);
  const overlaps = countOverlaps({ commits, rules, windowHours, generated });
  const t4 = performance.now();

  const nonMerge = commits.filter((c) => !c.isMerge);
  const perAgent = new Map<string, number>();
  const bots = new Map<string, number>();
  for (const c of nonMerge) {
    const primary = c.agents[0];
    if (c.bucket === "agent" && primary) perAgent.set(primary, (perAgent.get(primary) ?? 0) + 1);
    if (c.bucket === "unknown-bot") bots.set(c.authorName, (bots.get(c.authorName) ?? 0) + 1);
  }
  const count = (b: Commit["bucket"]): number => nonMerge.filter((c) => c.bucket === b).length;
  const byCountThenName = <T extends { name: string }>(get: (x: T) => number) => (a: T, b: T) =>
    get(b) - get(a) || a.name.localeCompare(b.name);

  const result: ScanResult = {
    schema: 1,
    tool: { name: "agentmash-scan", version: VERSION, rules: rules.version },
    repo: { name: info.name, branch: ref.label, shallow: info.shallow },
    period: { days, since: new Date(since * 1000).toISOString(), until: new Date(until * 1000).toISOString() },
    commits: {
      total: commits.length,
      merges: commits.length - nonMerge.length,
      nonMerge: nonMerge.length,
      agent: count("agent"),
      unattributed: count("unattributed"),
      automation: count("automation"),
      unknownBots: [...bots].map(([name, n]) => ({ name, commits: n })).sort(byCountThenName((x) => x.commits)),
      multiAgent: nonMerge.filter((c) => c.agents.length > 1).length,
      shallowBoundary: commits.filter((c) => c.boundary).length,
    },
    agents: [...perAgent]
      .map(([id, n]) => ({ id, name: rules.agents.get(id) ?? id, commits: n }))
      .sort(byCountThenName((x) => x.commits)),
    overlaps,
    timingsMs: {
      setup: Math.round(t1 - t0),
      log: Math.round(t2 - t1),
      attribution: Math.round(t3 - t2),
      overlaps: Math.round(t4 - t3),
    },
  };
  return { cwd, info, rules, commits, result };
}

export async function scan(opts: ScanOptions = {}): Promise<ScanResult> {
  return (await collect(opts)).result;
}
