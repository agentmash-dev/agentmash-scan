# Discovery

Date: 2026-10-20. Everything here was measured read-only on public repositories. Machine: Apple M4 (10 cores, 16 GB), macOS 26.2, Apple git 2.39.3, Node 22.23.

Commit links are evidence for attribution signals only. The measurement tables name no repository: repos are labelled R1–R9 with a coarse profile, and the mapping stays on the machine that ran the measurement (`reference/repos.local.json`, gitignored). Nothing here is meant as a score for a project or its maintainers.

## Summary

- **Attribution:** 13 agents, 39 verified signals, each with at least one commit link; 1 signal left unverified (`droid/` branch prefix). All 11 agents on the list have evidence, plus Antigravity, Gemini Code Assist and Copilot Autofix found on the way.
- **Unattributed is the main risk.** Median 48% of non-merge commits in 9 repos (range 14–81%). In the two repos where agents write half the commits (R2, R3), 92–96% of the Unattributed commits come from people who mark agent commits elsewhere in the same 90 days. Teams that build coding agents mark little of their own agent work (section 2).
- **Squash merges hide almost all conflicts.** 98–100% of PR landings are squash merges in all 9 repos. In 90 days the 9 repos had 72 merge commits and 11 conflicted merges in total; 6 repos had none.
- **Overlaps exist, and depend on definitions.** Agent/agent overlaps at 24h: median 29 per repo (0–598), 1,031 in total. 58% of them are the same tool run by different people. The noise filter (lockfiles, changelogs, 100+ file commits) removes 35%. 6h gives about 0.45x the 24h number, 72h about 1.9x.
- **Humans overlap too.** Human/human overlaps at 24h total 4,988 against 1,031 agent/agent; agent/human total 3,452.
- **Speed is fine.** The largest history (R1, 20,623 commits) scans whole in 3.49 s; its newest 10,000 commits in 2.95 s. 10,000 commits with 1,031 merges (R3) in 1.15 s. The risk is one huge merge (2.2 s alone), not the commit count.
- **merge-tree works on Apple git 2.39**, agrees with `git show --remerge-diff` on 20 of 20 real merges, and can run without writing a byte into the scanned repo.
- **Card renderer:** `@resvg/resvg-wasm`, 2.5 MB, no native binary, 46 ms per card and no cold-start penalty (the native build took 1.75 s on its first run).

## 1. How to reproduce

```
git clone --bare <repo-url> repo.git                   # full history, no checkout
node reference/measure.mjs repo.git --json             # 90 days, rules from data/attribution.json
node reference/measure.mjs repo.git --limit 10000      # timing on the newest 10,000 commits
```

`reference/measure.mjs` is a discovery script, not the product. It has no tests and skips one rule from the plan (mapping a bot-authored commit to its single human co-author). R5 was cloned with `--filter=blob:none` (full commit and tree history, file contents fetched on demand) because the full clone is 925 MB; its numbers are complete but it is left out of the timing and full-history merge tables.

## 2. Attribution signals

Searched with `gh search commits` (read-only) on 2026-10-20, plus the cloned repos. `verified` means at least one real commit shows the signal; nothing was added from memory. Only `verified` rules are applied.

