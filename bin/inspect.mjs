#!/usr/bin/env node
/**
 * Daily inspection run.
 *
 * One invocation does the whole job: scan the profile, score every plugin,
 * fold today into the history, then rewrite the machine-readable ledger, the
 * static site and the README boards. Nothing is fetched from the network and
 * nothing outside this repository is written, so a scheduled run is safe to
 * repeat and safe to fail.
 *
 * Exit codes are meaningful to a scheduler:
 *   0 — ran, and the boards are current
 *   1 — ran, but at least one finding was severe enough to flag
 *   2 — could not run (no profile, unreadable manifest)
 *
 * @module electric-chimneys/bin/inspect
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanProfile } from "../src/scan.mjs";
import { scoreFinding, rankEntries, buildBoards, boardToMarkdown } from "../src/rank.mjs";
import { humanise, timerDailyCost } from "../src/metrics.mjs";
import { renderSite } from "../src/render.mjs";
import { renderDossier } from "../src/dossier.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const DATA = join(REPO, "data");
const SITE = join(REPO, "site");

/** Severity threshold above which the run exits non-zero. */
const ALARM_SCORE = 50_000;

/**
 * Locate the dsh profile to audit.
 *
 * Honours `EC_PROFILE` so a contributor can point the scanner at a fixture
 * directory; defaults to the real web profile.
 *
 * @returns absolute profile path, or `undefined` when it is absent.
 */
function resolveProfile() {
  const fromEnv = process.env.EC_PROFILE;
  const fallback = join(process.env.HOME ?? "", ".dsh/profiles/web");
  const candidate = fromEnv ?? fallback;
  return existsSync(join(candidate, "package.json")) ? candidate : undefined;
}

/**
 * Read a JSON file, returning a fallback when it is missing or corrupt.
 *
 * A corrupt history must never abort a run: losing one day of trend data is
 * recoverable, losing the run is not.
 *
 * @param path - absolute file path.
 * @param fallback - value to return on any failure.
 * @returns parsed value or the fallback.
 */
function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

/**
 * Write pretty JSON with a trailing newline so diffs stay clean.
 *
 * @param path - absolute file path.
 * @param value - serialisable value.
 */
function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

/**
 * Replace a delimited block inside a Markdown file.
 *
 * The README is the project's front page, and it is regenerated on every run.
 * Markers keep the human-written parts untouched while the boards stay live.
 *
 * @param text - full document.
 * @param name - marker name, e.g. `DAILY`.
 * @param body - replacement content.
 * @returns the document with that block substituted.
 */
