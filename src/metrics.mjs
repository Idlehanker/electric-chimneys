/**
 * Carbon accounting for browser plugins.
 *
 * ## The unit
 *
 * Every number this module produces is in **arbitrary energy units (a.u.)**, and
 * that is deliberate. A static analyser cannot measure joules. It can measure
 * the things that *cause* joules: how often a timer fires, how large the payload
 * is, how much JavaScript the main thread must parse before the plugin does
 * anything, and whether the author bothered to suspend work when the tab is
 * hidden. Those are observable, comparable and reproducible.
 *
 * Converting to Wh would require a real joule meter, a fixed device, and a fixed
 * thermal envelope. We have none of those in a CI runner, so we publish a unit
 * that is honest about being a model rather than a measurement.
 *
 * ## The model
 *
 * ```
 *   work per day (a.u.) = ticksPerDay × costPerTick
 *   costPerTick         = payloadBytes / 1024 + 1
 * ```
 *
 * The constant `1` is not padding: a request that returns 30 bytes still costs a
 * timer wake-up, a TCP round trip on a cold connection, a JSON parse and a React
 * commit. Treating tiny responses as free is exactly the accounting error that
 * lets polling look harmless. A reader who disagrees with the constant can change
 * one number here and re-run; the ranking recomputes consistently.
 *
 * ## What is ignored, and why
 *
 * Server-side work is out of scope. This project audits what the *browser* burns
 * on the user's machine — the part the user pays for in battery heat and the
 * part the plugin author controls directly. A plugin that offloads to a server
 * is not therefore good; it has simply moved the cost somewhere this ledger does
 * not measure, and every entry says so.
 *
 * @module electric-chimneys/metrics
 */

/** Milliseconds in one solar day. */
export const MS_PER_DAY = 86_400_000;

/**
 * How much a single poll is assumed to cost before payload size is considered.
 *
 * Represents the fixed overhead of waking the event loop and issuing a request.
 */
export const FIXED_TICK_COST = 1;

/**
 * Fraction of wall-clock time a timer is assumed to be running.
 *
 * `0.6` is a modelled duty cycle: a developer works roughly eight hours and the
 * tab sits idle-but-open for the rest. We do not claim precision — we claim that
 * the same assumption is applied to every plugin, so the ranking stays fair.
 */
export const ASSUMED_DUTY_CYCLE = 0.6;

/**
 * Weight applied to a timer whose network call sits behind an early return.
 *
 * A queue-draining poller and a pairing-status poller both fire on a fixed
 * cadence but usually return without touching the network. `0.1` says "assume it
 * actually requests one tick in ten" — a guess, stated as one, and applied
 * uniformly so the ranking stays comparable.
 *
 * The alternative — charging them at face value — would rank a dormant poller
 * above a live one, which is a worse error than an admitted approximation.
 */
export const CONDITIONAL_WEIGHT = 0.1;

/**
 * Ticks per day for a timer with the given interval.
 *
 * A hidden-tab guard is credited by halving the ticks: a visibility-aware poller
 * genuinely does less work, and pretending otherwise would punish the authors
 * who did the right thing.
 *
 * @param intervalMs - the timer's period, in milliseconds.
 * @param hiddenAware - whether the plugin checks `document.hidden` / visibility.
 * @returns modelled ticks per day, floored at zero.
 */
export function ticksPerDay(intervalMs, hiddenAware) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return 0;
  const raw = MS_PER_DAY / intervalMs;
  return raw * ASSUMED_DUTY_CYCLE * (hiddenAware ? 0.5 : 1);
}

/**
 * Cost of one tick at a given payload size.
 *
 * @param responseBytes - bytes the endpoint returns.
 * @returns cost in arbitrary units.
 */
export function costPerTick(responseBytes) {
  const kb = Math.max(0, Number.isFinite(responseBytes) ? responseBytes : 0) / 1024;
  return kb + FIXED_TICK_COST;
}

/**
 * Daily energy attributable to one polling timer.
 *
 * @param intervalMs - timer period.
 * @param responseBytes - modelled payload of the request it fires.
 * @param hiddenAware - whether the plugin pauses while hidden.
 * @returns modelled daily work in arbitrary units.
 */
export function timerDailyCost(intervalMs, responseBytes, hiddenAware, conditional = false) {
  const base = ticksPerDay(intervalMs, hiddenAware) * costPerTick(responseBytes);
  return conditional ? base * CONDITIONAL_WEIGHT : base;
}

/**
 * Parse cost: bytes of JavaScript the browser must download and parse.
 *
 * Cold-start cost is paid once per page load, not per tick, so it is reported
 * separately instead of being folded into the daily number. A 1.5 MB bundle is a
 * different *kind* of waste from a 500 ms poller, and collapsing them would hide
 * both.
 *
 * @param clientBytes - size of the plugin's browser bundle.
 * @returns modelled parse cost in arbitrary units.
 */
export function parseCost(clientBytes) {
  return Math.max(0, clientBytes) / 1024;
}

/**
 * Abbreviate a count for display without losing the order of magnitude.
 *
 * @param value - a non-negative number.
 * @returns a short human string such as `84.3k`.
 */
export function humanise(value) {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(value < 10 ? 2 : 0);
}
