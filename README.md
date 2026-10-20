# agentmash-scan

Count how often your AI coding agents stepped on each other's files.

```
npx agentmash scan
```

`npx agentmash-scan` runs the same thing directly.

Runs on your machine, reads git history only, sends nothing anywhere.

```
agentmash scan · last 90 days · my-app (main)

Agents in history
  Claude Code          14 commits
  Codex                 9 commits
  Cursor                5 commits
  Unattributed         20 commits   no agent mark, 31% of commits
  Automation            4 commits   dependency, release and CI bots

Collisions
  Same file changed by 2+ agents within 24h     3 times
  Agent and human on the same file within 24h   1 time
  Merges that conflicted                        2 of 6
    resolved by Claude Code                     1
    resolved by a human                         1
  Hottest files
    src/api.ts                                  2 overlaps
    src/edge.ts                                 1 overlap

Your AI agents stepped on each other 3 times in 90 days.
Counted when two agent sessions changed the same file within 24h of each other.
This is a lower bound: rebases and squash merges hide conflicts.
Attribution is heuristic: 20 commits had no agent mark.

Share your number:   npx agentmash scan --card
Catch it live:       npx agentmash login
```

That output comes from the test repo in `test/fixtures`, shortened.

## What it counts

**Which agent made a commit.** In this order: a `Co-authored-by` or other trailer (`Co-Authored-By: Claude …`, `Amp-Thread-ID: …`), a bot author (`copilot-swe-agent[bot]`, `Cursor Agent`), a marker in the message (`Generated with Claude Code`), a branch name in a merge subject (`codex/…`, `claude/…`). Commits without any of these are **Unattributed**, and their share is always printed. Dependency and release bots are counted as automation; other bots are listed by name and never guessed.

**Overlaps.** The same file changed by two different agent sessions within the window (24h by default). A session is an agent plus a person: your Claude Code and your teammate's Claude Code are two sessions. Each (file, commit) pair counts once. Lockfiles, changelogs, generated files (`*_generated.*`, `*.gen.*`, `linguist-generated` in `.gitattributes`) and commits touching more than 100 files are left out.

**Conflicted merges.** Every two-parent merge in the period is merged again with `git merge-tree`; if git reports a conflict, the merge was conflicted. Whoever authored the merge commit resolved it. Needs git 2.38 or newer; on older git this part is skipped and the output says so.

**Not counted:** tokens and money. Git history doesn't contain them.

**Limits, printed every time:**
- It's a lower bound. Squash merges and rebases resolve conflicts in branches git doesn't keep, so most teams show few conflicted merges. On a squash-merge repo the time of a commit is the time its PR landed, so an overlap there means two PRs landed on the same file within the window.
- Attribution is heuristic. An agent that doesn't sign its commits can't be seen. Teams strip trailers, and some agents never add them.

## Options

| Flag | Default | |
|---|---|---|
| `[path]` | current directory | the repository to scan |
| `--days <n>` | 90 | period |
| `--window <time>` | 24h | how close two changes must be: `90m`, `6h`, `3d` |
| `--branch <name>` | current branch | branch or commit to scan |
| `--json` | off | the numbers as JSON |
| `--card` | off | save `scan.png` (1200x675, X) and `scan-1080x1350.png` (Instagram, LinkedIn) |
| `--share` | off | open a post on X with your number |
| `--show-repo` | off | put the repo name on the card and in the post |
| `--contribute` | off | add your anonymous counts to the monthly agent collision report |
| `--agent-bot <name>` | | count a bot author as an agent, e.g. `--agent-bot "keppo-bot[bot]"` |

Exit codes: 0 done, 1 git problem (not a repo, unknown branch), 2 bad flags.

## Privacy

- No login and no network calls. The only download is npx fetching the package.
- Read-only: `git merge-tree` writes its merged trees into a temporary object directory, which is deleted afterwards; nothing is written into your `.git`.
- The card shows a number, one sentence, agent names and the command. No file paths, and no repo name unless you pass `--show-repo`. The X post holds the same.
- At the end of an interactive run it asks once: *Add your anonymous counts to the monthly agent collision report? (y/N)*. The default is no. A yes, or `--contribute`, opens agentmash.dev in your browser with the counts in the page address after `#`, the part browsers never send to a server. They hold commits per agent, overlaps, conflicted merges and the period, and nothing else: no paths, repo names, people or bot names. Nothing leaves your machine unless you press Send on that page.
- The question is skipped with `--json`, in CI (`CI` set), when input or output isn't a terminal, or with `AGENTMASH_SCAN_NO_ASK=1`. `BROWSER=none` prints links instead of opening them.

## Agents it recognises

| Agent | Recognised by |
|---|---|
| Claude Code | trailer, bot author, message marker, `claude/` branch |
| Codex | trailer, bot author, message marker, `codex/` branch |
| Cursor | trailer, bot author, `cursor/` branch |
| GitHub Copilot | trailer, bot author, `copilot/` branch |
| Devin | trailer, bot author, `devin/` branch |
| Gemini CLI | trailer, bot author, message marker |
| Antigravity | trailer |
| Gemini Code Assist | trailer |
| Jules | trailer, bot author |
| Aider | trailer, author suffix `(aider)` |
| OpenCode | trailer, bot author |
| Amp | trailer |
| Factory Droid | trailer, bot author |

Every rule lives in [`data/attribution.json`](data/attribution.json) with a link to a real commit that shows it; the research is in [`reference/DISCOVERY.md`](reference/DISCOVERY.md). To add an agent or a signal, add a rule with `"status": "verified"` and at least one commit link in `evidence`. Rules without evidence stay `unverified` and are never applied.

## As a library

```js
import { scan, formatReport } from "agentmash-scan";

const result = await scan({ cwd: "path/to/repo", days: 90, windowHours: 24 });
console.log(result.overlaps.agentAgent, result.merges.conflicted);
process.stdout.write(formatReport(result));
```

`scan()` never prints and never touches the network. `renderCard()`, `writeCards()`, `shareText()` and `contribution()` are exported too.

## Requirements

Node 20 or newer and git. The merge check needs git 2.38 or newer (the git that ships with Xcode is 2.39).

## Development

```
npm test        # builds, then runs the tests against fixture repos with known numbers
npm run bench   # a 10,000-commit repo must scan in under 10 seconds
```

## License

MIT. The bundled fonts (Manrope, JetBrains Mono) are under the SIL Open Font License 1.1, see [`fonts/OFL.txt`](fonts/OFL.txt).
