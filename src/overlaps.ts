import type { Commit } from "./attribute.js";
import { runGit } from "./git/run.js";
import type { Rules } from "./rules.js";

export interface HotFile {
  path: string;
  overlaps: number;
}

export interface OverlapResult {
  windowHours: number;
  /** (file, commit) pairs where two different agent actors touched the file within the window */
  agentAgent: number;
  /** the same with one side an Unattributed commit by a different person */
  agentHuman: number;
  hottest: HotFile[];
}

export interface OverlapInput {
  commits: readonly Commit[];
  rules: Rules;
  windowHours: number;
  /** paths marked linguist-generated in .gitattributes */
  generated?: ReadonlySet<string>;
  /** how many hottest files to keep; default 5 */
  top?: number;
}

interface Event {
  time: number;
  /** position in history, older first; breaks ties between equal author times */
  order: number;
  commit: Commit;
}

const isAgent = (c: Commit): boolean => c.bucket === "agent";
const actor = (c: Commit): string => `${c.agents[0] ?? ""}|${c.person}`;

export function countOverlaps(input: OverlapInput): OverlapResult {
  const { rules } = input;
  const windowSeconds = Math.round(input.windowHours * 3600);
  const generated = input.generated ?? new Set<string>();
  const byFile = new Map<string, Event[]>();
  const n = input.commits.length;
  input.commits.forEach((c, i) => {
    if (c.isMerge || c.boundary) return;
    if (c.bucket === "automation" || c.bucket === "unknown-bot") return;
    if (c.files.length > rules.maxFilesPerCommit) return;
    // git log lists newest first
    const ev: Event = { time: c.authorTime, order: n - i, commit: c };
    for (const f of c.files) {
      if (rules.noisePath.test(f) || generated.has(f)) continue;
      let list = byFile.get(f);
      if (!list) byFile.set(f, (list = []));
      list.push(ev);
    }
  });

  let agentAgent = 0;
  let agentHuman = 0;
  const hot = new Map<string, number>();
  for (const [path, events] of byFile) {
    if (events.length < 2) continue;
    events.sort((a, b) => a.time - b.time || a.order - b.order);
    for (let j = 1; j < events.length; j++) {
      const b = (events[j] as Event).commit;
      let aa = false;
      let ah = false;
      for (let i = j - 1; i >= 0; i--) {
        const ev = events[i] as Event;
        if (b.authorTime - ev.time > windowSeconds) break;
        const a = ev.commit;
        if (isAgent(a) && isAgent(b)) {
          if (actor(a) !== actor(b)) aa = true;
        } else if ((isAgent(a) || isAgent(b)) && a.person !== b.person) {
          if (a.bucket === "unattributed" || b.bucket === "unattributed") ah = true;
        }
        if (aa && ah) break;
      }
      if (aa) {
        agentAgent++;
        hot.set(path, (hot.get(path) ?? 0) + 1);
      }
      if (ah) agentHuman++;
    }
  }
  const hottest = [...hot]
    .map(([path, overlaps]) => ({ path, overlaps }))
    .sort((a, b) => b.overlaps - a.overlaps || a.path.localeCompare(b.path))
    .slice(0, input.top ?? 5);
  return { windowHours: input.windowHours, agentAgent, agentHuman, hottest };
}

/**
 * Paths the repo marks `linguist-generated` (GitHub's convention for generated code).
 * Reads .gitattributes from the work tree; a bare repo or any error gives an empty set.
 */
export async function generatedPaths(cwd: string, paths: Iterable<string>): Promise<Set<string>> {
  const list = [...new Set(paths)];
  const out = new Set<string>();
  if (list.length === 0) return out;
  try {
    const { stdout } = await runGit(["check-attr", "-z", "--stdin", "linguist-generated"], {
      cwd,
      input: list.join("\0") + "\0",
      env: { GIT_LITERAL_PATHSPECS: "1" },
    });
    const parts = stdout.split("\0");
    for (let i = 0; i + 2 < parts.length; i += 3) {
      const value = parts[i + 2];
      if (value === "set" || value === "true") out.add(parts[i] as string);
    }
  } catch {
    // no work tree or an old git: fall back to the path patterns alone
  }
  return out;
}
