/**
 * Static reader for DSH plugin browser bundles.
 *
 * ## Why static, and what it costs us
 *
 * A runtime audit would need a browser, a fixed device and a power meter. None of
 * those belong in a nightly job, so this module reads the shipped JavaScript and
 * infers the timers from it. That trades precision for reproducibility: anyone
 * can re-run the same scan on the same version and get the same numbers.
 *
 * The limitation must be stated plainly, because it bounds every claim on the
 * site: **a timer this scanner cannot see is a cost we do not bill.** Minified
 * bundles that compute an interval at runtime, or that schedule work through a
 * framework primitive rather than `setInterval`, will be under-reported. The
 * "coverage" field on each finding records how confident we are.
 *
 * ## What counts as a finding
 *
 * Only timers whose callback plausibly reaches the network. A 500 ms timer that
 * re-reads an in-memory reference is cheap and is deliberately not billed; one
 * that `fetch`es is the thing this project exists to name.
 *
 * @module electric-chimneys/scan
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

/** Timers slower than this are treated as polite and not reported as findings. */
export const NOTEWORTHY_INTERVAL_MS = 5_000;

/**
 * Resolve the browser entry a package declares.
 *
 * `exports['./client']` may be a string or a conditions object; `dsh.client`
 * may name a custom path. Falling back to the conventional pair keeps the
 * scanner working on older packages.
 *
 * @param pkgDir - absolute path of the installed package.
 * @param manifest - its parsed package.json.
 * @returns the absolute path of the browser bundle, or `undefined`.
 */
export function resolveClientEntry(pkgDir, manifest) {
  const candidates = [];
  const exp = manifest?.exports?.["./client"];
  if (typeof exp === "string") candidates.push(exp);
  else if (exp && typeof exp === "object") {
    if (typeof exp.default === "string") candidates.push(exp.default);
    if (typeof exp.import === "string") candidates.push(exp.import);
  }
  candidates.push("./lib/client.js", "./client.js", "./lib/client.browser.js");
  for (const rel of candidates) {
    const abs = join(pkgDir, rel);
    if (existsSync(abs)) return abs;
  }
  return undefined;
}

/**
 * Does this chunk of source plausibly reach the network?
 *
 * The distinction is the whole ballgame for fairness. A 16 ms timer that
 * re-renders a caret is a *UI* timer: it never leaves the process, so charging
 * it the fixed network cost would be a lie. A 16 ms timer that `fetch`es is the
 * thing this project exists to name.
 *
 * Both are real energy, but they are not the same amount, and the README only
 * claims to rank polling. So we bill network timers and merely *report* the
 * others.
 *
 * @param text - callback source, or any window around the call site.
 * @returns true when a network-shaped call is present.
 */
