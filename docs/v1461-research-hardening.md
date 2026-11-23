# V1.4.6.1 — model hardening and prospective validation

Prepared on 23 November 2026, Australia/Melbourne, from `84d08dc` on `codex/nba-wide-research`. **No model promotion, live policy change, formatter activation or production restart.** The objective is trustworthy evidence, not a more attractive backtest.

## Baseline and current deployment

The fresh online backup is `.local/v1461/before.sqlite`, integrity `ok`. It contains 16,317 log revisions, 243 receipt bodies, 276 source receipts, 804 experimental forecasts, 608 SHADOW forecasts, 56 issued recommendations, 56 grades, 68 recommendation outboxes, 48 family claims and four original model records. Historical issued results remain 30W/26L, no pending, A$0.30 hypothetical P/L. These are issued positions, not independent experiments.

Market PID **71645** remains pinned to `13db5ff` (V1.4.5.1). SHADOW PID **62713** remains pinned to V1.4.5. Website PID **72693** remains the port-3000 `eb84819` build. The local research checkout differs from all three deployed releases. Neither worker, LaunchAgent, V6 nor the live website was changed.

Streaming hashes verify all original rows, including source bodies, forecasts, suggestions, grades, delivery rows and permanent claims; all four model hashes match. Credential/config/recurring-policy/installed-plist fingerprints match. The unchanged existing worker appended two BDL source receipts/request records during this task; the research code made **zero provider calls** and zero live Telegram sends. No new Sportsbet request, shared credit allowance, quota increase or synthetic live row was introduced. Private evidence stays under `.local/v1461/` and out of Git/build inputs.

## Minutes deficiencies and correction

V1.4.6 converted five quantiles into only 20 rounded samples. The resulting histogram had holes in its support. `residualPMF(0, grid, max)` also added about 0.99% artificial mass at one minute; clipping residuals created additional boundary atoms. Maximum minutes depended on a player's previously observed overtime, making unseen overtime impossible. Calibration could flatten adjacent CDF values into further zero count probabilities. The original ensemble assigned zero mass to **43 of 400** realised rounded-minute outcomes. Reported NLL uses the existing `1e-12` scoring floor; without that floor, its log score is infinite for those outcomes.

The corrected ridge/hierarchical minutes distributions integrate a continuous Student-t(3) residual KDE over rounded-minute bins. Bandwidth uses only chronological training residuals, a robust rule of thumb and half-minute resolution floor. Residual draws are not clipped to a boundary. Probability is conditioned over positive continuous minutes up to 75, the existing ingestion contract; bin zero represents a positive playing time rounded below half a minute, not a DNP probability.

The quantile alternative uses monotone rearrangement, strictly separated anchors and a continuous inverse-CDF interpolation in logit-probability coordinates, with analytic logistic tails. Stable survival differences prevent upper-tail floating-point cancellation. Every admissible minute bin has positive mass, without an arbitrary one-minute spike. Unseen overtime retains support. This is a research distributional assumption, not a claim of optimal smoothing or calibrated confidence bounds. The 75-minute limit follows retained-data validation rather than a theoretical maximum NBA game duration.

