import type { RawCommit } from "./git/log.js";
import type { CompiledSignal, Rules, SignalKind } from "./rules.js";

export type Bucket = "agent" | "unattributed" | "automation" | "unknown-bot";

export interface Trailer {
  /** lowercased key */
  key: string;
  value: string;
  name: string;
  email: string;
}

export interface Commit extends RawCommit {
  isMerge: boolean;
  bucket: Bucket;
  /** agent ids, primary first */
  agents: string[];
  /** how the primary agent was found */
  kind: SignalKind | null;
  /** person key; the same for every commit by the same human */
  person: string;
}

const TRAILER = /^\s*([A-Za-z][A-Za-z0-9-]*)\s*:\s*(.+?)\s*$/;
const NAME_EMAIL = /^(.*?)\s*<([^>]*)>\s*$/;

/**
 * every `Key: value` line of the body, wherever it is: squash merges put co-authors in the middle.
 * The subject is skipped, `feat: x` is not a trailer.
 */
export function parseTrailers(message: string): Trailer[] {
  const out: Trailer[] = [];
  for (const line of message.split("\n").slice(1)) {
    const m = TRAILER.exec(line);
    if (!m) continue;
    const value = m[2] ?? "";
    const ne = NAME_EMAIL.exec(value);
    out.push({ key: (m[1] ?? "").toLowerCase(), value, name: ne ? (ne[1] ?? "") : value, email: ne ? (ne[2] ?? "") : "" });
  }
  return out;
}

const subjectOf = (message: string): string => message.split("\n", 1)[0] ?? "";

/** branch names a merge subject points at: as written, and without a leading owner segment */
export function branchCandidates(subject: string): string[] {
  let m = /^Merge pull request #\d+ from (\S+)/.exec(subject);
  if (m && m[1]) return [m[1], m[1].replace(/^[^/]+\//, "")];
  m = /^Merge (?:remote-tracking )?branch '(?:origin\/)?([^']+)'/.exec(subject);
  return m && m[1] ? [m[1]] : [];
}

export function branchAgent(subject: string, rules: Rules): string | null {
  const refs = branchCandidates(subject).map((b) => b.toLowerCase());
  for (const s of rules.signals) {
    if (s.kind === "branch" && s.prefix && refs.some((r) => r.startsWith(s.prefix as string))) return s.agentId;
  }
  return null;
}

function trailerMatches(s: CompiledSignal, t: Trailer): boolean {
  return (
    t.key === s.key &&
    (!s.nameRe || s.nameRe.test(t.name)) &&
    (!s.emailRe || s.emailRe.test(t.email)) &&
    (!s.re || s.re.test(t.value))
  );
}

function identityMatches(s: CompiledSignal, name: string, email: string): boolean {
  return (!s.nameRe || s.nameRe.test(name)) && (!s.emailRe || s.emailRe.test(email));
}

/** agents found in the commit itself (no branch rule), in precedence order */
export function matchAgents(c: RawCommit, rules: Rules, trailers: readonly Trailer[] = parseTrailers(c.message)): Map<string, SignalKind> {
  const hits = new Map<string, SignalKind>();
  for (const s of rules.signals) {
    if (hits.has(s.agentId)) continue;
    let ok = false;
    if (s.kind === "trailer") ok = trailers.some((t) => trailerMatches(s, t));
    else if (s.kind === "author") ok = identityMatches(s, c.authorName, c.authorEmail) || identityMatches(s, c.committerName, c.committerEmail);
    else if (s.kind === "message") ok = s.re !== undefined && s.re.test(c.message);
    if (ok) hits.set(s.agentId, s.kind);
  }
  return hits;
}

