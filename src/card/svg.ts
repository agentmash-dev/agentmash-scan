import { DEFAULT_COMMAND, formatDays } from "../report.js";
import type { ScanResult } from "../scan.js";
import { ADVANCES } from "./metrics.js";

export type CardSize = "landscape" | "portrait";

export const CARD_SIZES: Record<CardSize, { width: number; height: number; file: string }> = {
  landscape: { width: 1200, height: 675, file: "scan.png" },
  portrait: { width: 1080, height: 1350, file: "scan-1080x1350.png" },
};

export interface CardOptions {
  /** print the repository name; off by default */
  showRepo?: boolean;
  /** the command printed small at the bottom */
  command?: string;
}

// agentmash.dev night palette
const NIGHT = "#0e0d0c";
const MILK = "#efece6";
const MILK_2 = "#bdb7ae";
const MILK_3 = "#857f76";
const AMBER = "#e9b45a";

type Face = keyof typeof ADVANCES;
const FAMILY: Record<Face, [string, number]> = {
  manrope800: ["Manrope", 800],
  manrope500: ["Manrope", 500],
  mono400: ["JetBrains Mono", 400],
};

/** width in px of `text` set in `face` at `size`, from the font's own advance widths (no kerning) */
export function textWidth(text: string, face: Face, size: number, tracking = 0): number {
  const adv = ADVANCES[face];
  let em = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0x20;
    em += code >= 0x20 && code < 0x7f ? (adv[code - 0x20] ?? 0.6) : 0.6;
  }
  return em * size + tracking * size * Math.max(0, [...text].length - 1);
}

/** greedy word wrap; a word longer than the line gets a line of its own */
export function wrap(text: string, face: Face, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, face, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function text(x: number, y: number, s: string, face: Face, size: number, fill: string, extra = ""): string {
  const [family, weight] = FAMILY[face];
  return `<text x="${x}" y="${Math.round(y)}" font-family="${family}" font-weight="${weight}" font-size="${Math.round(size)}" fill="${fill}"${extra}>${esc(s)}</text>`;
}

/** agent names joined with middle dots, cut to `maxLines` with "+N more" */
function agentLines(names: readonly string[], size: number, maxWidth: number, maxLines: number): string[] {
  for (let shown = names.length; shown >= 1; shown--) {
    const rest = names.length - shown;
    const joined = names.slice(0, shown).join(" · ") + (rest ? ` · +${rest} more` : "");
    const lines = wrapOnDots(joined, size, maxWidth);
    if (lines.length <= maxLines) return lines;
  }
  return [];
}

/** wrap between agents, never inside a name */
function wrapOnDots(joined: string, size: number, maxWidth: number): string[] {
  const parts = joined.split(" · ");
  const lines: string[] = [];
  let line = "";
  for (const p of parts) {
    const next = line ? `${line} · ${p}` : p;
    if (line && textWidth(next, "manrope500", size) > maxWidth) {
      lines.push(line);
      line = p;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

interface Layout {
  pad: number;
  numberMax: number;
  numberMin: number;
  lineSize: number;
  lineMaxLines: number;
  agentSize: number;
  agentMaxLines: number;
  footSize: number;
}

const LAYOUT: Record<CardSize, Layout> = {
  landscape: { pad: 88, numberMax: 300, numberMin: 110, lineSize: 40, lineMaxLines: 2, agentSize: 32, agentMaxLines: 2, footSize: 26 },
  portrait: { pad: 96, numberMax: 420, numberMin: 150, lineSize: 60, lineMaxLines: 3, agentSize: 42, agentMaxLines: 3, footSize: 34 },
};

const TRACKING = -0.03;

export function cardSvg(r: ScanResult, size: CardSize, opts: CardOptions = {}): string {
  const { width: W, height: H } = CARD_SIZES[size];
  const L = LAYOUT[size];
  const maxW = W - 2 * L.pad;
  const n = r.overlaps.agentAgent;
  const number = n.toLocaleString("en-US");
  const sentence = `${n === 1 ? "time" : "times"} my AI agents stepped on each other in ${formatDays(r.period.days)}`;

  const numSize = Math.max(L.numberMin, Math.min(L.numberMax, maxW / (textWidth(number, "manrope800", 1, TRACKING) || 1)));
  let lineSize = L.lineSize;
  let lines = wrap(sentence, "manrope500", lineSize, maxW);
  while (lines.length > L.lineMaxLines && lineSize > 20) {
    lineSize -= 2;
    lines = wrap(sentence, "manrope500", lineSize, maxW);
  }
  const agents = agentLines(r.agents.map((a) => a.name), L.agentSize, maxW, L.agentMaxLines);

  // vertical rhythm: digits are about 0.72 em tall in Manrope
  const numH = numSize * 0.72;
  const lineH = lineSize * 1.25;
  const agentH = L.agentSize * 1.3;
  const blockH = numH + lineSize * 0.55 + lines.length * lineH + (agents.length ? L.agentSize * 0.6 + agents.length * agentH : 0);
  const footY = H - L.pad + L.footSize * 0.3;
  const top = L.pad + Math.max(0, (footY - L.footSize * 2 - L.pad - blockH) / 2);

  const out: string[] = [];
  let y = top + numH;
  out.push(text(L.pad - numSize * 0.04, y, number, "manrope800", numSize, MILK, ` letter-spacing="${(TRACKING * numSize).toFixed(1)}"`));
  y += lineSize * 0.55;
  for (const l of lines) {
    y += lineH;
    out.push(text(L.pad, y, l, "manrope500", lineSize, MILK_2));
  }
  if (agents.length) {
    y += L.agentSize * 0.6;
    for (const l of agents) {
      y += agentH;
      out.push(text(L.pad, y, l, "manrope500", L.agentSize, AMBER));
    }
  }
  out.push(text(L.pad, footY, opts.command ?? DEFAULT_COMMAND, "mono400", L.footSize, MILK_3));
  if (opts.showRepo) {
    const name = r.repo.name;
    const x = W - L.pad - textWidth(name, "mono400", L.footSize);
    if (x > L.pad + textWidth(opts.command ?? DEFAULT_COMMAND, "mono400", L.footSize) + 40) {
      out.push(text(Math.round(x), footY, name, "mono400", L.footSize, MILK_3));
    }
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="${NIGHT}"/>`,
    ...out,
    "</svg>",
  ].join("\n");
}
