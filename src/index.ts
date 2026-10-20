export { scan, type AgentCount, type ScanOptions, type ScanResult } from "./scan.js";
export { DEFAULT_COMMAND, formatReport, formatWindow, headline, toJSON, type ReportOptions } from "./report.js";
export type { HotFile, OverlapResult } from "./overlaps.js";
export type { MergeResult, ResolverCount } from "./git/merges.js";
export { compileRules, loadRulesFile, parseRulesFile, type Rules, type RulesFile } from "./rules.js";
export { parseTrailers, branchCandidates, type Bucket, type Commit } from "./attribute.js";
export { GitError } from "./git/run.js";
export { cardSvg, CARD_SIZES, type CardOptions, type CardSize } from "./card/svg.js";
export { shareText, shareUrl, type ShareOptions } from "./share.js";
export { contribution, contributeUrl, CONTRIBUTE_URL, type Contribution } from "./contribute.js";

/** PNG bytes of the card; loads the wasm renderer on first use only */
export async function renderCard(...args: Parameters<typeof import("./card/render.js").renderCard>): Promise<Uint8Array> {
  const { renderCard: render } = await import("./card/render.js");
  return render(...args);
}

export async function writeCards(...args: Parameters<typeof import("./card/render.js").writeCards>): Promise<string[]> {
  const { writeCards: write } = await import("./card/render.js");
  return write(...args);
}
export { VERSION } from "./version.js";
