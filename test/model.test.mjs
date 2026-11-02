/**
 * Model tests.
 *
 * The fixture in `fixtures/profile` is not decorative: it encodes the two
 * properties this project must never lose — a visibility guard halves the bill,
 * and a UI timer is not billed as a network timer. If these break, the board is
 * wrong even when it renders.
 *
 * Run with: `node --test test/`
 */

import test from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { scanProfile } from "../src/scan.mjs";
import { scoreFinding } from "../src/rank.mjs";
import { ticksPerDay, costPerTick, CONDITIONAL_WEIGHT } from "../src/metrics.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "..", "fixtures", "profile");

const BUNDLES = ["demo-chimney", "demo-polite", "demo-bloat", "demo-steady"];

/**
 * Scan the fixture and score everything at the default 1 KB payload.
 *
 * @returns a map of name → scored entry.
 */
function scoreFixture() {
  const findings = scanProfile(FIXTURE, BUNDLES);
  const byName = new Map();
  for (const finding of findings) byName.set(finding.name, { finding, score: scoreFinding(finding, 1024) });
  return byName;
}

test("a visibility guard halves the bill", () => {
  const scored = scoreFixture();
  const chimney = scored.get("demo-chimney");
  const polite = scored.get("demo-polite");
  assert.ok(chimney && polite, "both fixture packages must be found");
  assert.equal(chimney.finding.visibilityGuard, false);
  assert.equal(polite.finding.visibilityGuard, true);
  const ratio = polite.score.total / chimney.score.total;
  // Parse cost is not halved, only polling is, so the ratio is just above 0.5
  // for a bundle this small; allow a tight band around it.
  assert.ok(ratio > 0.45 && ratio < 0.6, `expected ~0.5, got ${ratio.toFixed(3)}`);
});

test("a plugin with no timers ranks on parse cost alone", () => {
  const scored = scoreFixture();
  const bloat = scored.get("demo-bloat");
  assert.ok(bloat, "demo-bloat must be found");
  assert.equal(bloat.finding.hotIntervals.length, 0);
  assert.ok(bloat.score.pollingCost === 0, "no polling cost without timers");
  assert.ok(bloat.score.parseCost > 100, "a large bundle must carry real parse cost");
});

test("a polite 30-second poller stays below the finding threshold", () => {
  const scored = scoreFixture();
  const steady = scored.get("demo-steady");
  assert.ok(steady, "demo-steady must be found");
  assert.equal(steady.finding.hotIntervals.length, 0, "30 s is not a hot interval");
});

test("the archetype poller is billed as a network timer", () => {
  const scored = scoreFixture();
  const chimney = scored.get("demo-chimney");
  assert.deepEqual(chimney.finding.hotIntervals, [250]);
});

test("ticks per day is monotone in the interval", () => {
  const fast = ticksPerDay(100, false);
  const slow = ticksPerDay(1000, false);
  assert.ok(fast > slow, "a shorter interval must produce more ticks");
  assert.ok(ticksPerDay(1000, true) < slow, "a guard must reduce ticks");
});

test("a tiny payload is never free", () => {
  assert.ok(costPerTick(0) >= 1, "the fixed cost floor must be at least 1");
  assert.ok(costPerTick(12) > costPerTick(0), "larger payloads must cost more");
});

test("the conditional weight actually discounts", () => {
  assert.ok(CONDITIONAL_WEIGHT > 0 && CONDITIONAL_WEIGHT < 1);
});
