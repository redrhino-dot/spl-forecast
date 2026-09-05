# SPFL 2026/27 Predictor Scorecard

A lightweight, evolving match predictor for the Scottish Premiership, built to sit alongside your existing ESPN / TheSportsDB / football-data.org fetchers and update every gameweek via GitHub Actions.

## Files

- `team_stats.csv` — raw inputs, one row per club. Update this after every matchweek.
- `spfl_predictor.js` — the rating engine and Poisson scoreline model (zero dependencies).

## What It Ranks

**1. Form** — the last 6 results per team, weighted so more recent games count more (weights 1.0 → 2.0 oldest to newest). A team on `WWWLWW` scores higher than one on `WWLWWW` even with identical points, because the loss is more recent in the second string.

**2. Home pitch advantage** — computed per team as `(HomePPG + 0.5) / (AwayPPG + 0.5)`, not a single league-wide constant. This captures that some sides (e.g. a team with a fortress home record but poor away form) get a much bigger boost than others. It's blended multiplicatively into the Poisson lambdas via a square-root split — boosting the home side's expected goals and suppressing the away side's by the same factor.

**3. Attack/Defense strength (xG proxy)** — currently goals-for and goals-against per game relative to the league average, in the style of a basic Dixon-Coles model. This is intentionally the weakest link in the model and the most valuable upgrade path — see "Upgrading to Real xG" below.

## The Shrinkage Problem (Why This Matters in September)

Early in a season, four or five games is a tiny sample. A team that starts 4-0-0 will show an outlandish attack/defense rating that a Poisson model will happily turn into a predicted 4-0 or 5-0 scoreline every week. `spfl_predictor.js` handles this with a `shrink()` function that pulls every rating toward the league-average value of 1.0 until a team has played `SAMPLE_TRUST_GAMES` (default 12, i.e. roughly a third of the season). By matchday 20+, ratings are trusted at full strength; in September, they're heavily regressed. Adjust `SAMPLE_TRUST_GAMES` if you want faster or slower convergence.

## Running It

```bash
# League-wide power ranking (Form + Attack/Defense + Home rating combined)
node spfl_predictor.js team_stats.csv --scorecard

# Single fixture prediction
node spfl_predictor.js team_stats.csv "Motherwell" "Dundee United"
```

The fixture command returns full 1X2 percentages, the single most likely exact score, and the top 3 most probable scorelines with their individual probabilities — useful because in a Poisson model the "most likely" score is often only an 12-17% outcome, and the top-3 spread tells you how confident that pick really is.

## Weekly Evolution Workflow

This is designed to grow the same way your live-score and prediction repos already do:

1. After each gameweek, update `team_stats.csv` — MP, W/D/L, GF/GA, home/away splits, and shift the `Form6` string left by one character, dropping the oldest result and appending the newest.
2. Commit the updated CSV. `spfl_predictor.js` needs no code changes — it recomputes all ratings from the CSV on every run.
3. Optionally, wire a GitHub Actions cron job (similar to your existing live-score automation) that scrapes the BBC Sport or Sporting Life table each Sunday night, regenerates `team_stats.csv` automatically, and commits it — fully removing the manual step.
4. Run `--scorecard` weekly to track how each team's Power Score, Form Multiplier, and Home Advantage Rating drift over the season — this is the "developing" part of the scorecard the model is built for.

## Upgrading to Real xG

Goals-for/against is a decent early proxy but is noisy — a side can out-shoot an opponent 20-3 and still lose 1-0. To swap in real Expected Goals:

1. Source shot-level or match-level xG (Understat doesn't cover the SPFL, but FotMob and SofaScore both publish per-match xG for Scottish Premiership fixtures via their unofficial APIs — the same category of integration you've already done with ESPN).
2. Add `xGF` and `xGA` columns to `team_stats.csv`.
3. In `buildRatings()`, blend `rawAttack` and `rawDefense` as a weighted average of goals-based and xG-based ratios (e.g. 60% xG / 40% actual goals) rather than goals alone — this is the standard approach to avoid overreacting to finishing variance while still respecting actual results.

## Betting-Market Cross-Check

Per the discipline from the Dundee derby analysis: this model's 1X2 output should always be sanity-checked against live bookmaker odds. Convert any odds to implied probability (`1/decimal_odds`), normalize away the overround, and compare directly against `homeWinPct` / `drawPct` / `awayWinPct` from `predictMatch()`. Large divergences are exactly where you either have a genuine edge or a blind spot in the model (usually missing injury/suspension news, which this scorecard doesn't yet ingest) — investigate before staking either way.
