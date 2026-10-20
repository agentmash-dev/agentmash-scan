export { scan, type AgentCount, type ScanOptions, type ScanResult } from "./scan.js";
export { DEFAULT_COMMAND, formatReport, formatWindow, headline, toJSON, type ReportOptions } from "./report.js";
export type { HotFile, OverlapResult } from "./overlaps.js";
export type { MergeResult, ResolverCount } from "./git/merges.js";
export { compileRules, loadRulesFile, parseRulesFile, type Rules, type RulesFile } from "./rules.js";
export { parseTrailers, branchCandidates, type Bucket, type Commit } from "./attribute.js";
export { GitError } from "./git/run.js";
export { VERSION } from "./version.js";
