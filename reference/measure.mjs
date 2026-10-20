#!/usr/bin/env node
// Discovery-only measurement script. Not the product: no tests, rough on purpose.
// usage: node reference/measure.mjs <repo> [--days 90] [--rules data/attribution.json] [--limit N] [--json]
// Prints per-repo numbers used in reference/DISCOVERY.md. Read-only on the repo:
// merge-tree writes its trees into a temporary object directory, never into <repo>.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? def : argv[i + 1];
};
const repo = resolve(argv[0]);
const days = Number(opt("days", 90));
const limit = opt("limit", null);
const rulesPath = opt("rules", new URL("../data/attribution.json", import.meta.url).pathname);
const asJson = argv.includes("--json");

const git = (args, extra = {}) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 30, ...extra });

// ---------- rules ----------
const rules = JSON.parse(readFileSync(rulesPath, "utf8"));
const KIND_RANK = { trailer: 0, author: 1, message: 2, branch: 3 };
const compiled = [];
for (const a of rules.agents) {
  for (const s of a.signals) {
    if (s.status !== "verified") continue;
    const c = { agent: a.name, kind: s.kind, s };
    if (s.name_pattern) c.nameRe = new RegExp(s.name_pattern, "i");
    if (s.email_pattern) c.emailRe = new RegExp(s.email_pattern, "i");
    if (s.pattern) c.re = new RegExp(s.pattern, s.flags ?? "i");
    compiled.push(c);
  }
}
compiled.sort((x, y) => KIND_RANK[x.kind] - KIND_RANK[y.kind]);
const automationRe = new RegExp(rules.automation?.name_pattern ?? "^(dependabot|renovate|github-actions)(\\[bot\\])?$", "i");
const unknownBotRe = new RegExp(rules.unknown_bot?.name_pattern ?? "(\\[bot\\]|[-_ ]bot)$", "i");

function parseTrailers(body) {
  const out = [];
  for (const line of body.split("\n")) {
    const m = /^\s*([A-Za-z][A-Za-z0-9-]*)\s*:\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const value = m[2];
    const em = /^(.*?)\s*<([^>]+)>\s*$/.exec(value);
    out.push({ key: m[1].toLowerCase(), value, name: em ? em[1] : value, email: em ? em[2] : "" });
  }
  return out;
}

function attribute(c) {
  const hits = new Map(); // agent -> best kind
  const trailers = parseTrailers(c.body);
  for (const r of compiled) {
    let ok = false;
    if (r.kind === "trailer") {
      ok = trailers.some(
        (t) =>
          t.key === r.s.key.toLowerCase() &&
          (!r.nameRe || r.nameRe.test(t.name)) &&
          (!r.emailRe || r.emailRe.test(t.email)) &&
          (!r.re || r.re.test(t.value)),
      );
    } else if (r.kind === "author") {
      const people = [
        [c.an, c.ae],
        [c.cn, c.ce],
      ];
      ok = people.some(
        ([n, e]) => (r.nameRe || r.emailRe) && (!r.nameRe || r.nameRe.test(n)) && (!r.emailRe || r.emailRe.test(e)),
      );
    } else if (r.kind === "message") {
      ok = r.re.test(c.body);
    }
    if (ok && !hits.has(r.agent)) hits.set(r.agent, r.kind);
  }
  return hits;
}

// ---------- pass 1: git log ----------
const since = `${days}.days.ago`;
const FMT = "%x1e%H%x1f%P%x1f%aN%x1f%aE%x1f%cN%x1f%cE%x1f%at%x1f%ct%x1f%B%x1f";
const t0 = performance.now();
const logArgs = ["log", "HEAD", "-z", "--no-renames", "--name-only", `--format=${FMT}`];
if (limit) logArgs.push("-n", limit);
else logArgs.push(`--since=${since}`);
const raw = git(logArgs);
const tSpawn = performance.now();
const commits = [];
for (const rec of raw.split("\x1e")) {
  if (!rec) continue;
  const f = rec.split("\x1f");
  const tail = f[9] ?? "";
  const files = tail.split("\0").map((s) => s.replace(/^\n/, "")).filter(Boolean);
  commits.push({
    sha: f[0],
    parents: f[1] ? f[1].split(" ") : [],
    an: f[2],
    ae: f[3],
    cn: f[4],
    ce: f[5],
    at: Number(f[6]),
    ct: Number(f[7]),
    body: f[8],
    files,
  });
}
const tParse = performance.now();

