# Token Launch Radar — version 2

An entry for the [make.fun](https://make.fun/bounty/token-radar-01) bounty
[token-radar-01 — Build the best token launch radar](https://make.fun/bounty/token-radar-01).

[![make.fun bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/RIYAN112233/makefun-token-radar-v2/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/RIYAN112233/makefun-token-radar-v2/reward.svg)](https://make.fun/bounty/token-radar-01)

## What it does

The program (`main.ts`, Node 22, standard library only) reads the bounty's sealed DefiLlama
snapshot and builds a radar of the protocols that record no token yet:

- **board.json** — every protocol on the snapshot's watchlist, plus the strongest early protocols
  below the watchlist floor, ranked 1..N by implied launch value, each with launch odds, a farm
  verdict with a sized ticket, and a farm plan.
- **dashboard/** — a static page (no network, no framework) with the ranked board, search,
  category and chain filters, a watchlist-only toggle, five sort orders (launch odds among them),
  a detail view per protocol showing the fitted model's own arithmetic for that row, an integrity
  strip accounting for all 758 protocols in the snapshot, the tokenised peer set with the model's
  leave-one-out price for each, the method stated whole, and the held-out tests.
- **screenshots/** — the board, one protocol's detail view, and a filtered view.
- **dossier.json** — written with the vendored `buildDossier` library, byte for byte as the
  scorer rebuilds it.

## The value model — fitted, not hand-set

Version 1 priced a launch as TVL × a category median multiple × three factors whose sizes were
chosen by hand. Version 2 fits the model to the snapshot's own traded protocols by ordinary
least squares, and prints the held-out scores next to version 1's:

```
log10(implied value) = b0 + b1*log10(TVL) + b2*growth + b3*log10(age + 30 days) + b4*extra chains
```

fitted on the 128 protocols whose token trades with a recorded market cap and TVL. Held out —
each peer priced by a model that never saw it — the fitted model's median error is **×3.70**,
against **×5.76** for version 1's model scored the same way; on a walk-forward split (fit the
earlier-tracked half, price the later half) it is **×3.54** against **×5.93**. The fit also
reverses two of version 1's assumptions, and says so on the dashboard: at the same TVL, a
protocol whose TVL just spiked prices *lower*, not higher, and longer-tracked protocols price
slightly lower in this snapshot.

Each row also carries **launch odds** read from its peers' record — of the protocols most like
it (same category, within 5× its TVL, of a similar age, widened until the group holds at least
ten), the share that already trade a token — and a **farm verdict** (Priority / Standard /
Light touch) that sizes the plan's ticket. The board's top 66 rows carry a bespoke eight-step
plan built around that verdict; the rest carry a standard six-step plan sized by the same
verdict. Protocols whose token already trades are never ranked: they are the peer set the
model learns from, shown apart at the market's own values.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to>/snapshot.json
```
