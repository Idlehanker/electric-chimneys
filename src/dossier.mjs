/**
 * Per-plugin findings pages.
 *
 * A ranking without evidence is an accusation. Every entry on the board links
 * here, where the reader sees exactly what the scanner saw: the bundle, the
 * intervals, the endpoints, the arithmetic, and — importantly — what we did NOT
 * look at.
 *
 * @module electric-chimneys/dossier
 */

import { humanise, timerDailyCost, costPerTick, ticksPerDay } from "./metrics.mjs";
import { escapeHtml } from "./render.mjs";

/**
 * Render one plugin's dossier page.
 *
 * @param entry - a record from `data/latest-scan.json`.
 * @param rank - its position on today's board, or `undefined`.
 * @returns a complete HTML document.
 */
export function renderDossier(entry, rank) {
  const timers = (entry.hotIntervals ?? []).map((intervalMs) => {
    const ticks = ticksPerDay(intervalMs, entry.visibilityGuard);
    const perTick = costPerTick(entry.payloadBytes);
    return {
      intervalMs,
      ticks,
      perTick,
      daily: timerDailyCost(intervalMs, entry.payloadBytes, entry.visibilityGuard),
    };
  });

  const rows = timers
    .map(
      (t) =>
        `<tr><td class="num">${t.intervalMs}</td><td class="num">${humanise(t.ticks)}</td><td class="num">${t.perTick.toFixed(2)}</td><td class="num">${humanise(t.daily)}</td></tr>`,
    )
    .join("\n");

  const endpoints = (entry.endpoints ?? [])
    .map((endpoint) => `<li><code>${escapeHtml(endpoint)}</code></li>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(entry.name)} — Electric Chimneys</title>
<style>
  :root { color-scheme: dark; --bg:#0b0f0d; --surface:#121a16; --line:#23312a; --ink:#e8f0ea; --muted:#8fa398; --accent:#5ddc9a; --bad:#f2705d; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 0 24px 80px; }
  header { padding: 56px 0 28px; border-bottom: 1px solid var(--line); }
  .kicker { color: var(--accent); font-size:12px; letter-spacing:.18em; text-transform:uppercase; }
  h1 { font-size: clamp(26px,4vw,40px); margin: 14px 0 8px; letter-spacing:-.02em; }
  code { font-family: ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13px; }
  .meta { color: var(--muted); }
  h2 { font-size:18px; margin: 40px 0 10px; }
  p { color: var(--muted); max-width: 70ch; }
  table { width:100%; border-collapse:collapse; background:var(--surface); border-radius:10px; overflow:hidden; font-size:14px; }
  th { text-align:left; padding:10px 14px; color:var(--muted); font-size:12px; font-weight:500; border-bottom:1px solid var(--line); }
  td { padding:10px 14px; border-bottom:1px solid var(--line); }
  td.num, th.num { text-align:right; font-variant-numeric: tabular-nums; }
  tr:last-child td { border-bottom:none; }
  .score { display:inline-block; background:var(--surface); border:1px solid var(--line); border-left:3px solid var(--bad); border-radius:10px; padding:16px 22px; margin-top:16px; }
  .score b { font-size:26px; display:block; }
  .score span { color:var(--muted); font-size:12px; }
  ul { color: var(--muted); }
  .caveat { background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:16px 20px; margin-top:28px; }
  a { color: var(--accent); }
</style>
</head>
<body>
<div class="wrap">
<header>
  <div class="kicker">Electric Chimneys · findings</div>
  <h1><code>${escapeHtml(entry.name)}</code></h1>
  <p class="meta">version ${escapeHtml(entry.version)} · rank #${rank ?? "—"} today · bundle ${humanise(entry.sizeBytes / 1024)} KB</p>
  <div class="score"><b>${humanise(entry.score.total)} a.u.</b><span>modelled daily waste</span></div>
</header>

<h2>Arithmetic</h2>
<p>Score = polling cost + parse cost. Polling cost is per billed timer; parse cost is the browser bundle divided by 1024.</p>
<table>
<thead><tr><th class="num">Interval (ms)</th><th class="num">Ticks/day</th><th class="num">Cost/tick</th><th class="num">Daily (a.u.)</th></tr></thead>
<tbody>
${rows || '<tr><td colspan="4">No sub-5-second network timers found. This entry is ranked on parse cost alone.</td></tr>'}
</tbody>
</table>
<p class="meta">Polling subtotal ${humanise(entry.score.pollingCost)} a.u. · parse ${humanise(entry.score.parseCost)} a.u. · payload assumed ${entry.payloadBytes} B · hidden-tab guard: ${entry.visibilityGuard ? '<span style="color:var(--accent)">yes (half credit)</span>' : '<span style="color:var(--bad)">no</span>'}</p>

<h2>Endpoints seen in the bundle</h2>
${endpoints ? `<ul>${endpoints}</ul>` : '<p>No path-like literals matched the extractor. The plugin may build URLs dynamically.</p>'}

<div class="caveat">
  <strong>What we did not look at</strong>
  <p style="margin:8px 0 0">Server-side compute, GPU work, layout thrash, memory pressure, and any timer whose period is computed at runtime. A cost we cannot see is a cost we do not bill — so treat this number as a floor, not a verdict. If you believe this finding is wrong, open an issue with the version and the line; corrections ship with the reasoning intact.</p>
</div>

<p style="margin-top:40px"><a href="../index.html">← back to the boards</a></p>
</div>
</body>
</html>
`;
}
