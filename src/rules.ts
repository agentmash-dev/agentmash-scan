import { readFileSync } from "node:fs";

export type SignalKind = "trailer" | "author" | "message" | "branch";

const KINDS: readonly SignalKind[] = ["trailer", "author", "message", "branch"];

export interface SignalSpec {
  kind: SignalKind;
  status: "verified" | "unverified";
  evidence: string[];
  key?: string;
  name_pattern?: string;
  email_pattern?: string;
  pattern?: string;
  flags?: string;
  prefix?: string;
  example?: string;
  note?: string;
}

export interface AgentSpec {
  id: string;
  name: string;
  signals: SignalSpec[];
}

export interface RulesFile {
  schema: 1;
  updated: string;
  agents: AgentSpec[];
  automation: { name_pattern: string };
  unknown_bot: { name_pattern: string };
  bot_chores?: { subject_pattern: string };
  noise: { path_pattern: string; max_files_per_commit: number };
}

export interface CompiledSignal {
  agentId: string;
  kind: SignalKind;
  key?: string;
  nameRe?: RegExp;
  emailRe?: RegExp;
  re?: RegExp;
  prefix?: string;
}

export interface Rules {
  /** the `updated` date of the rules file, printed in --json so numbers can be traced to a rules version */
  version: string;
  /** agent id -> display name, in file order */
  agents: ReadonlyMap<string, string>;
  /** verified signals only, ordered trailer > author > message > branch, file order within a kind */
  signals: readonly CompiledSignal[];
  automation: RegExp;
  unknownBot: RegExp;
  botChores: RegExp | null;
  noisePath: RegExp;
  maxFilesPerCommit: number;
}

export const DEFAULT_RULES_URL = new URL("../data/attribution.json", import.meta.url);

