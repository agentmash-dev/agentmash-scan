// A 10,000-commit repo for the speed check, built in one `git fast-import` stream.
// Each 20-commit cycle: 18 main-line commits, one side-branch commit and its merge; every 10th merge conflicts.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const BIG_START = Date.UTC(2026, 0, 1) / 1000;
const STEP = 500; // seconds between commits: 10,000 commits span about 58 days
export const BIG_COMMITS = 10_000;
export const BIG_NOW = new Date((BIG_START + BIG_COMMITS * STEP + 3600) * 1000);

const PEOPLE = Array.from({ length: 8 }, (_, i) => [`Person ${i}`, `p${i}@example.com`]);
const TRAILERS = [
  "Co-Authored-By: Claude <noreply@anthropic.com>",
  "Co-authored-by: Codex <codex@openai.com>",
  "Co-authored-by: Cursor <cursoragent@cursor.com>",
  "Co-authored-by: Amp <amp@ampcode.com>",
];

export function buildBig() {
  const root = mkdtempSync(join(tmpdir(), "amscan-big-"));
  const dir = join(root, "repo");
  const emptyConfig = join(root, "gitconfig");
  writeFileSync(emptyConfig, "");
  const env = { ...process.env, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: "1" };
  execFileSync("git", ["init", "-q", "-b", "main", dir], { env });

  const out = [];
  const data = (s) => `data ${Buffer.byteLength(s)}\n${s}\n`;
  let k = 0;
  let mark = 0;
  let mainTip = 0;
  const who = (i) => PEOPLE[i % PEOPLE.length];
  const commit = ({ ref, from, merge, person, msg, files }) => {
    const ts = BIG_START + k * STEP;
    k++;
    mark++;
    const [name, email] = person;
    out.push(`commit ${ref}\nmark :${mark}\nauthor ${name} <${email}> ${ts} +0000\ncommitter ${name} <${email}> ${ts} +0000\n`);
    out.push(data(msg));
    if (from) out.push(`from :${from}\n`);
    if (merge) out.push(`merge :${merge}\n`);
    for (const [path, content] of files) out.push(`M 100644 inline ${path}\n${data(content)}`);
    out.push("\n");
    return mark;
  };
  const path = (i) => `src/m${i % 200}/f${Math.floor(i / 200) % 10}.ts`;
  const message = (i) => (i % 10 < 3 ? `change ${i}\n\n${TRAILERS[i % TRAILERS.length]}` : `change ${i}`);

  for (let cycle = 0; k < BIG_COMMITS; cycle++) {
    for (let j = 0; j < 17; j++) {
      const i = k;
      // one file from a hot set of 60 (so overlaps happen) and one from the long tail of 2,000
      const files = [[path((i * 13) % 60), `${i}\n`], [path(60 + ((i * 7) % 1940)), `${i}\n`]];
      mainTip = commit({ ref: "refs/heads/main", from: mainTip || undefined, person: who(i * 7 + j), msg: message(i), files });
    }
    const conflict = cycle % 10 === 0;
    const sideFile = path(cycle * 31 + 5);
    const mainFile = conflict ? sideFile : path(cycle * 31 + 6);
    const side = commit({ ref: `refs/heads/side${cycle}`, from: mainTip, person: who(cycle), msg: message(k), files: [[sideFile, `side ${k}\n`]] });
    mainTip = commit({ ref: "refs/heads/main", from: mainTip, person: who(cycle + 3), msg: message(k), files: [[mainFile, `main ${k}\n`]] });
    // the merge keeps the side's content, which resolves the conflict when there is one
    mainTip = commit({ ref: "refs/heads/main", from: mainTip, merge: side, person: who(cycle + 1), msg: `Merge branch 'side${cycle}'`, files: [[sideFile, `side ${k - 2}\n`]] });
  }
  execFileSync("git", ["fast-import", "--quiet"], { cwd: dir, env, input: out.join(""), maxBuffer: 1 << 28 });
  return { root, dir, now: BIG_NOW, conflicting: Math.ceil(BIG_COMMITS / 20 / 10), merges: BIG_COMMITS / 20 };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  console.log(buildBig().dir);
}
