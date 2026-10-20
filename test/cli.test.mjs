import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseWindow } from "../dist/args.js";
import { formatReport, formatWindow, headline } from "../dist/report.js";
import { scan, VERSION } from "../dist/index.js";
import { buildFixture, NOW } from "./fixtures/build-fixture.mjs";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const SNAPSHOT = new URL("./fixtures/report.txt", import.meta.url);
const run = (args, env = {}) =>
  spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", AGENTMASH_SCAN_NOW: NOW.toISOString(), ...env },
  });

describe("cli", () => {
  let root;
  let dir;
  before(() => ({ root, dir } = buildFixture()));
  after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));

  test("the report matches the snapshot", () => {
    const r = run([dir]);
    assert.equal(r.status, 0, r.stderr);
    if (process.env.UPDATE_SNAPSHOTS) writeFileSync(SNAPSHOT, r.stdout);
    assert.equal(r.stdout, readFileSync(SNAPSHOT, "utf8"));
  });

  test("--json prints the scan result", () => {
    const r = run([dir, "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.schema, 1);
    assert.equal(j.tool.version, VERSION);
    assert.equal(j.overlaps.agentAgent, 3);
    assert.equal(j.merges.conflicted, 2);
  });

  test("--window and --days", () => {
    assert.equal(JSON.parse(run([dir, "--json", "--window", "72h"]).stdout).overlaps.agentAgent, 6);
    assert.equal(JSON.parse(run([dir, "--json", "--window", "3d"]).stdout).overlaps.windowHours, 72);
    assert.equal(JSON.parse(run([dir, "--json", "--days", "10"]).stdout).commits.total, 4);
  });

  test("--branch scans another branch", () => {
    const j = JSON.parse(run([dir, "--json", "--branch", "c3"]).stdout);
    assert.equal(j.repo.branch, "c3");
    assert.ok(j.commits.total < 70);
  });

  test("runs from inside the repo without a path", () => {
    const r = spawnSync(process.execPath, [CLI, "--json"], { cwd: join(dir, "src"), encoding: "utf8", env: { ...process.env, AGENTMASH_SCAN_NOW: NOW.toISOString() } });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).overlaps.agentAgent, 3);
  });

  test("outside a repo: exit 1 and a hint", () => {
    const empty = mkdtempSync(join(tmpdir(), "amscan-empty-"));
    try {
      const r = run([empty]);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /not a git repository \(run it inside a repo/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  test("bad flags: exit 2", () => {
    assert.equal(run([dir, "--window", "soon"]).status, 2);
    assert.equal(run([dir, "--days", "-3"]).status, 2);
    assert.equal(run([dir, "--frobnicate"]).status, 2);
    assert.equal(run([dir, "other"]).status, 2);
  });

  test("an unknown branch: exit 1", () => {
    const r = run([dir, "--branch", "nope"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /"nope" not found/);
  });

  test("--help and --version", () => {
    const h = run(["--help"]);
    assert.equal(h.status, 0);
    assert.match(h.stdout, /^Count how often/);
    assert.equal(run(["-v"]).stdout.trim(), VERSION);
  });

  test("no colour codes without a terminal", () => {
    assert.doesNotMatch(run([dir], { NO_COLOR: "" }).stdout, /\x1b\[/);
  });
});

describe("report wording", () => {
  let root;
  let base;
  before(async () => {
    let dir;
    ({ root, dir } = buildFixture());
    base = await scan({ cwd: dir, now: NOW });
  });
  after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));

  test("the headline", () => {
    assert.equal(headline(base), "Your AI agents stepped on each other 3 times in 90 days.");
    assert.equal(headline({ ...base, overlaps: { ...base.overlaps, agentAgent: 1 }, period: { ...base.period, days: 1 } }), "Your AI agents stepped on each other 1 time in 1 day.");
    assert.equal(headline({ ...base, overlaps: { ...base.overlaps, agentAgent: 12345 } }), "Your AI agents stepped on each other 12,345 times in 90 days.");
  });

  test("old git, no agents, shallow clone, time limit", () => {
    const oldGit = formatReport({ ...base, merges: { ...base.merges, skipped: "git-too-old", git: "2.34.1" } });
    assert.match(oldGit, /Merges that conflicted\s+not checked: git 2\.34\.1 is older than 2\.38/);
    const none = formatReport({ ...base, agents: [], commits: { ...base.commits, agent: 0 } });
    assert.match(none, /no commit here carried an agent mark/);
    assert.match(formatReport({ ...base, repo: { ...base.repo, shallow: true } }), /^Shallow clone:/m);
    const cut = formatReport({ ...base, merges: { ...base.merges, rerun: 3, unchecked: 2 } });
    assert.match(cut, /2 of 4 checked \(2 not checked, time limit\)/);
  });

  test("window labels", () => {
    assert.deepEqual([formatWindow(24), formatWindow(6), formatWindow(72), formatWindow(1.5), formatWindow(36)], ["24h", "6h", "3d", "90m", "36h"]);
    assert.deepEqual([parseWindow("24h"), parseWindow("90m"), parseWindow("2d"), parseWindow("6")], [24, 1.5, 48, 6]);
  });
});
