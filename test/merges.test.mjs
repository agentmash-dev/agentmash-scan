import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// test files run in parallel processes; a private TMPDIR keeps the temp-dir counts below to this one
const privateTmp = mkdtempSync(join(tmpdir(), "amscan-merges-test-"));
process.env.TMPDIR = privateTmp;
import { pathToFileURL } from "node:url";
import { after, before, describe, test } from "node:test";
import { classify } from "../dist/attribute.js";
import { checkMerges, parseMergeTreeBatch } from "../dist/git/merges.js";
import { gitVersion, repoInfo } from "../dist/git/run.js";
import { compileRules, loadRulesFile, scan } from "../dist/index.js";
import { buildFixture, NOW } from "./fixtures/build-fixture.mjs";

const expected = JSON.parse(readFileSync(new URL("./fixtures/expected.json", import.meta.url), "utf8"));
const rules = compileRules(loadRulesFile());
const scanTemps = () => readdirSync(tmpdir()).filter((n) => n.startsWith("agentmash-scan-"));

describe("fixture merges", () => {
  let root;
  let dir;
  let env;
  before(() => ({ root, dir, env } = buildFixture()));
  after(() => rmSync(privateTmp, { recursive: true, force: true, maxRetries: 3 }));

  const objectCount = () => {
    const out = execFileSync("git", ["count-objects", "-v"], { cwd: dir, encoding: "utf8" });
    const get = (k) => Number(new RegExp(`^${k}: (\\d+)`, "m").exec(out)?.[1]);
    return get("count") + get("in-pack");
  };

  test("conflicted merges, octopus and resolvers", async () => {
    const r = await scan({ cwd: dir, now: NOW });
    const { git, skipped, ...got } = r.merges;
    assert.equal(skipped, null);
    assert.match(git, /^\d+\.\d+\.\d+$/);
    assert.deepEqual(got, expected.merges);
  });

  test("the scan writes nothing into the repo and cleans its temp dirs", async () => {
    const before = objectCount();
    const tempsBefore = scanTemps().length;
    await scan({ cwd: dir, now: NOW });
    assert.equal(objectCount(), before);
    assert.equal(scanTemps().length, tempsBefore);
  });

  test("git older than 2.38 skips the merge pass and says so", async () => {
    const commits = classify(await rawCommits(dir), rules);
    const r = await checkMerges({ cwd: dir, objectsDir: join(dir, ".git", "objects"), version: { major: 2, minor: 34, patch: 1, text: "2.34.1" }, commits, rules });
    assert.deepEqual([r.skipped, r.rerun, r.unchecked, r.octopus], ["git-too-old", 0, 5, 1]);
  });

  test("a merge with a missing parent is counted and skipped, the rest still run", async () => {
    const commits = classify(await rawCommits(dir), rules);
    const merge = commits.find((c) => c.isMerge && c.parents.length === 2);
    const fake = { ...merge, sha: "f".repeat(40), parents: [merge.parents[0], "d".repeat(40)] };
    const info = await repoInfo(dir);
    const r = await checkMerges({ cwd: dir, objectsDir: info.objectsDir, version: await gitVersion(dir), commits: [...commits, fake], rules });
    assert.equal(r.missingParents, 1);
    assert.equal(r.rerun, 5);
    assert.equal(r.conflicted, 2);
  });

  test("a parent that is not a commit is skipped like a missing one", async () => {
    const commits = classify(await rawCommits(dir), rules);
    const merge = commits.find((c) => c.isMerge && c.parents.length === 2);
    const blob = execFileSync("git", ["rev-parse", "HEAD:README.md"], { cwd: dir, encoding: "utf8" }).trim();
    const fake = { ...merge, sha: "e".repeat(40), parents: [merge.parents[0], blob] };
    const info = await repoInfo(dir);
    const r = await checkMerges({ cwd: dir, objectsDir: info.objectsDir, version: await gitVersion(dir), commits: [...commits, fake], rules });
    assert.deepEqual([r.missingParents, r.rerun, r.unchecked, r.conflicted], [1, 5, 0, 2]);
  });

  test("a time budget stops the pass and reports what is left", async () => {
    const commits = classify(await rawCommits(dir), rules);
    const info = await repoInfo(dir);
    const r = await checkMerges({ cwd: dir, objectsDir: info.objectsDir, version: await gitVersion(dir), commits, rules, budgetMs: 0 });
    assert.equal(r.rerun + r.unchecked, 5);
    assert.ok(r.unchecked > 0, "a zero budget leaves merges unchecked");
    assert.equal(scanTemps().length, 0);
  });

  test("a shallow clone: boundary commits keep their commit but lose their files", async () => {
    const shallow = join(root, "shallow");
    execFileSync("git", ["clone", "-q", "--depth", "3", pathToFileURL(dir).href, shallow], { env, stdio: "ignore" });
    const day = await scan({ cwd: shallow, now: NOW });
    assert.equal(day.repo.shallow, true);
    assert.equal(day.commits.total, 3);
    assert.equal(day.commits.shallowBoundary, 1);
    // edge.ts lost its earlier half to the boundary; edge2's pair is 24h + 1s apart
    assert.equal(day.overlaps.agentAgent, 0);
    const threeDays = await scan({ cwd: shallow, now: NOW, windowHours: 72 });
    assert.equal(threeDays.overlaps.agentAgent, 1);
    assert.equal(day.merges.total, 0);
  });
});

describe("merge-tree batch output", () => {
  test("statuses: 0 is conflicted, 1 is clean", () => {
    assert.deepEqual(parseMergeTreeBatch("0\0tree1\0a.txt\0b.txt\0\0" + "1\0tree2\0\0"), [true, false]);
  });

  test("a record cut off by the budget is dropped", () => {
    assert.deepEqual(parseMergeTreeBatch("1\0tree1\0\0" + "0\0tree2\0a.t"), [false]);
    assert.deepEqual(parseMergeTreeBatch("1\0tree1\0\0" + "0\0tree2\0a.txt\0"), [false]);
    assert.deepEqual(parseMergeTreeBatch(""), []);
  });
});

async function rawCommits(dir) {
  const { readLog } = await import("../dist/git/log.js");
  const { resolveRef } = await import("../dist/git/run.js");
  const ref = await resolveRef(dir, undefined);
  return readLog(dir, { sha: ref.sha, since: Math.floor(NOW.getTime() / 1000) - 90 * 86400 });
}