The robust bandwidth is motivated by [kernel-density bandwidth practice](https://www.stat.ethz.ch/R-manual/R-devel/library/stats/html/bandwidth.html); that manual's Gaussian rule does not establish optimality for our Student-t residual model. Distribution and threshold scoring retain the existing proper-score definitions.

## Frozen benchmark reproduction and evaluation

`models-v146.ts` preserves the original implementation byte for byte, SHA-256 `84939ebd21415d957b0aaee7ef2dd28f04af0908a5dd04f04d9d92a43ec42c33`. The original evaluator explicitly imports it. All five original runs were rerun: **every model's metrics and clustered comparisons, artifacts, selection metrics, split and cohort hash matched exactly**. Only resource measurements vary. Evidence: `reproducibility.json` and `replay-*.json`.

Repair comparisons use the **same 400 targets per market** from the original `.local/v146/before.sqlite`, not the newer safety snapshot. There are 239 players, 30 teams, 116 fixtures and 17 UTC fixture dates. The five targets share player-games and are not 2,000 independent outcomes. Fixture-concentration effective cluster count is 95.35, not a known dependence-adjusted ESS.

The original split is unchanged: 744 training, 400 selection, 600 calibration (266 fit / 334 choice), 400 test. Training/selection/calibration/test dates remain separated. New mixture weights are selected on selection only; CDF calibration fits the earlier calibration dates and is chosen on later dates. No repair threshold is fitted on test outcomes. The repaired density parameters reuse frozen original point/quantile weights and training residuals to isolate distribution construction. Attempt excess is fitted from verified training attempts and observed training minutes.

**This is a reused development holdout.** Its original errors were inspected before this repair; the new results are diagnostic, not untouched independent confirmation. Multiple challengers/targets were compared. Historical publication clocks remain insufficient for a four-stage genuinely as-of benchmark. Nothing is backdated or relabelled as prospective.

### Minutes: identical targets

MAE below uses original unrounded actual minutes. Coverage/width and distribution scores use the unchanged rounded-minute scoring convention. “Repaired blend” is the selection-chosen 25% corrected quantile / 75% recent-ten mixture with separately chosen sigmoid calibration.

| Model | CRPS | NLL | Minutes MAE | Coverage80 | Width80 | Low-minute/tail NLL |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Simple recent-ten | 3.5647 | 3.2959 | 4.951 | 78.00% | 14.625 | 3.9602 |
| Original V1.4.6 ensemble | 3.5509 | 5.7534 | 5.012 | 85.50% | 17.517 | 9.0510 |
| Original raw quantile | 3.7188 | 6.9338 | 5.231 | 80.75% | 15.905 | 17.7279 |
| Smoothed ridge | 4.4487 | 3.5675 | 6.535 | 74.75% | 18.098 | 2.9021 |
| Smoothed hierarchical | 4.4492 | 3.5678 | 6.533 | 74.00% | 18.102 | 2.8965 |
| Continuous quantile | 3.7361 | 3.3036 | 5.296 | 79.25% | 15.875 | 4.7546 |
| Repaired blend | 3.5572 | 3.2466 | 4.997 | 84.00% | 15.988 | 3.5506 |

The repaired blend's date-clustered CRPS difference versus the old ensemble is [-0.0068, 0.0210]; NLL difference is [-3.3424, -1.4670]. NLL difference versus recent-ten is [-0.0859, -0.0077]. These 300-resample ranges describe this diagnostic cohort, not a significance or promotion claim. Bootstrap absolute-error ranges use rounded outcomes; unrounded-minute MAE is a separate diagnostic estimate. Fixture-clustered intervals and differences for rounded MAE, coverage, width, Brier and threshold log loss are retained in each result file.

The tail subset has 34 cases with rounded minutes below 10 or above 45; none actually exceed 45, so this tests early exits, not overtime accuracy. Actual low-minute frequency is **8.50%**. Simple recent-ten predicts **9.43%**, old ensemble **10.45%**, raw corrected quantile **4.02%**, repaired blend **10.31%**. Raw quantiles still underpredict early exits. Predicted >48-minute probability is 0.22% for the blend, but zero realised events cannot establish tail calibration. All repaired minute distributions remove the original support holes; density validity alone does not establish forecast superiority.

The correction substantially repairs tail log scores, but the blend slightly worsens old-ensemble CRPS and still loses to recent-ten on minutes MAE. Ridge variants perform poorly. **Keep the simple model as the conservative reference; no minutes model is promoted.**

### Player-stat results

Conditional count excess is estimated using observed training minutes and integrated over predictive minutes once. Raw count variance is not added again. Integer lines/push probabilities continue to use the unchanged exact discrete PMFs.

| Target | Strongest simple CRPS | Original ensemble CRPS / NLL | Repaired selected blend CRPS / NLL | Δ CRPS vs original, date 95% range |
| --- | ---: | --- | --- | --- |
| points | 3.5143 | 3.5633 / 3.1817 | 3.5502 / 3.1734 | [-0.0427, 0.0149] |
| rebounds | 1.3567 | 1.3660 / 2.2359 | 1.3533 / 2.8636 | [-0.0280, 0.0021] |
| assists | 1.0038 | 0.9914 / 1.8561 | 0.9895 / 1.8512 | [-0.0069, 0.0038] |
| threes | 0.6643 | 0.6585 / 1.4078 | 0.6587 / 1.4081 | [-0.0008, 0.0017] |

Improvements are mixed. Rebounds' selection/calibration-chosen isotonic CDF improves CRPS slightly but worsens NLL markedly; isotonic flats remain an explicit log-score limitation. The raw repaired distributions and every calibration/coverage result are disclosed, rather than retrospectively choosing the best test metric. Existing V1.4.6 boosted models were exactly reproduced; they do not justify added complexity. No framework/dependency was added and no model is promoted. No genuine historical Sportsbet prices exist for the 400-case benchmark: no bookmaker ROI or synthetic prices are manufactured.

### Three-point attempts

The original `attemptsMixture()` first replaced the entire minutes PMF with its mean. The correction computes conditional attempt distributions at every minute value, integrates those into an attempt PMF, then integrates the beta-binomial conversion posterior for every attempt count. This is equivalent to integrating the full conditional makes mixture. Conversion uncertainty is retained; attempt excess is now estimated from verified attempts conditional on observed training minutes, instead of borrowing makes dispersion.

| Model | CRPS | NLL | Brier | Coverage80 |
| --- | ---: | ---: | ---: | ---: |
| EWA | 0.6643 | 1.4160 | 0.1692 | 92.25% |
| Existing hierarchical control | 0.6632 | 1.4271 | 0.1685 | 91.50% |
| Original V1.4.6 attempts | 0.6833 | 1.4488 | 0.1742 | 87.75% |
| Integrated attempts, original minutes | 0.6860 | 1.4437 | 0.1756 | 88.75% |
| Integrated attempts, repaired minutes | 0.6797 | 1.4333 | 0.1735 | 88.75% |
| Original ensemble | 0.6585 | 1.4078 | 0.1674 | 91.50% |
| Repaired selected blend | 0.6587 | 1.4081 | 0.1675 | 91.50% |

All comparisons use the same verified 400-case cohort. This is not an isolated causal estimate of minutes integration alone: the corrected variants also use attempt-specific excess. Analytical tests separately verify identical results at a point-mass minutes distribution with the same excess, and increased variance when minutes vary at fixed mean. Verified attempts must exist and makes cannot exceed attempts. Count PMFs remain normalised. The attempt-rate point estimate still has limitations, particularly all-zero historical attempts; no rate-uncertainty or role-change reliability is claimed.

The integrated raw model remains worse than EWA; its selected blend is essentially level with the old ensemble. **Retain EWA as a strong reference and abandon any claim that the added complexity is independently justified.**

## Independent prospective challenger lifecycle

`src/research-advanced/prospective.ts` implements a separate SQLite journal. It is not a migration of live SQLite, a production-model replacement or a Telegram path. Both the journal action flag and cycle execution default disabled. Read-only review can inspect a retained journal without enabling registration/grading. No real challenger forecasts were registered by this task; lifecycle evidence is isolated/mock testing only.

Implemented workflow:

1. `fitFromRetained` selects genuine final records available by the fitting cutoff, reconstructs historical features in strict as-of mode, fits bounded minutes/conditional-count parameters and freezes raw calibration. Later source corrections cannot enter earlier features. A conservative latest-revision filter may discard usable earlier revisions; it never substitutes future evidence. Insufficient strict history fails closed. The low-level external-parameter publisher labels that provenance separately; it does not pretend externally supplied weights were fitted by the strict builder.
2. Artifact publication freezes parameters, training body references, fit protocol, cutoff and forecasting code commit/file hashes. Repeating the same publication is idempotent across preparation times. Dirty/changed forecasting code is rejected; the journal compares against its loaded identity. No original model is refitted in place.
3. Registration derives its timestamp from the current clock; there is no caller-supplied historical registration time. It requires a fresh retained scheduled BDL fixture and roster proof, original source-qualified production baseline, strict current feature evidence and a two-minute pregame safety margin. It freezes full count/minutes PMFs, original baseline distribution/inputs/artifact, simple and hierarchical controls, parameters/calibration, source observation/publication clocks and input hashes. Participation stays null and probabilities conditional on playing.
4. A private SQLite UNIQUE key over fixture/player/prop/artifact and `BEGIN IMMEDIATE` make registration race-safe/idempotent. Deadline and current fixture/roster checks occur before and after insertion; cancellation or crossing rolls back. Later evidence of an earlier actual start cannot validate an after-tip registration. Update/delete triggers protect artifacts, predictions and grading revisions. Reopening retains the original record. New artifact versions are kept distinct and never pooled as independent predictions.
5. Optional Sportsbet capture accepts only an existing archived exact two-sided market with matching fixture/player/line/side/clock/terms, original retained mapping proofs and fresh prices. Missing prices do not block independent registration. No request is made to obtain them, and bookmakers are not treated as independent samples.
6. `grade` reads only existing verified finals. It checks exact player/fixture/team/season/start and source clocks, keeps missing/ambiguous/unknown participation unresolved, records verified DNP as void, and appends corrections under a source-evidence hash. Repeated finals create no extra grade. A later incomplete/invalid correction holds the current comparison, without deleting earlier valid grades. Bounded round-robin checkpoints prevent unresolved rows from starving later targets.
7. Comparison uses the latest valid grade per prediction, grouped by artifact/prop. It reports full-distribution scores, calibration/interval coverage, unrounded minutes MAE versus original production minutes, matched captured-market Brier scores and fixture/date-clustered differences. DNP/pending/held cases are separated. There is no position, stake, P/L, outbox, message or promotion action. Unsupported decisive probabilities remain null and are counted outside matched market scores. Production forecasts may predate challenger registration: timing/information-set differences must be stratified before architectural claims; simple/hierarchical controls use current challenger inputs.

`challengerCycle` is a disabled callable integration boundary, processes at most two registrations and bounded grading, and yields around active source work or a pregame task within ten minutes. It imposes a soft between-operation budget up to two seconds; **this is not a hard process CPU limit**. A production scheduler/LaunchAgent is not installed or claimed ready. A future independent wrapper must provide a journal-only ownership lease, low-priority bounded children, hard timeout/memory limits, pinned code and recovery diagnostics. It must not attach computation to the live market worker or alter the current SHADOW supervisor.

## Broad policy population and retained source replay

`policies` and `population` CLI commands now use the complete observation audit. The old issued-only V1.4.6 helper remains historical research, not the default comparison. `source-history.ts` rebuilds retained fixture/roster/linked-injury source knowledge without reading today’s overwritten live metadata. It never changes a source timestamp or calls a provider. Snapshot counts (all 904 sides also have an exact opposite-side snapshot):

| Population | Count |
| --- | ---: |
| Observed quote sides | 904 |
| Distinct player/fixture/prop families | 294 |
| Exact same-line/timestamp two-sided snapshots | 452 |
| Source-qualified conditional forecast quote sides | 904 |
| Passing unchanged numeric baseline checks | 70 |
| Actual historical recommendations | 56 |
| Actual issued families | 48 |
| Distinct settled first-forecast targets | 281 |

“Source-qualified forecast” means genuine retained quote/mapping/model/input clocks, not verified pregame participation or full recommendation eligibility. The source-history pass recovered **eight complete two-page injury traversals** from original receipts. It reconstructs fixture/roster/injury knowledge at each observation, reuses the unchanged source checks and respects quiet hours. **852** sides pass source evidence; **52** are blocked by retained Questionable (32) or Probable (20) records. **68** sides pass source, numeric and delivery-window checks before family suppression. These are completed cursor traversals, not atomic point-in-time snapshots: each page clock is preserved and absence from the list never means confirmed availability. Missing/stale/ambiguous/filtered/incomplete source evidence fails closed. Historical owner authorisation, binding and outbox execution are not inferred, so the replay does not claim those opportunities would all have been issued. The independent challenger journal is not joined by this population audit and reports an unknown registry count rather than a fabricated zero.

Each policy takes its earliest eligible observation per family; ties use the unchanged numeric ranking, never final outcomes, a favourable later line or reversed direction. The complete archive remains auditable. Distinct player/fixture/prop targets are still correlated across props, players, teams and fixtures.

| Research policy | Selected opportunities | Won / lost / unresolved | Promotion evidence |
| --- | ---: | --- | --- |
| A-production-baseline | 48 | 25 / 23 / 0 | None |
| B-minutes-sample | 21 | 9 / 12 / 0 | None |
| C-calibration-uncertainty | 0 | 0 / 0 / 0 | None |
| D-evidence-combined | 0 | 0 / 0 / 0 | None |

Unissued rows receive accuracy/calibration scores only: **no A$5 position, P/L or ROI is assigned**. Fixture/date clustering uses probability losses, not wagering simulation. There is only one Melbourne fixture date; its interval is explicitly unavailable rather than a misleading degenerate interval. First frozen forecast scores for 281 distinct targets supplement the selected-opportunity scores. The selected A family set matches the actual 48 issued families, but selected observation times/prices can differ from issuance: execution history is not reconstructed. Timing strata contain 204 T−90, 538 T−20 and 162 other quote sides. A selects 7 / 32 / 9 first opportunities respectively; these correlated, single-date slices do not justify a timing-policy change. Neither count is a sample of independent bets.

Policy B does not establish improved quality, and C/D still lack broad pre-cutoff calibration/role/correlation evidence. Zero selections are not proof of quality. The current heuristic half-binomial conservative-EV penalty remains an unvalidated sensitivity adjustment, not an empirical confidence bound. No production threshold, time window, recommendation cap or first-family guard changed.

## Simple website; backend evidence preserved

The `/watch` route and its navigation entry are removed from the planned release. The previous port-3078 preview was identified by PID, working directory and listening port, stopped with a scoped SIGTERM, and confirmed exited. Its private historical evidence/build files were preserved. No replacement research-opportunity interface is deployed.

Bet Log remains issued-only, newest first by original `at` and ID, with existing date/result filters, exact original lines/prices/probabilities and grades. `bet-log.ts`, CSV, annotations and accounting are unchanged. The prepared Performance page derives only issued records/latest grades: wins/losses/pending, original-position hypothetical results, calibration, market groups, date trends and first-family analysis. Historical extra positions stay in original totals. Actual wager records are not conflated with hypothetical results. Navigation is Bet Log (brand), Performance and Service status, using the existing styling.

All 904 candidate records, forecasts, rejected evidence, receipts, calibration and experiment artifacts remain in the backend. The old backend read-only reader is retained for private analytics/regressions; it has no user-facing route. No research-only record enters Bet Log or Performance. The existing live website is not rebuilt in place.

## Telegram: separately deployable, not activated

The V1.4.6 compact formatter is retained. `compactExistingBatch` renders precisely the already-decided ID order and returns the same `hash(['suggestion-batch', ids])`. It refuses a split, changed order or mixed grouping that would alter the existing batch. `docs/v1461-compact-market.patch` is a concrete reviewed candidate against the otherwise unchanged market engine. **It has not been applied to production/root engine.**

The patch changes only new-outbox text creation. Eligibility, sorting, old pagination/consolidation rules, suggestion IDs, batch IDs, bindings, state transitions and dispatcher remain intact. If compact text cannot fit exactly the existing batch, it retains legacy text. Existing `INSERT OR IGNORE` identities and immutable outbox triggers preserve all old bodies; accepted/uncertain messages are never recreated or resent.

An isolated copy with the patch applied was compared against unchanged engine behaviour. Position hashes, batch IDs/order, acceptance, known 429 retry counts and uncertainty suppression matched exactly; text alone differed. Repeated ranking issued zero extra families. Existing accepted/retry/uncertainty/dedup regression tests remain unchanged. All transport calls in these tests are mocked, with fetch disabled. No live test message was sent.

## Verification, reproducibility and resource impact

The full suite is run in a private-free source/dependency clone under `.local/v1461/verify`; the running website's `.next` is untouched. Root TypeScript validation also runs independently. Final full-suite/build evidence is `verify-source-release.log`: TypeScript, 269 regression tests and production build passed. HTTP checks verified exact newest-first order, date/result filters, all 56 CSV rows, issued-only Performance, Watch 404 and loopback protection. Thirteen build traces contain no private runtime files, and the temporary verification server was stopped. All source/test files are compared with the verified clone before commit. Distribution validity, leakage, frozen baseline hash/replay, minutes tails, attempt integration, strict training, registration/deadline rollback, restart uniqueness, immutable revisions/holds, source-matched markets, fair comparisons, round-robin recovery, formatting and issued-only website regressions are covered.

The advanced comparison is sequential, low priority, uses a 768-MiB Node heap and a 160-second outer wall bound (150-second internal evaluation guard), and checks live deadlines before targets. It makes zero network calls. Peak RSS is process RSS, not total machine memory.

| Target | New comparison elapsed | User CPU | Peak RSS |
| --- | ---: | ---: | ---: |
| minutes | 11.51s | 11.24s | 458.3 MiB |
| points | 15.05s | 14.95s | 450.3 MiB |
| rebounds | 15.16s | 15.18s | 454.3 MiB |
| assists | 15.63s | 15.65s | 450.7 MiB |
| threes | 26.04s | 25.48s | 486.3 MiB |

Original V1.4.6 runs took about 5.5–10.8s and 495–538 MiB peak RSS. The repair comparison reuses frozen fitted weights but includes additional density construction and uncertainty calculations, so it is not a like-for-like training-throughput benchmark. Numeric population auditing was reduced from about 49s to about 10s by caching immutable receipt validation while checking every original cutoff. The complete retained-source replay measured 11.15s wall / 10.80s user CPU and 465.1 MiB maximum RSS. Completion events are reconstructed online; future duplicate pages cannot change an earlier as-of source decision. It remains offline work, not a market-path operation. Full-source prospective inference/training throughput has not been validated under a deployed workload; small mocked lifecycle timings are not evidence of production readiness.

Reproduce from the retained genuine snapshots, with new create-only private output names:

```sh
node --max-old-space-size=768 --import tsx src/research-advanced/cli.ts evaluate .local/v146/before.sqlite .local/v1461/new-original-minutes.json minutes
node --max-old-space-size=768 --import tsx src/research-advanced/cli.ts harden .local/v146/before.sqlite .local/v1461/new-minutes.json minutes .local/v146/final-minutes.json
node --max-old-space-size=768 --import tsx src/research-advanced/cli.ts policies .local/v1461/before.sqlite .local/v1461/new-policy.json
```

Repeat both evaluation commands for points, rebounds, assists and threes. The CLI opens snapshots read-only, drops priority, disables fetch and permits outputs only within `.local`. Source dataset, cohort/training IDs, splits, frozen artifacts and code hashes bind the comparisons. Protocol files preserve the initial and numerically hardened density runs; no output is overwritten. No strict historical source-clock benchmark or profitability claim is manufactured.

## Activation and rollback boundaries

**LIVE:** market V1.4.5.1, SHADOW V1.4.5, original four artifacts, all original issued records/grades, automatic finals/grading, T−90/T−20 acquisition, Telegram protections and existing quota policy. No V6 inspection/modification was needed.

**PREPARED:** simple issued-only website build, compact batch seam and market-only patch, separate immutable challenger lifecycle and disabled cycle API. **EXPERIMENTAL:** corrected density/attempts variants, chronological diagnostic comparisons and broad source-evidence policy replay. **BLOCKED:** automatic challenger scheduling/production integration, broad independent prospective evidence, validated edge confidence bounds, full historical runtime-authorisation/delivery replay and model/policy promotion. A mathematical tail repair is not independent validation.

Website activation needs its existing website-only review/build/switch procedure, private-free artifact checks and scoped process identity verification. Preserve the existing build for website-only rollback; never overwrite serving `.next` or restore SQLite. Do not restart market/SHADOW for a website release.

Formatter activation requires separate owner approval for a pinned market release containing the reviewed patch. Re-audit actual PIDs/heartbeats/leases, pending delivery states, no acquisition or quota reservation, unchanged source/policy/config/model hashes and no market/SHADOW deadline within ten minutes. Take a fresh online backup and integrity check, prepare pinned candidate and current-market rollback files, record approval, stop only the verified market process and confirm exit/released ownership before bootstrapping its replacement. Never edit existing outboxes or remove family claims. Observe at least 165 awake seconds. If validation fails, stop/verify exit of that candidate and restore only the prior market code/LaunchAgent; retain all compact historical texts, claims and grades. No database restore, SHADOW restart, V6 change or budget increase.

Prospective activation is a separate independent-worker approval. Before scheduling: choose an immutable reviewed Git worktree/release, clean code manifest and fixed artifact IDs; use a read-only live-source handle and separate private journal; train outside pregame paths with genuinely as-of inputs; validate baseline/source TTL availability without fetching; implement a journal-only ownership lease and bounded supervised children with hard time/memory guards; yield to existing source/pregame jobs; test sleep/restart recovery and initially observe dry runs. The cycle API is not a deployed scheduler. Missing evidence must produce a recorded hold, not a data request or forced prediction. Existing finals alone supply grades. No model/policy becomes production-eligible through registration or comparison.

On challenger failure, disable/stop only its future independent process and retain its journal. Original market/SHADOW services and source tasks remain operational. Revert challenger code if needed without deleting forecasts or grading revisions. No live database, model artifact, quota, credential or service restoration is part of rollback.
