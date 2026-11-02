/**
 * Board tests.
 *
 * These exist because two real defects shipped and were caught only by running
 * the thing:
 *
 * 1. `--render-only` crashed on `finding.visibilityGuard`, because the persisted
 *    `latest-scan.json` is flat while the in-memory shape is nested.
 * 2. The weekly board silently reported a 1-day mean when history held two days.
 *
 * A nightly job is exactly where such failures go unnoticed, so they are pinned
 * here rather than trusted to manual runs.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { buildBoards, rollingMean } from "../src/rank.mjs";

/**
 * Build a minimal in-memory scored entry.
 *
 * @param name - plugin name.
 * @param total - daily score.
 * @returns a record shaped like the scanner's output.
 */
function entry(name, total) {
  return {
    name,
    version: "1.0.0",
    finding: { visibilityGuard: true, sizeBytes: 1024, hotIntervals: [2000] },
    score: { total, fastestIntervalMs: 2000 },
  };
}

test("weekly mean uses every day in history, not just today", () => {
  const history = { a: { days: { "2026-11-01": 100, "2026-11-02": 50 } } };
  const boards = buildBoards(history, [entry("a", 50)], "2026-11-02");
  assert.equal(boards.weekly[0].samples, 2, "both days must be sampled");
  assert.equal(boards.weekly[0].score, 75, "mean of 100 and 50 is 75");
});

test("all-time uses the peak, not the latest", () => {
  const history = { a: { days: { "2026-11-01": 100, "2026-11-02": 50 } } };
  const boards = buildBoards(history, [entry("a", 50)], "2026-11-02");
  assert.equal(boards.allTime[0].score, 100, "peak must survive a good day");
});

test("the weekly window is capped at seven days", () => {
  const days = {};
  for (let i = 1; i <= 10; i += 1) days[`2026-11-0${i % 9 + 1}`] = i * 10;
  const history = { a: { days } };
  const boards = buildBoards(history, [entry("a", 100)], "2026-11-10");
  assert.ok(boards.weekly[0].samples <= 7, "never averages more than a week");
});

test("rollingMean handles an empty series", () => {
  assert.equal(rollingMean([], 7), 0);
});

test("a plugin absent from history still appears on all three boards", () => {
  const boards = buildBoards({}, [entry("fresh", 42)], "2026-11-02");
  assert.equal(boards.daily.length, 1);
  assert.equal(boards.weekly.length, 1);
  assert.equal(boards.allTime.length, 1);
  assert.equal(boards.allTime[0].daysListed, 1);
});

test("persisted flat records re-hydrate without losing fields", () => {
  // Mirrors what bin/inspect.mjs does for --render-only.
  const flat = {
    name: "p",
    version: "2.0.0",
    payloadBytes: 512,
    sizeBytes: 2048,
    visibilityGuard: true,
    hotIntervals: [5000],
    conditionalIntervals: [],
    uiOnlyHotIntervals: [],
    endpoints: ["/api/p/state"],
    score: { total: 12.5, pollingCost: 10, parseCost: 2.5 },
  };
  const hydrated = {
    name: flat.name,
    version: flat.version,
    payloadBytes: flat.payloadBytes,
    finding: {
      sizeBytes: flat.sizeBytes,
      visibilityGuard: flat.visibilityGuard,
      hotIntervals: flat.hotIntervals,
      conditionalIntervals: flat.conditionalIntervals,
      endpoints: flat.endpoints,
    },
    score: { total: flat.score.total, fastestIntervalMs: flat.hotIntervals[0] },
  };
  const boards = buildBoards({ p: { days: { "2026-11-02": 12.5 } } }, [hydrated], "2026-11-02");
  assert.equal(boards.daily[0].visibilityGuard, true, "guard must survive the round trip");
  assert.equal(boards.daily[0].fastestIntervalMs, 5000, "interval must survive the round trip");
});
