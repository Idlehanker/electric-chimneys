/**
 * Static site renderer.
 *
 * The published page is one self-contained HTML file: no framework, no build
 * step, no runtime dependency. That is a deliberate choice for a project whose
 * subject is wasteful software — shipping a 400 KB bundle to display a table of
 * oversized bundles would be an obvious self-own.
 *
 * Rendering is pure: the same inputs produce byte-identical output, so a daily
 * commit is only non-empty when the numbers actually moved.
 *
 * @module electric-chimneys/render
 */

import { humanise } from "./metrics.mjs";

/**
 * Escape text for safe interpolation into HTML.
 *
 * Plugin names come from package manifests, which we do not control. Even
 * though the current inputs are registry names, escaping is not optional: the
 * scanner reads whatever is installed.
 *
 * @param value - any value to render.
 * @returns HTML-safe text.
 */
export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Render one board as an HTML table.
 *
 * @param rows - ranked rows.
 * @param kind - `daily` | `weekly` | `allTime`.
 * @returns an HTML string.
 */
function table(rows, kind) {
  if (rows.length === 0) {
    return '<p class="empty">No findings in this window. Either the fleet is clean or the scanner is blind — check the coverage note below.</p>';
  }

  const header =
    kind === "daily"
      ? "<tr><th>#</th><th>Plugin</th><th>Version</th><th>Daily waste (a.u.)</th><th>Fastest timer</th><th>Hidden-tab guard</th></tr>"
      : kind === "weekly"
        ? "<tr><th>#</th><th>Plugin</th><th>Version</th><th>7-day mean (a.u.)</th><th>Days sampled</th><th>Today</th></tr>"
        : "<tr><th>#</th><th>Plugin</th><th>Version</th><th>Peak (a.u.)</th><th>Days listed</th></tr>";

  const body = rows
    .map((row) => {
      if (kind === "daily") {
        const guard = row.visibilityGuard ? '<span class="ok">yes</span>' : '<span class="bad">no</span>';
        const slug = String(row.name).replaceAll("/", "__").replaceAll("@", "");
        return `<tr><td class="rank">${row.rank}</td><td><a href="plugin/${slug}.html"><code>${escapeHtml(row.name)}</code></a></td><td>${escapeHtml(row.version)}</td><td class="num">${humanise(row.score)}</td><td class="num">${row.fastestIntervalMs ?? "—"} ms</td><td>${guard}</td></tr>`;
      }
      if (kind === "weekly") {
        return `<tr><td class="rank">${row.rank}</td><td><code>${escapeHtml(row.name)}</code></td><td>${escapeHtml(row.version)}</td><td class="num">${humanise(row.score)}</td><td class="num">${row.samples}</td><td class="num">${humanise(row.latest)}</td></tr>`;
      }
      return `<tr><td class="rank">${row.rank}</td><td><code>${escapeHtml(row.name)}</code></td><td>${escapeHtml(row.version)}</td><td class="num">${humanise(row.score)}</td><td class="num">${row.daysListed}</td></tr>`;
    })
    .join("\n");

  return `<table>\n<thead>${header}</thead>\n<tbody>\n${body}\n</tbody>\n</table>`;
}

/**
 * Build the full page.
 *
 * @param options - the three boards plus timestamps.
 * @param options.boards - `{ daily, weekly, allTime }`.
 * @param options.todayIso - run date.
 * @param options.generatedAt - full ISO timestamp.
 * @returns a complete HTML document.
 */
