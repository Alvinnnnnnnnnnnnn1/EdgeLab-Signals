# Model engineering continuation

This branch starts at verified core `f8cac6e`; it does not replace either pinned production cutover. All new statistical paths are offline or separately gated SHADOW. No active weights, qualification policy, grant, source acquisition, transport or protected job changes are authorised by these modules.

Implementation surface: `suggestions/forecasts.ts:generateExperimentalForecasts`, `research/features.ts:preparedFeatures`, `research/inference.ts`, `research-advanced/models.ts:minutesDistribution/minuteMixture`, `core/models.ts:probabilities`, `suggestions/engine.ts`, `research-advanced/prospective.ts:ChallengerJournal`, `research/reliability/worker.ts`, `multi-bookmaker/`, and `production/deployment.ts:protectedCycleSafety/deploymentSafety`. The active journal hybrid is not an independent challenger.

Data proof: `model-engineering/data.ts` verifies retained receipts and retains every original revision. An individual cutoff chooses its latest eligible revision. Unknowns remain null. A historical final fetched in November cannot become an October pregame feature in AS_OF mode. RETROSPECTIVE permits prior-game lag research only and cannot establish original source availability or betting ROI.

Candidates predeclared before new scoring: M1 partial-pooled per-minute rates integrated over empirical minutes scenarios; last5/last10/EWA/season controls; conditional Poisson diagnostic; attempt/make threes only with complete earlier attempt data. M2 modest local boosted minutes only if independent retrospective dates support disjoint training/residual/calibration/selection/test partitions. M3 not pursued without supported installed discrete probabilistic tooling. No dependency installation or source code copying is needed.

Data, experiments, exact source hashes, private result rows and continuation commands live under the repository's ignored `.local/model-engineering/`. No raw data, credentials, licensed provider payloads or private config belongs in a build artifact.

Verified 24 November data snapshot: 17,300 revisions, 16,632 distinct player-games, 551 fixtures, 725 players, 104 UTC dates (22 October 2024–24 November 2026). Positive participation/minutes: 11,508 rows, 550 fixtures, 636 players, 103 dates. Unknown participation: 5,124; no missing minutes. All 11,508 participating rows retain 3PA/3PM/FGA/FGM/FTA/FTM; no starter fields. Receipts span 21–24 November 2026. Only 396 targets over four dates have even one earlier same-player receipt; that is not a training-eligible count. Quote archive: 1,718 sides, 14 fixtures, three dates. Revisions and quote sides are not independent target outcomes.

Node 24.21.0/TypeScript are installed. Python 3.9.6 has no numpy/scipy/sklearn/XGBoost/LightGBM/NGBoost. Use dependency-free TypeScript, including existing small boosted-stump utilities only for retrospective experiments with adequate date splits; M3 is not attempted. True receipt-clock M2 and selected-price calibrators are not trainable honestly on this date breadth.

## Implemented experiment

`m1.ts` fits Gamma-Poisson pooled rates and role-band priors from training labels, models minutes separately with empirical own/pool residual scenarios, and integrates NB count PMFs across positive minutes. Historical minute/rate association is explicitly noncausal. Threes can integrate genuine earlier attempts with a beta-binomial make posterior. Poisson is a diagnostic control. The common-minutes sampler exposes scenarios without claiming that marginal PMFs identify a calibrated joint distribution.

`experiment.ts` and `calibration.ts` freeze whole-date train/residual/calibration/selection/final partitions. M2 is a fixed 30-stump minutes regressor with residuals from disjoint later dates, integrated through the count model. Identity, regularised Platt and beta CDF maps preserve coherent integer distributions. No selected-price calibration or market blend is fitted. November 23–24 are excluded from fitting and selection. The source hash and pre-score protocol bind every candidate, including unsuccessful ones.

The genuine retrospective experiment trained on 273 eligible player-games over 36 dates (sparse retained history), then used 997 calibration and 1,314 selection rows per prop. Final period: 2,213 matched participating player-games per prop over 16 dates and 115 fixtures. Every supported candidate has identical final targets. No original production PMF exists for most of these historical targets: these comparisons are lag-only research controls, not production comparisons. Previously inspected historical data cannot be claimed independently untouched. Date bootstrap intervals remain exploratory and do not remove serial dependence between neighbouring dates.

| Prop | EWA CRPS | Raw M1 CRPS | M2 CRPS | Selection winner's final CRPS |
|---|---:|---:|---:|---:|
| PTS | 3.364867 | 3.322779 | 3.519515 | Beta M1: 3.356011 |
| REB | 1.321162 | 1.305849 | 1.367214 | Platt M1: 1.298201 |
| AST | 0.962613 | 0.950081 | 0.988675 | Platt M1: 0.956010 |
| 3PM | 0.624724 | 0.644798 | 0.664756 | EWA: 0.624724 |

Do not reselect raw M1 after inspecting the final period, call threes improved, or promote any candidate. Raw M1 remains the predeclared primary SHADOW candidate. M2 is rejected for activation on these results; M3 has no installed suitable tooling. Calibration is mixed and does not repair selected-opportunity calibration by construction. Historical ROI is unavailable on this cohort. Raw model point bias, interval coverage, every simple control, all calibration bins/PIT, NLL, date/fixture intervals and complete predictions remain in private reports.

The computation used about 195 seconds and 1,063 MiB peak RSS. First archive attempt hit V8's string limit; the streaming rerun completed computation and gzip output but hit a Buffer-to-JSON hashing heap limit. `artifacts.ts` repaired finalisation without retraining or rescoring: gzip CRC, all 90,733 PMFs and per-model counts verified, byte SHA-256 manifest retained. Failed attempts are preserved; they are not statistical successes or extra experiments.

## Separate SHADOW lifecycle

`journal.ts` stores models, compressed input manifests, immutable forecasts, quote observations, holds and append-only grades in a separate private SQLite file. Registration uses the actual wall clock, T−2 deadline, exact identities, source hashes and feature clocks; it cannot backdate. Corrections append new grades. Missing stats/participation/DNP remain unscored conditional outcomes with explicit reasons. A rotating bounded grade cursor prevents older forecasts starving later ones. No outbox, recommendations, network client or production model writer exists.

`freshness.ts` distinguishes build age and individual information ages, rejects future source snapshots and creates new cached revisions without altering originals. Repeated unchanged reports are distinguished from semantic information changes. Missing injury/role evidence is explicit. The policy has no invented numerical TTL and activation defaults OFF. `evidence.ts` reconstructs only retained pre-issue fixture/roster/injury facts; it does not infer known starters or positive availability from a missing injury row.

`shadow.ts` enumerates the accessible cached slate independently of price coverage, computes same-cutoff original controls and simple controls, preserves frozen production forecasts separately, and observes exact cached paired quotes without requests. The guarded CLI requires pinned model/runtime code, service birth identities, private configuration fingerprints and original protected manifest, completed pagination, source/child idle and ten-minute deadline guards. It never installs or restarts a worker. Invocation is disabled until a separately reviewed finite effective plan passes these guards. No live SHADOW activation has occurred while protected jobs remain queued.

The promotion rule is frozen in `journal.ts` before prospective outcomes: at least 30 independent dates before review, paired proper-score intervals versus original and strongest simple controls, selected-opportunity and role-group calibration/coverage, provenance parity, genuine price evidence and a separate immutable authorised decision. Thirty dates are a minimum review sample, not a power guarantee. No automatic promotion is implemented.
