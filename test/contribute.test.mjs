import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { contribution, contributeUrl, CONTRIBUTE_URL, isYes, QUESTION, shouldAsk } from "../dist/contribute.js";
import { scan } from "../dist/index.js";
import { buildFixture, NOW } from "./fixtures/build-fixture.mjs";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

describe("contribute", () => {
  let root;
  let dir;
  let result;
  before(async () => {
    ({ root, dir } = buildFixture());
    const r = await scan({ cwd: dir, now: NOW, agentBots: ["acme-agent[bot]"] });
    result = { ...r, repo: { ...r.repo, name: "secret-repo-name" } };
  });
  after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));

  test("aggregates only: no repo, paths, people or bot names", () => {
    const c = contribution(result);
    const json = JSON.stringify(c);
    for (const leak of ["secret-repo-name", "src/", "api.ts", "Alice", "alice@", "acme-agent", "main"]) {
      assert.ok(!json.includes(leak), `leaks ${leak}`);
    }
    assert.deepEqual(Object.keys(c).sort(), ["agents", "commits", "days", "merges", "overlaps", "rules", "tool", "v", "windowHours"]);
    assert.equal(c.overlaps.agentAgent, 3);
    assert.equal(c.merges.conflicted, 2);
    assert.equal(c.agents["Claude Code"], 14);
  });

  test("the counts ride in the URL fragment and decode back", () => {
    const c = contribution(result);
    const url = contributeUrl(c);
    assert.ok(url.startsWith(`${CONTRIBUTE_URL}#`));
    assert.ok(!url.includes("?"), "nothing in the query string, which a server would see");
    assert.deepEqual(JSON.parse(Buffer.from(url.split("#")[1], "base64url").toString("utf8")), c);
  });

  test("ask only when a person is at the keyboard", () => {
    const base = { stdinTTY: true, stdoutTTY: true, env: {}, json: false, contribute: false };
    assert.equal(shouldAsk(base), true);
    assert.equal(shouldAsk({ ...base, stdinTTY: false }), false);
    assert.equal(shouldAsk({ ...base, stdoutTTY: false }), false);
    assert.equal(shouldAsk({ ...base, env: { CI: "true" } }), false);
    assert.equal(shouldAsk({ ...base, env: { AGENTMASH_SCAN_NO_ASK: "1" } }), false);
    assert.equal(shouldAsk({ ...base, json: true }), false);
    assert.equal(shouldAsk({ ...base, contribute: true }), false);
  });

  test("only y or yes counts as yes; the default is no", () => {
    for (const a of ["y", "Y", "yes", " YES "]) assert.equal(isYes(a), true, a);
    for (const a of ["", "n", "no", "yep", "sure", null]) assert.equal(isYes(a), false, String(a));
  });

  test("a piped run never asks and exits", () => {
    const r = spawnSync(process.execPath, [CLI, dir], { encoding: "utf8", env: { ...process.env, AGENTMASH_SCAN_NOW: NOW.toISOString() }, timeout: 20000 });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes(QUESTION.trim()));
  });

  test("--contribute prints the link when no browser opens", () => {
    const r = spawnSync(process.execPath, [CLI, dir, "--contribute"], { encoding: "utf8", env: { ...process.env, BROWSER: "none", AGENTMASH_SCAN_NOW: NOW.toISOString() } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Your counts are ready here: https:\/\/agentmash\.dev\/scan\/report#/);
    assert.match(r.stdout, /Nothing is sent until you press Send/);
  });
});
