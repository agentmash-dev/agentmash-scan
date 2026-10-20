import { runGit } from "./run.js";

export interface RawCommit {
  sha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  committerName: string;
  committerEmail: string;
  /** unix seconds */
  authorTime: number;
  /** unix seconds */
  commitTime: number;
  message: string;
  /** paths changed against the first parent; empty for merges and shallow-boundary commits */
  files: string[];
  /** the commit's parents were cut by a shallow clone, so its file list is unknown */
  boundary: boolean;
}

const RS = "\x1e";
const US = "\x1f";
// %aN/%aE/%cN/%cE apply .mailmap
const FORMAT = `--format=${RS}%H${US}%P${US}%aN${US}%aE${US}%cN${US}%cE${US}%at${US}%ct${US}%B${US}`;

/** `git log` wants a date it can parse in every version; this form has been stable for years */
export const gitDate = (unix: number): string => {
  const d = new Date(unix * 1000);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
};

export function parseRecord(rec: string, boundary: ReadonlySet<string>): RawCommit | null {
  const f = rec.split(US);
  if (f.length < 10) return null;
  const sha = f[0] ?? "";
  // %B may in theory contain the separator; everything between the fixed fields and the tail is the message
  const message = f.slice(8, -1).join(US).replace(/\s+$/, "");
  const tail = f[f.length - 1] ?? "";
  const isBoundary = boundary.has(sha);
  const files = isBoundary
    ? []
    : tail
        .split("\0")
        .map((s) => s.replace(/^\n/, ""))
        .filter((s) => s !== "");
  return {
    sha,
    parents: f[1] ? f[1].split(" ").filter(Boolean) : [],
    authorName: f[2] ?? "",
    authorEmail: f[3] ?? "",
    committerName: f[4] ?? "",
    committerEmail: f[5] ?? "",
    authorTime: Number(f[6]),
    commitTime: Number(f[7]),
    message,
    files,
    boundary: isBoundary,
  };
}

export interface LogOptions {
  /** a commit sha; resolve names with resolveRef first */
  sha: string;
  /** keep commits with a committer time at or after this unix second */
  since: number;
  /** stop after this many commits (the speed check uses it) */
  limit?: number;
  shallowBoundary?: ReadonlySet<string>;
}

export async function readLog(cwd: string, opts: LogOptions): Promise<RawCommit[]> {
  const boundary = opts.shallowBoundary ?? new Set<string>();
  const commits: RawCommit[] = [];
  let buf = "";
  const take = (chunk: string): void => {
    for (const rec of chunk.split(RS)) {
      if (!rec) continue;
      const c = parseRecord(rec, boundary);
      // --since stops near the boundary but lets a few older commits through (clock skew slop); drop them here
      if (c && c.commitTime >= opts.since) commits.push(c);
    }
  };
  const args = ["log", "-z", "--no-renames", "--name-only", "--no-ext-diff", "--no-color", FORMAT];
  if (opts.limit !== undefined) args.push(`--max-count=${opts.limit}`);
  else args.push(`--since=${gitDate(opts.since)}`);
  args.push(opts.sha, "--");
  await runGit(args, {
    cwd,
    onStdout: (s) => {
      buf += s;
      const cut = buf.lastIndexOf(RS);
      if (cut > 0) {
        take(buf.slice(0, cut));
        buf = buf.slice(cut);
      }
    },
  });
  take(buf);
  return commits;
}
