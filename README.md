# 🔥 Electric Chimneys

### *Every watt a plugin ignores becomes your battery.*

[![daily audit](https://img.shields.io/badge/audit-daily-5ddc9a?style=flat-square)](#)
[![unit](https://img.shields.io/badge/unit-arbitrary%20energy%20(a.u.)-f0a94c?style=flat-square)](#how-the-score-works)
[![no network](https://img.shields.io/badge/runs%20offline-yes-5ddc9a?style=flat-square)](#)

> **Name, decoded.** A chimney is where the fuel you paid for goes up as smoke
> nobody bills you for. A laptop full of runaway timers has a chimney too — it is
> invisible, it sits on your knees, and it is venting your battery right now.
> Electric chimneys smoke without a flame. **That is what this ledger measures.**

---

## 🌍 Our declaration

**Software has a chimney.** It is invisible, it is in your lap, and nobody sends
you a bill for it.

Every timer that fires while you are reading. Every status request that returns
twelve bytes and still costs a wake-up, a round trip, a JSON parse and a React
commit. Every bundle that must be downloaded and parsed before a button can be
drawn. That is fuel — burned somewhere, usually from a battery, usually for
nothing.

We refuse the idea that this is simply the price of a rich interface.

> ### Green software is not a feature you bolt on. It is a budget you respect.

A plugin that polls four times a second has made a decision **on your behalf**
about how long your laptop will last and how much coal was burned to charge it.
It did not ask. This ledger asks for it, publicly, every day.

**爱护地球，从我做起。**
*Care for the Earth — starting with us.* That sentence is not a slogan in this
repository. It is the specification.

---

## 📊 The three boards

Live, regenerated on every run. The same data drives [`site/index.html`](site/index.html).

<!-- EC:TOTAL:START -->
**0** plugins audited · **0.00** total daily waste units · last run 2026-11-14
<!-- EC:TOTAL:END -->

### 🕛 Today's board — *one scan, one day*

The number that would move tonight if an author shipped a fix.

<!-- EC:DAILY:START -->
> **2026-11-14** · regenerated 2026-11-14T10:19:33.590Z

| # | Plugin | Version | Daily waste (a.u.) | Fastest timer | Hidden-tab guard |
|---|---|---|---|---|---|

<!-- EC:DAILY:END -->

### 🗓 This week — *rolling 7-day mean*

What a plugin is **like**, rather than what it did once. A single bad release
should not crown it permanently, and a genuine problem should not hide behind a
quiet Tuesday.

<!-- EC:WEEKLY:START -->
| # | Plugin | Version | 7-day mean (a.u.) | Days sampled | Today |
|---|---|---|---|---|---|

<!-- EC:WEEKLY:END -->

### 🏆 All time — *peak score, and for how long*

Longevity is the honest signal. A plugin that has burned cycles for ninety days
is a different problem from one that spiked once.

<!-- EC:ALLTIME:START -->
| # | Plugin | Version | Peak (a.u.) | Days listed |
|---|---|---|---|---|

<!-- EC:ALLTIME:END -->

---

## 🧪 How the score works

```
work per day (a.u.) = ticks per day × cost per tick  +  bundle parse cost

ticks per day  = 86,400,000 / interval_ms  ×  0.6 duty cycle  ×  0.5 if visibility-aware
cost per tick  = payload KB + 1
parse cost     = bundle KB
```

**Why "arbitrary units" and not watt-hours.** A static analyser cannot measure
joules. It can measure the things that *cause* joules: how often a timer fires,
how large the payload is, how much JavaScript must be parsed, and whether the
author suspended work when the tab was hidden. Converting any of that to Wh
would require a joule meter, a fixed device and a fixed thermal envelope — none
of which exist in a CI runner. We publish a unit that is honest about being a
model.

**Why the constant `+1`.** A twelve-byte response is not free. It costs a timer
wake, a round trip on a cold connection, a JSON parse and a render. Treating tiny
responses as free is precisely the accounting error that lets polling look
harmless.

**What is credited.** A bundle that checks `document.hidden` / `visibilityState`
really does less work, and is scored at half. Authors who did the right thing are
not punished for it.

**What is out of scope.** Server-side compute. This ledger audits what the
*browser* burns on the user's machine — the part the user pays for in battery
heat and the part the plugin author controls directly. A plugin that offloads to a
server has not become good; it has moved the cost somewhere we do not measure.

---

## 📏 What this can and cannot see

We read the shipped JavaScript. That buys reproducibility and costs precision.

| Sees | Does not see |
|---|---|
| Literal `setInterval` / `setTimeout` periods | Intervals computed at runtime from variables |
| Payload size when configured per plugin | Real bytes on the wire per request |
| `document.hidden` / `visibilitychange` guards | Work scheduled through framework primitives |
| Bundle size on disk | GPU work, layout thrash, memory pressure |

> **A timer we cannot see is a cost we do not bill.** This is a floor, not a
> ceiling. If you find a plugin burning cycles that is missing from these boards,
> that is a defect in *this repository* — please open an issue.

---

## ⚖️ Fairness rules

This project names real packages. That obliges us to some rules we hold ourselves
to, in public:

1. **Reproducible or it does not ship.** Every number comes from
   `npm run inspect` against a pinned version. The same inputs produce the same
   ordering every time — only the run timestamp moves.
2. **Version is always published.** We rank a *version*, never an author.
3. **Corrections are first-class.** If our arithmetic is wrong, the issue is
   accepted and the fix lands with the reasoning intact.
4. **Fixes are celebrated.** A plugin that drops off the board gets a line in
   [`docs/EXONERATED.md`](docs/EXONERATED.md) — we are not here to hold grudges,
   we are here to reduce the number.
5. **No personal attacks.** The subject is a timer's interval, not a person's
   competence. Every finding links to the exact line.

---

## 🚀 Run it yourself

```sh
git clone https://github.com/<you>/electric-chimneys.git
cd electric-chimneys

# audit the default profile (~/.dsh/profiles/web)
npm run inspect

# audit a different profile
EC_PROFILE=/path/to/profile npm run inspect

# regenerate the site and README from the last scan, without re-scanning
npm run render

# prove the model still holds its invariants
npm test
```

`npm test` runs against `fixtures/profile`, a four-package synthetic profile
that pins the two properties this project must never lose: a visibility guard
halves the bill, and a UI timer is not billed as a network timer. Those tests
were written **after** both properties were broken during development — see
[`docs/METHOD.md`](docs/METHOD.md) for what went wrong and how it was caught.

Exit codes are meaningful to a scheduler:

| Code | Meaning |
|---|---|
| `0` | Ran; boards are current |
| `1` | Ran; at least one finding above the alarm threshold |
| `2` | Could not run (no profile, unreadable manifest) |

---

## 🗂 Layout

```
electric-chimneys/
├── bin/
│   └── inspect.mjs        # the daily run: scan → score → history → render
├── src/
│   ├── metrics.mjs        # the carbon model, in one place
│   ├── scan.mjs           # static reader for plugin bundles
│   ├── rank.mjs           # daily / weekly / all-time boards
│   └── render.mjs         # zero-dependency static site
├── data/
│   ├── history.json       # every plugin's score, every day
│   ├── latest-scan.json   # full findings of the most recent run
│   ├── payloads.json      # per-plugin payload overrides
│   └── rankings.json      # the three boards, machine-readable
├── site/index.html        # the published page
└── docs/
    ├── METHOD.md          # the model, the constants, the critique of them
    └── EXONERATED.md      # plugins that fixed their behaviour
```

---

## 🤝 Contributing

The most valuable contribution is **not** a new rule that makes the numbers
bigger. It is one of these:

- **A false positive.** Show us a finding that does not actually cost energy.
- **A blind spot.** Show us a real waste our scanner cannot see.
- **A fix.** Land it, and we will exonerate your plugin on the front page.

Read [`docs/METHOD.md`](docs/METHOD.md) before arguing with the output — it
contains the limits we already know about, stated by us rather than discovered by
you.

---

## 📜 License

MIT. Take the model, improve it, point it at your own fleet.

---

<p align="center">
<sub><b>爱护地球，从我做起</b> · Care for the Earth, starting with us.</sub>
</p>
