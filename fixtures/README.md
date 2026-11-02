# Fixture profile

A deterministic, offline profile for CI and for anyone who wants to see the
scanner work without pointing it at their own machine.

```sh
EC_PROFILE=fixtures/profile npm run inspect --dry-run
```

Four synthetic packages, each chosen to pin one behaviour:

| Package | What it pins |
|---|---|
| `demo-chimney` | The archetype: 250 ms poll, no visibility guard. Must rank high. |
| `demo-polite` | Same cadence **with** a `document.hidden` guard. Must score exactly half of `demo-chimney`. |
| `demo-bloat` | No timers, 350 KB bundle. Must rank on parse cost alone. |
| `demo-steady` | 30 s poll with a guard. Must fall below the finding threshold. |

If a change to `src/` breaks the relationship between the first two rows, that
change made the model less honest, not more.
