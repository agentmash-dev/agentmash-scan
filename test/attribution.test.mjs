import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { classify } from "../dist/attribute.js";
import { branchCandidates, compileRules, loadRulesFile, parseRulesFile, parseTrailers, scan } from "../dist/index.js";
import { buildFixture, NOW } from "./fixtures/build-fixture.mjs";

const expected = JSON.parse(readFileSync(new URL("./fixtures/expected.json", import.meta.url), "utf8"));

describe("fixture attribution", () => {
  let root;
  let dir;
  let result;
  before(async () => {
    ({ root, dir } = buildFixture());
    result = await scan({ cwd: dir, now: NOW });
  });
  after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));

  test("commit buckets", () => {
    assert.deepEqual(result.commits, expected.commits);
  });

  test("commits per agent", () => {
    const got = Object.fromEntries(result.agents.map((a) => [a.name, a.commits]));
    assert.deepEqual(got, expected.agents);
  });

  test("agents are sorted by commits, then name", () => {
    assert.deepEqual(
      result.agents.map((a) => a.name),
      Object.entries(expected.agents)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([n]) => n),
    );
  });

  test("the period and repo", () => {
    assert.equal(result.period.days, 90);
    assert.equal(result.period.until, NOW.toISOString());
    assert.equal(result.repo.branch, "main");
    assert.equal(result.repo.shallow, false);
  });

  test("a shorter period drops older commits", async () => {
    // 600h after the start is "now"; 10 days back keeps only the edge commits at 400h+
    const r = await scan({ cwd: dir, now: NOW, days: 10 });
    assert.equal(r.commits.total, 4);
    assert.deepEqual(Object.fromEntries(r.agents.map((a) => [a.name, a.commits])), { Codex: 2, Cursor: 2 });
  });

  test("--agent-bot counts an unknown bot as an agent", async () => {
    const r = await scan({ cwd: dir, now: NOW, agentBots: ["acme-agent[bot]"] });
    assert.deepEqual(r.commits.unknownBots, []);
    assert.equal(r.agents.find((a) => a.name === "acme-agent")?.commits, 1);
  });

  test("a branch that doesn't exist is an error", async () => {
    await assert.rejects(scan({ cwd: dir, now: NOW, branch: "no-such-branch" }), /not found/);
  });
});

describe("attribution rules", () => {
  const rules = compileRules(loadRulesFile());
  const commit = (over) => ({
    sha: "0".repeat(40),
    parents: ["1".repeat(40)],
    authorName: "Alice Doe",
    authorEmail: "alice@example.com",
    committerName: "Alice Doe",
    committerEmail: "alice@example.com",
    authorTime: 0,
    commitTime: 0,
    message: "x",
    files: [],
    boundary: false,
    ...over,
  });

  test("trailers anywhere in the body, names and emails split", () => {
    const t = parseTrailers("feat: x (#1)\n\n* one\n\nCo-authored-by: Cursor Agent <cursoragent@cursor.com>\n\nCo-Authored-By: Claude <noreply@anthropic.com>");
    assert.deepEqual(
      t.map((x) => [x.key, x.name, x.email]),
      [
        ["co-authored-by", "Cursor Agent", "cursoragent@cursor.com"],
        ["co-authored-by", "Claude", "noreply@anthropic.com"],
      ],
    );
  });

  test("model-named Claude trailers match by email", () => {
    const [c] = classify([commit({ message: "x\n\nCo-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>" })], rules);
    assert.deepEqual([c.bucket, c.agents, c.kind], ["agent", ["claude-code"], "trailer"]);
  });

  test("a squash with two agents keeps both, Claude first by file order", () => {
    const [c] = classify([commit({ message: "x\n\nCo-authored-by: Codex <codex@openai.com>\nCo-authored-by: Claude <noreply@anthropic.com>" })], rules);
    assert.deepEqual(c.agents, ["claude-code", "codex"]);
  });

  test("trailers win over the author", () => {
    const [c] = classify(
      [commit({ authorName: "Cursor Agent", authorEmail: "cursoragent@cursor.com", message: "x\n\nCo-authored-by: Amp <amp@ampcode.com>" })],
      rules,
    );
    assert.deepEqual([c.agents[0], c.kind], ["amp", "trailer"]);
  });

  test("a bot author with one human co-author belongs to that human", () => {
    const [bot, human] = classify(
      [
        commit({ authorName: "copilot-swe-agent[bot]", authorEmail: "198982749+Copilot@users.noreply.github.com", message: "x\n\nCo-authored-by: alice <123+alice@users.noreply.github.com>" }),
        commit({ authorName: "alice", authorEmail: "alice@users.noreply.github.com" }),
      ],
      rules,
    );
    assert.equal(bot.bucket, "agent");
    assert.equal(bot.person, human.person);
  });

  test("bot chores are automation, real bot work is an agent", () => {
    const bot = { authorName: "opencode-agent[bot]", authorEmail: "opencode-agent[bot]@users.noreply.github.com" };
    const [chore, work] = classify([commit({ ...bot, message: "chore: generate" }), commit({ ...bot, message: "fix(tui): keep the workspace" })], rules);
    assert.equal(chore.bucket, "automation");
    assert.deepEqual([work.bucket, work.agents], ["agent", ["opencode"]]);
  });

  test("known automation and unknown bots", () => {
    const [dep, other, person] = classify(
      [
        commit({ authorName: "renovate[bot]", authorEmail: "x@users.noreply.github.com" }),
        commit({ authorName: "keppo-bot[bot]", authorEmail: "y@users.noreply.github.com" }),
        commit({}),
      ],
      rules,
    );
    assert.deepEqual([dep.bucket, other.bucket, person.bucket], ["automation", "unknown-bot", "unattributed"]);
  });

  test("branch names from merge subjects, with and without the owner", () => {
    assert.deepEqual(branchCandidates("Merge pull request #7 from alice/codex/feature"), ["alice/codex/feature", "codex/feature"]);
    assert.deepEqual(branchCandidates("Merge pull request #1 from devin/1792327876-x"), ["devin/1792327876-x", "1792327876-x"]);
    assert.deepEqual(branchCandidates("Merge branch 'claude/fix-it' into main"), ["claude/fix-it"]);
    assert.deepEqual(branchCandidates("feat: nothing to see"), []);
  });

  test("unverified signals are never applied", () => {
    const file = loadRulesFile();
    const droid = file.agents.find((a) => a.id === "factory-droid");
    assert.ok(droid.signals.some((s) => s.status === "unverified"));
    assert.ok(!compileRules(file).signals.some((s) => s.kind === "branch" && s.prefix === "droid/"));
  });

  test("bad rules files fail loudly", () => {
    assert.throws(() => parseRulesFile({ schema: 2 }), /schema/);
    const file = loadRulesFile();
    const broken = structuredClone(file);
    broken.agents[0].signals[0].evidence = [];
    assert.throws(() => parseRulesFile(broken), /verified but has no evidence/);
    const badRe = structuredClone(file);
    badRe.agents[0].signals[0].email_pattern = "(";
    assert.throws(() => parseRulesFile(badRe), /not a valid regex/);
  });
});
