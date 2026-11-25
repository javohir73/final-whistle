# UFC prediction evaluation

Generated 2026-11-25 from commit 96aba0f. Aggregate numbers only.

## Summary

- ufc-elo-v0.1: 2,800 held-out fights, accuracy 55.0%, Brier 0.2389, log loss 0.6704. GATE ufc-elo-v0.1: FAIL (log loss below 0.6931 in 3 of 3: 2024 2025 2026; pooled Brier 0.2389 > 0.235)
- ufc-form-v0.2: 2,800 held-out fights, accuracy 62.2%, Brier 0.2299, log loss 0.6514. GATE ufc-form-v0.2: PASS (log loss below 0.6931 in 3 of 3: 2024 2025 2026; pooled Brier 0.2299 <= 0.235)
- Market, on the 2,322 held-out fights with a price: accuracy 67.8%, Brier 0.2058, log loss 0.5983. On the same fights the form model has accuracy 62.1%, Brier 0.2308, log loss 0.6536.

## Protocol

Every number below is walk-forward: a fight is predicted from information that existed before it, and nothing from the held-out years is used to choose a setting. Elo (k, first year of history, idle decay) is tuned by log loss on fights from 2018 to 2021. The form model's training window (3, 5 or 8 years) and regularisation strength (0.1, 1 or 10) are chosen by log loss on 2021, trained on the years before it. For each held-out year T from 2022 to 2026, the form model is fitted on the chosen window of years ending 31 December of T-1 and predicts every fight in T. Elo predictions use only fights that started earlier. The method pick for year T comes from the finishing methods of the ten years before T, by weight class and scheduled rounds. Only finished fights with a winner are scored or used as training labels; draws and no contests stay in the rating history but are never scored. 2026 is a partial year: it covers fights up to 2026-11-21.

The fighter listed first by the feed won more often than half of the time, so the models must not see listing order. Every form-model input changes sign when the two fighters swap, and the model has no intercept. The swap check below rebuilds the whole history with every fight's two fighters swapped, recomputes the Elo ratings and features from it, refits the form model and re-scores it.

The market is the de-vigged moneyline from `ufc_odds_snapshots`: per source the latest valid price taken at or before the scheduled start, averaged over sources. Sources whose name contains "Live" are left out because their prices are in-play. For backfilled history the snapshot time is the bout's scheduled time, so this approximates the closing line. Prices exist almost only from mid-2019.

## Data

- Finished bouts in history: 9,524 (1993 to 2026).
- Scored bouts (a winner recorded): 9,357. Draws and no contests, never scored: 167.
- Fighters: 3,223.
- Scored bouts with a market price: 3,645 in all, 2,322 of the 2,800 held-out fights (2022 on).

## Chosen settings

- Elo (ufc-elo-v0.1): k 100, history from 2010, idle decay 0.2 per year.
- Form (ufc-form-v0.2): training window 3 years, regularisation C 0.1.
- The committed parameter file was fitted on the 3 years from 2023-11-25 to 2026-11-25 (1,721 scored bouts). That production fit has no held-out score of its own; the results below come from the per-year walk-forward fits.

## Results by model

### ufc-elo-v0.1

| Year | Fights | Accuracy | Brier | Log loss |
|---|---|---|---|---|
| 2022 | 558 | 55.2% | 0.2402 | 0.6732 |
| 2023 | 556 | 53.6% | 0.2415 | 0.6756 |
| 2024 | 562 | 55.3% | 0.2375 | 0.6674 |
| 2025 | 563 | 57.0% | 0.2353 | 0.6631 |
| 2026 | 561 | 54.0% | 0.2400 | 0.6727 |
| Pooled | 2,800 | 55.0% | 0.2389 | 0.6704 |

229 of the 2,800 fights have a probability of exactly 50% (both fighters unrated) and count as wrong in the accuracy column. On the other 2,571 fights accuracy is 59.9%.

### ufc-form-v0.2