export function looksNetworked(text) {
  // Deliberately NARROW. An earlier version matched /\.(get|post|put|delete)/
  // to catch `http.get(...)`, and it also matched `ctx.get("theme")`,
  // `map.get(id)` and every other getter in the language — which billed a
  // 50 ms UI boot-recovery loop as a network poll and put an innocent plugin at
  // the top of the board. A false accusation is worse than a missed finding, so
  // the verb-based branch is gone; only unambiguous network shapes remain.
  return (
    /\b(fetch|XMLHttpRequest|EventSource|WebSocket)\s*\(/.test(text) ||
    /\bapi\s*\(/.test(text) ||
    /\bpostJson\s*\(/.test(text) ||
    /\brequest\s*\(/.test(text) ||
    /\$stream\s*\(/.test(text) ||
    /\brpc\./.test(text) ||
    /\bcall\(\s*["'`]/.test(text)
  );
}

/**
 * Is the network call gated behind an early return?
 *
 * A timer that fires every 2 s but returns immediately unless a queue is
 * non-empty is not polling at 2 s in practice. Two real examples shaped this:
 *
 * - `dshmarket` drains a job queue: `if (!records.some(queued)) return; fetch(...)`
 * - `dsh-im-connect` polls a QR pairing status only while the pairing tab is open
 *
 * Billing those at face value would put them at the top of a board they do not
 * belong on. We cannot know the duty cycle of an arbitrary guard, so we charge a
 * fixed fraction and say so out loud rather than inventing precision.
 *
 * @param callback - the timer's callback source.
 * @returns true when a `return` precedes the first network call.
 */
export function isConditional(callback) {
  const networkAt = callback.search(/\b(fetch|api|postJson|request|\$stream|rpc\.|call\(\s*["'`])/);
  if (networkAt <= 0) return false;

  // Strip the visibility guard BEFORE looking for a return.
  //
  // `if (document.hidden) return;` is a visibility guard, and it is already
  // credited at 0.5 by ticksPerDay(). Counting it again here as a "conditional
  // network call" would apply both discounts and bill the plugin at 0.05 — a
  // 20x under-report on exactly the well-behaved plugins this project means to
  // reward. The fixture test caught this; the comment exists so it stays caught.
  const before = callback
    .slice(0, networkAt)
    .replace(/if\s*\([^)]*(?:document\.hidden|visibilityState|\.hidden)[^)]*\)\s*(?:\{\s*)?return\b/g, "")
    .replace(/if\s*\([^)]*(?:document\.hidden|visibilityState|\.hidden)[^)]*\)\s*\{[^{}]*\}/g, "");

  return /\breturn\b/.test(before);
}

/**
 * Extract `setInterval` / `setTimeout` periods from source text.
 *
 * Both numeric literals (`2500`) and exponent form (`2.5e3`, which is what most
 * bundlers emit) are accepted. A variable period cannot be resolved statically
 * and is skipped rather than guessed.
 *
 * @param source - bundle text.
 * @returns intervals in milliseconds, deduplicated.
 */
export function extractIntervalsDetailed(source) {
  const found = new Map();
  // The callback can be an inline arrow function that itself contains commas,
  // so a bounded non-greedy window up to the next comma is not enough: the
  // period is the LAST numeric literal before the closing paren. We therefore
  // scan each `setInterval(...)` call by balancing parentheses.
  const callStart = /set(?:Interval|Timeout)\s*\(/gi;
  for (const start of source.matchAll(callStart)) {
    const open = start.index + start[0].length - 1;
    let depth = 0;
    let end = -1;
    let inString = null;
    for (let i = open; i < source.length && i < open + 2000; i += 1) {
      const ch = source[i];
      if (inString !== null) {
        if (ch === "\\") i += 1;
        else if (ch === inString) inString = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inString = ch;
        continue;
      }
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue;
    const args = source.slice(open + 1, end);

    // Split the argument list on TOP-LEVEL commas so that numbers inside the
    // callback body are never mistaken for the period. `setInterval(() => {
    // if (retries >= 100) ... }, 50)` must yield 50, not 100.
    const parts = [];
    let current = "";
    let level = 0;
    let quote = null;
    for (let i = 0; i < args.length; i += 1) {
      const ch = args[i];
      if (quote !== null) {
        current += ch;
        if (ch === "\\") {
          current += args[i + 1] ?? "";
          i += 1;
        } else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        current += ch;
        continue;
      }
      if (ch === "(" || ch === "[" || ch === "{") level += 1;
      else if (ch === ")" || ch === "]" || ch === "}") level -= 1;
      if (ch === "," && level === 0) {
        parts.push(current);
        current = "";
        continue;
      }
      current += ch;
    }
    parts.push(current);

    // The period is the LAST top-level argument that is a bare numeric literal.
    // A guard clause's `100` lives inside the callback, which is now parts[0].
    //
    // Numeric literals may carry separators (`30_000`) or exponent form
    // (`2.5e3`, what bundlers emit), so strip underscores before converting.
    // Without this, `30_000` reads as `30` and a polite 30 s poller is billed
    // like a 30 ms one — the single worst false positive we could ship.
    let value;
    for (const part of parts.slice(1)) {
      const bare = part.trim();
      const m = /^([0-9][0-9_]*(?:\.[0-9][0-9_]*)?(?:e[0-9]+)?)$/i.exec(bare);
      if (m !== null) value = Number(m[1].replaceAll("_", ""));
    }
    if (value === undefined || !Number.isFinite(value) || value <= 0) continue;

    // Classify by what the callback body does. `args` is the full argument
    // list; the callback is the first top-level part unless the period came
    // first (`setInterval(ms, fn)` is not a real signature, but `setTimeout`
    // callers sometimes write the delay first in generated code).
    const callback = parts.length > 1 && /^[0-9]/.test(parts[0].trim()) ? parts[1] : parts[0];
    const networked = looksNetworked(callback);
    const conditional = networked && isConditional(callback);
    const existing = found.get(value);
    if (existing === undefined) found.set(value, { intervalMs: value, networked, conditional, count: 1 });
    else {
      existing.count += 1;
      existing.networked = existing.networked || networked;
      existing.conditional = existing.conditional || conditional;
    }
  }
  return [...found.values()].sort((a, b) => a.intervalMs - b.intervalMs);
}

/**
 * Extract just the periods, keeping the historical narrow return type.
 *
 * @param source - bundle text.
 * @returns intervals in milliseconds, ascending.
 */
export function extractIntervals(source) {
  return extractIntervalsDetailed(source).map((entry) => entry.intervalMs);
}

/**
 * Detect whether the bundle suspends work while the tab is hidden.
 *
 * Credit is given for either idiom: the `document.hidden` / `visibilityState`
 * pair, or a `visibilitychange` listener. Both are how a responsible plugin
 * stops burning cycles the user cannot see.
 *
 * @param source - bundle text.
 * @returns true when a guard is present.
 */
export function hasVisibilityGuard(source) {
  return /document\.hidden|visibilityState|visibilitychange/.test(source);
}

/**
 * Collect endpoint-looking string literals.
 *
 * Used only to give a human reader a foothold when they open the file to check
 * our arithmetic — we never invent a payload size from a path.
 *
 * @param source - bundle text.
 * @returns unique path-like literals, capped for readability.
 */
export function extractEndpoints(source) {
  const found = new Set();
  for (const match of source.matchAll(/["'`](\/[a-zA-Z0-9_\-./]*\/)[a-zA-Z0-9_\-]+["'`]/g)) {
    const value = match[0].slice(1, -1);
    if (value.length > 2 && value.length < 80) found.add(value);
  }
  return [...found].sort().slice(0, 12);
}

/**
 * Read one installed plugin and summarise what it is likely to cost.
 *
 * @param profileDir - the dsh profile root containing `node_modules`.
 * @param bundleName - the package name as it appears in `dsh.profile.bundles`.
 * @returns a finding record, or `undefined` when the package has no browser half.
 */
export function scanPlugin(profileDir, bundleName) {
  const pkgDir = join(profileDir, "node_modules", bundleName);
  const manifestPath = join(pkgDir, "package.json");
  if (!existsSync(manifestPath)) return undefined;

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return undefined;
  }

  const entry = resolveClientEntry(pkgDir, manifest);
  if (entry === undefined) return undefined;

  const source = readFileSync(entry, "utf8");
  const sizeBytes = statSync(entry).size;
  const detailed = extractIntervalsDetailed(source);

  // Only network-shaped timers are billed. UI timers (carets, animations,
  // hover polling) are real energy too, but they cost a render rather than a
  // round trip, and folding them into a "polling" score would make the ranking
  // indefensible. They are counted and reported separately.
  const networked = detailed.filter((entry) => entry.networked);
  const uiOnly = detailed.filter((entry) => !entry.networked);

  return {
    name: manifest.name ?? bundleName,
    version: manifest.version ?? "unknown",
    entry,
    sizeBytes,
    intervals: detailed.map((entry) => entry.intervalMs),
    visibilityGuard: hasVisibilityGuard(source),
    endpoints: extractEndpoints(source),
    /** Network timers fast enough to matter, fastest first — these are billed. */
    hotIntervals: networked
      .filter((entry) => entry.intervalMs < NOTEWORTHY_INTERVAL_MS)
      .map((entry) => entry.intervalMs),
    /** Of those, the ones gated behind a guard — billed at reduced weight. */
    conditionalIntervals: networked
      .filter((entry) => entry.intervalMs < NOTEWORTHY_INTERVAL_MS && entry.conditional)
      .map((entry) => entry.intervalMs),
    /** UI-only timers of the same cadence, reported so the reader can judge. */
    uiOnlyHotIntervals: uiOnly
      .filter((entry) => entry.intervalMs < NOTEWORTHY_INTERVAL_MS)
      .map((entry) => entry.intervalMs),
  };
}

/**
 * Scan every bundle a profile declares.
 *
 * @param profileDir - profile root.
 * @param bundles - the `dsh.profile.bundles` array.
 * @returns findings, newest scan only; packages without a browser half are skipped.
 */
export function scanProfile(profileDir, bundles) {
  const out = [];
  for (const name of bundles) {
    try {
      const finding = scanPlugin(profileDir, name);
      if (finding !== undefined) out.push(finding);
    } catch (error) {
      out.push({
        name,
        version: "unknown",
        entry: "",
        sizeBytes: 0,
        intervals: [],
        visibilityGuard: false,
        endpoints: [],
        hotIntervals: [],
        uiOnlyHotIntervals: [],
        scanError: String(error instanceof Error ? error.message : error),
      });
    }
  }
  return out;
}
