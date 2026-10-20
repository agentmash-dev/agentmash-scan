import { mkdtempSync, rmSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import type { Commit } from "../attribute.js";
import type { Rules } from "../rules.js";
import { hasMergeTree, runGit, type GitVersion } from "./run.js";

export interface ResolverCount {
  /** an agent name, "person" for a merge without an agent mark, "automation", or a bot's name */
  name: string;
  merges: number;
}

export interface MergeResult {
  /** merge commits in the period */
  total: number;
  /** two-parent merges that merge-tree reran */
  rerun: number;
  /** 3+ parents: git's octopus strategy refuses conflicting merges, so these were clean */
  octopus: number;
  /** a parent object is not in the repo; rerunning would abort the whole batch */
  missingParents: number;
  /** left unchecked when the time budget ran out */
  unchecked: number;
  conflicted: number;
  resolvers: ResolverCount[];
  /** why the merge pass did not run at all */
  skipped: null | "git-too-old";
  git: string;
}

export interface MergeInput {
  cwd: string;
  objectsDir: string;
  version: GitVersion;
  commits: readonly Commit[];
  rules: Rules;
  /** stop rerunning after this long; default 6000 ms */
  budgetMs?: number;
  /** parallel merge-tree processes; default one per core */
  parallel?: number;
}

interface BatchResult {
  /** per merge in batch order: true = conflicted; shorter than the batch when the budget cut it */
  statuses: boolean[];
}

/** `status\0tree\0path…\0\0` per merge; status 0 means conflicted (inverted against the exit code) */
export function parseMergeTreeBatch(out: string): boolean[] {
  // the last token is whatever follows the last NUL: empty for complete output, a fragment after a cut
  const parts = out.split("\0");
  const last = parts.length - 1;
  const statuses: boolean[] = [];
  let k = 0;
  while (k + 1 < last) {
    let end = k + 2;
    while (end < last && parts[end] !== "") end++;
    // complete only when the empty terminator of the path list arrived
    if (end >= last) break;
    statuses.push(parts[k] === "0");
    k = end + 1;
  }
  return statuses;
}

async function runBatch(cwd: string, objectsDir: string, pairs: readonly string[], signal: AbortSignal): Promise<BatchResult> {
  const temp = mkdtempSync(join(tmpdir(), "agentmash-scan-"));
  let out = "";
  try {
    await runGit(["merge-tree", "--write-tree", "--stdin", "-z", "--name-only", "--no-messages", "--allow-unrelated-histories"], {
      cwd,
      input: pairs.join("\n") + "\n",
      // merged trees and blobs go to a throwaway object dir; the scanned repo stays untouched
      env: { GIT_OBJECT_DIRECTORY: temp, GIT_ALTERNATE_OBJECT_DIRECTORIES: objectsDir },
      okCodes: [0, 1],
      onStdout: (s) => {
        out += s;
      },
      signal,
    });
  } catch (e) {
    if (!(e instanceof Error && e.name === "AbortError")) throw e;
  } finally {
    rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
  }
  return { statuses: parseMergeTreeBatch(out).slice(0, pairs.length) };
}

function resolverName(c: Commit, rules: Rules): string {
  if (c.bucket === "agent") return rules.agents.get(c.agents[0] ?? "") ?? c.agents[0] ?? "agent";
  if (c.bucket === "automation") return "automation";
  if (c.bucket === "unknown-bot") return c.authorName;
  return "person";
}

export async function checkMerges(input: MergeInput): Promise<MergeResult> {
  const merges = input.commits.filter((c) => c.isMerge);
  const octopus = merges.filter((c) => c.parents.length > 2).length;
  const two = merges.filter((c) => c.parents.length === 2);
  const base = { total: merges.length, octopus, git: input.version.text };
  if (!hasMergeTree(input.version)) {
    return { ...base, rerun: 0, missingParents: 0, unchecked: two.length, conflicted: 0, resolvers: [], skipped: "git-too-old" };
  }
  if (two.length === 0) {
    return { ...base, rerun: 0, missingParents: 0, unchecked: 0, conflicted: 0, resolvers: [], skipped: null };
  }

  const { stdout } = await runGit(["cat-file", "--batch-check"], { cwd: input.cwd, input: two.flatMap((c) => c.parents).join("\n") + "\n" });
  const missing = new Set(
    stdout
      .split("\n")
      .filter((l) => l.endsWith(" missing"))
      .map((l) => l.split(" ")[0]),
  );
  const feed = two.filter((c) => !c.parents.some((p) => missing.has(p)));

  const lanes = Math.max(1, Math.min(input.parallel ?? availableParallelism(), Math.ceil(feed.length / 16)));
  const batches: Commit[][] = Array.from({ length: lanes }, () => []);
  // round-robin, so one huge merge doesn't sit in front of a long queue
  feed.forEach((c, i) => (batches[i % lanes] as Commit[]).push(c));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.budgetMs ?? 6000);
  let results: BatchResult[];
  try {
    results = await Promise.all(batches.map((b) => runBatch(input.cwd, input.objectsDir, b.map((c) => c.parents.join(" ")), controller.signal)));
  } finally {
    clearTimeout(timer);
  }

  let rerun = 0;
  let conflicted = 0;
  const resolvers = new Map<string, number>();
  results.forEach((r, lane) => {
    const batch = batches[lane] as Commit[];
    r.statuses.forEach((isConflicted, i) => {
      rerun++;
      if (!isConflicted) return;
      conflicted++;
      const who = resolverName(batch[i] as Commit, input.rules);
      resolvers.set(who, (resolvers.get(who) ?? 0) + 1);
    });
  });
  return {
    ...base,
    rerun,
    missingParents: two.length - feed.length,
    unchecked: feed.length - rerun,
    conflicted,
    resolvers: [...resolvers]
      .map(([name, n]) => ({ name, merges: n }))
      .sort((a, b) => b.merges - a.merges || a.name.localeCompare(b.name)),
    skipped: null,
  };
}
