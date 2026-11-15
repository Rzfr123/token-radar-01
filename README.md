# Token Radar — token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Rzfr123/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Rzfr123/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Every pre-token protocol in the sealed DefiLlama snapshot, ranked by what its
launch would be worth, each with a farm plan. Built for make.fun's
token-radar-01 bounty ($1,325).

## The model (radar-2)

Implied value is priced off the snapshot's own live market, never a fixed
multiple and never a hand-picked name:

```
implied = round(TVL x category_multiple x growth x maturity x breadth)
```

- **category_multiple** — median market-cap-per-TVL of the live-token
  protocols in the same category (min 3, else the global median 0.2138),
  clamped to [0.05, 2.0]. Lending is priced like lending trades.
- **growth** — `1 + clamp(change_7d, -60, 120) / 100 x 0.5`
- **maturity** — `0.6 + min(age_days, 1095) / 1095 x 0.4` (unknown age: 365d)
- **breadth** — `1 + 0.03 x min(chains - 1, 10)`, at most x1.30

The board ranks **every** rankable pre-token protocol (watchlist + all
pre-token protocols below the $50M floor), so a launch is found early.
Live-token protocols are set aside with their market caps shown.

## The dashboard

Static, no network: sortable board, search + category + chain filters,
early-only toggle, pre-token / live-token tabs, and a detail view per
protocol with the full model breakdown and a 6-step farm plan (every step
states its cost and time). The page recomputes each row and checks it
against board.json.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22+, standard library only. No network, no funds, no keys.

Implied value is this entry's own claim, never make.fun's. A protocol on
the board records no token in the snapshot — that is DefiLlama's record,
not proof it has none.
