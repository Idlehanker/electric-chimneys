# Method

This document states exactly how a score is produced, what it assumes, and where
it is weak. It is written to be argued with.

## 1. The question

> Which installed browser plugin costs the most **modelled** energy on the user's
> machine per day, and can we prove it reproducibly?

Two words carry the weight: *modelled* and *reproducibly*. A joule measurement is
neither — it varies with device, thermal state, ambient temperature and what else
the machine is doing. A ranking built on it would reshuffle nightly for reasons
unrelated to code.

## 2. What is measured

| Input | How it is obtained |
|---|---|
| Timer periods | Regex over the shipped bundle: literal `setInterval` / `setTimeout` second arguments |
| Bundle size | `stat` on the resolved `exports["./client"]` entry |
| Visibility guard | Presence of `document.hidden`, `visibilityState` or `visibilitychange` |
| Payload size | Configured per plugin in `data/payloads.json`; default 1024 B |

## 3. The model

```
ticks/day   = 86_400_000 / interval_ms × 0.6 × (visibility-aware ? 0.5 : 1)
cost/tick   = payload_bytes / 1024 + 1
polling/day = ticks/day × cost/tick
parse       = bundle_bytes / 1024
score       = polling/day + parse
```

### 3.1 The duty cycle (0.6)

A modelled fraction of wall-clock time during which the tab is open and the timer
is live. A developer works roughly eight hours out of twenty-four; the tab is
sometimes closed, sometimes suspended, sometimes on a machine that is asleep.

**Critique:** 0.6 is a guess with a plausible story. A user who leaves the tab
open around the clock would experience ~1.6× this; a user who closes it at night
would experience less. Because the same constant is applied to every plugin, the
*ranking* is insensitive to it — only the absolute numbers scale.

### 3.2 The visibility credit (0.5)

A plugin that stops working when `document.hidden` is true genuinely does less.
Halving is a crude stand-in for "roughly half the time the tab is in the
background" — which is a better model than the reality that many such plugins
only *check* visibility and still run their timer.

**Critique:** this credits intent. A plugin that guards its *render* but not its
*fetch* still gets the credit. We accept this to avoid requiring a runtime trace,
and we flag it here rather than pretending the credit is precise.

### 3.3 The fixed cost (+1)

A timer tick is never free, even when the response is tiny. It costs:

- an event-loop wake-up (timer resolution, syscall, scheduler churn),
- a TCP round trip, or a re-use of a keep-alive socket plus header parse,
- a JSON parse and allocation,
- usually a React state update and a commit.

Charging `payload_kb` alone would value a 12-byte poll at 0.012 units — three
orders of magnitude below reality. The `+1` is not padding; it is the floor of
"waking up at all".

**Critique:** the true fixed cost varies with connection reuse and HTTP/2
multiplexing. `+1` is a single number standing in for a distribution.

### 3.4 Conditional calls (0.1)

Some timers fire on a fixed cadence but usually return before touching the
network. Two real examples shaped this rule:

- `dshmarket` drains a job queue every 2 s, but only fetches when a queued or
  running record exists.
- `dsh-im-connect` polls QR pairing status every 2 s, but only while that tab
  is open.

Charging these at face value ranks a dormant poller above a live one. We apply a
fixed 0.1 weight instead and report `conditionalIntervals` in the raw data so a
reader can recompute without it.

**Critique:** 0.1 is a guess. A busy queue could make it 1.0; an idle machine
makes it 0. It is applied uniformly, so the ordering among conditional pollers
stays fair even when the absolute number is soft.

### 3.5 Billing only network timers

A 50 ms timer that re-renders a caret and a 50 ms timer that fetches are not the
same cost, and folding both into a "polling" score would be indefensible. The
scanner classifies each timer by what its callback calls, bills only network
timers, and reports UI-only timers separately in `uiOnlyHotIntervals`.

**Critique:** the classifier is a pattern match on source text. `ctx.get("theme")`
once matched a `/\.(get|post)/` rule and put an innocent plugin at the top of the
board. The rule is now narrow and deliberately conservative: a missed finding is
better than a false accusation.

### 3.6 Why parse cost uses weight 1

A 1.5 MB bundle costs one parse per page load, not per day. Folding it into a
per-day score mixes units. We do it anyway because both are "what this plugin
takes from you" and because the parse term is usually an order of magnitude below
the polling term — it refines the order rather than dominating it.

**Critique:** for a plugin with no timers but a 1.5 MB bundle, the score is
entirely parse cost. Read those rows as "cold-start cost", not "continuous burn".

## 4. What is not measured, and why

- **Server-side compute.** Out of scope by design, and stated on every surface.
- **GPU and compositing.** A plugin animating off-screen still costs real power;
  we cannot see it statically.
- **Memory pressure.** A leak forces swap, which costs energy; no static signal.
- **Layout thrash.** `getBoundingClientRect` in a loop is expensive; not detected.
- **Build-time and CI energy.** The ledger measures the user's machine.

## 5. Known failure modes

1. **Minified dynamism.** `setInterval(fn, cfg.interval)` is invisible. The
   scanner skips it rather than guessing. Under-reports.
2. **Framework scheduling.** Work driven by a store subscription rather than a
   timer is not counted, even when the store updates 60 times a second.
3. **Shared timers.** One module-level timer serving several components is
   counted once. Correct per timer, potentially under-representing total work.
4. **Event-driven polling.** A `fetch` on `focus` plus `visibilitychange` only
   costs what the user's own interactions cause; we do not bill it.

## 6. Reproducibility

```sh
npm run inspect          # writes data/, site/index.html, README boards
npm run render           # re-renders from data/latest-scan.json only
```

Ranking ties break on plugin name, so two runs over unchanged inputs produce the
same ordering every time. The `generatedAt` timestamp and the site's footer
differ, because they record when the run happened; everything derived from a
measurement is stable. That distinction matters: a ledger whose *numbers*
reshuffle when nothing changed is not a ledger, but a ledger that pretends not to
know when it ran is not auditable.

## 7. Corrections

If any constant above is wrong, the fix is a pull request to
`src/metrics.mjs` plus a note here describing what changed and why the old value
was wrong. We would rather publish a corrected number than defend a wrong one.