export function loadRulesFile(path: string | URL = DEFAULT_RULES_URL): RulesFile {
  return parseRulesFile(JSON.parse(readFileSync(path, "utf8")));
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function str(v: unknown, where: string): string {
  if (typeof v !== "string" || v === "") throw new Error(`attribution rules: ${where} must be a non-empty string`);
  return v;
}

function optStr(v: unknown, where: string): string | undefined {
  return v === undefined ? undefined : str(v, where);
}

function pattern(v: unknown, where: string): string {
  const s = str(v, where);
  try {
    new RegExp(s);
  } catch (e) {
    throw new Error(`attribution rules: ${where} is not a valid regex: ${(e as Error).message}`);
  }
  return s;
}

function optPattern(v: unknown, where: string): string | undefined {
  return v === undefined ? undefined : pattern(v, where);
}

function parseSignal(raw: unknown, where: string): SignalSpec {
  if (!isRecord(raw)) throw new Error(`attribution rules: ${where} must be an object`);
  const kind = raw["kind"];
  if (typeof kind !== "string" || !KINDS.includes(kind as SignalKind)) {
    throw new Error(`attribution rules: ${where}.kind must be one of ${KINDS.join(", ")}`);
  }
  const status = raw["status"];
  if (status !== "verified" && status !== "unverified") {
    throw new Error(`attribution rules: ${where}.status must be "verified" or "unverified"`);
  }
  const evidence = raw["evidence"];
  if (!Array.isArray(evidence) || !evidence.every((e) => typeof e === "string")) {
    throw new Error(`attribution rules: ${where}.evidence must be a list of URLs`);
  }
  if (status === "verified" && evidence.length === 0) {
    throw new Error(`attribution rules: ${where} is verified but has no evidence`);
  }
  const s: SignalSpec = { kind: kind as SignalKind, status, evidence: evidence as string[] };
  const key = optStr(raw["key"], `${where}.key`);
  const namePattern = optPattern(raw["name_pattern"], `${where}.name_pattern`);
  const emailPattern = optPattern(raw["email_pattern"], `${where}.email_pattern`);
  const pat = optPattern(raw["pattern"], `${where}.pattern`);
  const flags = optStr(raw["flags"], `${where}.flags`);
  const prefix = optStr(raw["prefix"], `${where}.prefix`);
  if (key !== undefined) s.key = key;
  if (namePattern !== undefined) s.name_pattern = namePattern;
  if (emailPattern !== undefined) s.email_pattern = emailPattern;
  if (pat !== undefined) s.pattern = pat;
  if (flags !== undefined) s.flags = flags;
  if (prefix !== undefined) s.prefix = prefix;
  if (s.kind === "trailer" && s.key === undefined) throw new Error(`attribution rules: ${where} is a trailer without a key`);
  if (s.kind === "branch" && s.prefix === undefined) throw new Error(`attribution rules: ${where} is a branch rule without a prefix`);
  if (s.kind === "message" && s.pattern === undefined) throw new Error(`attribution rules: ${where} is a message rule without a pattern`);
  if (s.kind === "author" && s.name_pattern === undefined && s.email_pattern === undefined) {
    throw new Error(`attribution rules: ${where} is an author rule without name_pattern or email_pattern`);
  }
  return s;
}

export function parseRulesFile(raw: unknown): RulesFile {
  if (!isRecord(raw)) throw new Error("attribution rules: the file must be a JSON object");
  if (raw["schema"] !== 1) throw new Error("attribution rules: unsupported schema (expected 1)");
  const agentsRaw = raw["agents"];
  if (!Array.isArray(agentsRaw)) throw new Error("attribution rules: agents must be a list");
  const ids = new Set<string>();
  const agents = agentsRaw.map((a, i): AgentSpec => {
    if (!isRecord(a)) throw new Error(`attribution rules: agents[${i}] must be an object`);
    const id = str(a["id"], `agents[${i}].id`);
    if (ids.has(id)) throw new Error(`attribution rules: duplicate agent id ${id}`);
    ids.add(id);
    const signals = a["signals"];
    if (!Array.isArray(signals)) throw new Error(`attribution rules: agents[${i}].signals must be a list`);
    return {
      id,
      name: str(a["name"], `agents[${i}].name`),
      signals: signals.map((s, j) => parseSignal(s, `${id}.signals[${j}]`)),
    };
  });
  const automation = raw["automation"];
  const unknownBot = raw["unknown_bot"];
  const botChores = raw["bot_chores"];
  const noise = raw["noise"];
  if (!isRecord(automation)) throw new Error("attribution rules: automation must be an object");
  if (!isRecord(unknownBot)) throw new Error("attribution rules: unknown_bot must be an object");
  if (!isRecord(noise)) throw new Error("attribution rules: noise must be an object");
  const maxFiles = noise["max_files_per_commit"];
  if (typeof maxFiles !== "number" || !Number.isInteger(maxFiles) || maxFiles < 1) {
    throw new Error("attribution rules: noise.max_files_per_commit must be a positive integer");
  }
  const file: RulesFile = {
    schema: 1,
    updated: str(raw["updated"], "updated"),
    agents,
    automation: { name_pattern: pattern(automation["name_pattern"], "automation.name_pattern") },
    unknown_bot: { name_pattern: pattern(unknownBot["name_pattern"], "unknown_bot.name_pattern") },
    noise: { path_pattern: pattern(noise["path_pattern"], "noise.path_pattern"), max_files_per_commit: maxFiles },
  };
  if (botChores !== undefined) {
    if (!isRecord(botChores)) throw new Error("attribution rules: bot_chores must be an object");
    file.bot_chores = { subject_pattern: pattern(botChores["subject_pattern"], "bot_chores.subject_pattern") };
  }
  return file;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Compiles the verified signals. `agentBots` are bot author names the user asked to count as agents
 * (`--agent-bot keppo-bot[bot]`); each becomes its own agent named after the bot.
 */
export function compileRules(file: RulesFile, agentBots: readonly string[] = []): Rules {
  const agents = new Map<string, string>();
  const signals: CompiledSignal[] = [];
  const specs: AgentSpec[] = [
    ...file.agents,
    ...agentBots.map((bot) => ({
      id: `bot:${bot}`,
      name: bot.replace(/\[bot\]$/i, ""),
      signals: [{ kind: "author" as const, status: "verified" as const, evidence: ["--agent-bot"], name_pattern: `^${escapeRe(bot)}$` }],
    })),
  ];
  for (const a of specs) {
    agents.set(a.id, a.name);
    for (const s of a.signals) {
      if (s.status !== "verified") continue;
      const c: CompiledSignal = { agentId: a.id, kind: s.kind };
      if (s.key !== undefined) c.key = s.key.toLowerCase();
      if (s.name_pattern !== undefined) c.nameRe = new RegExp(s.name_pattern, "i");
      if (s.email_pattern !== undefined) c.emailRe = new RegExp(s.email_pattern, "i");
      if (s.pattern !== undefined) c.re = new RegExp(s.pattern, s.flags ?? "i");
      if (s.prefix !== undefined) c.prefix = s.prefix.toLowerCase();
      signals.push(c);
    }
  }
  const rank = (k: SignalKind): number => KINDS.indexOf(k);
  // Array.prototype.sort is stable, so file order survives inside a kind
  signals.sort((x, y) => rank(x.kind) - rank(y.kind));
  return {
    version: file.updated,
    agents,
    signals,
    automation: new RegExp(file.automation.name_pattern, "i"),
    unknownBot: new RegExp(file.unknown_bot.name_pattern, "i"),
    botChores: file.bot_chores ? new RegExp(file.bot_chores.subject_pattern, "i") : null,
    noisePath: new RegExp(file.noise.path_pattern),
    maxFilesPerCommit: file.noise.max_files_per_commit,
  };
}
