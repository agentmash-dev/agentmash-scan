// Builds a small repo whose numbers are known by construction. See PLAN.md "Test fixture" and expected.json.
// usage: node test/fixtures/build-fixture.mjs [dir]   (prints the directory)
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const HOUR = 3600;
export const START = Date.UTC(2026, 0, 1) / 1000;
/** the scan's "now": 600 hours after the start */
export const NOW = new Date((START + 600 * HOUR) * 1000);

const who = (name, email) => ({ name, email });
export const ALICE = who("Alice Doe", "alice@example.com");
export const BOB = who("Bob Roe", "bob@example.com");
export const CAROL = who("Carol Poe", "carol@example.com");
export const DAVE = who("Dave Moe", "dave@example.com");
const DEPENDABOT = who("dependabot[bot]", "49699333+dependabot[bot]@users.noreply.github.com");
const ACME_BOT = who("acme-agent[bot]", "1+acme-agent[bot]@users.noreply.github.com");
const CLAUDE_BOT = who("claude[bot]", "209825114+claude[bot]@users.noreply.github.com");
const CURSOR_AGENT = who("Cursor Agent", "cursoragent@cursor.com");
const COPILOT = who("copilot-swe-agent[bot]", "198982749+Copilot@users.noreply.github.com");
const DEVIN = who("devin-ai-integration[bot]", "158243242+devin-ai-integration[bot]@users.noreply.github.com");
const OPENCODE_BOT = who("opencode-agent[bot]", "opencode-agent[bot]@users.noreply.github.com");
const DAVE_AIDER = who("Dave Moe (aider)", "dave@example.com");

const CLAUDE = "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>";
const CODEX = "Co-authored-by: Codex <codex@openai.com>";
const CURSOR = "Co-authored-by: Cursor <cursoragent@cursor.com>";
const coAuthor = (p) => `Co-authored-by: ${p.name} <${p.email}>`;

/**
 * Everything lives under one fresh temp `root` (the repo at root/repo unless `dir` is given);
 * delete `root` when done.
 */
