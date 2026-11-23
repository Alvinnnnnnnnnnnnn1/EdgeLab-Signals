# V1.4.6 — advanced forecasting research, prepared only

**Superseded website plan:** [V1.4.6.1](v1461-research-hardening.md) removes Watch and retires its preview. The audit/benchmark results below remain frozen historical evidence; the old Watch activation instructions no longer apply.

Research date: 23 November 2026, Australia/Melbourne. No stronger production model or recommendation policy is established. The new architecture, Watch interface and compact formatter are prepared; neither worker was restarted and nothing was promoted.

## Protected deployment and frozen evidence

Development started at `eb84819` on `codex/nba-wide-research`. The website at port 3000 remains that build. Market PID 71645 is pinned to `13db5ff` (V1.4.5.1); research PID 62713 remains the independently pinned V1.4.5 supervisor. Local source HEAD is not their loaded release.

A SQLite online backup at 15:15:27 AEDT captured 16,282 genuine retained log revisions, 241 receipt bodies, 274 source receipts, 804 experimental forecasts, 608 SHADOW forecasts, 56 recommendations, 49 grades, 68 outboxes, 48 permanent family claims and four model artifacts. Integrity is `ok`. Private evidence and output are under `.local/v146/`, mode 0600. No private file is committed or included in the preview build.

The audit/evaluations use this fixed backup, not a moving live dataset. Original inputs, delivery bodies, source timestamps, prices, grades and models are preserved. A later read-only preservation audit checks every original row prefix by streaming hashes and compares credential/config/policy/plist fingerprints and model hashes. Normal authorised live collection/grading can append rows during this task. The observed additions were 35 genuine final-stat rows, seven grades and two BDL request reservations from the existing worker; no new Sportsbet request or Telegram send was made by this work. All original row prefixes and four model hashes matched; private credentials, config, recurring policy and both installed LaunchAgents matched their original fingerprints. Both worker identities and run counts remained unchanged with valid leases and fresh heartbeats.

## Actual recommendation audit

The owner's snapshot is reconciled exactly: 56 issues, 24 won, 25 lost, seven pending, 49 settled, A$−19.05 and −7.78% historical hypothetical ROI. All 56 IDs appear in 14 accepted Telegram batches. Provider acceptance does not establish device delivery/read status.

These are 48 unique fixture/player/prop families: eight historical duplicate families each have an extra recommendation. Taking the first issue per family gives 19 won, 22 lost and seven pending; A$−27.00 / −13.17% on 41 settled. Historical duplicates improved the apparent P/L by A$7.95. The original 56 ledger positions and their accounting are unchanged.

| Melbourne issuance date | Issues | Won | Lost | Pending | Original-price P/L |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2026-11-22 | 11 | 6 | 5 | 0 | A$-0.80 |
| 2026-11-23 | 45 | 18 | 20 | 7 | A$-18.25 |

The following subgroups use first issues only. They are exploratory correlated slices, not evidence for a rule banning a side, prop or time window.

| Prop | Issued | W / L / pending | Mean decisive probability | Realised win fraction | Original-price P/L |
| --- | ---: | --- | ---: | ---: | ---: |
| points | 23 | 11 / 8 / 4 | 0.648 | 0.579 | A$9.70 |
| assists | 7 | 1 / 5 / 1 | 0.694 | 0.167 | A$-21.30 |
| rebounds | 13 | 6 / 6 / 1 | 0.684 | 0.500 | A$-3.30 |
| threes | 5 | 1 / 3 / 1 | 0.734 | 0.250 | A$-12.10 |

First-family Brier is **0.30483**, log loss **0.82049**, predicted decisive probability **67.36%** versus observed **46.34%**. Genuine same-line, opposite-side, same-clock, same-receipt/terms Sportsbet prices are available for all 41 settled families: inverse-odds-normalised fair-market Brier **0.25407**. This is a matched comparison, not an independent bookmaker ensemble. Independent model probabilities remain separate; no market blend was fitted.

UNDER: 41 issued, 17W/17L/seven pending, predicted 68.75% versus 50.0% observed; OVER: seven issued, 2W/5L, predicted 60.61% versus 28.57%. In the 0.7–0.8 band, eight settled families average 76.44% but win 25%; in 0.8–0.9, only three average 81.88% and win 33.33%. These identify an overconfidence warning, not a statistically established systematic error. The small groups share players, teams and fixtures.