const normName = (n: string): string => n.trim().toLowerCase().replace(/\s+/g, " ");
const normEmail = (e: string): string => {
  const x = e.trim().toLowerCase();
  // 12345+login@users.noreply.github.com and login@users.noreply.github.com are the same account
  return x.replace(/^\d+\+(?=[^@]+@users\.noreply\.github\.com$)/, "");
};
/** emails many people share; they must not glue different names into one person */
const SHARED_EMAIL = /^(|noreply@github\.com|ai@local|root@localhost|you@example\.com|.*@localhost(\.localdomain)?)$/;

class People {
  private readonly parent = new Map<string, string>();

  private find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r) as string;
    let y = x;
    while (this.parent.get(y) !== r) {
      const next = this.parent.get(y) as string;
      this.parent.set(y, r);
      y = next;
    }
    return r;
  }

  add(name: string, email: string): void {
    const n = `n:${normName(name)}`;
    const e = normEmail(email);
    if (SHARED_EMAIL.test(e)) {
      this.find(n);
      return;
    }
    const a = this.find(n);
    const b = this.find(`e:${e}`);
    if (a !== b) this.parent.set(a, b);
  }

  key(name: string): string {
    return this.find(`n:${normName(name)}`);
  }
}

export interface ClassifyOptions {
  /** sha -> agent id, from merges of agent-prefixed branches */
  branchAgents?: ReadonlyMap<string, string>;
}

export function classify(raw: readonly RawCommit[], rules: Rules, opts: ClassifyOptions = {}): Commit[] {
  const branchAgents = opts.branchAgents ?? new Map<string, string>();
  const authorSignals = rules.signals.filter((s) => s.kind === "author");
  const trailerSignals = rules.signals.filter((s) => s.kind === "trailer");
  const isBotName = (name: string): boolean => rules.unknownBot.test(name) || rules.automation.test(name);
  // an agent identity of its own (Cursor Agent, copilot-swe-agent[bot]), as opposed to a person whose name an agent decorates
  const isAgentIdentity = (name: string, email: string): boolean =>
    authorSignals.some((s) => s.emailRe !== undefined && s.emailRe.test(email) && (!s.nameRe || s.nameRe.test(name)));
  const isHumanCoAuthor = (t: Trailer): boolean =>
    t.key === "co-authored-by" && t.email !== "" && !isBotName(t.name) && !trailerSignals.some((s) => trailerMatches(s, t));

  const people = new People();
  const parsed = raw.map((c) => {
    const trailers = parseTrailers(c.message);
    const botAuthor = isBotName(c.authorName) || isAgentIdentity(c.authorName, c.authorEmail);
    if (!botAuthor) people.add(c.authorName, c.authorEmail);
    const humans = trailers.filter(isHumanCoAuthor);
    for (const t of humans) people.add(t.name, t.email);
    return { c, trailers, botAuthor, humans };
  });

  return parsed.map(({ c, trailers, botAuthor, humans }): Commit => {
    const isMerge = c.parents.length > 1;
    const hits = matchAgents(c, rules, trailers);
    if (hits.size === 0) {
      const b = branchAgents.get(c.sha);
      if (b) hits.set(b, "branch");
    }
    const only = humans.length === 1 ? humans[0] : undefined;
    const person = botAuthor
      ? only
        ? people.key(only.name)
        : `bot:${normName(c.authorName)}`
      : people.key(c.authorName);
    const base = { ...c, isMerge, person };

    const kinds = [...hits.values()];
    if (
      kinds.length > 0 &&
      kinds.every((k) => k === "author") &&
      botAuthor &&
      rules.botChores !== null &&
      rules.botChores.test(subjectOf(c.message))
    ) {
      return { ...base, bucket: "automation", agents: [], kind: null };
    }
    if (hits.size > 0) return { ...base, bucket: "agent", agents: [...hits.keys()], kind: kinds[0] ?? null };
    if (rules.automation.test(c.authorName)) return { ...base, bucket: "automation", agents: [], kind: null };
    if (rules.unknownBot.test(c.authorName)) return { ...base, bucket: "unknown-bot", agents: [], kind: null };
    return { ...base, bucket: "unattributed", agents: [], kind: null };
  });
}