// branch-prefix attribution through merge subjects
const branchRules = compiled.filter((r) => r.kind === "branch");
// candidates: the ref as written, and the ref without a leading owner segment
const branchOf = (subject) => {
  let m = /^Merge pull request #\d+ from (\S+)/.exec(subject);
  if (m) return [m[1], m[1].replace(/^[^/]+\//, "")];
  m = /^Merge (?:remote-tracking )?branch '(?:origin\/)?([^']+)'/.exec(subject);
  return m ? [m[1]] : [];
};
const bySha = new Map(commits.map((c) => [c.sha, c]));
const branchAgent = new Map();
let branchMerges = 0;
for (const c of commits) {
  if (c.parents.length !== 2) continue;
  const refs = branchOf(c.body.split("\n")[0]).map((b) => b.toLowerCase());
  const r = branchRules.find((x) => refs.some((b) => b.startsWith(x.s.prefix.toLowerCase())));
  if (!r) continue;
  branchMerges++;
  const shas = git(["rev-list", `${c.parents[0]}..${c.parents[1]}`]).split("\n").filter(Boolean);
  for (const s of shas) if (!branchAgent.has(s)) branchAgent.set(s, r.agent);
}

// person identity: union of same name or same email
const parent = new Map();
const find = (x) => {
  while (parent.get(x) !== x) {
    parent.set(x, parent.get(parent.get(x)));
    x = parent.get(x);
  }
  return x;
};
const union = (a, b) => {
  for (const k of [a, b]) if (!parent.has(k)) parent.set(k, k);
  parent.set(find(a), find(b));
};
const normEmail = (e) => e.toLowerCase().replace(/^\d+\+/, "");
for (const c of commits) union(`n:${c.an.toLowerCase()}`, `e:${normEmail(c.ae)}`);

let nonMerge = 0;
let automation = 0;
let multiAgent = 0;
const perAgent = {};
const perKind = {};
const unknownBots = {};
for (const c of commits) {
  c.person = find(`n:${c.an.toLowerCase()}`);
  if (c.parents.length > 1) continue;
  nonMerge++;
  const hits = attribute(c);
  if (hits.size === 0 && branchAgent.has(c.sha)) hits.set(branchAgent.get(c.sha), "branch");
  if (hits.size === 0 && automationRe.test(c.an)) {
    c.automation = true;
    automation++;
    continue;
  }
  if (hits.size === 0 && unknownBotRe.test(c.an)) {
    c.automation = true;
    unknownBots[c.an] = (unknownBots[c.an] ?? 0) + 1;
    continue;
  }
  if (hits.size > 1) multiAgent++;
  c.agents = [...hits.keys()];
  c.agent = c.agents[0] ?? null;
  const key = c.agent ?? "Unattributed";
  perAgent[key] = (perAgent[key] ?? 0) + 1;
  if (c.agent) perKind[hits.get(c.agent)] = (perKind[hits.get(c.agent)] ?? 0) + 1;
}
const tAttr = performance.now();

