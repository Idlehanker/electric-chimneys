/**
 * Turn raw scan findings into the three boards the site publishes.
 *
 * ## Three boards, one score
 *
 * - **Daily** — today's scan, ranked by modelled daily work. This is the number
 *   that would change if an author shipped a fix tonight.
 * - **Weekly** — the rolling seven-day mean of the daily scores. Smoothing out
 *   one bad day is the point: a release that briefly spikes should not crown a
 *   plugin permanently, and a genuine problem should not be hidden by a quiet
 *   Tuesday.
 * - **All-time** — the highest score the plugin has ever reached, plus how many
 *   days it has held a place. Longevity is the honest signal: a plugin that has
 *   burned cycles for ninety days is a different problem from one that spiked
 *   once.
 *
 * A plugin appears on a board only while it is installed. Vanishing from the
 * ledger when it is uninstalled would let an author "fix" a finding by asking
 * users to remove it, so history is retained — see `data/history.json`.
 *
 * @module electric-chimneys/rank
 */

import { timerDailyCost, parseCost, humanise } from "./metrics.mjs";

/** Weight applied to the parse cost when folding it into the headline score. */
export const PARSE_WEIGHT = 1;

/**
 * Score one plugin for one day.
 *
 * The headline number adds every hot timer's daily work to a one-time parse
 * cost. Mixing a per-day quantity with a per-load quantity is intentional and
 * documented on the site: both are "what this plugin takes from you", and the
 * parse cost is small enough at these magnitudes that it refines the order
 * rather than dominating it.
 *
 * @param finding - a record produced by {@link module:scan.scanPlugin}.
 * @param modelledPayloadBytes - response size assumed for this plugin's polls.
 * @returns the score in arbitrary units, and its parts.
 */
export function scoreFinding(finding, modelledPayloadBytes) {
  const conditional = new Set(finding.conditionalIntervals ?? []);
  const timers = finding.hotIntervals.map((intervalMs) => ({
    intervalMs,
    conditional: conditional.has(intervalMs),
    dailyCost: timerDailyCost(intervalMs, modelledPayloadBytes, finding.visibilityGuard, conditional.has(intervalMs)),
  }));

  const pollingCost = timers.reduce((sum, timer) => sum + timer.dailyCost, 0);
  const parse = parseCost(finding.sizeBytes) * PARSE_WEIGHT;
  const total = pollingCost + parse;

  return {
    total,
    pollingCost,
    parseCost: parse,
    timers,
    fastestIntervalMs: finding.hotIntervals[0],
  };
}

/**
 * Rank an array of scored plugins, worst first.
 *
 * Ties break on the plugin name so that two consecutive runs of the same data
 * produce byte-identical output. A ranking that reshuffles when nothing changed
 * would undermine the whole ledger.
 *
 * @param entries - scored plugin records.
 * @returns a new array, sorted.
 */
export function rankEntries(entries) {
  return [...entries].sort((a, b) => {
    if (b.score.total !== a.score.total) return b.score.total - a.score.total;
    return String(a.name).localeCompare(String(b.name));
  });
}

/**
 * Compute the rolling mean of a series of numbers.
 *
 * @param values - observed daily scores, oldest first.
 * @param window - how many trailing days to average, default 7.
 * @returns the mean, or 0 for an empty series.
 */
export function rollingMean(values, window = 7) {
  if (values.length === 0) return 0;
  const slice = values.slice(-window);
  return slice.reduce((sum, value) => sum + value, 0) / slice.length;
}

/**
 * Build the three boards from the persisted history plus today's scan.
 *
 * @param history - `{ [pluginName]: { days: { [isoDate]: number } } }`.
 * @param todayEntries - today's scored entries, already ranked.
 * @param todayIso - the date key for today, `YYYY-MM-DD`.
 * @returns `{ daily, weekly, allTime }` boards, each an array of rows.
 */
export function buildBoards(history, todayEntries, todayIso) {
  const daily = todayEntries.map((entry, index) => ({
    rank: index + 1,
    name: entry.name,
    version: entry.version,
    score: entry.score.total,
    fastestIntervalMs: entry.score.fastestIntervalMs,
    visibilityGuard: entry.finding.visibilityGuard,
    sizeBytes: entry.finding.sizeBytes,
    daysListed: Object.keys(history[entry.name]?.days ?? {}).length,
  }));

  const weeklyRows = [];
  const allTimeRows = [];

  for (const entry of todayEntries) {
    const days = history[entry.name]?.days ?? {};
    const series = Object.keys(days).sort().map((key) => days[key]);
    const weekMean = rollingMean(series, 7);
    const peak = series.length > 0 ? Math.max(...series) : 0;

    weeklyRows.push({
      name: entry.name,
      version: entry.version,
      score: weekMean,
      samples: Math.min(series.length, 7),
      latest: entry.score.total,
    });
    allTimeRows.push({
      name: entry.name,
      version: entry.version,
      score: peak,
      daysListed: series.length,
    });
  }

  const rank = (rows) =>
    rows
      .sort((a, b) => (b.score !== a.score ? b.score - a.score : String(a.name).localeCompare(String(b.name))))
      .map((row, index) => ({ rank: index + 1, ...row }));

  return { daily, weekly: rank(weeklyRows), allTime: rank(allTimeRows) };
}

/**
 * Render a board as a Markdown table body.
 *
 * @param rows - ranked rows.
 * @param kind - which board this is; controls the columns shown.
 * @returns Markdown rows without a header.
 */
export function boardToMarkdown(rows, kind) {
  return rows
    .map((row) => {
      const score = humanise(row.score);
      if (kind === "daily") {
        return `| ${row.rank} | \`${row.name}\` | ${row.version} | ${score} | ${row.fastestIntervalMs ?? "—"} ms | ${row.visibilityGuard ? "yes" : "**no**"} |`;
      }
      if (kind === "weekly") {
        return `| ${row.rank} | \`${row.name}\` | ${row.version} | ${score} | ${row.samples} | ${humanise(row.latest)} |`;
      }
      return `| ${row.rank} | \`${row.name}\` | ${row.version} | ${score} | ${row.daysListed} |`;
    })
    .join("\n");
}
