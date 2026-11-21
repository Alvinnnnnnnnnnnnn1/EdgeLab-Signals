# V1.4 live research foundation

Continuation of `codex/nba-wide-research` from clean commit `d437bff`, using the existing genuine database. No branch switch, history rewrite, merge or SportsModel modification was performed. The historical V1.3 benchmark failed on threes; its first three calculations were not saved. V1.4 fixes this failure and adds an independent research worker, separate SHADOW records, Telegram transport and owner-controlled activation.

## Verified engine corrections

The exact immutable-data reproducer is a player with ten genuine zero-attempt games, no missing attempts and a league reference containing 10,468 attempts. The old attempts model returned null, causing `Missing attempts-beta-binomial prediction on common row`. Genuine zero attempts now receive a declared exposure-smoothed attempt prior and a proper make-probability prior. Missing attempts, invalid reference exposure and inconsistent makes remain unsupported; legitimate zero-attempt players are retained in the identical cohort.

A second failure, `Unsupported three-attempt tail`, appeared after the zero-attempt fix. The old mixture stopped at 60 attempts. The corrected mixture uses the full checked count support and log-stable beta-binomial probabilities. Tests cover broad tails, genuine zero attempts, small positive attempts, missing data and unavailable reference exposure. No missing observation becomes zero.