// ---------- overlaps ----------
const NOISE = new RegExp(
  rules.noise?.path_pattern ??
    "(^|/)(package-lock\\.json|pnpm-lock\\.yaml|yarn\\.lock|bun\\.lockb?|Cargo\\.lock|go\\.sum|poetry\\.lock|uv\\.lock|Gemfile\\.lock|composer\\.lock|CHANGELOG\\.md)$",
);
const MAX_FILES = rules.noise?.max_files_per_commit ?? 100;
function overlaps(windowSec, filtered) {
  const byFile = new Map();
  for (const c of commits) {
    if (c.parents.length > 1 || c.automation) continue;
    if (filtered && c.files.length > MAX_FILES) continue;
    for (const f of c.files) {
      if (filtered && NOISE.test(f)) continue;
      if (!byFile.has(f)) byFile.set(f, []);
      byFile.get(f).push(c);
    }
  }
  const n = { aaTool: 0, aaActor: 0, ah: 0, hh: 0 };
  const hot = new Map();
  for (const [f, evs] of byFile) {
    evs.sort((a, b) => a.at - b.at);
    for (let j = 1; j < evs.length; j++) {
      const b = evs[j];
      const seen = { aaTool: false, aaActor: false, ah: false, hh: false };
      for (let i = j - 1; i >= 0 && b.at - evs[i].at <= windowSec; i--) {
        const a = evs[i];
        if (a.agent && b.agent) {
          if (a.agent !== b.agent) seen.aaTool = true;
          if (a.agent !== b.agent || a.person !== b.person) seen.aaActor = true;
        } else if ((a.agent || b.agent) && a.person !== b.person) seen.ah = true;
        else if (!a.agent && !b.agent && a.person !== b.person) seen.hh = true;
      }
      for (const k of Object.keys(n)) if (seen[k]) n[k]++;
      if (seen.aaActor) hot.set(f, (hot.get(f) ?? 0) + 1);
    }
  }
  const top = [...hot.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return { ...n, top };
}
const ov = {};
for (const [label, sec] of [
  ["6h", 6 * 3600],
  ["24h", 24 * 3600],
  ["72h", 72 * 3600],
]) {
  ov[label] = overlaps(sec, true);
}
ov["24h_raw"] = overlaps(24 * 3600, false);
const tOverlap = performance.now();

// ---------- landing style on the first-parent line ----------
const fp = git(["log", "HEAD", "--first-parent", limit ? `-n${limit}` : `--since=${since}`, "--format=%P%x1f%cN%x1f%s"])
  .split("\n")
  .filter(Boolean)
  .map((l) => l.split("\x1f"));
let fpMerge = 0;
let fpSquash = 0;
let fpOther = 0;
for (const [p, cn, s] of fp) {
  if (p.split(" ").length > 1) fpMerge++;
  else if (/\(#\d+\)\s*$/.test(s) && cn === "GitHub") fpSquash++;
  else fpOther++;
}

// ---------- pass 2: merge-tree ----------
const merges = commits.filter((c) => c.parents.length >= 2);
const octopus = merges.filter((c) => c.parents.length > 2).length;
const two = merges.filter((c) => c.parents.length === 2);
const t2a = performance.now();
let missing = 0;
let feed = [];
if (two.length) {
  const check = spawnSync("git", ["-C", repo, "cat-file", "--batch-check"], {
    input: two.flatMap((c) => c.parents).join("\n") + "\n",
    encoding: "utf8",
    maxBuffer: 1 << 30,
  }).stdout.split("\n");
  const missingSet = new Set(check.filter((l) => l.endsWith(" missing")).map((l) => l.split(" ")[0]));
  feed = two.filter((c) => !c.parents.some((p) => missingSet.has(p)));
  missing = two.length - feed.length;
}
let conflicted = 0;
const resolvers = {};
if (feed.length) {
  const objDir = mkdtempSync(join(tmpdir(), "amscan-obj-"));
  const gitDir = git(["rev-parse", "--absolute-git-dir"]).trim();
  const res = spawnSync(
    "git",
    ["-C", repo, "merge-tree", "--write-tree", "--stdin", "-z", "--name-only", "--no-messages"],
    {
      input: feed.map((c) => c.parents.join(" ")).join("\n") + "\n",
      encoding: "utf8",
      maxBuffer: 1 << 30,
      env: {
        ...process.env,
        GIT_OBJECT_DIRECTORY: objDir,
        GIT_ALTERNATE_OBJECT_DIRECTORIES: join(gitDir, "objects"),
      },
    },
  );
  rmSync(objDir, { recursive: true, force: true });
  const parts = res.stdout.split("\0");
  let k = 0;
  for (const c of feed) {
    const status = parts[k++];
    k++; // tree
    while (k < parts.length && parts[k] !== "") k++;
    k++;
    if (status === "0") {
      conflicted++;
      const hits = attribute(c);
      const who = hits.size ? [...hits.keys()][0] : automationRe.test(c.an) ? "automation" : "human/unattributed";
      resolvers[who] = (resolvers[who] ?? 0) + 1;
    }
  }
  if (res.status !== 0 && res.status !== 1) console.error("merge-tree exit", res.status, res.stderr.slice(0, 300));
}
const t2b = performance.now();

const total = commits.length;
const result = {
  repo: argv[0],
  window: limit ? `last ${limit} commits` : `${days} days`,
  commits: total,
  nonMerge,
  automation,
  unknownBots,
  perAgent,
  perKind,
  multiAgent,
  branchMerges,
  people: new Set(commits.map((c) => c.person)).size,
  merges: merges.length,
  octopus,
  missingParents: missing,
  conflicted,
  resolvers,
  firstParent: { merge: fpMerge, squash: fpSquash, other: fpOther },
  overlaps: ov,
  ms: {
    logSpawn: Math.round(tSpawn - t0),
    logParse: Math.round(tParse - tSpawn),
    attribution: Math.round(tAttr - tParse),
    overlaps: Math.round(tOverlap - tAttr),
    mergeTree: Math.round(t2b - t2a),
    mergeTreeCount: feed.length,
  },
};
if (asJson) console.log(JSON.stringify(result));
else console.log(JSON.stringify(result, null, 2));
