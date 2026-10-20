import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { ScanResult } from "../scan.js";
import { cardSvg, CARD_SIZES, type CardOptions, type CardSize } from "./svg.js";

type ResvgModule = typeof import("@resvg/resvg-wasm");

const FONT_FILES = ["manrope-800.ttf", "manrope-500.ttf", "jetbrains-mono-400.ttf"];
let ready: Promise<ResvgModule> | null = null;

/** loads the wasm renderer once, from disk: no network, no native binary */
function resvg(): Promise<ResvgModule> {
  ready ??= (async () => {
    const mod = await import("@resvg/resvg-wasm");
    const wasm = createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm");
    await mod.initWasm(readFileSync(wasm));
    return mod;
  })();
  return ready;
}

let fonts: Uint8Array[] | null = null;
const fontBuffers = (): Uint8Array[] =>
  (fonts ??= FONT_FILES.map((f) => new Uint8Array(readFileSync(new URL(`../../fonts/${f}`, import.meta.url)))));

export async function renderPng(svg: string): Promise<Uint8Array> {
  const { Resvg } = await resvg();
  const r = new Resvg(svg, { font: { fontBuffers: fontBuffers(), defaultFontFamily: "Manrope" }, textRendering: 1 });
  const png = r.render().asPng();
  r.free();
  return png;
}

export function renderCard(result: ScanResult, size: CardSize, opts: CardOptions = {}): Promise<Uint8Array> {
  return renderPng(cardSvg(result, size, opts));
}

/** writes scan.png (1200x675, X) and scan-1080x1350.png (Instagram, LinkedIn) into `dir`; returns the paths */
export async function writeCards(result: ScanResult, dir: string, opts: CardOptions = {}): Promise<string[]> {
  const paths: string[] = [];
  for (const size of Object.keys(CARD_SIZES) as CardSize[]) {
    const path = join(dir, CARD_SIZES[size].file);
    writeFileSync(path, await renderCard(result, size, opts));
    paths.push(path);
  }
  return paths;
}