export function renderSite({ boards, todayIso, generatedAt }) {
  const totalPlugins = boards.daily.length;
  const totalWaste = boards.daily.reduce((sum, row) => sum + row.score, 0);
  const worst = boards.daily[0];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Electric Chimneys — carbon ledger for DSH plugins</title>
<meta name="description" content="A daily, reproducible audit of the browser plugins that waste the most energy. Green software is not a feature; it is a budget.">
<style>
  :root {
    color-scheme: dark;
    --bg: #0b0f0d;
    --surface: #121a16;
    --line: #23312a;
    --ink: #e8f0ea;
    --muted: #8fa398;
    --accent: #5ddc9a;
    --warn: #f0a94c;
    --bad: #f2705d;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, "Noto Sans SC", sans-serif;
  }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 0 24px 96px; }
  header.hero { padding: 72px 0 40px; border-bottom: 1px solid var(--line); }
  .kicker { color: var(--accent); font-size: 12px; letter-spacing: .18em; text-transform: uppercase; }
  h1 { font-size: clamp(32px, 6vw, 56px); line-height: 1.05; margin: 16px 0 12px; letter-spacing: -.02em; }
  h1 span { color: var(--accent); }
  .lede { color: var(--muted); font-size: 17px; max-width: 62ch; margin: 0; }
  .stats { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 32px; }
  .stat { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 14px 18px; min-width: 150px; }
  .stat b { display: block; font-size: 24px; font-weight: 650; }
  .stat span { color: var(--muted); font-size: 12px; }
  h2 { font-size: 22px; margin: 56px 0 8px; letter-spacing: -.01em; }
  h2 .tag { color: var(--muted); font-weight: 400; font-size: 13px; margin-left: 10px; }
  p.note { color: var(--muted); font-size: 14px; max-width: 74ch; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 14px; background: var(--surface); border-radius: 12px; overflow: hidden; }
  thead th { text-align: left; padding: 12px 14px; color: var(--muted); font-weight: 500; font-size: 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  tbody td { padding: 12px 14px; border-bottom: 1px solid var(--line); }
  tbody tr:last-child td { border-bottom: none; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.rank { color: var(--accent); font-weight: 650; font-variant-numeric: tabular-nums; width: 44px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  .ok { color: var(--accent); }
  .bad { color: var(--bad); font-weight: 600; }
  .empty { color: var(--muted); font-style: italic; }
  .manifesto { background: var(--surface); border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 12px; padding: 26px 30px; margin-top: 20px; }
  .manifesto p { margin: 0 0 14px; }
  .manifesto p:last-child { margin-bottom: 0; }
  .manifesto strong { color: var(--accent); }
  footer { margin-top: 72px; padding-top: 24px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; }
  a { color: var(--accent); }
  @media (max-width: 720px) {
    .wrap { padding: 0 16px 64px; }
    table { font-size: 12px; }
    thead th, tbody td { padding: 9px 8px; }
  }
</style>
</head>
<body>
<div class="wrap">

<header class="hero">
  <div class="kicker">Electric Chimneys · updated ${escapeHtml(todayIso)}</div>
  <h1>Every watt a plugin ignores<br>becomes <span>your battery</span>.</h1>
  <p class="lede">A daily, reproducible audit of the browser plugins installed in this DeepSeek Harness profile. Plugins are ranked by modelled daily energy waste — not by vendetta, not by vibes, and never by anything we cannot re-measure tomorrow.</p>
  <div class="stats">
    <div class="stat"><b>${totalPlugins}</b><span>plugins audited</span></div>
    <div class="stat"><b>${humanise(totalWaste)}</b><span>daily waste units (a.u.)</span></div>
    <div class="stat"><b>${escapeHtml(worst ? worst.name.split("/").pop() : "—")}</b><span>worst offender today</span></div>
    <div class="stat"><b>${escapeHtml(generatedAt.slice(0, 10))}</b><span>last run</span></div>
  </div>
</header>

<section class="manifesto">
  <div class="kicker">Our declaration</div>
  <p><strong>Software has a chimney.</strong> It is invisible, it is in your lap, and nobody sends you a bill for it. Every timer that fires while you are reading, every status request that returns twelve bytes and costs a wake-up, every bundle that must be parsed before a button can be drawn — that is fuel, burned somewhere, usually from a battery, usually for nothing.</p>
  <p>We refuse the idea that this is the price of a rich interface. <strong>Green software is not a feature you bolt on; it is a budget you respect.</strong> A plugin that polls four times a second has made a decision on your behalf about how long your laptop will last.</p>
  <p>So we keep a ledger. We name the offenders, we publish the method, and we re-run the numbers every single day so that a fix is visible and a regression is not forgotten. <strong>爱护地球，从我做起 — care for the Earth, starting with us.</strong> That sentence is not a slogan here; it is the specification.</p>
</section>

<h2>Today's board <span class="tag">ranked by modelled daily work</span></h2>
<p class="note">One scan, one day. This is the number that would move tonight if an author shipped a fix.</p>
${table(boards.daily.slice(0, 20), "daily")}

<h2>This week <span class="tag">rolling 7-day mean</span></h2>
<p class="note">Smoothing tells you what a plugin is <em>like</em>, rather than what it did once. A single bad release should not crown it permanently.</p>
${table(boards.weekly.slice(0, 20), "weekly")}

<h2>All time <span class="tag">peak score, and for how long</span></h2>
<p class="note">Longevity is the honest signal. A plugin that has burned cycles for ninety days is a different problem from one that spiked once.</p>
${table(boards.allTime.slice(0, 20), "allTime")}

<h2>How to read this <span class="tag">read it before you argue with it</span></h2>
<p class="note">Scores are in <strong>arbitrary energy units (a.u.)</strong>. They are a model, not a joule-meter reading: work per day = ticks per day × (payload KB + 1). The constant is there because a twelve-byte response still costs a timer wake, a round trip, a parse and a render — pretending tiny responses are free is the accounting error that makes polling look harmless. Bundles that suspend work while the tab is hidden are credited at half. Server-side cost is out of scope; see the repository for the full method and its limits.</p>

<footer>
  Generated ${escapeHtml(generatedAt)} from a static scan of the installed profile.
  Method, raw data and corrections: <a href="https://github.com/">the repository</a>.
  Found a mistake? Open an issue — being wrong loudly and fixing it publicly is the only way this ledger stays credible.
</footer>

</div>
</body>
</html>
`;
}
