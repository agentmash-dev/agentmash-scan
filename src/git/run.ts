import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";

export class GitError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "GitError";
  }
}

export interface RunOptions {
  cwd: string;
  input?: string;
  env?: Record<string, string>;
  /** exit codes that count as success; default [0] */
  okCodes?: readonly number[];
  /** receives decoded stdout as it arrives instead of buffering it */
  onStdout?: (chunk: string) => void;
  signal?: AbortSignal;
}

export interface RunResult {
  stdout: string;
  exitCode: number;
}

/** -c flags that keep the output stable whatever the user's git config says */
const STABLE = ["-c", "core.quotepath=off", "-c", "log.showSignature=false", "-c", "color.ui=false"];

export function runGit(args: readonly string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", [...STABLE, ...args], {
      cwd: opts.cwd,
      // GIT_OPTIONAL_LOCKS=0: never take the index lock, the scan is read-only
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", ...opts.env },
      stdio: [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    const decoder = new StringDecoder("utf8");
    const out: string[] = [];
    const err: Buffer[] = [];
    if (!child.stdout || !child.stderr) {
      reject(new GitError("could not read git output", null, ""));
      return;
    }
    child.stdout.on("data", (b: Buffer) => {
      const s = decoder.write(b);
      if (opts.onStdout) opts.onStdout(s);
      else out.push(s);
    });
    child.stderr.on("data", (b: Buffer) => err.push(b));
    child.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") reject(new GitError("git is not installed or not on PATH", null, ""));
      else if (e.name === "AbortError") reject(e);
      else reject(new GitError(e.message, null, ""));
    });
    child.on("close", (code) => {
      const tail = decoder.end();
      if (opts.onStdout) {
        if (tail) opts.onStdout(tail);
      } else out.push(tail);
      const stderr = Buffer.concat(err).toString("utf8");
      const ok = opts.okCodes ?? [0];
      if (code !== null && ok.includes(code)) resolvePromise({ stdout: out.join(""), exitCode: code });
      else reject(new GitError(`git ${args[0] ?? ""} failed: ${stderr.trim().split("\n")[0] ?? ""}`, code, stderr));
    });
    if (opts.input !== undefined && child.stdin) {
      child.stdin.on("error", () => {
        // git can exit before reading all input (e.g. merge-tree on a fatal error); close reports it
      });
      child.stdin.end(opts.input);
    }
  });
}

export interface GitVersion {
  major: number;
  minor: number;
  patch: number;
  text: string;
}

export async function gitVersion(cwd: string): Promise<GitVersion> {
  const { stdout } = await runGit(["--version"], { cwd });
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(stdout);
  if (!m) throw new GitError(`cannot read the git version from "${stdout.trim()}"`, 0, "");
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3] ?? 0), text: `${m[1]}.${m[2]}.${m[3] ?? 0}` };
}

/** git merge-tree --write-tree arrived in git 2.38 */
export const hasMergeTree = (v: GitVersion): boolean => v.major > 2 || (v.major === 2 && v.minor >= 38);

export interface RepoInfo {
  /** directory name of the work tree, or of the bare repo without .git */
  name: string;
  gitDir: string;
  objectsDir: string;
  bare: boolean;
  shallow: boolean;
  /** commits whose parents were cut by a shallow clone */
  shallowBoundary: ReadonlySet<string>;
}

export async function repoInfo(cwd: string): Promise<RepoInfo> {
  let lines: string[];
  try {
    const { stdout } = await runGit(
      ["rev-parse", "--absolute-git-dir", "--is-bare-repository", "--is-shallow-repository", "--git-path", "objects", "--git-path", "shallow"],
      { cwd },
    );
    lines = stdout.trim().split("\n");
  } catch (e) {
    if (e instanceof GitError && e.exitCode !== null) throw new GitError("not a git repository", e.exitCode, e.stderr);
    throw e;
  }
  const [gitDir = "", bare = "", shallow = "", objects = "", shallowPath = ""] = lines;
  const isBare = bare === "true";
  let name: string;
  if (isBare) {
    name = basename(gitDir).replace(/\.git$/, "");
  } else {
    const { stdout } = await runGit(["rev-parse", "--show-toplevel"], { cwd });
    name = basename(stdout.trim());
  }
  const shallowFile = resolve(cwd, shallowPath);
  const boundary =
    shallow === "true" && existsSync(shallowFile)
      ? new Set(readFileSync(shallowFile, "utf8").split("\n").map((l) => l.trim()).filter(Boolean))
      : new Set<string>();
  return {
    name,
    gitDir,
    objectsDir: resolve(cwd, objects),
    bare: isBare,
    shallow: shallow === "true",
    shallowBoundary: boundary,
  };
}

export interface ResolvedRef {
  sha: string;
  /** what to print: the branch name, or "HEAD" when detached */
  label: string;
}

export async function resolveRef(cwd: string, ref: string | undefined): Promise<ResolvedRef> {
  const rev = ref ?? "HEAD";
  let sha: string;
  try {
    const { stdout } = await runGit(["rev-parse", "--verify", "--quiet", "--end-of-options", `${rev}^{commit}`], { cwd });
    sha = stdout.trim();
  } catch (e) {
    if (e instanceof GitError && e.exitCode !== null) {
      throw new GitError(ref ? `branch or commit "${ref}" not found` : "the repository has no commits yet", e.exitCode, e.stderr);
    }
    throw e;
  }
  if (ref) return { sha, label: ref };
  try {
    const { stdout } = await runGit(["symbolic-ref", "--short", "-q", "HEAD"], { cwd });
    return { sha, label: stdout.trim() || "HEAD" };
  } catch {
    return { sha, label: "HEAD" };
  }
}