export function buildFixture(dir) {
  const root = mkdtempSync(join(tmpdir(), "amscan-fixture-"));
  dir ??= join(root, "repo");
  mkdirSync(dir, { recursive: true });
  // an empty global config keeps the user's hooks, signing and templates out of the fixture
  const emptyConfig = join(root, "gitconfig");
  writeFileSync(emptyConfig, "");
  const baseEnv = { ...process.env, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: "1" };
  const git = (args, env = {}) =>
    execFileSync("git", args, { cwd: dir, env: { ...baseEnv, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const as = (p, hours) => {
    const date = `${Math.round(START + hours * HOUR)} +0000`;
    return {
      GIT_AUTHOR_NAME: p.name,
      GIT_AUTHOR_EMAIL: p.email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: p.name,
      GIT_COMMITTER_EMAIL: p.email,
      GIT_COMMITTER_DATE: date,
    };
  };
  const write = (path, content) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  };
  const commit = (hours, p, message, files) => {
    for (const [path, content] of Object.entries(files)) write(path, content);
    git(["add", "-A"]);
    git(["commit", "-q", "--no-verify", "--cleanup=whitespace", "-m", message], as(p, hours));
  };
  const msg = (subject, ...trailers) => (trailers.length ? `${subject}\n\n${trailers.join("\n")}` : subject);
  const touch = (path, hours) => ({ [path]: `${path} at ${hours}h\n` });

  git(["init", "-q", "-b", "main"]);
  git(["config", "commit.gpgsign", "false"]);
  git(["config", "core.autocrlf", "false"]);

  // outside the 90-day window
  commit(-91 * 24 + 600, DAVE, "chore: old history", { "OLD.md": "old\n" });
  commit(0, DAVE, "chore: init", { "README.md": "line1\nline2\nline3\nline4\n" });

  // A. one commit per signal, each on its own file
  commit(1, ALICE, msg("feat: a1", CLAUDE), touch("attr/01.txt", 1));
  commit(2, BOB, msg("feat: a2", "Claude-Session: https://claude.ai/code/session_fixture"), touch("attr/02.txt", 2));
  commit(3, CLAUDE_BOT, "feat: a3", touch("attr/03.txt", 3));
  commit(4, CAROL, msg("feat: a4", "🤖 Generated with [Claude Code](https://claude.com/claude-code)"), touch("attr/04.txt", 4));
  commit(5, ALICE, msg("feat: a5", CODEX), touch("attr/05.txt", 5));
  commit(6, BOB, msg("feat: a6", CURSOR), touch("attr/06.txt", 6));
  commit(7, CURSOR_AGENT, msg("feat: a7", coAuthor(CAROL)), touch("attr/07.txt", 7));
  commit(8, COPILOT, msg("feat: a8", coAuthor(ALICE)), touch("attr/08.txt", 8));
  commit(9, DEVIN, "feat: a9", touch("attr/09.txt", 9));
  commit(10, BOB, msg("feat: a10", "Co-authored-by: google-labs-jules[bot] <161369871+google-labs-jules[bot]@users.noreply.github.com>"), touch("attr/10.txt", 10));
  commit(11, CAROL, msg("feat: a11", "Co-authored-by: aider (gpt-5) <aider@aider.chat>"), touch("attr/11.txt", 11));
  commit(12, DAVE_AIDER, "feat: a12", touch("attr/12.txt", 12));
  commit(13, ALICE, msg("feat: a13", "Amp-Thread-ID: https://ampcode.com/threads/T-1", "Co-authored-by: Amp <amp@ampcode.com>"), touch("attr/13.txt", 13));
  commit(14, BOB, msg("feat: a14", "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"), touch("attr/14.txt", 14));
  commit(15, CAROL, msg("feat: a15", "🤖 Generated with [Gemini CLI](https://github.com/google-gemini/gemini-cli)"), touch("attr/15.txt", 15));
  commit(16, ALICE, msg("feat: a16", "Co-authored-by: Antigravity <antigravity@gemini.google.com>"), touch("attr/16.txt", 16));
  commit(17, BOB, msg("feat: a17", "Co-authored-by: opencode (glm-5) <ai@local>"), touch("attr/17.txt", 17));
  commit(18, CAROL, msg("feat: a18", "Co-authored-by: gemini-code-assist[bot] <176961590+gemini-code-assist[bot]@users.noreply.github.com>"), touch("attr/18.txt", 18));
  commit(19, ALICE, msg("feat: a19 squash of two agents", "Co-Authored-By: Claude <noreply@anthropic.com>", CODEX), touch("attr/19.txt", 19));
  commit(20, OPENCODE_BOT, "chore: generate", touch("attr/20.txt", 20));

  // people without marks, automation, an unknown bot
  [ALICE, BOB, CAROL, DAVE, ALICE, BOB].forEach((p, i) => commit(21 + i, p, `fix: h${i + 1}`, touch(`human/${i + 1}.txt`, 21 + i)));
  commit(27, DEPENDABOT, "chore(deps): bump a", touch("deps/a.json", 27));
  commit(28, DEPENDABOT, "chore(deps): bump b", touch("deps/b.json", 28));
  commit(29, ACME_BOT, "feat: k1", touch("bot/k.txt", 29));

  // B. the overlap ladder on src/api.ts: 1 / 2 / 4 at 6h / 24h / 72h
  commit(100, ALICE, msg("feat: b1", CLAUDE), touch("src/api.ts", 100));
  commit(102, CAROL, msg("feat: b2", CODEX), touch("src/api.ts", 102));
  commit(110, BOB, msg("feat: b3", CLAUDE), touch("src/api.ts", 110));
  commit(150, ALICE, msg("feat: b4", CLAUDE), touch("src/api.ts", 150));
  commit(151, ALICE, msg("feat: b5", CLAUDE), touch("src/api.ts", 151));

  // traps that must count zero
  commit(200, ALICE, "fix: t1 by hand", touch("src/db.ts", 200));
  commit(201, ALICE, msg("fix: t1 with an agent", CLAUDE), touch("src/db.ts", 201));
  commit(210, ALICE, msg("chore: t2 lock", CLAUDE), touch("pnpm-lock.yaml", 210));
  commit(211, BOB, msg("chore: t2 lock", CODEX), touch("pnpm-lock.yaml", 211));
  const big = {};
  for (let i = 0; i < 150; i++) Object.assign(big, touch(`big/f${String(i).padStart(3, "0")}.txt`, 220));
  commit(220, ALICE, msg("refactor: t3 big", CLAUDE), big);
  commit(221, CAROL, msg("fix: t3 after big", CODEX), touch("big/f000.txt", 221));
  commit(230, DEPENDABOT, "chore(deps): t4", touch("src/x.ts", 230));
  commit(231, ALICE, msg("fix: t4", CLAUDE), touch("src/x.ts", 231));
  commit(235, ALICE, msg("chore: t5 regen", CLAUDE), touch("gen/client_generated.ts", 235));
  commit(236, BOB, msg("chore: t5 regen", CODEX), touch("gen/client_generated.ts", 236));

  // agent vs person: 1 at every window
  commit(240, ALICE, "fix: ui by hand", touch("src/ui.tsx", 240));
  commit(245, BOB, msg("fix: ui", CURSOR), touch("src/ui.tsx", 245));

  // C. merges
  const readme = (l2, l3) => ({ "README.md": `line1\n${l2}\n${l3}\nline4\n` });
  // C1: conflicted, resolved by a person
  git(["checkout", "-q", "-b", "c1"]);
  commit(300, CAROL, "docs: c1", readme("c1", "line3"));
  git(["checkout", "-q", "main"]);
  commit(301, DAVE, "docs: main 1", readme("main-1", "line3"));
  try {
    git(["merge", "--no-ff", "--no-edit", "c1"], as(ALICE, 302));
    throw new Error("fixture: c1 was expected to conflict");
  } catch (e) {
    if (!String(e.stdout ?? "").includes("CONFLICT")) throw e;
  }
  write("README.md", "line1\nresolved-1\nline3\nline4\n");
  git(["add", "README.md"]);
  git(["commit", "-q", "--no-verify", "-m", "Merge branch 'c1'"], as(ALICE, 302));
  // C2: conflicted, resolved with an agent
  git(["checkout", "-q", "-b", "c2"]);
  commit(303, CAROL, "docs: c2", { "README.md": "line1\nresolved-1\nc2\nline4\n" });
  git(["checkout", "-q", "main"]);
  commit(304, DAVE, "docs: main 2", { "README.md": "line1\nresolved-1\nmain-2\nline4\n" });
  try {
    git(["merge", "--no-ff", "--no-edit", "c2"], as(BOB, 305));
    throw new Error("fixture: c2 was expected to conflict");
  } catch (e) {
    if (!String(e.stdout ?? "").includes("CONFLICT")) throw e;
  }
  write("README.md", "line1\nresolved-1\nresolved-2\nline4\n");
  git(["add", "README.md"]);
  git(["commit", "-q", "--no-verify", "-m", msg("Merge branch 'c2'", "Co-Authored-By: Claude <noreply@anthropic.com>")], as(BOB, 305));
  // C3: clean
  git(["checkout", "-q", "-b", "c3"]);
  commit(306, CAROL, "feat: c3", touch("clean/c3.txt", 306));
  git(["checkout", "-q", "main"]);
  commit(307, DAVE, "feat: main 3", touch("clean/main3.txt", 307));
  git(["merge", "-q", "--no-ff", "-m", "Merge branch 'c3'", "c3"], as(DAVE, 308));
  // C4: clean octopus
  for (const [i, h] of [[1, 309], [2, 310], [3, 311]]) {
    git(["checkout", "-q", "-b", `o${i}`, "main"]);
    commit(h, CAROL, `feat: o${i}`, touch(`oct/o${i}.txt`, h));
  }
  git(["checkout", "-q", "main"]);
  git(["merge", "-q", "--no-ff", "-m", "Merge branches 'o1', 'o2' and 'o3'", "o1", "o2", "o3"], as(DAVE, 312));
  // C5: a codex/ branch: its two plain commits count as Codex
  git(["checkout", "-q", "-b", "codex/feature"]);
  commit(313, BOB, "feat: codex a", touch("feature/codex-a.ts", 313));
  commit(314, BOB, "feat: codex b", touch("feature/codex-b.ts", 314));
  git(["checkout", "-q", "main"]);
  commit(315, DAVE, "feat: main 5", touch("clean/main5.txt", 315));
  git(["merge", "-q", "--no-ff", "-m", "Merge pull request #7 from alice/codex/feature", "codex/feature"], as(DAVE, 316));
  // C6: unrelated histories (a vendored subtree), clean
  git(["checkout", "-q", "--orphan", "vendor"]);
  git(["rm", "-rfq", "."]);
  commit(317, CAROL, "chore: vendor lib", touch("vendor/lib.txt", 317));
  git(["checkout", "-q", "main"]);
  git(["merge", "-q", "--no-ff", "--allow-unrelated-histories", "-m", "Merge branch 'vendor'", "vendor"], as(DAVE, 318));

  // D. the window edge: exactly 24h counts, 24h + 1s does not
  commit(400, CAROL, msg("feat: edge", CODEX), touch("src/edge.ts", 400));
  commit(424, BOB, msg("feat: edge", CURSOR), touch("src/edge.ts", 424));
  commit(500, CAROL, msg("feat: edge 2", CODEX), touch("src/edge2.ts", 500));
  commit(524 + 1 / HOUR, BOB, msg("feat: edge 2", CURSOR), touch("src/edge2.ts", 524));

  return { root, dir, now: NOW, env: baseEnv };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { dir } = buildFixture(process.argv[2]);
  console.log(dir);
}
