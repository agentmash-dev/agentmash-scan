# agentmash-scan plan

Status: discovery done, waiting for approval. Numbers behind every decision are in [reference/DISCOVERY.md](reference/DISCOVERY.md).

## What ships

`npx agentmash-scan` (later `npx agentmash scan`) reads the local git history of one branch and prints how often AI coding agents changed the same file within a window, how many merges conflicted, and which agents made which commits. Fully local. The core is a library; the CLI is a thin layer over it so the main `agentmash` CLI can call `scan()` directly.

## Definitions (the tests assert these)

- **Commit set**: commits reachable from `--branch` (default `HEAD`) whose committer date is within `--days` of `now`. `now` is an option of the library so tests are deterministic.
- **Attribution**: rules in `data/attribution.json`, only `status: "verified"` rules apply. Precedence trailer > author > message > branch. A commit can carry several agents (GitHub squash merges copy every co-author); the first by precedence is the primary agent, the rest are kept and counted as a multi-agent commit.
- **Buckets**: every non-merge commit lands in exactly one of agent, Unattributed, automation (known dependency/release/CI bots), unknown bot (any other `[bot]`, printed by name, never guessed as an agent). A commit attributed only through an agent bot's author identity whose subject looks like codegen, release or hash-update work is automation (`bot_chores` in the rules): agent bots double as CI identities.
- **Person**: author after `.mailmap`; same name or same email means the same person. For a bot-authored agent commit with exactly one human `Co-authored-by`, the person is that human (Copilot and Cursor background agents work this way).
- **Actor**: (agent, person). Alice's Claude Code and Bob's Claude Code are two actors.
- **Overlap**: a (file, commit B) pair where an earlier commit A touched the same file, `B.authorTime - A.authorTime <= window`, both are agent commits, and `actor(A) != actor(B)`. Each (file, B) counts once. Author time, because rebases rewrite committer time.
- **Agent vs human overlap**: same rule with one side Unattributed and a different person. Counted and printed, not in the headline (see open questions).
- **Noise**: lockfiles, `CHANGELOG.md`, and commits touching more than 100 files are left out of overlaps (rules in `data/attribution.json` under `noise`). Automation and unknown bots are left out of overlaps.
- **Conflicted merge**: a two-parent merge in the commit set for which `git merge-tree --write-tree` reports a conflict. Octopus merges are counted and skipped (git's octopus strategy refuses conflicting merges, so a recorded octopus merge was clean). Merges with a missing parent (shallow clone) are counted and skipped with a warning.
- **Resolver**: attribution of the merge commit itself (author + trailers in its message).
- **Hottest files**: top 5 files by headline overlaps. Terminal only, never on the card or in `--share`.
- **Headline**: `Your AI agents stepped on each other N times in D days.` where N = overlaps (agent vs agent, default window).

## Modules

```
src/
  index.ts          public API: scan(), formatReport(), renderCard(), types
  scan.ts           orchestrates the passes, returns ScanResult (pure data, no I/O besides git)
  git/run.ts        spawns git, streams stdout, maps errors, checks git >= 2.38 and shallow state
  git/log.ts        streaming parser for `git log -z --no-renames --name-only --format=...`
  git/merges.ts     cat-file --batch-check on parents, then `merge-tree --stdin --allow-unrelated-histories` batches
                    (one per CPU core) with a temp object dir and a time budget
  rules.ts          loads and validates data/attribution.json, compiles regexes once
  attribute.ts      per-commit attribution, branch-prefix pass over merge subjects, person and actor identity
  overlaps.ts       per-file sliding window, agent/agent and agent/human counts, hottest files
  report.ts         terminal text: tables, headline, the two printed limits, the two next-step lines; NO_COLOR aware
  json.ts           `--json` output with a schema version
  card/svg.ts       SVG for 1200x675 and 1080x1350 from ScanResult (number, line, agent names, command)
  card/render.ts    SVG to PNG with @resvg/resvg-wasm, fonts passed as buffers, loaded lazily
  card/fonts/       Manrope and JetBrains Mono TTF subsets (OFL) + OFL.txt; the site's faces, resvg cannot read woff2
  share.ts          X intent URL with numbers and agent names only; opens the default browser
  contribute.ts     the end-of-run question and the --contribute path (see open question 5)
  cli.ts            node:util parseArgs, flags, TTY checks, exit codes
data/attribution.json
test/
  fixtures/build-fixture.mjs   deterministic small repo with known numbers
  fixtures/expected.json       exact expected numbers per window
  fixtures/build-big.mjs       10K-commit repo through git fast-import for the speed check
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

Measured (DISCOVERY.md §5): 10,000 real commits with 1,031 merges in 1.15 s. The git log pass and merge-tree are the two costs; parsing, attribution and overlaps together are under 0.2 s.

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
- 6 plain human commits (Unattributed), 2 `dependabot[bot]` commits (automation), 1 `keppo-bot[bot]` commit (unknown bot)
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

1. **Git layer and attribution.** `git/run.ts`, `git/log.ts`, `rules.ts`, `attribute.ts`, `scan()` returning commit counts per bucket and agent; fixture builder with the attribution part; tests with exact counts. `--json` prints that much.
2. **Overlaps.** `overlaps.ts` with windows, actor rules, noise filters, hottest files; fixture overlap part; tests for 6h / 24h / 72h and every trap.
3. **Merges.** `git/merges.ts`: version gate (skip with a printed note below git 2.38), parent check, batch merge-tree in a temp object dir with `--allow-unrelated-histories`, per-core batches and the time budget, octopus and shallow handling, resolvers; fixture merge part, an unrelated-history merge, and the shallow clone test.
4. **Terminal report and flags.** `report.ts`, `json.ts`, `cli.ts` with `--days --window --branch --json --show-repo`; snapshot test of the text output; `build-big.mjs` and `npm run bench`.
5. **Card and share.** `card/svg.ts`, `card/render.ts`, font subsets, `--card` writing `scan.png` (both sizes), `--share` opening the X intent; visual check of both sizes in light and dark viewers.
6. **Contribute and release.** The y/N question and `--contribute` (after open question 5 is decided), README, `private: false`, `npm publish` 0.1.0, GitHub release.
7. **`npx agentmash scan`.** In the main agentmash repo: a `scan` subcommand that depends on `agentmash-scan` and calls `scan()`. Separate prompt, separate repo.

## Open questions for Damir

1. `scan` or `wrapped`.
2. Default window.
3. Agent vs human overlaps in the headline or not.
4. Unknown bots (custom GitHub Apps that write features): show by name only, or let the user mark them as agents with a flag.
5. `--contribute` against "no network calls in the package": the spec asks it to send counts, the constraints forbid network calls. Proposal: `--contribute` opens a prefilled page in the browser (counts in the URL fragment, which never reaches a server until the person presses submit there), so the package itself never opens a socket.

Recommendations with numbers are in the chat reply and in DISCOVERY.md.
