// npm run bench: a 10,000-commit repo must scan in under 10 seconds.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { scan } from "../dist/index.js";
import { buildBig, BIG_COMMITS } from "./fixtures/build-big.mjs";

const BUDGET_MS = 10_000;
const t0 = performance.now();
const big = buildBig();
console.log(`built ${BIG_COMMITS} commits in ${Math.round(performance.now() - t0)} ms`);
try {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    const r = await scan({ cwd: big.dir, now: big.now });
    runs.push(performance.now() - t);
    assert.equal(r.commits.total, BIG_COMMITS);
    assert.equal(r.merges.total, big.merges);
    assert.equal(r.merges.conflicted, big.conflicting);
    if (i === 0) console.log("timings (ms):", JSON.stringify(r.timingsMs), "| agent/agent overlaps:", r.overlaps.agentAgent);
  }
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const t = performance.now();
  const p = spawnSync(process.execPath, [cli, big.dir, "--json"], { encoding: "utf8", env: { ...process.env, AGENTMASH_SCAN_NOW: big.now.toISOString() } });
  const cliMs = performance.now() - t;
  assert.equal(p.status, 0, p.stderr);
  console.log(`scan(): ${runs.map((x) => Math.round(x)).join(" / ")} ms; CLI with node start: ${Math.round(cliMs)} ms; budget ${BUDGET_MS} ms`);
  assert.ok(Math.max(...runs, cliMs) < BUDGET_MS, "over the 10 s budget");
} finally {
  rmSync(big.root, { recursive: true, force: true, maxRetries: 3 });
}
