import { readFileSync } from "node:fs";

const pkg: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export const VERSION: string =
  typeof pkg === "object" && pkg !== null && "version" in pkg && typeof pkg.version === "string" ? pkg.version : "0.0.0";