function replaceBlock(text, name, body) {
  const start = `<!-- EC:${name}:START -->`;
  const end = `<!-- EC:${name}:END -->`;
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`, "m");
  const replacement = `${start}\n${body}\n${end}`;
  return pattern.test(text) ? text.replace(pattern, replacement) : text;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const renderOnly = process.argv.includes("--render-only");

  if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });
  if (!existsSync(SITE)) mkdirSync(SITE, { recursive: true });

  const historyPath = join(DATA, "history.json");
  const rankingsPath = join(DATA, "rankings.json");
  const history = readJson(historyPath, {});

  const todayIso = new Date().toISOString().slice(0, 10);
  // `latest-scan.json` stores FLAT records (name/version/hotIntervals/score),
  // while `buildBoards` expects the richer in-memory shape with a `finding` and
  // a `score` object. `--render-only` re-hydrates the flat file back into that
  // shape instead of re-scanning. Getting this wrong made every render-only run
  // crash on `finding.visibilityGuard`, which is exactly the kind of failure a
  // nightly job would hit and a human would not.
  let scored = readJson(join(DATA, "latest-scan.json"), []).map((record) => ({
    name: record.name,
    version: record.version,
    payloadBytes: record.payloadBytes ?? 1024,
    finding: {
      sizeBytes: record.sizeBytes ?? 0,
      visibilityGuard: record.visibilityGuard === true,
      hotIntervals: record.hotIntervals ?? [],
      conditionalIntervals: record.conditionalIntervals ?? [],
      uiOnlyHotIntervals: record.uiOnlyHotIntervals ?? [],
      endpoints: record.endpoints ?? [],
    },
    score: {
      total: record.score?.total ?? 0,
      pollingCost: record.score?.pollingCost ?? 0,
      parseCost: record.score?.parseCost ?? 0,
      fastestIntervalMs: record.score?.fastestIntervalMs ?? record.hotIntervals?.[0],
    },
  }));

  if (!renderOnly) {
    const profileDir = resolveProfile();
    if (profileDir === undefined) {
      console.error("[electric-chimneys] no dsh profile found; set EC_PROFILE to a profile root");
      process.exit(2);
    }

    const profilePkg = JSON.parse(readFileSync(join(profileDir, "package.json"), "utf8"));
    const bundles = profilePkg?.dsh?.profile?.bundles ?? [];
    const findings = scanProfile(profileDir, bundles);

    scored = findings.map((finding) => {
      // Model the payload at the median response size we observe across
      // endpoints; per-plugin overrides live in data/payloads.json.
      const overrides = readJson(join(DATA, "payloads.json"), {});
      const payloadBytes = overrides[finding.name] ?? 1024;
      return {
        name: finding.name,
        version: finding.version,
        finding,
        score: scoreFinding(finding, payloadBytes),
        payloadBytes,
      };
    });
  }

  const ranked = rankEntries(scored.filter((entry) => entry.score.total > 0));

  if (dryRun) {
    console.log(`[electric-chimneys] dry run: ${ranked.length} plugins would be audited, nothing written`);
    for (const entry of ranked.slice(0, 5)) {
      console.log(`  ${entry.name.padEnd(34)} ${entry.score.total.toFixed(0)}`);
    }
    return;
  }

  // Fold today into history before building boards so "days listed" includes today.
  for (const entry of ranked) {
    if (!history[entry.name]) history[entry.name] = { days: {} };
    history[entry.name].days[todayIso] = Number(entry.score.total.toFixed(2));
    history[entry.name].version = entry.version;
  }

  const boards = buildBoards(history, ranked, todayIso);
  const generatedAt = new Date().toISOString();

  writeJson(join(DATA, "latest-scan.json"), ranked.map(({ name, version, finding, score, payloadBytes }) => ({
    name,
    version,
    payloadBytes,
    sizeBytes: finding.sizeBytes,
    visibilityGuard: finding.visibilityGuard,
    hotIntervals: finding.hotIntervals,
    conditionalIntervals: finding.conditionalIntervals ?? [],
    uiOnlyHotIntervals: finding.uiOnlyHotIntervals ?? [],
    endpoints: finding.endpoints,
    score: {
      total: Number(score.total.toFixed(2)),
      pollingCost: Number(score.pollingCost.toFixed(2)),
      parseCost: Number(score.parseCost.toFixed(2)),
    },
  })));
  writeJson(historyPath, history);
  writeJson(rankingsPath, { generatedAt, date: todayIso, ...boards });

  // --- regenerate the human-facing surfaces ---------------------------------
  void humanise;
  const readmePath = join(REPO, "README.md");
  if (existsSync(readmePath)) {
    let readme = readFileSync(readmePath, "utf8");
    readme = replaceBlock(readme, "DAILY", `> **${todayIso}** · regenerated ${generatedAt}\n\n| # | Plugin | Version | Daily waste (a.u.) | Fastest timer | Hidden-tab guard |\n|---|---|---|---|---|---|\n${boardToMarkdown(boards.daily.slice(0, 10), "daily")}`);
    readme = replaceBlock(readme, "WEEKLY", `| # | Plugin | Version | 7-day mean (a.u.) | Days sampled | Today |\n|---|---|---|---|---|---|\n${boardToMarkdown(boards.weekly.slice(0, 10), "weekly")}`);
    readme = replaceBlock(readme, "ALLTIME", `| # | Plugin | Version | Peak (a.u.) | Days listed |\n|---|---|---|---|---|\n${boardToMarkdown(boards.allTime.slice(0, 10), "allTime")}`);
    readme = replaceBlock(readme, "TOTAL", `**${boards.daily.length}** plugins audited · **${humanise(boards.daily.reduce((sum, row) => sum + row.score, 0))}** total daily waste units · last run ${todayIso}`);
    writeFileSync(readmePath, readme, "utf8");
  }

  writeFileSync(join(SITE, "index.html"), renderSite({ boards, todayIso, generatedAt }), "utf8");

  // One dossier per ranked plugin, so every claim on the board is checkable.
  const dossierDir = join(SITE, "plugin");
  if (!existsSync(dossierDir)) mkdirSync(dossierDir, { recursive: true });
  for (const row of boards.daily) {
    const record = ranked.find((entry) => entry.name === row.name);
    if (record === undefined) continue;
    const flat = {
      name: record.name,
      version: record.version,
      payloadBytes: record.payloadBytes,
      sizeBytes: record.finding.sizeBytes,
      visibilityGuard: record.finding.visibilityGuard,
      hotIntervals: record.finding.hotIntervals,
      conditionalIntervals: record.finding.conditionalIntervals ?? [],
      endpoints: record.finding.endpoints,
      score: {
        total: Number(record.score.total.toFixed(2)),
        pollingCost: Number(record.score.pollingCost.toFixed(2)),
        parseCost: Number(record.score.parseCost.toFixed(2)),
      },
    };
    const slug = record.name.replaceAll("/", "__").replaceAll("@", "");
    writeFileSync(join(dossierDir, `${slug}.html`), renderDossier(flat, row.rank), "utf8");
  }

  {
    console.log(`[electric-chimneys] ${todayIso}: ${boards.daily.length} plugins audited`);
    console.log(`[electric-chimneys] worst: ${boards.daily[0]?.name ?? "(none)"} @ ${humanise(boards.daily[0]?.score ?? 0)} a.u.`);
  }

  const alarming = boards.daily.filter((row) => row.score >= ALARM_SCORE);
  if (alarming.length > 0 && !dryRun) {
    console.log(`[electric-chimneys] ${alarming.length} plugin(s) above the alarm threshold:`);
    for (const row of alarming) console.log(`  - ${row.name} @ ${humanise(row.score)} a.u.`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[electric-chimneys] inspection failed:", error);
  process.exit(2);
});