NBA Cup Group Play, Quarterfinals and Semifinals are regular-season games; the Championship remains separate, consistent with the [NBA's official Cup rules](https://www.nba.com/news/nba-cup-101). Unknown stages remain unknown. Exact original fixture receipts produced **1,138 derived phase corrections** in a new `player-games/1.4.0` snapshot. Original logs, receipt timestamps and old snapshots were not rewritten.

Model version is `prop-research/1.4.0`; archived 1.1 artifacts remain readable, but are not silently reused with changed prediction semantics for new forecasts. An experiment-local chronological index parses clocks once and reuses earlier rows by cutoff. Regression tests compare complete feature values across props, observation boundaries and revisions against the original implementation.

The benchmark now writes atomic, immutable per-prop reports and a hash-bound manifest, with pending/running/complete/blocked/failed states. Resume verifies completed reports, recovers an interrupted report commit, skips completed props and refuses corruption. Same-host dead-process recovery releases only the matching benchmark lease; a live owner prevents duplicate execution. Single-prop execution is supported.

```sh
npm run research -- benchmark DATASET.json retrospective --target-season 2026 --prop threes --resume
```

The actual failed threes run was resumed alone. The first three completed reports retained their original hashes and were not recomputed.

## Actual retrospective model comparison

Snapshot: `da6201dc7586e5978d805a894ea297a13e1b7db33f2a7c054852cac7c526cfb8`.

Run: `244cfdfec780c717a67d9fb5dfd9b4a158d0e0dbbde07bc175acc38426328d4d`.

Each prop used **246 training, 362 selection, 245 calibration-fitting, 415 calibration-selection and 731 held-out player-games**. The held-out set contains **306 players, 41 fixtures and six dates**. The 2,193 threshold scores per prop reuse these games. They are not 2,193 independent observations. Targets are source season 2026; earlier genuine imported history remains available to features. This is retrospective research, not historical point-in-time validation.

All controls, three hierarchical NB variants, minutes simulation, both boosted models and ensembles were evaluated; threes also includes attempts/makes. There are 12 candidates per non-threes prop and 13 for threes. [The full aggregate comparison CSV](v14-model-comparison.csv) contains every candidate's MAE, bias, CRPS, count NLL, Brier/log loss, calibration, interval coverage, projected-minute roles, and date/fixture clustered uncertainty. Full reliability bins and frozen predictions remain in the private per-prop JSON reports.

Earlier selection chose an ensemble for each prop. The strongest earlier-selected simple controls and actual held-out results are:

| Prop | Simple control | Selected MAE | Selected bias | Selected CRPS | Simple CRPS | Date-cluster 95% CRPS difference |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Points | Last 10 | 4.8492 | 0.0885 | 3.44191 | 3.46474 | [-0.03758, -0.01396] |
| Rebounds | Last 10 | 1.9656 | 0.1273 | 1.35830 | 1.36977 | [-0.01507, -0.00277] |
| Assists | EWA | 1.4372 | 0.0389 | 0.98615 | 0.97073 | [0.00716, 0.02413] |
| Threes | Season-shrunk | 0.9960 | 0.1096 | 0.64869 | 0.64665 | [-0.00495, 0.00967] |

Differences are selected minus simple; lower is better. Assists deteriorated and threes did not establish improvement. Points/rebounds improvements on six dates are provisional evidence, not broad validation.

| Prop | Count NLL | Brier | Log loss | ECE | 80% interval coverage | Calibration |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Points | 3.15550 | 0.09362 | 0.30039 | 0.01120 | 83.99% | Sigmoid |
| Rebounds | 2.22816 | 0.11752 | 0.37364 | 0.02788 | 86.46% | Raw |
| Assists | 1.89969 | 0.11533 | 0.35967 | 0.01072 | 90.56% | Sigmoid |
| Threes | 1.41690 | 0.16365 | 0.49174 | 0.03373 | 92.48% | Sigmoid |

Each date/fixture interval uses 500 seeded cluster resamples. There are only six independent test dates. **Every model remains ineligible for qualified alerts**: retrospective timing, insufficient date breadth, participation calibration, reliability/improvement issues and missing prospective/market evidence remain visible. No synthetic evidence or relaxed threshold was used.

Completed V1.4 runtimes were 21.65 / 25.17 / 22.97 / 23.08 seconds for PTS/REB/AST/3PM. The earlier first three runs took 196.94 / 251.26 / 226.58 seconds. This is an observed runtime improvement on this host; corrected Cup metadata also changes the new dataset cohort. Feature-equivalence tests establish that indexing itself preserves the calculation.

## Minutes and context

The separate minutes diagnostic uses the same 731 held-out targets and chooses by earlier selection MAE, not test outcomes:

| Minutes method | MAE | Bias | 80% coverage |
| --- | ---: | ---: | ---: |
| Last 5 | 4.4852 | -0.1864 | 71.96% |
| Last 10 | 4.5171 | -0.2580 | 72.09% |
| EWA | 4.4172 | -0.3358 | 73.46% |
| Empirical bootstrap | 4.7406 | -0.6329 | 71.00% |

EWA was selected earlier; its paired MAE difference versus Last 10 has date-cluster interval [-0.1450, -0.0177]. Coverage remains below the nominal 80%. This diagnostic does not silently replace a validated prop projector. The existing minutes Monte Carlo propagates earlier minutes uncertainty. Actual target minutes are scoring labels only. Starter/bench labels, teammate effects, pace and opponent opportunity covariates were not fabricated. Existing boosted context/form ablations use only source-derivable features.

```sh
npm run research -- minutes FROZEN_REPORTS.json
```

## Genuine dataset, quotas and source limitations

**8,715 original genuine NBA player-games are unchanged**, across 694 players, all 30 teams and 324 fixtures. There are 6,504 positive-minute records and 2,211 unknown participation records. Minutes, PTS/REB/AST/3PM, three-attempt and overtime fields are present; zero minutes never establishes a verified DNP. Exact source receipt integrity and SQLite integrity passed; there are no quarantined pages.

| Season | Rows | State |
| --- | ---: | --- |
| 2024–25 | 1,881 | Partial |
| 2025–26 | 0 | Missing; prioritized next |
| 2026–27 | 6,834 | Collected available windows; daily maintenance still required |

V1.4 made **zero new BDL requests and zero Odds API requests**. The existing UTC-day BDL usage remains 100/100, with the 25-request foreground batch maximum and 13-second interval preserved. Source jobs defer until the next UTC day; on this run that reset is **22 November 2026, 11:00 Australia/Melbourne**. The worker checks actual quota/date before sending. No cap increase was made.

The earlier Sportsbet test's four requests/five credits remain historical coverage evidence. Its grant is spent/expired. Recurring paid access is disabled. A genuinely authoritative shared coordinator still needs SportsModel participation or an independent allocation architecture; the finite V1.3 guard is not represented as such a coordinator. V6 was not altered.

## Research-only vertical slice

The new orchestrator does not call the quote-screening worker or The Odds API. Its persisted jobs cover fixtures, paginated active-player membership, injuries, recent finals/corrections, prioritized history, pregame windows, scoring, monitoring and daily status. A 60-second heartbeat is independent of provider polling. Defaults are one provider request per cycle, six-hour fixtures, 24-hour roster membership, four-hour injuries and six-hour recent-final maintenance. Historical work preserves ten requests for maintenance. Daily and cooldown reservations remain authoritative.

Priorities are current 2026–27 maintenance, missing 2025–26, then incomplete 2024–25. Cursor filters are retained; an expired schedule scope restarts with a new cursor namespace after an outage. Upcoming source IDs/timestamps and scheduled lifecycle state are required. Postponed/cancelled/uncertain fixtures do not produce guessed substitutes. Missed windows expire.

RESEARCH computes genuine-history model-versus-baseline diagnostics and an immutable journal. SHADOW additionally registers first pre-tip conditional forecasts from exact source-backed player/team membership, explicitly marking availability unverified and minutes model-estimated. Fresh positive availability with verified game roster can use the existing stricter pathway. The two record tables and metrics remain separate. Injury-list omission is never availability; known Out vetoes forecasting. A final wall-clock deadline check prevents registration after a long calculation crosses tip-off.

Frozen models retain dataset/artifact/report hashes, training cutoffs, selected control, calibration, reasons and provisional status. Later finals and corrections can score retained forecasts without rewriting them. Degradation remains a non-promoted model-health state, not an automatic retraining/promotion loop.

The actual dry run and explicit genuine cycle made no sports requests. Source jobs were **deferred by quota exhaustion**. There were **zero genuine prospective forecasts, zero graded forecasts and zero unresolved registered forecasts**, because genuine upcoming fixture/roster evidence has not yet been fetched. Mocked tests exercise discovery through four-prop registration, restart, cancellation, quota deferral, deadline crossing and scoring; those counts are not live evidence.

## Telegram and operational modes

Telegram verifies the bot and exact allowlisted private destination, binds verification to configured credentials and never logs token-bearing URLs or the private destination. The new integrated outbox canary was accepted exactly once. Its state is **accepted**, not delivered/read. Telegram provides no iPhone delivery receipt. Mocked tests cover rejection, 429/backoff, timeout ambiguity, interrupted claims and duplicate prevention. Uncertain outcomes are held without blind resend.

Research-status messages remain an independent **opt-in, disabled** switch. They derive counts from immutable journals. Qualified opportunity delivery remains disabled and cannot be enabled through the status switch. BlueBubbles verification remains intact as an inactive legacy channel. New installations default to mode `disabled`.

```sh
npm run signals -- verify-telegram
npm run signals -- telegram-test --confirm
# Optional future status digests; this does not enable opportunities.
npm run signals -- telegram-status enable --confirm
npm run signals -- telegram-status disable --confirm
```

## Owner-controlled macOS activation

A valid private LaunchAgent was generated and linted at `.local/ops/com.edgelab.signals.research.plist`, using the actual Node 24 executable and absolute repository/config paths. It is **prepared, not installed or loaded** at this checkpoint. The service wrapper and worker keep bounded rotating private logs, recover persisted jobs, enforce one active worker, detect heartbeat gaps and stop gracefully. Neither the dashboard nor an open Terminal is required after activation. An asleep or shut-down Mac does not provide continuous research.

After reviewing this checkpoint, activate RESEARCH with:

```sh
cd /Users/asan/EdgeLab-Signals
npm run research -- live-plan
npm run research -- live-once --dry-run
npm run research -- activate research --confirm
npm run research -- prepare-launchagent
mkdir -p "$HOME/Library/LaunchAgents"
cp .local/ops/com.edgelab.signals.research.plist "$HOME/Library/LaunchAgents/"
chmod 600 "$HOME/Library/LaunchAgents/com.edgelab.signals.research.plist"
launchctl print "gui/$(id -u)/com.edgelab.signals.research" >/dev/null 2>&1 || launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.edgelab.signals.research.plist"
npm run research -- live-status
```

When the genuine feed/roster checks pass, `npm run research -- activate shadow --confirm` permits separately labelled conditional registration. It does not enable qualified alerts. Do not install the legacy quote-worker template for this research mode.

Stop safely with:

```sh
npm run research -- deactivate --confirm
launchctl bootout "gui/$(id -u)/com.edgelab.signals.research"
```

Final tests and commit identifiers are recorded with the handoff. Private evidence is under `.local/v14`, `.local/benchmark-runs` and `.local/research-runs`. Keys, chat IDs, raw data, grants, config and databases are not included in Git or build artifacts.

## Final verification

`npm run verify` passed **123 tests**, with zero failures/skips, strict TypeScript and the production build. The absolute-path service wrapper also starts/stops with disabled configuration in an isolated workspace. Ten build trace manifests contain zero private runtime entries; the configured stats/odds keys, Telegram token/private destination and relay password have zero occurrences in build output. A completed benchmark resume verified every report and recalculated zero props. All 8,715 original normalized logs and their retained sources passed preservation checks; SQLite integrity is `ok`. No genuine recommendation or qualified outbox entry exists.

The final UTC-rollover regression subtracts completed league-wide and maintenance date intervals before queuing a growing current-month window. Selected-player scopes do not stand in for NBA-wide coverage, and scopes with source exclusions do not certify coverage. Thus recent maintenance does not cause a completed month to be re-downloaded before the missing 2025–26 season.

## Exact changed files

```text
.env.example
docs/architecture.md
docs/handoff.md
docs/nba-collection-and-live-research.md
docs/operations.md
docs/source-capabilities.md
docs/v14-live-research-foundation.md
docs/v14-model-comparison.csv
scripts/research-service.mjs
src/app/status/page.tsx
src/cli.ts
src/core/config.ts
src/core/messaging.ts
src/core/store.ts
src/core/telegram.ts
src/core/worker.ts
src/providers/balldontlie.ts
src/research/benchmark-run.ts
src/research/cli.ts
src/research/collection.ts
src/research/dataset.ts
src/research/distributions.ts
src/research/experiment.ts
src/research/features.ts
src/research/inference.ts
src/research/live.ts
src/research/metadata.ts
src/research/minutes.ts
src/research/models.ts
src/research/monitoring.ts
src/research/operations.ts
src/research/prospective.ts
src/research/shadow.ts
tests/collection.test.ts
tests/live-research.test.ts
tests/service.test.ts
tests/telegram.test.ts
tests/v14-engine.test.ts
```
