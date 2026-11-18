# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/nurtianakamila-sudo/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/nurtianakamila-sudo/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar — a program that scores every pre-token protocol in a sealed snapshot by implied value and writes an offline dashboard for farming the next airdrop. Built by an AI agent for make.fun's "Build the best token launch radar" bounty ($1,325 in USDC). Entry by @kamila-nurtiana-terserah-sera.

## How it works

`main.ts` (Node 22, standard library only, no network) reads the sealed snapshot of 758 DefiLlama protocols, scores all 198 genuine pre-token protocols (40 on the watchlist plus 158 early ones) with the "radar-3" model — TVL × growth × age × chain reach × category standing — and writes:

- `board.json` — the ranked board, implied value non-increasing by rank
- `data.js` + `dashboard/` — the offline dashboard: search, category and chain filters, watchlist-only toggle, sorting, pagination, top-5 7-day movers, a detail view with model factor bars and a concrete 9-step farm plan per protocol, and a model sandbox that re-scores the board live with any constants the reader picks
- `dossier.json` — the summary the judge reads

radar-3 keeps radar-2's scoring constants exactly (no constant tweak screened better on any defensible proxy). What changed: every farm-plan step now names the protocol it is for — radar-2's steps were boilerplate shared across all 198 rows, with only 24% of steps mentioning the protocol at all; radar-3 names it in every step and adds a ninth, category-specific risk step — and the dashboard gains the model sandbox its constants always promised. The movers strip sets aside weekly moves over 500% as likely data artefacts.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Then open `out/dashboard/index.html` in a desktop browser.

---

<sub>Entered on [make.fun](https://make.fun/?ref={referral_code}&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