T−90: seven families, 1W/5L/one pending across only two fixtures; T−20: 30, 12W/12L/six pending. First-family result evidence spans six settled fixtures on **one Melbourne fixture date**, despite two issuance dates. Fixture-clustered exploratory ROI 95% bootstrap range is −29.06% to +12.07%; a one-date bootstrap is degenerate and provides no meaningful independent date uncertainty. No strategy conclusion follows.

Predicted-minutes MAE is 5.109 minutes over 26 distinct settled player/fixtures, taking the earliest family’s prediction. Per-recommendation MAE is 5.163, but that repeats some player outcomes and is not independent. All 49 original grades replay exactly against frozen original prices/identities/settlement clocks; their primary and supporting receipt bodies are retained. No ambiguous or >24-hour-late evidence was identified. Seven pending rows remain pending in the frozen audit.

During development, the existing SHADOW worker independently collected final statistics and graded those seven rows. The later genuine snapshot has 30W/26L/0 pending, P/L A$0.30 and ROI 0.11%. This is a separate timestamped update; no policy or model was tuned on these appended results.

The full private `report-audit.json` contains per-date/fixture/player/model/side/prop/timing groups, odds/probability/edge bands, exact quote receipt hashes, settlement IDs, original probabilities, accepted delivery mappings and player/team/fixture exposure. The permanent family guard remains the live V1.4.5.1 implementation.

## Architecture diagnosis

- Recent-ten minutes and SD are useful controls, but averages cannot represent rotation changes, early exits or verified restrictions. DNP rows are excluded from conditional stat histories; missing player rows do not establish an absence denominator. Participation remains null without verified opportunity history. No unconditional probability is manufactured.
- Existing per-minute hierarchical NB uses broad count dispersion. Combining that count variance with a minutes mixture can count playing-time variability twice. The new conditional excess estimate uses observed training minutes, integrating predictive minutes variance once. This is a modelling hypothesis, not proof of the cause of current losses.
- Original whole-distribution calibration is retained for controls. Fitting/choosing calibration on small or shifted cohorts can degrade held-out CRPS; the new results demonstrate this tradeoff. High estimated probability does not establish reliability.
- The production conservative EV subtracts a heuristic half-binomial standard error from scenario probabilities. A fitted player probability is not a binomial proportion over independent games; overlapping history and scenarios are dependent. This is not an empirically validated lower confidence bound and must not be described as one. No production formula was changed.
- No verified historical starters, restrictions, pregame teammate opportunity denominators or causal vacated minutes exist in this dataset. Raw prior complete boxscores support possession/usage proxies, not official tracking pace or injury/lineup facts. Missing evidence remains null.
- Ranking many eligible correlated opportunities by estimated edge selects estimation error as well as signal. Model disagreement is a useful diagnostic, not independent replication. Permanent first-family issuance makes an early T−90 choice irreversible for that fixture. The tiny T−90 group cannot justify changing its schedule or deduplication.

## Experimental architecture and protocol

New modules under `src/research-advanced/` have no production recommendation caller. Minutes challengers include ridge regression, shrunk player residual offsets and pinball-loss stump quantile boosting with repaired quantile order. Features include recent/season means, exponentially weighted trend, variability/quantiles, low-minute frequency, rest, home and observed team changes. Residual uncertainty uses chronological cross-fit training folds rather than fitted point residuals. Minutes remain conditional on participation. Supports use previously observed overtime duration; unseen overtime and early-exit tails remain a limitation. Quantiles use a coarse grid and bounded smoothing; poor tail log scores are disclosed.

Stat challengers compare five simple controls, original hierarchical NB architecture, three probabilistic minutes/NB mixtures, verified three-attempt beta-binomial conversion and deterministic two-stage mean/excess-variance boosting. The last is not NGBoost or a full natural-gradient likelihood optimiser. Complexity did not justify external ML packages: no dependencies were installed. Exact PMF integration is the primary mixture; seeded 2,000-draw Monte Carlo checks ten held cases per target.

