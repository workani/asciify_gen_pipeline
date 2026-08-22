import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join, sep } from "node:path";

/**
 * Executable lookup that understands PATH. `existsSync("google-chrome")` asks
 * about a file in the working directory, which is never what a bare command
 * name means, so every bare candidate has to be walked through PATH by hand.
 */
export const CHROME_CANDIDATES = Object.freeze([
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "/opt/google/chrome/chrome",
  "/snap/bin/chromium",
]);

function executableFile(path) {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveBinary(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (isAbsolute(candidate) || candidate.includes(sep)) {
      if (executableFile(candidate)) return candidate;
      continue;
    }
    for (const directory of (process.env.PATH ?? "").split(delimiter)) {
      if (!directory) continue;
      const full = join(directory, candidate);
      if (executableFile(full)) return full;
    }
  }
  return null;
}

/** True when the candidate can actually be spawned, PATH lookup included. */
export function isExecutable(candidate) {
  return Boolean(candidate) && Boolean(resolveBinary([candidate]));
}

/**
 * An explicit CHROME_BIN/OPENCODE_BIN is honoured verbatim: a typo there must
 * surface as a named error, not as a silent fallback to some other browser.
 */
export function resolveChromeBin(explicit = process.env.CHROME_BIN) {
  return explicit || resolveBinary(CHROME_CANDIDATES);
}

export function opencodeCandidates() {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  return [home ? join(home, ".opencode", "bin", "opencode") : null, "opencode"].filter(Boolean);
}

export function resolveOpencodeBin(explicit = process.env.OPENCODE_BIN) {
  return explicit || resolveBinary(opencodeCandidates());
}
