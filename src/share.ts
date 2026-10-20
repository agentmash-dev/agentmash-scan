import { spawn } from "node:child_process";
import { DEFAULT_COMMAND, headline } from "./report.js";
import type { ScanResult } from "./scan.js";

export interface ShareOptions {
  showRepo?: boolean;
  command?: string;
}

/** the post: the headline, the agents by name, the command. Numbers and agent names only. */
export function shareText(r: ScanResult, opts: ShareOptions = {}): string {
  const first = headline(r).replace(/^Your AI agents/, "My AI agents");
  const lines = [opts.showRepo ? first.replace(/\.$/, ` on ${r.repo.name}.`) : first];
  if (r.agents.length) lines.push(r.agents.map((a) => a.name).join(" · "));
  lines.push(opts.command ?? DEFAULT_COMMAND);
  return lines.join("\n");
}

export const shareUrl = (text: string): string => `https://x.com/intent/post?text=${encodeURIComponent(text)}`;

/** hands the URL to the system browser; the package itself never makes a request */
export function openUrl(url: string): Promise<boolean> {
  const [cmd, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { stdio: "ignore", detached: true });
      child.on("error", () => resolve(false));
      child.on("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