| Agent | Kind | Signal | Status | Evidence |
|---|---|---|---|---|
| Claude Code | trailer | `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` | verified | [matthewwong525/WongStack@c22d448](https://github.com/matthewwong525/WongStack/commit/c22d448bfd8204994ba92f65b5f722762ce6f052)<br>[alexec/Agents@6e16de9](https://github.com/alexec/Agents/commit/6e16de9e5b9071b40b99f296dac4c1d5a31bb20f) |
| Claude Code | trailer | `Claude-Session: https://claude.ai/code/session_<id>` | verified | [maestroDev3/GreenFriend@7fb334d](https://github.com/maestroDev3/GreenFriend/commit/7fb334dc4760bd2abaaa0882e14be7a9d58996b9) |
| Claude Code | author | `claude[bot] <209825114+claude[bot]@users.noreply.github.com>` | verified | [beyondessential/tamanu@5db47f2](https://github.com/beyondessential/tamanu/commit/5db47f2051087d175c006673dedce491a5881d66) |
| Claude Code | message | `🤖 Generated with [Claude Code](https://claude.com/claude-code)` | verified | [usenotra/notra-mcp@29a03f5](https://github.com/usenotra/notra-mcp/commit/29a03f58008004655d7eb7e1f46fc44d435f413e)<br>[nuwave/lighthouse@3b6872c](https://github.com/nuwave/lighthouse/commit/3b6872c6755175ca303bb25e06535f6e0657e107) |
| Claude Code | branch | `claude/` | verified | [nelaka141/personnel-finance-manager@8d885cc](https://github.com/nelaka141/personnel-finance-manager/commit/8d885cc1a8f89abe060d53fd0b3f31393a2c65a8) |
| Codex | trailer | `Co-authored-by: Codex <codex@openai.com>` | verified | [pj-tmt/tmt@e1f206b](https://github.com/pj-tmt/tmt/commit/e1f206b3343cf5ee3652c124b324349a2d484557)<br>[openflowfm/visuals@f8b1358](https://github.com/openflowfm/visuals/commit/f8b135806eb1f3b2f576a35ce765a6425fe1b8e6) |
| Codex | trailer | `Co-authored-by: codex (gpt-5.5) <ai@local>`<br>same ai@local convention as the opencode trailer, one organisation | verified | [eclipse-oniro-mirrors/security_access_token@5673cf3](https://github.com/eclipse-oniro-mirrors/security_access_token/commit/5673cf34213a589bfcf9c908c91d9da3f4ca905a) |
| Codex | trailer | `Generated-with: Codex` | verified | [ivanarama/PromptPilot@4c68c1b](https://github.com/ivanarama/PromptPilot/commit/4c68c1b77bc28013c36f1d5394384726bdf1cf9a) |
| Codex | author | `chatgpt-codex-connector[bot] <chatgpt-codex-connector[bot]@users.noreply.github.com>` | verified | [LionSR/TNLean@de11a9e](https://github.com/LionSR/TNLean/commit/de11a9ef4d947b231e450d86104167c85d9ec27b) |
| Codex | message | `🤖 Generated with Codex` | verified | [AllenMuu/stackwatch@125f985](https://github.com/AllenMuu/stackwatch/commit/125f9850ed9be2b112a4353bd4b82e8a1a053c10)<br>[fglock/PerlOnJava@7e5035d](https://github.com/fglock/PerlOnJava/commit/7e5035d8fc67c4b704a78e6604564a061fd2abfd) |
| Codex | branch | `codex/` | verified | [scytrowski/dotty-rs@57da0cc](https://github.com/scytrowski/dotty-rs/commit/57da0cc0747a55e5b5930b9ab8ea3901343e6269) |
| Cursor | trailer | `Co-authored-by: Cursor <cursoragent@cursor.com>` | verified | [mattermost/mattermost@14ee0ae](https://github.com/mattermost/mattermost/commit/14ee0ae9a330c5fecf268731959c16a4c081e8be)<br>[undevy-org/tablewright@809750b](https://github.com/undevy-org/tablewright/commit/809750b2cb756f0e186e7c9eff43de122f2ea1b1) |
| Cursor | author | `Cursor Agent <cursoragent@cursor.com>`<br>background / cloud agent commits as itself, the human is a co-author | verified | [AuraHQ-ai/aura@f35a3e8](https://github.com/AuraHQ-ai/aura/commit/f35a3e80a083fc642d794140a3e6a88d46e3009a)<br>[AIRP-spec/inference-advocate@5091219](https://github.com/AIRP-spec/inference-advocate/commit/509121919cbd15df66d2586c4d4c0f2e408b7659) |
| Cursor | branch | `cursor/` | verified | [langfuse/langfuse@7393a37](https://github.com/langfuse/langfuse/commit/7393a37d9af02cd8b813ed336f4bfeaae0d85fdb) |
| GitHub Copilot | trailer | `Co-authored-by: copilot-swe-agent[bot] <198982749+Copilot@users.noreply.github.com>`<br>three ids seen: 198982749 coding agent, 223556219 local Copilot session, 175728472 Copilot Autofix | verified | [microsoft/typescript-go@65535b2](https://github.com/microsoft/typescript-go/commit/65535b2038f285dcb98703769bf08002b25ca5a7)<br>[microsoft/typescript-go@6924fef](https://github.com/microsoft/typescript-go/commit/6924feff43f1d5d95679be110f7e06e10697c8df)<br>[microsoft/typescript-go@0f714a5](https://github.com/microsoft/typescript-go/commit/0f714a5386993872feb5ab81795ec8e22c4638bd) |
| GitHub Copilot | trailer | `Co-authored-by: Copilot Autofix powered by AI <223894421+github-code-quality[bot]@users.noreply.github.com>`<br>code scanning / code quality autofix; a second bot id outside the +Copilot pattern | verified | [siemens/simatic-s7-webserver-api@2a7bcd8](https://github.com/siemens/simatic-s7-webserver-api/commit/2a7bcd8221b6baea79f959b72a17b36c56f772a0) |
| GitHub Copilot | trailer | `Copilot-Session: <uuid>` | verified | [microsoft/typescript-go@04f7f3d](https://github.com/microsoft/typescript-go/commit/04f7f3db2bf2b3fe51eedba2aafcb05a907ffa94) |
| GitHub Copilot | trailer | `Agent-Logs-Url: https://github.com/<owner>/<repo>/sessions/<uuid>` | verified | [Mryan2005/novel-manager@a6fc1df](https://github.com/Mryan2005/novel-manager/commit/a6fc1dfdf3befcf3f87fc81b76fb5d56128f739b) |
| GitHub Copilot | author | `copilot-swe-agent[bot] <198982749+Copilot@users.noreply.github.com>` | verified | [Mryan2005/novel-manager@a6fc1df](https://github.com/Mryan2005/novel-manager/commit/a6fc1dfdf3befcf3f87fc81b76fb5d56128f739b) |
| GitHub Copilot | branch | `copilot/` | verified | [microsoft/typescript-go@c6b013f](https://github.com/microsoft/typescript-go/commit/c6b013f5706d58582f566df778cc0df2683b58f5) |
| Devin | trailer | `Co-authored-by: Devin AI <158243242+devin-ai-integration[bot]@users.noreply.github.com>` | verified | [chhoumann/quickadd@c9de468](https://github.com/chhoumann/quickadd/commit/c9de468888781f470a76458930d1dc50f1e428af)<br>[Golem-Base/optimism@bf69c6b](https://github.com/Golem-Base/optimism/commit/bf69c6b9cb2c518705df1de898b06dbafa1e0024) |
| Devin | author | `devin-ai-integration[bot] <158243242+devin-ai-integration[bot]@users.noreply.github.com>`<br>display name also seen as Devin AI, so the rule matches the email | verified | [chhoumann/quickadd@dc9a650](https://github.com/chhoumann/quickadd/commit/dc9a6504c3c8704d743b0c08fdd8343bd375883f)<br>[kondabattulabalachandra-creator/LUXEE-GROWTH@e8f343a](https://github.com/kondabattulabalachandra-creator/LUXEE-GROWTH/commit/e8f343aefa06a9ff3d1e31829f472d74b8018864) |
| Devin | branch | `devin/` | verified | [kondabattulabalachandra-creator/LUXEE-GROWTH@e8f343a](https://github.com/kondabattulabalachandra-creator/LUXEE-GROWTH/commit/e8f343aefa06a9ff3d1e31829f472d74b8018864) |
| Gemini CLI | trailer | `Co-Authored-By: Gemini CLI <noreply@google.com>`<br>written by a wrapper ("via agent-pager"); the CLI itself showed no default trailer | verified | [a60708090xun/ccs-dashboard@97b5057](https://github.com/a60708090xun/ccs-dashboard/commit/97b505782c5af4c77f7afa77f1624d5ad6da06d2) |
| Gemini CLI | message | `🤖 Generated with [Gemini CLI](https://github.com/google-gemini/gemini-cli)` | verified | [iray-tno/ankiniki@5dd86a1](https://github.com/iray-tno/ankiniki/commit/5dd86a1c4d6ec693b4553f07166eb16447a408b5)<br>[charchess/vixens@8614b90](https://github.com/charchess/vixens/commit/8614b9022de39286477518fd715dc566bdade638) |
| Gemini CLI | author | `gemini-cli[bot] <gemini-cli[bot]@users.noreply.github.com>`<br>ambiguous: the same name also signs release bumps (chore(release): bump version) in gemini-cli forks | verified | [mscraftsman/generative-ai@9972d0c](https://github.com/mscraftsman/generative-ai/commit/9972d0c9e61d940eea09f25c0fa5deef02f1f0fb)<br>[Woiny27/gemini-cli@f8678f9](https://github.com/Woiny27/gemini-cli/commit/f8678f9e9def05a6b7753b90d95db33e9a9684de) |
| Antigravity | trailer | `Co-authored-by: Antigravity <antigravity@gemini.google.com>` | verified | [kidthales/tol-palettes@a577871](https://github.com/kidthales/tol-palettes/commit/a57787187820e259e1863f039d29b2739c25f9e1) |
| Antigravity | trailer | `Generated-by: Antigravity (Gemini 4 Argon)` | verified | [kidthales/tol-palettes@a577871](https://github.com/kidthales/tol-palettes/commit/a57787187820e259e1863f039d29b2739c25f9e1) |
| Gemini Code Assist | trailer | `Co-authored-by: gemini-code-assist[bot] <176961590+gemini-code-assist[bot]@users.noreply.github.com>`<br>review suggestions applied in the PR; AI-written lines, not the Gemini CLI | verified | [google-gemini/gemini-cli@a5cdfab](https://github.com/google-gemini/gemini-cli/commit/a5cdfab7216bcad51b2b354e2bc31b9a8380bfa7) |
| Jules | trailer | `Co-authored-by: google-labs-jules[bot] <161369871+google-labs-jules[bot]@users.noreply.github.com>` | verified | [gwelby/PhiFlow@a545915](https://github.com/gwelby/PhiFlow/commit/a5459152e32f13507796605cbc9852fb4a88f20a) |
| Jules | author | `google-labs-jules[bot] <161369871+google-labs-jules[bot]@users.noreply.github.com>` | verified | [Milky1919/heictoimg@add599a](https://github.com/Milky1919/heictoimg/commit/add599a5c25584c1a11bedb777e2fb16db8000ca) |
| Aider | author | `Paul Gauthier (aider) <paul@aider.chat>`<br>older Aider default: the user's own name with an (aider) suffix | verified | [Aider-AI/aider@9f1ef3f](https://github.com/Aider-AI/aider/commit/9f1ef3f49f6b14542c2a7fa954877a48c0a1813e) |
| Aider | trailer | `Co-authored-by: aider (ollama_chat/qwen3-coder:30b) <aider@aider.chat>`<br>the name carries the model; the same squash commits also carry Claude Code and Cursor Agent trailers | verified | [mattehe-creator/appfabriken@1abeef9](https://github.com/mattehe-creator/appfabriken/commit/1abeef91c5f331d10f9f5fb3c3bafa29079ac1da) |
| OpenCode | author | `opencode-agent[bot] <opencode-agent[bot]@users.noreply.github.com>`<br>the OpenCode GitHub agent; the same name also signs nightly publish commits in OpenCode's own repo | verified | [cloudflare/partykit@c31b339](https://github.com/cloudflare/partykit/commit/c31b339eda82ceee669318decd9feb2c254ef339)<br>[Qureshi-Inc/ezpm-cloud@2ce2ab2](https://github.com/Qureshi-Inc/ezpm-cloud/commit/2ce2ab234e994b64f9848b72ba5783d2976636c9) |
| OpenCode | trailer | `Co-authored-by: opencode (glm-5.2) <ai@local>`<br>seen in one organisation's repos with an ai@local email; not shown to be an OpenCode default | verified | [eclipse-oniro-mirrors/security_asset@7eced6e](https://github.com/eclipse-oniro-mirrors/security_asset/commit/7eced6e18f8abb26f2831ab7c08dc9b12207c216)<br>[eclipse-oniro-mirrors/ability_ability_runtime@73b1659](https://github.com/eclipse-oniro-mirrors/ability_ability_runtime/commit/73b1659209693d8d51b40381d720f01ed479b4c8) |
| Amp | trailer | `Amp-Thread-ID: https://ampcode.com/threads/T-<id>` | verified | [unkeyed/unkey@192377d](https://github.com/unkeyed/unkey/commit/192377d5f52f217323bfd6c1a96d12c2fdddc964) |
| Amp | trailer | `Co-authored-by: Amp <amp@ampcode.com>` | verified | [unkeyed/unkey@192377d](https://github.com/unkeyed/unkey/commit/192377d5f52f217323bfd6c1a96d12c2fdddc964)<br>[unkeyed/unkey@da20871](https://github.com/unkeyed/unkey/commit/da20871f6161cf27a15e8b844114736fa2d2c3c9) |
| Factory Droid | author | `factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>` | verified | [abnerjacobsen/deepdiff-mcp@e4a7003](https://github.com/abnerjacobsen/deepdiff-mcp/commit/e4a70031fd2515d168b7bc570723ac7e11d4eb31) |
| Factory Droid | branch | `droid/` | unverified | none found |
| Factory Droid | trailer | `Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>` | verified | [thedavidweng/tg-drive@5b8fd42](https://github.com/thedavidweng/tg-drive/commit/5b8fd4263cc544387f8e163b34cbef4e688a99d4)<br>[yagnyam-in/proxy-parent@59bb644](https://github.com/yagnyam-in/proxy-parent/commit/59bb644b5e8ed070e9024f894b9247544cd7cd24) |

### What the search taught

- **Trailers survive squash merges, branch names don't.** When GitHub squashes a PR it copies the author of every squashed commit into a `Co-authored-by:` line (lowercase `b`, added at the end). A PR whose commits were authored by `Cursor Agent <cursoragent@cursor.com>` lands as a human-authored commit with `Co-authored-by: Cursor Agent <cursoragent@cursor.com>`. That is why the trailer and email rules carry almost all attribution in the measured repos (every attributed commit in R1–R9 was found by a trailer or an author, none by a branch). Branch names only survive in `Merge pull request #N from owner/branch` subjects, which squash-merge teams don't produce: 23 of ~90 recent merged PRs in one repo came from `cursor/` branches and none of those names is in its git history.
- **One commit can carry several agents.** Squashes of mixed PRs carry Claude + Codex, Claude + Cursor, or Aider + Claude + Cursor trailers at once ([PerfectPan/wiki@a0a0754](https://github.com/PerfectPan/wiki/commit/a0a075499248ec4140e30708014ea8922214fe18), [mattehe-creator/appfabriken@0c2e980](https://github.com/mattehe-creator/appfabriken/commit/0c2e98092d22bcefbe8127104329fa1cb797ba95)). The rules keep all of them and pick a primary by precedence.
- **Match by email or bot id, not by display name.** The same agent shows up under several names: `Claude`, `Claude Opus 5.5 (1M context)`, `Claude Sonnet 5.5` (all `noreply@anthropic.com`); `Devin AI` and `devin-ai-integration[bot]`; `Copilot`, `Copilot App`, `copilot-swe-agent[bot]`, `Copilot Autofix powered by AI` (ids 198982749, 223556219, 175728472 before `+Copilot@users.noreply.github.com`, plus 223894421 `github-code-quality[bot]`). One `claude[bot]` name was signed with the `github-actions` id 41898282 ([proinsias/homebrew-tap@92e912a](https://github.com/proinsias/homebrew-tap/commit/92e912afc77d253de961264f88e28c6de7c5d13e)), so the name rule stays, but with lower trust than the id.
- **Most markers are habits, not defaults.** `Generated with Codex`, `Generated-with: Codex`, `Generated with [Gemini CLI]` and `Co-Authored-By: Gemini CLI` all exist, but in a handful of repos each and in several spellings; they read like people (or wrappers such as "agent-pager") copying Claude Code's format. A commit can't prove what a tool does by default, so the table records what was seen, not what the tool promises.
- **Teams that build agents don't mark their own commits.** In the last 100 default-branch commits of one agent vendor's own CLI repo (probed through the API, not in the tables) no commit carries a signal of that agent; in R7 (an agent CLI) 77% of 90-day commits are Unattributed and the CLI's own marker appears zero times. A team that runs agents all day can scan as "0".
- **Custom bots write features.** `keppo-bot[bot]`, `detail-app[bot]` and `briandconnelly-agent[bot]` are GitHub Apps that open feature PRs; in R6 one such app wrote 37% of the 90-day commits, some with Claude trailers inside. Name rules can't know them. They get their own "unknown bot" bucket, printed by name, so they are neither counted as agents nor hidden among humans.
- **Not on the list but found:** Antigravity (`Co-authored-by: Antigravity <antigravity@gemini.google.com>`, `Generated-by: Antigravity (Gemini 4 Argon)`), Gemini Code Assist (applied review suggestions), Copilot Autofix.
- **Never visible in git:** inline completions (Copilot, Cursor Tab), any agent whose user commits by hand or strips trailers, local Codex CLI runs without a trailer.

## 3. Per-repo measurements

90 days back from 2026-10-20 on each default branch. "Agent users" are people with at least one attributed commit in the window. Shares are of non-merge commits. Squash share = squash landings / (squash + merge landings) on the first-parent line.

| Repo | Profile | Commits (90 d) | People (agent users) | Agent commits by agent | Unattributed | of which by agent users | Automation | Unknown bots | Multi-agent |
|---|---|---|---|---|---|---|---|---|---|
| R1 | TypeScript CLI monorepo | 4765 | 124 (13) | OpenCode 14%, Claude Code <1% | 78% | 22% | 8% | 0% | 0 |
| R2 | TypeScript web app monorepo | 2260 | 58 (34) | Claude Code 33%, Cursor 19%, Codex <1%, Amp <1% | 44% | 96% | 2% | 2% | 36 |
| R3 | TypeScript SDK monorepo | 1621 | 71 (32) | Claude Code 49%, Cursor 2%, Codex <1% | 39% | 92% | 6% | 4% | 9 |
| R4 | Rust developer tooling | 857 | 79 (8) | Claude Code 9%, GitHub Copilot <1% | 81% | 42% | 8% | 1% | 2 |
| R5 | TypeScript + Go platform monorepo | 667 | 10 (8) | Amp 47%, Claude Code <1%, Cursor <1% | 48% | 63% | 0% | 3% | 3 |
| R6 | TypeScript desktop app | 407 | 9 (4) | Claude Code 17% | 38% | 22% | <1% | 45% | 0 |
| R7 | TypeScript CLI | 203 | 20 (4) | Gemini Code Assist 4% | 77% | 26% | 18% | 0% | 0 |
| R8 | Go server | 187 | 38 (20) | GitHub Copilot 71%, Claude Code <1% | 14% | 33% | 14% | 0% | 0 |
| R9 | Go developer tooling | 114 | 27 (7) | GitHub Copilot 24%, Codex <1%, Claude Code <1% | 75% | 27% | 0% | 0% | 0 |

Overlap counts use the definitions in PLAN.md: a (file, commit) pair where a different actor (agent + person) touched the same file within the window. "Same tool only" counts only pairs where the two agents differ (Claude Code vs Cursor), so it excludes two people each running Claude Code. Noise filter: lockfiles, changelogs, commits touching more than 100 files, automation and unknown bots are left out.

| Repo | Merge commits (90 d) | Squash share | Conflicted merges (90 d) | Agent/agent 6h | 24h | 72h | 24h without noise filter | Same tool only, 24h | Agent/human 24h | Human/human 24h |
|---|---|---|---|---|---|---|---|---|---|---|
| R1 | 17 | 98% | 2 | 39 | 47 | 73 | 47 | 1 | 1608 | 3772 |
| R2 | 1 | 100% | 0 | 283 | 598 | 1134 | 912 | 398 | 927 | 495 |
| R3 | 31 | 99% | 1 | 131 | 292 | 640 | 499 | 26 | 477 | 237 |
| R4 | 22 | 100% | 8 | 2 | 4 | 14 | 15 | 0 | 48 | 332 |
| R5 | 1 | 100% | 0 | 7 | 29 | 117 | 53 | 4 | 154 | 60 |
| R6 | 0 | 100% | 0 | 0 | 8 | 21 | 17 | 0 | 111 | 11 |
| R7 | 0 | 100% | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 35 |
| R8 | 0 | 100% | 0 | 22 | 52 | 92 | 52 | 0 | 72 | 1 |
| R9 | 0 | 100% | 0 | 0 | 1 | 11 | 1 | 0 | 53 | 45 |

Full histories, every two-parent merge rerun through one `merge-tree --stdin` batch:

| Repo | All commits | Merges, full history | Octopus | Conflicted (merge-tree) | merge-tree ms total | ms per merge |
|---|---|---|---|---|---|---|
| R1 | 20623 | 87 | 0 | 9 | 2321 | 26.67 |
| R2 | 10323 | 20 | 0 | 9 | 53 | 2.63 |
| R3 | 17183 | 1710 | 0 | 51 | 661 | 0.39 |
| R4 | 11341 | 533 | 0 | 125 | 3176 | 5.96 |
| R5 | 6307 | not run (blobless clone) | | | | |
| R6 | 2162 | 0 | 0 | 0 | 13 | - |
| R7 | 6511 | 2 | 0 | 0 | 12 | 6.25 |
| R8 | 1191 | 8 | 0 | 1 | 15 | 1.93 |
| R9 | 2491 | 1 | 0 | 0 | 12 | 12.38 |

Attributed commits in the 90-day windows were found by a trailer (2,667) or a bot author (644). None needed a message marker alone, and none came from a branch name.

## 4. Reading the numbers

**Unattributed.** The share is high everywhere except where a bot does the work (R8, Copilot coding agent). The "of which by agent users" column is the honest caveat: in R2 and R3, people who demonstrably use agents wrote 96% and 92% of the Unattributed commits. Those commits are either hand-written or agent-written without a mark; git cannot tell which. Every printed number is therefore a lower bound on agent activity, and on overlaps between agents.

**Squash and conflicts.** With 98–100% squash landings, the merge-tree pass has almost nothing to rerun: 4 of 9 repos had zero merge commits in 90 days, 2 had one. Only R1 (2), R3 (1) and R4 (8) recorded conflicted merges, all resolved by people without an agent mark. The full histories show conflicts did happen when these teams merged (8% of 2,361 merges); squash merging moved the conflict resolution into the PR branch where git history doesn't keep it.

**What a 24h window measures on a squash repo.** GitHub writes the merge time as both author and committer time of a squash commit (2,164 of 2,164 checked in R2). So on squash repos an overlap means "two PRs from different actors landed on the same file within 24 hours", not "two agents edited it at the same time".

**Windows.** Agent/agent overlaps grow smoothly with the window: in the five repos with at least 20 at 24h, 6h keeps 0.24–0.83x (median 0.45x) and 72h gives 1.6–4.0x (median 1.9x). There is no natural cut-off in the data; the window is a definition, not a discovery.

**Actor, not tool.** Counting only pairs of different tools gives 429 instead of 1,031 at 24h; without R2 it is 31 instead of 433. Most collisions are two people's sessions of the same agent, for example Copilot coding agent PRs started by different maintainers in R8 (52 by actor, 0 by tool).

**Agent vs human.** At 24h agent/human overlaps are 1.4–53x the agent/agent count (median 8.7x over the 8 repos with any agent/agent overlap). The "human" side is the Unattributed bucket, which the first point shows is mostly agent users.

**Noise.** Lockfiles, changelogs and very large commits make up 35% of unfiltered agent/agent overlaps at 24h (1,596 unfiltered vs 1,031 filtered). The hottest files are shared docs and config (migration guides, READMEs, `.env` examples, `AGENTS.md`, i18n JSON) and generated code (`*_generated.go`, OpenAPI output). A lockfile reached a top 3 only before filtering, in one repo. Generated files are not in the noise filter yet; the plan adds them.

**Bots.** Known automation was 0–18% of commits. Unknown bots were up to 45% (R6), mostly a custom agent app. Agent bot identities also run CI chores (R1: 396 codegen and hash-update commits under an agent's bot identity), which the `bot_chores` rule moves to automation.

## 5. Speed

`reference/measure.mjs` timings, warm disk cache, Apple M4, Apple git 2.39.3, Node 22.23. "log" is spawning `git log -z --no-renames --name-only` and reading its output; "rest" is parsing, attribution and overlaps at three windows plus the unfiltered pass.

| Run | Commits | Merges rerun | log | rest | merge-tree | Wall clock |
|---|---|---|---|---|---|---|
| R1 newest 10,000 (largest repo, 3 runs) | 10,000 | 28 | 408–852 ms | 123 ms | 2,306–2,375 ms | **2.95 / 2.95 / 3.46 s** |
| R1 whole history | 20,623 | 87 | 759 ms | 209 ms | 2,375 ms | **3.49 s** |
| R3 newest 10,000 (most merges, 3 runs) | 10,000 | 1,031 | 413–428 ms | 148–159 ms | 435–451 ms | **1.14 / 1.16 / 1.16 s** |
| R4 newest 10,000 (Rust) | 10,000 | 132 | 1,008 ms | 304 ms | 2,226 ms | 3.5 s (sum of passes) |
| R2 newest 10,000 | 10,000 | 5 | 441 ms | 145 ms | 43 ms | 0.6 s (sum of passes) |
| R1 90 days (busiest window) | 4,765 | 17 | 511 ms | 68 ms | 2,373 ms | 3.0 s (sum of passes) |

10,000 commits were measured directly, so the target needs no extrapolation: every repo finishes within 3.6 s, about 3x below the 10 s budget. Extrapolated from these runs, the log pass costs 40–100 µs per commit (about 1 s per 10,000 in the worst repo), and the rest of the JS work 10–30 µs per commit.

The variable cost is merge-tree. Most merges take 0.4–27 ms, but one R1 merge alone took 2.2 s: a branch promotion with 8,207 files changed between its parents, where git gave up on exhaustive rename detection. That single merge is 75% of R1's wall clock. The plan answers it with per-core batches and a time budget for the merge pass (PLAN.md, "Speed budget").

Cold cache was not measured: a first run reads every tree in the window from disk and will be slower than these numbers.

## 6. merge-tree findings

Machine: Apple git 2.39.3 (the git that ships with Xcode command line tools, so the one most macOS users have). It has `merge-tree --write-tree` and the batch mode `--stdin`.

| Finding | Evidence | What the scanner does |
|---|---|---|
| Single merge: exit 1 = conflicted, 0 = clean | synthetic repo: conflicted merge exit 1, clean merge exit 0 | not used, too slow per merge |
| Batch `--stdin`: one process for all merges; each result starts with a status where **0 = conflicted, 1 = clean** (inverted against the exit code) | synthetic repo, both merges in one batch | batches split across CPU cores, parse `status\0tree\0paths…\0\0` with `-z --name-only --no-messages` |
| A missing parent object kills the whole batch (`not something we can merge`) and every merge after it is lost | synthetic repo with a fake parent | check every parent with `git cat-file --batch-check` first; skip and count merges with a missing parent (shallow clones), print a warning |
| A merge of unrelated histories (subtree import) kills the whole batch (`refusing to merge unrelated histories`) | R3 history, found while timing 10,000 commits | pass `--allow-unrelated-histories`, which replays that merge the way it was made |
| merge-tree writes the merged trees and blobs into the repo's object store | synthetic repo: without care new objects land in `.git/objects` | run it with `GIT_OBJECT_DIRECTORY=<temp dir>` and `GIT_ALTERNATE_OBJECT_DIRECTORIES=<repo>/.git/objects`; checked: repo stayed at 43 objects, the 2 new objects went to the temp dir, which is deleted afterwards. The scan stays read-only. |
| Octopus merges (3+ parents) cannot be rerun by merge-tree | synthetic octopus of 3 branches | skip and count. Git's octopus strategy refuses to record a merge that needs manual resolution, so a recorded octopus merge was clean unless it was hand-made. |
| Detection matches git's own record of conflicts | R2 full history: all 20 two-parent merges rerun; merge-tree flagged 9, `git show --remerge-diff` shows `remerge CONFLICT` on the same 9 commits, identical sets. One of them (from 2023) conflicts on the same two files in both tools. | merge-tree is the source of truth; `--remerge-diff` stays a debugging aid |
| git older than 2.38 has no `--write-tree` | Ubuntu 22.04 LTS packages git 2.34 (not tested here) | skip the merge pass, say so in the output, keep the rest of the scan |
| Cost per merge is dominated by outliers, not by the number of merges | R1: one branch-promotion merge with 8,207 files changed between its parents took 2.2 s (git printed `exhaustive rename detection was skipped due to too many files`); the other 16 merges in its 90-day window took about 20 ms each. Across full histories the mean was 0.39–27 ms per merge. | batches per CPU core, a time budget for the merge pass, and `checked X of Y merges` in the output when it runs out |
| Octopus merges are rare | 0 octopus merges among 2,361 merges in the 8 full histories rerun | skip-and-count is enough |

Across those 8 full histories merge-tree flagged 195 of 2,361 two-parent merges as conflicted (8%).

## 7. Test fixture

Designed in PLAN.md ("Test fixture"): a script builds a small repo with fixed identities and dates, one commit per verified signal, a known overlap ladder (1 / 2 / 4 at 6h / 24h / 72h), traps that must count zero (same person, lockfile, 150-file commit, automation), a window-edge pair, two conflicted merges, one clean merge, one octopus, a `codex/` branch merge, and a shallow clone of it. A second script streams a 10,000-commit repo through `git fast-import` for the speed check.

## 8. Card renderer

Measured on this Mac (arm64, Node 22.23) with the same 1200x675 and 1080x1350 SVG, one bundled TTF passed as a buffer, system fonts off. Sizes are npm `dist.unpackedSize` of what `npx` actually installs.

| Option | Install on one machine | Platforms | Native build risk | Render 1200x675 | Notes |
|---|---|---|---|---|---|
| **`@resvg/resvg-wasm` 2.6.2** | **2.5 MB** (one package) | any Node 20+ (pure wasm) | none: no binary, no install script | **46 ms warm, 13 ms wasm init; same on a first run** | fonts must be passed as buffers, which we want anyway for identical output on every OS |
| `@resvg/resvg-js` 2.6.2 | 44 KB + one platform binary: darwin-arm64 3.5 MB, darwin-x64 3.9 MB, linux-x64-gnu 4.4 MB, linux-x64-musl 4.4 MB, linux-arm64-gnu 3.9 MB, win32-x64 4.5 MB | 12 prebuilt targets | low (prebuilt via optionalDependencies), but no build at all for unlisted targets | 85 ms warm; **1,750 ms on the first run** (527 ms to load the fresh binary + 1,223 ms first render) | every `npx` cold start is a first run |
| `@napi-rs/canvas` 1.0.11 | 28 MB (darwin-arm64) | prebuilt per platform | low | not measured | 10x the install for a canvas API we don't need |
| `sharp` 0.35 | 0.3 MB + 18 MB libvips (darwin-arm64) | prebuilt per platform | low | not measured | an image pipeline; it still needs an SVG renderer underneath |
| `canvas` 3.2.3 | 0.4 MB + a binary downloaded from GitHub at install time | prebuilt or node-gyp | **high**: install script is `prebuild-install -r napi \|\| node-gyp rebuild`, the fallback needs cairo and pango; it also makes a network call outside npm | not measured | rejected |
| `satori` 0.63 | 26 MB | pure JS | none | n/a | turns JSX into SVG only, still needs resvg; we can write the SVG by hand |

Choice: `@resvg/resvg-wasm`. Smallest install, the same file on macOS arm64, Linux and Windows, no native build, and the fastest first render because there is no binary to load. It is imported lazily, only when `--card` is set, so a plain scan never loads it.

Fonts: agentmash.dev uses Manrope and JetBrains Mono, shipped as woff2. resvg reads TTF/OTF only, so the package bundles TTF subsets of both (both OFL). One weight per file: in the test render a `font-weight="700"` fell back to regular because only one face was loaded.

## 9. Not verified, or out of reach

- `droid/` branch prefix: no evidence found.
- Whether a marker is a tool's default: commits show what was written, not why. Codex and Gemini CLI markers look user-added.
- Codex local CLI vs Codex cloud: cloud work shows as `chatgpt-codex-connector[bot]` and `codex/` branches; the `Co-authored-by: Codex` trailers can't be tied to the CLI or the cloud from the commit alone.
- Cursor editor vs background agent: `Cursor Agent` as author is the background agent; `Co-authored-by: Cursor` could be either.
- A Claude trailer names a model, and other harnesses may write it (an `opencode-agent[bot]` commit carried `Co-Authored-By: Claude Sonnet 4.6`).
- Never visible in git: inline completions, agents whose users strip trailers or commit by hand.
- Not measured: cold-cache timing; Windows and Linux runs (renderer and git availability are reasoned from package metadata, not run).

## 10. Numbers behind the open questions

- **`scan` vs `wrapped`.** npm already has at least 8 "wrapped" packages for coding agents, 7 of them published in 2026 (`claude-wrapped`, `wrapped-claude`, `@da-trollefsen/claude-wrapped`, `@shanzoon/claude-wrapped`, `claude-wrapped-cli`, `lore-wrapped`, `behavior-wrapped`, `@lfgcampos/agent-wrapped`). All of them recap personal usage (sessions, tokens), which this tool deliberately does not compute. `agentmash-scan` is free on npm and matches the future `npx agentmash scan`.
- **Default window.** 6h gives zero agent/agent overlaps in 3 of 9 repos and 0.45x the 24h count elsewhere; 72h roughly doubles it and mostly adds coincidences (human/human grows the same way, 4,988 at 24h vs 9,829 at 72h). 24h reads as "the same day" and, on squash repos, "landed the same day".
- **Agent vs human.** 3,452 agent/human vs 1,031 agent/agent overlaps at 24h, and the "human" side is mostly agent users without a mark (92–96% in R2/R3). Putting it in the headline would multiply the number by a median 8.7x on the back of the weakest classification.
