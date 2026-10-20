# agentmash-scan plan

Status (2026-10-20): milestones 1-6 built, tested and pushed; 0.1.0 is packed and waits for the npm publish. Milestone 7 lives in the main agentmash repo. Numbers behind every decision are in [reference/DISCOVERY.md](reference/DISCOVERY.md).

## What ships

`npx agentmash-scan` (later `npx agentmash scan`) reads the local git history of one branch and prints how often AI coding agents changed the same file within a window, how many merges conflicted, and which agents made which commits. Fully local. The core is a library; the CLI is a thin layer over it so the main `agentmash` CLI can call `scan()` directly.

## Definitions (the tests assert these)

- **Commit set**: commits reachable from `--branch` (default `HEAD`) whose committer date is within `--days` of `now`. `now` is an option of the library so tests are deterministic.
- **Attribution**: rules in `data/attribution.json`, only `status: "verified"` rules apply. Precedence trailer > author > message > branch. A commit can carry several agents (GitHub squash merges copy every co-author); the first by precedence is the primary agent, the rest are kept and counted as a multi-agent commit.
- **Buckets**: every non-merge commit lands in exactly one of agent, Unattributed, automation (known dependency/release/CI bots), unknown bot (any other `[bot]`, printed by name, never guessed as an agent). A commit attributed only through an agent bot's author identity whose subject looks like codegen, release or hash-update work is automation (`bot_chores` in the rules): agent bots double as CI identities.
- **Person**: author after `.mailmap`; same name or same email means the same person. For a bot-authored agent commit with exactly one human `Co-authored-by`, the person is that human (Copilot and Cursor background agents work this way).
- **Actor**: (agent, person). Alice's Claude Code and Bob's Claude Code are two actors.
- **Overlap**: a (file, commit B) pair where an earlier commit A touched the same file, `B.authorTime - A.authorTime <= window`, both are agent commits, and `actor(A) != actor(B)`. Each (file, B) counts once. Author time, because rebases rewrite committer time.
- **Agent vs human overlap**: same rule with one side Unattributed and a different person. Counted and printed one line under the agent count, never in the headline.
- **Noise**: lockfiles, `CHANGELOG.md`, and commits touching more than 100 files are left out of overlaps (rules in `data/attribution.json` under `noise`); together they were 35% of unfiltered agent/agent overlaps. Generated code (`*_generated.*`, `*.gen.*`, `linguist-generated` in `.gitattributes`) showed up among the hottest files and is filtered too. Automation and unknown bots are left out of overlaps.
- **Conflicted merge**: a two-parent merge in the commit set for which `git merge-tree --write-tree` reports a conflict. Octopus merges are counted and skipped (git's octopus strategy refuses conflicting merges, so a recorded octopus merge was clean). Merges whose parent is missing or not a commit are counted and skipped. A shallow clone hides the parents of its boundary commits; those keep their place in the counts but lose their file lists, and the report says the numbers are partial.
- **Resolver**: attribution of the merge commit itself (author + trailers in its message).
- **Hottest files**: top 5 files by headline overlaps (the terminal shows 3). Terminal and `--json` only, never on the card or in `--share`.
- **Headline**: `Your AI agents stepped on each other N times in D days.` where N = overlaps (agent vs agent, default window 24h). The line under it says how it was counted.

## Modules

```
src/
  index.ts          public API: scan(), formatReport(), headline(), renderCard(), writeCards(), shareText(), contribution(), types
  scan.ts           orchestrates the passes, returns ScanResult (pure data, no I/O besides git)
  git/run.ts        spawns git, streams stdout, maps errors, git version, repo facts (root, objects dir, shallow boundary)
  git/log.ts        streaming parser for `git log -z --no-renames --name-only --format=...`
  git/merges.ts     cat-file --batch-check on parents, then `merge-tree --stdin --allow-unrelated-histories` batches
                    (one per CPU core) in temp object dirs, with a 6 s budget
  rules.ts          loads and validates data/attribution.json, compiles regexes once, adds --agent-bot agents
  attribute.ts      trailers, per-commit attribution and buckets, branch candidates, person identity
  overlaps.ts       per-file sliding window, agent/agent and agent/human counts, hottest files, linguist-generated lookup
  report.ts         terminal text (headline, its definition, both limits, next steps; NO_COLOR aware) and --json
  card/svg.ts       SVG for 1200x675 and 1080x1350: number, sentence, agent names, command; measured with real glyph widths
  card/metrics.ts   advance widths generated from the bundled fonts
  card/render.ts    SVG to PNG with @resvg/resvg-wasm, fonts passed as buffers, loaded on first use only
  share.ts          X intent text and URL (numbers and agent names only), handed to the system browser
  contribute.ts     aggregates for the monthly report, the URL-fragment link, when to ask, what counts as yes
  args.ts           node:util parseArgs, flag validation, help text
  cli.ts            runs the scan, prints, writes cards, asks the one question, exit codes
fonts/              static Manrope 500/800 and JetBrains Mono 400 TTF subsets + OFL.txt (resvg reads TTF, not woff2)
scripts/build-fonts.py  rebuilds fonts/ and src/card/metrics.ts from the site's woff2 files
data/attribution.json
test/
  fixtures/build-fixture.mjs   deterministic small repo with known numbers
  fixtures/expected.json       exact expected numbers per window
  fixtures/report.txt          the terminal report snapshot
  fixtures/build-big.mjs       10K-commit repo through git fast-import for the speed check
  bench.mjs                    npm run bench
  *.test.mjs                   node:test against dist/
```

`scan()` never prints and never touches the network. `cli.ts` is the only file that reads argv, writes to stdout or asks a question.

## Dependencies

| package | kind | why |
|---|---|---|
| `@resvg/resvg-wasm` 2.6.2 | runtime | SVG to PNG for `--card`. 2.4 MB, one file for every OS and CPU, no install scripts, no native binary. Rendered a 1200x675 card in 46 ms warm and 13 ms init; the native `@resvg/resvg-js` took 1.75 s on its first load on macOS arm64 (every `npx` run is a first load) and needs a platform package per OS. Loaded with a dynamic `import()` only when `--card` is set. |
| `typescript` 5.9 | dev | strict build to `dist/` |
| `@types/node` 20 | dev | Node 20 is the floor |

Nothing else: `node:util` parseArgs for flags, `node:readline/promises` for the y/N question, `node:child_process` for git and for opening the browser, `node:test` for tests, plain ANSI codes for colour.

Rejected: `canvas` (downloads a prebuilt from GitHub at install, falls back to node-gyp + cairo), `@napi-rs/canvas` (28 MB per platform), `sharp` (18 MB libvips per platform, and it still needs an SVG renderer underneath), `satori` (26 MB, and only produces SVG).

## Speed budget (10K commits, target < 10 s)

Measured (DISCOVERY.md §5): the newest 10,000 commits take 0.6–3.5 s in four real repos (1.15 s with 1,031 merges; 2.95 s in the largest repo, 20,623 commits, whose whole history takes 3.49 s). The git log pass (0.4–1.0 s per 10,000 commits) and merge-tree are the two costs; parsing, attribution and overlaps together stay under 0.31 s.

The risk is merge-tree outliers, not volume: one branch-promotion merge with 8,207 files changed between its parents took 2.2 s on its own, while the other 16 merges in that repo took about 20 ms each. So `git/merges.ts`:
- reruns only merges inside `--days`;
- splits them into one `merge-tree --stdin` batch per CPU core (`os.availableParallelism()`), each in its own temp object directory;
- stops at a time budget (default 6 s for the merge pass) and reports `checked X of Y merges` instead of a silent partial count.

`build-big.mjs` keeps this honest in local runs (`npm run bench`).

## Test fixture

`test/fixtures/build-fixture.mjs <dir>` builds the repo with plain git commands, fixed identities, `GIT_AUTHOR_DATE` / `GIT_COMMITTER_DATE` set per commit, `commit.gpgsign=false`, `core.autocrlf=false`. Tests call `scan({ cwd, now: FIXTURE_NOW })`. Times below are hours after the fixture start; `now` is start + 600 h.

Attribution, one commit per verified signal, each on its own file so it creates no overlap:
- alice + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, bob + `Claude-Session: https://claude.ai/code/session_x`, `claude[bot]` author, carol + `Generated with [Claude Code]`
- alice + `Co-authored-by: Codex <codex@openai.com>`, bob + `Co-authored-by: Cursor <cursoragent@cursor.com>`, `Cursor Agent <cursoragent@cursor.com>` author with carol as co-author (person = carol), `copilot-swe-agent[bot]` with alice as co-author, one per other verified agent
- one squash-style commit with Claude and Codex trailers (multi-agent, primary Claude Code)
- branch `codex/feature` with two plain commits merged as `Merge pull request #7 from alice/codex/feature` (both count as Codex through the branch rule)
- 6 plain human commits (Unattributed), 2 `dependabot[bot]` commits (automation), 1 `acme-agent[bot]` commit (unknown bot)
- 1 commit dated 91 days before `now` (outside `--days 90`)

Overlaps on `src/api.ts`:

| t (h) | actor | 6h | 24h | 72h |
|---|---|---|---|---|
| 100 | alice + Claude Code | | | |
| 102 | carol + Codex | +1 | +1 | +1 |
| 110 | bob + Claude Code | | +1 | +1 |
| 150 | alice + Claude Code | | | +1 |
| 151 | alice + Claude Code (same actor as 150) | | | +1 |

Traps that must stay at zero: alice human then alice + Claude on `src/db.ts` one hour apart (same person), Claude and Codex on `pnpm-lock.yaml` (noise), a 150-file Claude commit followed by Codex on one of those files (big commit), `dependabot[bot]` then Claude on `src/x.ts` (automation). Agent vs human: alice human then bob + Cursor on `src/ui.tsx` 5 h apart = 1. Window edge: Codex at 400 h and Cursor at exactly 424 h on `src/edge.ts` count at 24h (`<=`); a twin pair 24 h + 1 s apart does not.

Merges: two conflicted merges on `README.md` line 2 (one resolved by alice, one whose merge message carries a Claude trailer), one clean merge, one clean octopus of three branches, and the `codex/feature` merge. Expected: 5 merges, 4 rerun, 1 octopus skipped, 2 conflicted, resolvers `{ human: 1, "Claude Code": 1 }`.

Shallow case: `git clone --depth 3 file://<fixture>` must report the skipped merges and a warning, not crash.

`expected.json` holds every number above per window (6h, 24h, 72h). `build-big.mjs` streams 10,000 commits over 2,000 files with 4 agents, 8 people and 500 merges (50 conflicting) through `git fast-import` and asserts a full scan under 10 s.

## Milestones (one prompt each)

1. **Git layer and attribution.** Done. `git/run.ts`, `git/log.ts`, `rules.ts`, `attribute.ts`, `scan()` returning commit counts per bucket and agent; fixture builder with the attribution part; tests with exact counts. `--json` prints that much.
2. **Overlaps.** Done. `overlaps.ts` with windows, actor rules, noise filters, hottest files; fixture overlap part; tests for 6h / 24h / 72h and every trap.
3. **Merges.** Done. `git/merges.ts`: version gate (skip with a printed note below git 2.38), parent check, batch merge-tree in a temp object dir with `--allow-unrelated-histories`, per-core batches and the time budget, octopus and shallow handling, resolvers; fixture merge part, an unrelated-history merge, and the shallow clone test.
4. **Terminal report and flags.** Done. `report.ts` (with --json), `args.ts`, `cli.ts` with `--days --window --branch --json --show-repo`; snapshot test of the text output; `build-big.mjs` and `npm run bench`.
5. **Card and share.** Done. `card/svg.ts`, `card/render.ts`, font subsets, `--card` writing `scan.png` (both sizes), `--share` opening the X intent; visual check of both sizes in light and dark viewers.
6. **Contribute and release.** Done up to the publish: the y/N question, `--contribute`, README, 0.1.0 packed and run through `npx` from the tarball. Left: `private: false`, `npm publish`, GitHub release.
7. **`npx agentmash scan`.** In the main agentmash repo: a `scan` subcommand that depends on `agentmash-scan` and calls `scan()`. Separate prompt, separate repo.

## Decisions (approved by Damir, 2026-10-20)

Numbers from DISCOVERY.md §3, §4 and §10.

1. **`scan` or `wrapped`: `scan`.** At least 8 "wrapped" packages for coding agents are on npm already, 7 published in 2026, all of them personal usage recaps (tokens, sessions), which this tool does not compute. `agentmash-scan` is free on npm and becomes `npx agentmash scan` later without a rename.
2. **Default window: 24h.** The count grows smoothly with the window (6h keeps a median 0.45x of 24h, 72h gives 1.9x), so no cut-off is hiding in the data. 6h shows zero in 3 of 9 repos; 72h doubles human/human overlaps too (4,988 to 9,829), so most of what it adds is coincidence. On squash repos the time is the landing time, so 24h reads as "landed the same day".
3. **Agent vs human: not in the headline, printed one line below it.** Agent/human overlaps are a median 8.7x the agent/agent count, and the "human" side is the Unattributed bucket, which in the agent-heavy repos is 92–96% written by people who use agents. It would turn the headline into a number about our weakest classification. Related decision already taken in the definitions, flag it if you disagree: overlaps are counted per actor (agent + person), so Alice's Claude Code vs Bob's Claude Code counts. Counting per tool only would cut the total from 1,031 to 429, and to near zero in single-agent repos.
4. **Unknown bots** (custom GitHub Apps that write features, up to 45% of a repo's commits): print them by name, and add a `--agent-bot <name>` flag so a user can count one as an agent. Built.
5. **`--contribute` vs "no network calls in the package"**: the spec asks it to send counts, the constraints forbid network calls. Proposal: `--contribute` opens a prefilled page in the browser (counts in the URL fragment, which never reaches a server until the person presses submit there), so the package itself never opens a socket. Built; the page is not live yet (below).
6. **Headline wording**: an overlap is "landed on the same file within 24h", not a conflict; conflicted merges were 11 in 90 days across 9 repos. Keep "stepped on each other" in the headline, and print the definition on the line under it so the number survives a skeptical reply.

## Left before 0.1.0 goes public

- **The contribute page.** `--contribute` and a yes to the end-of-run question open `https://agentmash.dev/scan/report#<counts>`. That page has to read the fragment, show the counts and send them on Send. It belongs to the site in the main repo, which this repo does not touch; until it exists, a yes lands on a page that isn't there.
- **The command people copy.** The card, the report and the post say `npx agentmash-scan`, the command that works today. When milestone 7 ships `npx agentmash scan`, change `DEFAULT_COMMAND` in `src/report.ts`.
- **Publish.** `private: false`, `npm publish`, a GitHub release for v0.1.0.