Raw retained game/player/source joins provide prior FGA/FTA/3PA rates and complete-boxscore possession, opponent defence/assists/3PA and usage proxies. Training-only median imputation includes missingness indicators; entirely unavailable columns are omitted. Of 2,144 evaluated stage rows, all have the first seven proxy inputs and 1,797 have the usage proxy. These are retrospective supported counts, not verified historical pregame publication.

Chronological UTC-date boundaries are 2025-11-12 (training end), 2026-10-24 (selection end), 2026-11-07 (calibration end), 2026-11-23 (test end), across 83 available dates. Stable-hash bounded sampling yields **744 train, 400 selection, 600 calibration and 400 held-out player-games per target**. Calibration is separated into 266 fit and 334 choice rows on disjoint dates. Selection chooses the strongest simple control and challenger; a five-point mixture weight grid is fitted on selection only. Raw/sigmoid/isotonic CDF calibration is fitted on the earlier calibration fold and chosen on the later one. Nothing is fitted on the test outcomes.

Each held cohort contains 239 players, 30 teams, 116 fixtures and 17 UTC dates. It is the same underlying 400 player-games across props, not 2,000 independent outcomes. Fixture-concentration effective cluster count is 95.35; true dependence-adjusted ESS is not identified. Threshold scores (1,200 per target) stay inside their player-game and date/fixture bootstrap clusters. Intervals use 300 deterministic paired resamples; small date counts and multiple candidates limit inference.

**These are development holdouts, not untouched confirmatory evidence.** Initial minutes/points outputs were inspected during implementation; the final source hashes and bounded protocol were then frozen in `protocol.json`. All candidate outcomes are disclosed, no thresholds were tuned on the owner's loss snapshot, and independent future SHADOW confirmation is still required. No profitability is established.

Historical rows were fetched later: the conservative latest-revision strict-clock diagnostic finds only 142 history-qualified targets on three dates. It cannot establish a four-stage source-qualified training/evaluation history. Strict historical prospective evaluation is **BLOCKED**. Retrospective results do not rewrite receipt clocks. Current live model selection/calibration artifacts postdate historical folds, so replaying them there would leak future fitting. Original architecture controls are compared here; actual deployed frozen probabilities are separately compared to outcomes in the genuine recommendation audit above.

## Held-out results

Lower CRPS/NLL/Brier is better; 80% interval coverage must be considered with width. The table compares the selection-chosen simple baseline to the selection-fitted, calibration-chosen ensemble. CIs are paired date-clustered ensemble-minus-simple CRPS; fixture intervals and every candidate’s calibration bins/width are in the private result files.

| Target | Strongest simple | Simple CRPS | Ensemble CRPS | Δ CRPS 95% CI | Simple / ensemble NLL | Simple / ensemble Brier | Simple / ensemble coverage80 |
| --- | --- | ---: | ---: | --- | --- | --- | --- |
| minutes | last10-minutes | 3.5647 | 3.5509 | [-0.0826, 0.0417] | 3.2959 / 5.7534 | 0.1119 / 0.1128 | 78.00% / 85.50% |
| points | ewa | 3.5143 | 3.5633 | [-0.0421, 0.1287] | 3.1970 / 3.1817 | 0.0913 / 0.0923 | 75.75% / 80.00% |
| rebounds | last10 | 1.3567 | 1.3660 | [-0.0019, 0.0212] | 2.2299 / 2.2359 | 0.1179 / 0.1182 | 84.00% / 87.25% |
| assists | ewa | 1.0038 | 0.9914 | [-0.0169, -0.0085] | 1.8710 / 1.8561 | 0.1186 / 0.1170 | 88.00% / 89.00% |
| threes | ewa | 0.6643 | 0.6585 | [-0.0109, -0.0011] | 1.4160 / 1.4078 | 0.1692 / 0.1674 | 92.25% / 91.50% |

Assists and threes have encouraging exploratory ensemble CRPS differences; points/rebounds do not improve, minutes uncertainty includes zero and its tail NLL degrades sharply. Minutes MAE is 4.951 baseline versus 5.012 ensemble against original unrounded minutes. The raw threes attempts model loses to EWA on held-out CRPS (0.6833 versus 0.6643), despite being chosen on selection; its blended/calibrated version differs. Two-stage boosting is worse than the strongest simple control across all four props. No advanced model is promoted.

