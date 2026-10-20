import assert from "node:assert/strict";
import { readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { countOverlaps } from "../dist/overlaps.js";
import { compileRules, loadRulesFile, scan } from "../dist/index.js";
import { buildFixture, NOW } from "./fixtures/build-fixture.mjs";

const expected = JSON.parse(readFileSync(new URL("./fixtures/expected.json", import.meta.url), "utf8"));

describe("fixture overlaps", () => {
  let root;
  let dir;
  before(() => ({ root, dir } = buildFixture()));
  after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));

  for (const [label, hours] of [["6h", 6], ["24h", 24], ["72h", 72]]) {
    test(`window ${label}`, async () => {
      const r = await scan({ cwd: dir, now: NOW, windowHours: hours });
      assert.deepEqual({ agentAgent: r.overlaps.agentAgent, agentHuman: r.overlaps.agentHuman }, expected.overlaps[label]);
      assert.equal(r.overlaps.windowHours, hours);
    });
  }

  test("24h is the default window and the hottest files come with it", async () => {
    const r = await scan({ cwd: dir, now: NOW });
    assert.equal(r.overlaps.windowHours, 24);
    assert.deepEqual(r.overlaps.hottest, expected.hottest24h);
  });

  test("every trap counts once the noise filter is off: lockfile, big commit, generated file", async () => {
    const file = loadRulesFile();
    file.noise = { path_pattern: "^$", max_files_per_commit: 100000 };
    const r = await scan({ cwd: dir, now: NOW, rules: file });
    assert.equal(r.overlaps.agentAgent, expected.overlaps["24h"].agentAgent + 3);
    // automation stays out either way, and the same person's own edit never counts
    assert.equal(r.overlaps.agentHuman, expected.overlaps["24h"].agentHuman);
  });

  test("a subdirectory scans the whole repo", async () => {
    const r = await scan({ cwd: join(dir, "src"), now: NOW });
    assert.equal(r.overlaps.agentAgent, expected.overlaps["24h"].agentAgent);
    assert.equal(r.repo.name, "repo");
  });

  test("files marked linguist-generated are left out", async () => {
    const attrs = join(dir, ".gitattributes");
    writeFileSync(attrs, "src/api.ts linguist-generated\n");
    try {
      const r = await scan({ cwd: dir, now: NOW });
      assert.deepEqual(r.overlaps.hottest, [{ path: "src/edge.ts", overlaps: 1 }]);
      assert.equal(r.overlaps.agentAgent, 1);
    } finally {
      unlinkSync(attrs);
    }
  });
});

describe("overlap rules", () => {
  const rules = compileRules(loadRulesFile());
  let seq = 0;
  const c = (hours, bucket, agent, person, files = ["f.ts"], extra = {}) => ({
    sha: String(++seq).padStart(40, "0"),
    parents: ["p"],
    authorName: person,
    authorEmail: `${person}@x`,
    committerName: person,
    committerEmail: `${person}@x`,
    authorTime: Math.round(hours * 3600),
    commitTime: Math.round(hours * 3600),
    message: "x",
    files,
    boundary: false,
    isMerge: false,
    bucket,
    agents: agent ? [agent] : [],
    kind: agent ? "trailer" : null,
    person,
    ...extra,
  });
  // git log order: newest first
  const run = (list, windowHours = 24) => countOverlaps({ commits: [...list].reverse(), rules, windowHours });

  test("two agents of different people within the window", () => {
    assert.equal(run([c(0, "agent", "claude-code", "a"), c(1, "agent", "claude-code", "b")]).agentAgent, 1);
  });

  test("the same person with the same agent never counts", () => {
    assert.equal(run([c(0, "agent", "claude-code", "a"), c(1, "agent", "claude-code", "a")]).agentAgent, 0);
  });

  test("the same person with two agents counts", () => {
    assert.equal(run([c(0, "agent", "claude-code", "a"), c(1, "agent", "codex", "a")]).agentAgent, 1);
  });

  test("the window edge is inclusive", () => {
    assert.equal(run([c(0, "agent", "codex", "a"), c(24, "agent", "cursor", "b")]).agentAgent, 1);
    assert.equal(run([c(0, "agent", "codex", "a"), c(24 + 1 / 3600, "agent", "cursor", "b")]).agentAgent, 0);
  });

  test("one (file, commit) pair counts once however many agents came before it", () => {
    const r = run([c(0, "agent", "codex", "a"), c(1, "agent", "cursor", "b"), c(2, "agent", "amp", "c")]);
    assert.equal(r.agentAgent, 2);
  });

  test("merges, shallow boundaries and bots stay out", () => {
    const r = run([
      c(0, "agent", "codex", "a"),
      c(1, "agent", "cursor", "b", ["f.ts"], { isMerge: true }),
      c(2, "agent", "cursor", "b", ["f.ts"], { boundary: true }),
      c(3, "automation", null, "dependabot[bot]"),
      c(4, "unknown-bot", null, "acme[bot]"),
    ]);
    assert.deepEqual([r.agentAgent, r.agentHuman], [0, 0]);
  });

  test("agent then a different person by hand is agent/human, not agent/agent", () => {
    const r = run([c(0, "agent", "codex", "a"), c(1, "unattributed", null, "b")]);
    assert.deepEqual([r.agentAgent, r.agentHuman], [0, 1]);
  });

  test("hottest files are ordered by count, then path, and capped", () => {
    const list = [];
    for (const f of ["b.ts", "a.ts", "c.ts", "d.ts", "e.ts", "f.ts"]) {
      list.push(c(0, "agent", "codex", "x", [f]), c(1, "agent", "cursor", "y", [f]));
    }
    list.push(c(2, "agent", "amp", "z", ["c.ts"]));
    const r = run(list);
    assert.deepEqual(r.hottest.map((h) => h.path), ["c.ts", "a.ts", "b.ts", "d.ts", "e.ts"]);
  });
});
