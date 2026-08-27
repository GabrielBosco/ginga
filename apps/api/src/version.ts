import { readFileSync } from "node:fs";

function packageVersion() {
  try {
    const file = new URL("../package.json", import.meta.url);
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim() ? parsed.version.trim() : "dev";
  } catch {
    return "dev";
  }
}

export const GINGA_VERSION = process.env.GINGA_RELEASE_VERSION?.trim() || packageVersion();