| Year | Fights | Accuracy | Brier | Log loss |
|---|---|---|---|---|
| 2022 | 558 | 60.0% | 0.2344 | 0.6606 |
| 2023 | 556 | 61.3% | 0.2339 | 0.6604 |
| 2024 | 562 | 61.6% | 0.2278 | 0.6466 |
| 2025 | 563 | 65.9% | 0.2239 | 0.6380 |
| 2026 | 561 | 62.0% | 0.2298 | 0.6515 |
| Pooled | 2,800 | 62.2% | 0.2299 | 0.6514 |

### Baselines

The coin flip says 50% every time; its accuracy is shown as 50.0% by convention. "Higher rating at 50/50" says 50% but is scored on whether the fighter with the higher pre-fight Elo rating won (equal ratings count as wrong), so its accuracy equals Elo's by construction. Both have Brier 0.25 and log loss 0.6931.

**coin flip**

| Year | Fights | Accuracy | Brier | Log loss |
|---|---|---|---|---|
| 2022 | 558 | 50.0% | 0.2500 | 0.6931 |
| 2023 | 556 | 50.0% | 0.2500 | 0.6931 |
| 2024 | 562 | 50.0% | 0.2500 | 0.6931 |
| 2025 | 563 | 50.0% | 0.2500 | 0.6931 |
| 2026 | 561 | 50.0% | 0.2500 | 0.6931 |
| Pooled | 2,800 | 50.0% | 0.2500 | 0.6931 |

**higher rating at 50/50**

| Year | Fights | Accuracy | Brier | Log loss |
|---|---|---|---|---|
| 2022 | 558 | 55.2% | 0.2500 | 0.6931 |
| 2023 | 556 | 53.6% | 0.2500 | 0.6931 |
| 2024 | 562 | 55.3% | 0.2500 | 0.6931 |
| 2025 | 563 | 57.0% | 0.2500 | 0.6931 |
| 2026 | 561 | 54.0% | 0.2500 | 0.6931 |
| Pooled | 2,800 | 55.0% | 0.2500 | 0.6931 |

### Swap check

The history was rebuilt with every fight's fighters, winner and per-side stats swapped, and the ratings, features and form model were recomputed from it. The form model's pooled result is accuracy 62.2%, Brier 0.2299, log loss 0.6514 on 2,800 fights. The largest difference between any fight's probability and one minus its swapped probability is 9.24e-14.

## Against the market

Fights with a market price among the held-out fights: 2,322. All three rows below are scored on those same fights.

**2022**

| Predictor | Fights | Accuracy | Brier | Log loss |
|---|---|---|---|---|
| Market | 554 | 67.5% | 0.2050 | 0.5963 |
| Elo | 554 | 55.6% | 0.2401 | 0.6731 |
| Form | 554 | 59.9% | 0.2352 | 0.6628 |

**2023**

| Predictor | Fights | Accuracy | Brier | Log loss |
|---|---|---|---|---|
| Market | 550 | 66.9% | 0.2115 | 0.6109 |
| Elo | 550 | 53.8% | 0.2412 | 0.6751 |
| Form | 550 | 61.8% | 0.2331 | 0.6587 |

**2024**

| Predictor | Fights | Accuracy | Brier | Log loss |
|---|---|---|---|---|
| Market | 537 | 69.6% | 0.2006 | 0.5881 |
| Elo | 537 | 56.2% | 0.2363 | 0.6649 |
| Form | 537 | 61.8% | 0.2276 | 0.6462 |

**2025**

| Predictor | Fights | Accuracy | Brier | Log loss |
|---|---|---|---|---|
| Market | 552 | 67.4% | 0.2030 | 0.5904 |
| Elo | 552 | 56.7% | 0.2355 | 0.6635 |
| Form | 552 | 65.8% | 0.2244 | 0.6395 |

**2026**

