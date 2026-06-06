# BarrelIQ — Evaluation Layer

A standalone, read-only evaluation harness for the BarrelIQ rating. It **does not
touch the scoring model** — it loads the real `score()` from `app.js` so metrics
can never drift from what ships. No dependencies; plain Node.

## Why a rating → probability map lives here

The model outputs a **0–100 Rating**, *not* a probability. Brier score and
calibration need a probability, so this layer owns an explicit, swappable
`ratingToProb()` in `lib.js`. The default is the naive linear reading
(`rating / 100`). The whole point of the reliability curve is to show whether
that mapping is calibrated — currently it is **not** (the rating over-predicts).
Swap `ratingToProb` (e.g. for a fitted logistic/isotonic map) to test better
mappings; the scoring model stays untouched.

## Files

| File | Purpose |
|------|---------|
| `lib.js` | Loads the real model; probability + metric helpers (Brier, reliability, ECE, skill score); IO. |
| `record.js` | Snapshots model outputs (one row per player/game) into `predictions.jsonl`. |
| `evaluate.js` | Grades predictions vs outcomes; prints Brier, skill scores, ECE, reliability curves. |
| `outcomes.json` | Where you record actual HR results, keyed `"<date>:<id>" → 0/1`. |
| `predictions.jsonl` | Growing append-only prediction log (created/updated by `record.js`). |

## Workflow

1. **Record** the current slate's model outputs:
   ```sh
   node eval/record.js
   ```
   Idempotent per `DATA_DATE` — re-running replaces that day's rows. Run it once
   per slate so the log accumulates a real sample over time.

2. **Enter outcomes** once games are final, either by:
   - setting `"actualHR"` on rows in `predictions.jsonl`, or
   - adding `"<date>:<id>": 1` (homered) / `0` (didn't) entries to `outcomes.json`.

3. **Evaluate**:
   ```sh
   node eval/evaluate.js          # uses real outcomes only
   node eval/evaluate.js --demo   # fills MISSING outcomes with seeded synthetic
                                  # draws so the full report renders immediately
   ```

## What it reports

- **Observed base rate** — actual HR frequency in the graded set.
- **Brier score** for the **model**, the **market-implied baseline**, and
  **climatology** (predicting the base rate for everyone). Lower is better.
- **Brier Skill Score** (`1 − Brier/ref`) of the model vs each reference;
  `> 0` means it beats the reference.
- **Expected Calibration Error** for model and market.
- **Reliability curves** — per probability bin, predicted (`•`) vs observed
  (`█`) rate. A calibrated model tracks the diagonal.

## Caveats

- **Sample size.** A reliability curve over 10 rows is not meaningful. Accumulate
  many slates first; the log is designed to grow.
- **`--demo` is for pipeline validation only.** Synthetic outcomes are sampled
  from the market-implied probabilities (seeded, reproducible), which *favors the
  market baseline by construction*. Never judge the model on demo data.
- **Market baseline includes vig.** `impliedFromOdds` is raw implied probability;
  it's mildly inflated vs the fair price (devigging a single yes/no prop needs
  the NO-side odds, which aren't stored).