Full scoring includes threshold log loss, calibration ECE and reliability bands, bias, MAE, CRPS, NLL, coverage/width and paired date/fixture uncertainty for every candidate. No original held-out Sportsbet quotes exist for this historical cohort, so original-price challenger ROI is unavailable, not simulated. Genuine original-price P/L and model-versus-de-vigged market comparison apply only to the issued-recommendation audit.

Scoring follows the proper-distributional-scoring principles in [Gneiting and Raftery](https://sites.stat.washington.edu/raftery/Research/PDF/Gneiting2007jasa.pdf). [NGBoost](https://proceedings.mlr.press/v119/duan20a.html) is a research reference, not a dependency or claimed implementation.

## Candidate policies, never activated

A is the unchanged production baseline. B is a fixed sensitivity hypothesis declared before running its policy comparison, after inspecting the audit requiring 20 earlier complete games, ten current-season games, expected minutes ≥24 and SD ≤4.5. C requires ≥200 independent calibration games, ≥30 fixtures/dates, a pre-quote fit clock and positive empirical lower edge. D combines B/C and verified role/minutes plus correlated-exposure evidence. Finite inputs are required; absent evidence cannot be replaced by a high point probability.

On the original issued-family population: A retains 48; B retains 21 (43.75%), 9W/12L, A$−21 / −20% ROI. B does not demonstrate improved quality. C/D retain zero because evidence is missing; abstention is not demonstrated superiority. This is a retrospective sensitivity on already-issued families, not a replay over all opportunities or an independent policy test. Correlated exposure, timing and disagreement remain disclosed evidence gates/diagnostics; no arbitrary daily cap or production threshold was added.

## Research / Watch and compact messages

Prepared `/watch` lists every one of the 904 archived quote-side observations, 50 per page, with exact fixture/player/line/side/odds/original clock/source, frozen conditional probability, baseline/challenger, expected minutes/SD, disagreement and specific exclusion. Player/prop/fixture filters preserve the full archive. Repeated prices and opposite sides remain research evidence, not independent samples.

An actually issued matching quote is labelled historical QUALIFIED; fresh rows can be inspected through the unchanged numerical/source checks. Expiry, absent opposite side/terms, missing forecast/positive evidence, quiet hours, future source clocks and permanent family suppression remain explicit. This view does not bypass final engine ranking, binding, lease, quota or delivery guards. QUALIFIED here refers to the existing approved experimental suggestion policy, not model promotion. V1.4.6 offline results are not presented as forecasts available at an old quote cutoff. Every view is read-only and makes zero paid requests, positions or outboxes.

The independently reviewable production-build preview is at **http://127.0.0.1:3078/watch**, on a separate detached genuine-data copy with default network/delivery off and no private keys/config in its workspace. The existing port-3000 website stays unchanged. The preview is loopback-only and is not a persistent LaunchAgent.

`src/suggestions/compact-message.ts` implements the requested mobile-first plaintext structure, fixture grouping, Melbourne DST, full selection IDs alongside text, duplicate-family rejection, Unicode/control handling and a 3,500-character default bound. No Telegram parse mode is used, so markup characters remain literal. Long single entries fail closed. The live engine still calls its original formatter. Private `telegram-preview.json` contains only original first-family selections and `sent: 0`; `telegram-preview.txt` is an easy-to-read historical example, never a live opportunity.

## Reproduction, resources and tests

Use Node 24 and the existing lockfile. Start from a detached online snapshot with retained source bodies under `.local/v146/`; never use a synthetic/demo DB for evidence. Output files are private, create-only and cannot overwrite prior reports. Examples (choose new output filenames):

```sh
node --max-old-space-size=768 --import tsx src/research-advanced/cli.ts audit .local/v146/before.sqlite .local/v146/new-audit.json
node --max-old-space-size=768 --import tsx src/research-advanced/cli.ts evaluate .local/v146/before.sqlite .local/v146/new-points.json points
node --max-old-space-size=768 --import tsx src/research-advanced/cli.ts policies .local/v146/before.sqlite .local/v146/new-policies.json
node --import tsx src/research-advanced/cli.ts messages .local/v146/before.sqlite .local/v146/new-preview.json
```

Repeat evaluate for minutes, rebounds, assists and threes. CLI disables fetch, drops CPU priority and opens SQLite read-only. The evaluation enforces a 150-second wall guard; the reviewed run used sequential 768-MiB-heap children with 160-second CPU/wall limits and checked live acquisition/pregame jobs before each target, yielding within ten minutes of fixture deadlines. Training is manual and outside both workers. Artifact hashes bind source dataset, source code protocol, splits, sampled cohort, training IDs, weights and calibration. Public code contains no private source exports.

- minutes: 5.51s elapsed; 5.68s user CPU; peak RSS 494.5 MiB.
- points: 8.66s elapsed; 8.91s user CPU; peak RSS 531.2 MiB.
- rebounds: 8.61s elapsed; 8.95s user CPU; peak RSS 529.7 MiB.
- assists: 10.22s elapsed; 10.62s user CPU; peak RSS 531.6 MiB.
- threes: 10.84s elapsed; 11.30s user CPU; peak RSS 538.1 MiB.

Full `npm run verify` passed: **237 tests, zero failures, TypeScript and production build successful**. Fourteen build trace manifests contain zero private runtime inputs. All 904 rows were verified across 19 HTTP pages, along with filters and the loopback Host guard. The original port-3000 website remains unchanged. Verification is executed in `.local/v146/verify`, a private-free clone of current source/dependencies, so the live website's `.next` is never replaced. It includes TypeScript, the complete regression suite and production build. Sixteen new tests cover leakage, cross-fit minutes uncertainty, deterministic models/MC, missing context, train-only encoding, policy evidence clocks, read-only Watch pagination/staleness/permanent families, pending settlement/correlated dates, and compact notification identities/escaping/length/DST/mixed batches. The existing suite retains calibration, original-price settlement, concurrent dedup, grading revisions and worker sleep/recovery coverage. No test writes to the live DB or sends Telegram.

## Activation and rollback — separate approval required

**LIVE unchanged:** four original models, market V1.4.5.1 family guard, SHADOW V1.4.5, port-3000 website, T−90/T−20 jobs, grading, Telegram protections and recurring API policy. V6 was not touched. Normal authorised workers can still acquire sources and send genuine existing-policy notifications.

**PREPARED:** read-only Watch and compact formatter with regression tests. **EXPERIMENTAL:** minutes/stat/context/ensemble architecture, frozen retrospective diagnostics and A–D policy sensitivities. **BLOCKED:** defensible participation probabilities, verified historical role/availability, four-stage strict source-clock evaluation, original-price challenger ROI for the retrospective cohort and confirmatory independent model/policy improvement.

No restart is necessary to inspect the separate preview. To activate Watch on the existing website, review this commit, preserve private-free build traces, take the existing safe website-only build/rollback path and verify workers keep their identities. Do not replace the live `.next` in place while serving it. Roll back only that website release if needed.

Activating compact notifications needs a separately approved market-only release which explicitly wires this pure formatter into the existing immutable outbox creation path. First audit ownership/heartbeats/no requests or sending outboxes, ensure no pregame task within ten minutes, take a fresh online backup, prepare pinned candidate/rollback plists and preserve all family/uncertain-send guards. Do not rewrite already-created messages or send preview texts. Stop only that market worker under its existing deployment guards; observe at least 165 awake seconds. Roll back only its code/LaunchAgent after confirming exit; retain all database protections and never restore SQLite over live data. This release intentionally contains no formatter activation switch.

Model/policy activation is a separate decision after future, timestamped, immutable SHADOW registration and broad independent evaluation. Fit before each genuine forecast cutoff, retain actual publication/receipt clocks, freeze code/weights/calibration and collect across new fixture dates without optional stopping. Start with bounded offline challenge training on new genuine evidence; a future namespace/integration must pass existing ownership/as-of/deadline guards. Current advanced artifacts have `productionEnabled: false` and `promotionEligible: false`; do not relabel retrospective outputs as prospective registrations. Keep independent model and any future market blend separate. No new paid source, allowance, forced signal or real-money execution is authorised by this document.
