import type { ScanResult } from "./scan.js";

export interface ReportOptions {
  /** ANSI bold/dim; off for NO_COLOR or when not a terminal */
  color?: boolean;
  /** how people run this tool; printed in the next-step lines */
  command?: string;
}

export const DEFAULT_COMMAND = "npx agentmash-scan";

const fmt = (n: number): string => n.toLocaleString("en-US");
const plural = (n: number, one: string, many: string): string => `${fmt(n)} ${n === 1 ? one : many}`;

export function formatWindow(hours: number): string {
  if (hours >= 48 && hours % 24 === 0) return `${hours / 24}d`;
  if (Number.isInteger(hours)) return `${hours}h`;
  return `${Math.round(hours * 60)}m`;
}

export const formatDays = (days: number): string => plural(days, "day", "days");

/** the headline is the product: the same sentence goes on the card and into the share text */
export function headline(r: ScanResult): string {
  return `Your AI agents stepped on each other ${plural(r.overlaps.agentAgent, "time", "times")} in ${formatDays(r.period.days)}.`;
}

export function formatReport(r: ScanResult, opts: ReportOptions = {}): string {
  const color = opts.color ?? false;
  const command = opts.command ?? DEFAULT_COMMAND;
  const bold = (s: string): string => (color ? `\x1b[1m${s}\x1b[22m` : s);
  const dim = (s: string): string => (color ? `\x1b[2m${s}\x1b[22m` : s);
  const win = formatWindow(r.overlaps.windowHours);
  const lines: string[] = [];

  lines.push(`agentmash scan · last ${formatDays(r.period.days)} · ${r.repo.name} (${r.repo.branch})`);
  if (r.repo.shallow) lines.push(dim("Shallow clone: older history is missing here, so every number below is partial."));
  lines.push("");

  // Agents in history
  const c = r.commits;
  const rows: [string, number, string][] = r.agents.map((a) => [a.name, a.commits, ""]);
  const share = c.nonMerge ? Math.round((100 * c.unattributed) / c.nonMerge) : 0;
  rows.push(["Unattributed", c.unattributed, `no agent mark, ${share}% of commits`]);
  if (c.automation) rows.push(["Automation", c.automation, "dependency, release and CI bots"]);
  const bots = c.unknownBots.reduce((n, b) => n + b.commits, 0);
  if (bots) {
    const names = c.unknownBots.slice(0, 3).map((b) => `${b.name} ${fmt(b.commits)}`);
    if (c.unknownBots.length > 3) names.push(`${c.unknownBots.length - 3} more`);
    rows.push(["Other bots", bots, names.join(", ")]);
  }
  const nameW = Math.max(...rows.map(([n]) => n.length));
  const numW = Math.max(...rows.map(([, n]) => fmt(n).length));
  lines.push("Agents in history");
  for (const [name, n, note] of rows) {
    const line = `  ${name.padEnd(nameW)}   ${fmt(n).padStart(numW)} ${n === 1 ? "commit" : "commits"}`;
    lines.push(note ? `${line.padEnd(nameW + numW + 13)}   ${dim(note)}` : line);
  }
  if (bots) lines.push(dim(`  A bot above is an agent? Count it with --agent-bot "<name>".`));
  lines.push("");

  // Collisions
  const m = r.merges;
  const col: [string, string][] = [
    [`Same file changed by 2+ agents within ${win}`, plural(r.overlaps.agentAgent, "time", "times")],
    [`Agent and human on the same file within ${win}`, plural(r.overlaps.agentHuman, "time", "times")],
  ];
  if (m.skipped === "git-too-old") {
    col.push(["Merges that conflicted", `not checked: git ${m.git} is older than 2.38`]);
  } else if (m.total === 0) {
    col.push(["Merges that conflicted", "0, no merge commits in this period"]);
  } else {
    // octopus merges count as checked: git refuses to record one that conflicts
    const checked = m.rerun + m.octopus;
    const of = checked === m.total ? `${fmt(m.conflicted)} of ${fmt(m.total)}` : `${fmt(m.conflicted)} of ${fmt(checked)} checked`;
    const notes: string[] = [];
    if (m.unchecked) notes.push(`${fmt(m.unchecked)} not checked, time limit`);
    if (m.missingParents) notes.push(`${fmt(m.missingParents)} skipped, parent missing`);
    col.push(["Merges that conflicted", notes.length ? `${of} (${notes.join("; ")})` : of]);
    for (const res of m.resolvers) {
      col.push([`  resolved by ${res.name === "person" ? "a human" : res.name}`, fmt(res.merges)]);
    }
  }
  const labelW = Math.max(...col.map(([l]) => l.length));
  lines.push("Collisions");
  for (const [label, value] of col) lines.push(`  ${label.padEnd(labelW)}   ${value}`);
  const hot = r.overlaps.hottest.slice(0, 3);
  if (hot.length) {
    const pathW = Math.max(...hot.map((h) => h.path.length), labelW - 2);
    lines.push(`  ${hot.length === 1 ? "Hottest file" : "Hottest files"}`);
    for (const h of hot) lines.push(`    ${h.path.padEnd(pathW)}   ${plural(h.overlaps, "overlap", "overlaps")}`);
  }
  lines.push("");

  // headline and its limits
  lines.push(bold(headline(r)));
  lines.push(dim(`Counted when two agent sessions changed the same file within ${win} of each other.`));
  lines.push(dim("This is a lower bound: rebases and squash merges hide conflicts."));
  lines.push(
    dim(
      c.agent === 0
        ? "Attribution is heuristic: no commit here carried an agent mark, so unmarked agents are invisible."
        : `Attribution is heuristic: ${plural(c.unattributed, "commit", "commits")} had no agent mark.`,
    ),
  );
  lines.push("");
  lines.push(`Share your number:   ${command} --card`);
  lines.push("Catch it live:       npx agentmash login");
  return lines.join("\n") + "\n";
}

export function toJSON(r: ScanResult): string {
  return JSON.stringify(r, null, 2) + "\n";
}