| Predictor | Fights | Accuracy | Brier | Log loss |
|---|---|---|---|---|
| Market | 129 | 67.4% | 0.2184 | 0.6302 |
| Elo | 129 | 49.6% | 0.2534 | 0.7004 |
| Form | 129 | 58.1% | 0.2429 | 0.6840 |

**Pooled**

| Predictor | Fights | Accuracy | Brier | Log loss |
|---|---|---|---|---|
| Market | 2,322 | 67.8% | 0.2058 | 0.5983 |
| Elo | 2,322 | 55.3% | 0.2391 | 0.6709 |
| Form | 2,322 | 62.1% | 0.2308 | 0.6536 |

The form model's Brier is higher (worse) than the market's by 0.0250.
Elo's Brier is higher (worse) than the market's by 0.0334.
The form model's log loss is higher (worse) than the market's by 0.0553.

## Calibration

Fights are grouped by the favourite's stated probability. "Said" is the mean favourite probability in the group and "won" the share of those favourites that won. Pooled over all held-out years.

**ufc-elo-v0.1**

| Favourite probability (%) | Fights | Said | Won |
|---|---|---|---|
| 50–55 | 1,157 | 52.0% | 54.8% |
| 55–60 | 843 | 57.2% | 57.5% |
| 60–65 | 504 | 62.1% | 65.3% |
| 65–70 | 204 | 67.3% | 67.2% |
| 70–75 | 81 | 71.7% | 74.1% |
| 75–80 | 10 | 76.2% | 90.0% |
| 80–85 | 1 | 81.3% | 100.0% |

**ufc-form-v0.2**

| Favourite probability (%) | Fights | Said | Won |
|---|---|---|---|
| 50–55 | 740 | 52.4% | 54.2% |
| 55–60 | 681 | 57.4% | 59.8% |
| 60–65 | 532 | 62.4% | 62.4% |
| 65–70 | 359 | 67.4% | 67.4% |
| 70–75 | 238 | 72.4% | 67.6% |
| 75–80 | 138 | 77.5% | 75.4% |
| 80–85 | 74 | 82.0% | 82.4% |
| 85–90 | 26 | 86.7% | 84.6% |
| 90–95 | 7 | 92.5% | 85.7% |
| 95–100 | 5 | 97.5% | 100.0% |

## Method pick

Over 2,794 held-out fights that ended by KO/TKO, submission or decision, the picked method matched the actual method 49.4% of the time, regardless of who won. For comparison, 47.2% of those fights ended by decision. Both models share the same method pick.

## Picks game

5 points for the right winner and the right method, 2 for the right winner alone, 0 otherwise; a probability of exactly 50% is no call and scores 0.

| Model | Fights | Points | Points per fight |
|---|---|---|---|
| ufc-elo-v0.1 | 2,800 | 5,359 | 1.914 |
| ufc-form-v0.2 | 2,800 | 6,002 | 2.144 |

## Gate

Per model: the three most recent held-out years with at least 100 scored fights. The model passes when its log loss is below 0.6931 (a coin flip) in at least two of them and its pooled Brier over all held-out years is at most 0.235.

```
GATE ufc-elo-v0.1: FAIL (log loss below 0.6931 in 3 of 3: 2024 2025 2026; pooled Brier 0.2389 > 0.235)
GATE ufc-form-v0.2: PASS (log loss below 0.6931 in 3 of 3: 2024 2025 2026; pooled Brier 0.2299 <= 0.235)
```

## How to reproduce

```bash
export PYTHONPATH=backend:.
# <db url> is a SQLAlchemy URL for a new local file, <db file>
DB="<db url>"
rm -f <db file>
.venv/bin/python -c "import sys; from sqlalchemy import create_engine; import app.models; from app.db import Base; Base.metadata.create_all(create_engine(sys.argv[1]))" "$DB"
DATABASE_URL="$DB" .venv/bin/python -m pipeline.sports.ufc_backfill --raw <raw dir> --to <date>
.venv/bin/python -m pipeline.sports.ufc_evaluate --db "$DB" --out docs/UFC-EVALUATION.md --write-params
```
