import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { renderCard } from "../dist/card/render.js";
import { cardSvg, textWidth } from "../dist/card/svg.js";
import { shareText, shareUrl } from "../dist/share.js";
import { scan } from "../dist/index.js";
import { buildFixture, NOW } from "./fixtures/build-fixture.mjs";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const pngSize = (buf) => {
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "PNG signature");
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
};

describe("card and share", () => {
  let root;
  let dir;
  let result;
  before(async () => {
    ({ root, dir } = buildFixture());
    const r = await scan({ cwd: dir, now: NOW });
    result = { ...r, repo: { ...r.repo, name: "secret-repo-name" } };
  });
  after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));

  test("the card says the number, the line, the agents and the command", () => {
    const svg = cardSvg(result, "landscape");
    assert.match(svg, />3</);
    assert.match(svg, /times my AI agents stepped on each other in 90 days/);
    assert.match(svg, /Claude Code · Codex · Cursor/);
    assert.match(svg, />npx agentmash-scan</);
  });

  test("no file paths and no repo name unless asked", () => {
    for (const size of ["landscape", "portrait"]) {
      const svg = cardSvg(result, size);
      assert.doesNotMatch(svg, /src\/api\.ts|src\/edge\.ts/);
      assert.doesNotMatch(svg, /secret-repo-name/);
      assert.match(cardSvg(result, size, { showRepo: true }), /secret-repo-name/);
    }
  });

  test("no frames, pills or badges: one background rect, the rest is text", () => {
    const svg = cardSvg(result, "portrait");
    assert.equal((svg.match(/<rect/g) ?? []).length, 1);
    assert.doesNotMatch(svg, /<(path|circle|ellipse|line|polygon)\b/);
  });

  test("names are escaped", () => {
    const odd = { ...result, agents: [{ id: "x", name: "A<b>&c", commits: 1 }], repo: { ...result.repo, name: "x&y" } };
    const svg = cardSvg(odd, "landscape", { showRepo: true });
    assert.match(svg, /A&lt;b&gt;&amp;c/);
    assert.match(svg, />x&amp;y</);
  });

  test("one overlap reads as one time", () => {
    const one = { ...result, overlaps: { ...result.overlaps, agentAgent: 1 } };
    assert.match(cardSvg(one, "landscape"), /time my AI agents stepped on each other in 90 days/);
    assert.doesNotMatch(cardSvg(one, "landscape"), /times my/);
  });

  test("a long number still fits inside the margins", () => {
    const big = { ...result, overlaps: { ...result.overlaps, agentAgent: 123456789 } };
    const svg = cardSvg(big, "landscape");
    const size = Number(/font-weight="800" font-size="(\d+)"/.exec(svg)[1]);
    assert.ok(textWidth("123,456,789", "manrope800", size, -0.03) <= 1200 - 2 * 88 + 1);
  });

  test("both sizes render to PNGs of the right size", async () => {
    assert.deepEqual(pngSize(await renderCard(result, "landscape")), [1200, 675]);
    assert.deepEqual(pngSize(await renderCard(result, "portrait")), [1080, 1350]);
  });

  test("the share text has numbers and agent names only", () => {
    const text = shareText(result);
    assert.equal(text, "My AI agents stepped on each other 3 times in 90 days.\nClaude Code · Codex · Cursor · Aider · Amp · Antigravity · Devin · Factory Droid · Gemini CLI · Gemini Code Assist · GitHub Copilot · Jules · OpenCode\nnpx agentmash-scan");
    const url = shareUrl(text);
    assert.ok(url.startsWith("https://x.com/intent/post?text="));
    assert.equal(decodeURIComponent(url.split("text=")[1]), text);
    assert.doesNotMatch(url, /secret-repo-name|src%2F/);
    assert.match(shareText(result, { showRepo: true }), /in 90 days on secret-repo-name\./);
  });

  test("cli --card writes both files into the current directory", () => {
    const out = mkdtempSync(join(tmpdir(), "amscan-card-"));
    try {
      const r = spawnSync(process.execPath, [CLI, dir, "--card"], { cwd: out, encoding: "utf8", env: { ...process.env, NO_COLOR: "1", AGENTMASH_SCAN_NOW: NOW.toISOString() } });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /Card saved: .*scan\.png \(1200x675, X\) and .*scan-1080x1350\.png/);
      assert.deepEqual(pngSize(readFileSync(join(out, "scan.png"))), [1200, 675]);
      assert.deepEqual(pngSize(readFileSync(join(out, "scan-1080x1350.png"))), [1080, 1350]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  test("cli --share prints the post link; --json keeps stdout pure", () => {
    const env = { ...process.env, NO_COLOR: "1", BROWSER: "none", AGENTMASH_SCAN_NOW: NOW.toISOString() };
    const r = spawnSync(process.execPath, [CLI, dir, "--share"], { encoding: "utf8", env });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Post it from here: https:\/\/x\.com\/intent\/post\?text=My%20AI%20agents/);
    const j = spawnSync(process.execPath, [CLI, dir, "--json", "--share"], { encoding: "utf8", env });
    assert.equal(JSON.parse(j.stdout).overlaps.agentAgent, 3);
    assert.match(j.stderr, /Post it from here/);
  });
});
