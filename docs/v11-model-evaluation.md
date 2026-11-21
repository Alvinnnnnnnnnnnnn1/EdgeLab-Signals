# V1.1 model evaluation and handoff — 21 November 2026

**Result: blocked by genuine data access.** This task implemented and component-tested the expanded research engine, but did not meet the definition of success of a real independently evaluated player-prop system. There are **zero genuine NBA and zero genuine NBL player-games**, zero genuine training runs, zero genuine test results and zero alert-ready markets. Missing measurements below are not replaced with synthetic numbers or other authors' claims.

## Answers to the nine acceptance questions

| Question | Observed answer |
| --- | --- |
| Which genuine sources were accessed? | No outcome/statistics/odds feeds. Public provider documentation, source code and published research artifacts were reviewed. No outcome tables/fixtures were downloaded from those repositories. |
| Genuine player-games available? | NBA **0**; NBL **0**. Local `npm run research -- audit` confirms empty genuine coverage and absent independent stats/odds credentials. |
| Which independent models were genuinely trained/tested? | **None.** Numerical components have isolated labelled fixture tests; these are software checks, not basketball evaluation. |
| Best model per prop and baseline? | **Unknown** for NBA/NBL points, rebounds, assists and threes. No eligible cohort exists. L5/L10/EWA/shrunk-season/rate controls are mandatory in the new protocol. |
| Is an ensemble superior? | **Unknown.** The engine can decline an ensemble when earlier selection evidence does not support it. No genuine blend weights were fitted. |
| Adequately calibrated? | **Unestablished.** Sigmoid/isotonic calibration paths exist; no genuine calibrator has been fitted or approved. |
| Any market ready for alerts? | **No.** The old 200-game checkpoint cannot qualify a genuine V1.1 signal. Network/delivery remain disabled; no real message was sent. |
| Remaining blockers? | Permitted player logs and actual source receipts; phase/OT/attempt completeness; positive availability/roster opportunity archive; independent finite odds access, exact Sportsbet coverage/terms; genuine chronological/monitoring results; verified owner relay. |
| Shortest safe first-signal route? | Independent permitted NBA ALL-STAR-level stats/export → exact versioned source archive → as-of benchmarking/calibration → frozen non-issuing prospective research with real Sportsbet quotes/availability → passed statistical/monitoring gates → configured and verified BlueBubbles recipient. NBL can remain disabled while NBA is researched. |

No subscription, trial, API purchase, old credential, old quota or V6 worker was used. See [provider findings](v11-data-provider-findings.md) and [external model review](v11-model-research-comparison.md).

## Working engineering changes

The existing dashboard and three destinations are preserved. The transport, immutable recommendation/outcome history, configuration defaults and quota controls are retained. Additive changes are in `src/research`, the raw BDL normalizer, core optional research metadata, certificate-aware screening, and immutable candidate capture. V1 signals keep their original stored details and scoring history.

### Genuine ingestion and reproducible data

`research import-bdl` consumes already permitted captured pages without network calls. Raw endpoint identity, hashes, separate fixture/stat joins, source clocks, phase/OT/3PA fields and missingness are validated. The existing normalized licensed export path accepts optional research metadata for NBA/NBL. A source declaration is an integration boundary, not an independent legal permission oracle.

`research snapshot` writes an immutable `player-games/1.1.0` JSON document under `.local/datasets/<hash>.json`, containing all revisions, original receipts/bodies, quality metadata and licence references. The content hash includes the creation clock; the same frozen inputs and clock reproduce it. Source-time history is never backdated to game time. Unknown phase/participation/minutes/attempts/OT remain explicit. Conflicting revisions, DNP/production conflicts and impossible verified duration/make counts fail validation.

### Competing candidates

| Family | Implemented candidate / required evidence |
| --- | --- |
| Simple controls | L5, L10, exponentially weighted production, season mean shrunk toward longer player history and source-sample league priors, recent rate × projected minutes. Each returns a count PMF. |
| Hierarchical count model | Recency-weighted rate with source-sample league exposure shrinkage and player/stat-specific NB dispersion; earlier selection tests prior-exposure alternatives 60/120/240 minutes. Poisson is only the equidispersed limiting case, not a universal assumption. |
| Minutes-aware | Participation from explicitly verified roster opportunities, conditional minute history/residual sampling, regulation/observed-OT bounds, count production given minutes, seeded bounded Monte Carlo. No target minutes or retrospective absence list becomes a predictor. Missing opportunity denominator returns no live participation estimate. |
| Made threes | Empirical attempt-rate uncertainty plus beta-binomial makes. Missing 3PA excludes this candidate for the whole common cohort; it is not compared on an easier subset. |
| Boosted challenger | Small CPU log-count gradient-boosted stumps with training-residual NB uncertainty; at least 200 earlier complete training rows. Form-only versus available-context feature ablation. Explicitly **not** NGBoost/LightGBM/XGBoost reproduction. External-library/GPU models are deferred until genuine data size warrants them. |
| Conditional ensemble | League/prop-specific convex PMF mixture of up to three earlier-ranked candidates, weights fitted only in selection. A blend is retained only if selection CRPS improves; its later test may still lose. No independent-confidence bonus for correlated members. |

Opponent defensive opportunities, pace, usage, injury history and travel are not guessed. Venue/rest/team-change features use only the fixture and earlier known games. The league prior describes the available source sample, not an asserted complete league average. Non-playing probability is separate from conditional count production and is a void return under verified terms.

### Chronological experiment

`research benchmark` rejects synthetic records and snapshots with invalid source integrity. Unknown phase is excluded explicitly. Every target's features use earlier UTC dates only, and in as-of mode every contributing observation and supporting fetch must precede the forecast. All observation revisions are retained so a later correction cannot erase the earlier version that was known then.

Whole dates divide into an initial **50% training**, **15% hyperparameter/model/ensemble selection**, **15% calibration**, and final **20% untouched test**. Calibration itself has an earlier fitting half and later method-selection half. No shared date crosses a boundary. Rolling form updates only from outcomes genuinely available before each later origin; fitted boosted parameters, selected hyperparameters, mixture weights and calibration are frozen before the final test. Retrospective mode only gives exploratory chronological evidence and cannot promote.

All evaluated candidates use the same independent player-games, phases, target and period. Missing optional-model requirements exclude that model, not inconvenient rows. Low-minute cohorts are defined by the pregame minutes forecast; unobserved starter status is not invented. Same-day observations are excluded conservatively, even when an earlier same-day result might have been available.

Outputs include independent player-games, players, teams, fixtures and dates; MAE/bias, full discrete CRPS and NLL, predefined-threshold Brier/log loss, calibration, 80% intervals, seasons and projected-minute cohorts. Threshold scores remain nested within their player-game. Paired differences use seeded whole-date and whole-fixture bootstrap resampling, preserving all threshold dependence. Selected PMFs are retained, not only attractive aggregate scores. Fixed thresholds are analysis targets, never fabricated historical sportsbook lines; no ROI is calculated.

### Calibration and promotion

Raw, monotone sigmoid-CDF and isotonic-CDF recalibration are compared. Fitting refuses fewer than 200 independent calibration player-games; method choice uses the later calibration half, not the final test. Mapping a CDF and differencing it preserves a coherent non-negative PMF, exact integer push mass and arbitrary-line consistency. A bare per-line probability adjustment is not substituted for a full distribution.

Promotion requires substantially more than the legacy engineering floor: at least 200 held-out player-games, ten players, thirty dates, separate sufficient calibration fit/selection samples, supported reliability bins, bounded reliability/interval error, paired CRPS uncertainty and probability scores against the strongest earlier-selected control, verified participation/OT coverage, and a later genuinely frozen monitoring sample. Participation calibration is checked separately from count distributions. These predeclared gates are conservative research requirements, not a claim that the thresholds prove profitable betting.

`research certify` writes content-bound league/prop reports and model/calibration artifacts, does not edit private configuration, and never purchases or enables delivery. Ineligible artifacts can populate diagnostic forecasts and immutable screenings without issuing a recommendation. Loading a certificate rechecks report/artifact identity, statistical rules and its retained prospective evidence. Later monitoring degradation or a 90-day-old artifact disables eligibility at read time; manually changing `eligible` does not bypass those checks.

### Monitoring and sportsbook comparison

The scanner records normalized screened candidates separately from issued signals, including exclusions. It preserves original inputs, artifact identity, PMFs and quote clocks. Prospective monitoring takes the first source-qualified player-game forecast, retains losses/unissued candidates, evaluates independently ingested finals and uses the frozen simple comparator. It does not register a hypothetical position or infer owner action.

Real two-sided market matching/de-vig and observed price/line movement have dedicated exact-identity functions. They reject post-event quotes and incompatible lines/terms. Market inputs are excluded from the independent predictive feature vector. No actual Sportsbet comparison or closing-line measurement was possible in this task.

## Commands

```sh
npm run research -- audit
npm run research -- import-bdl .local/your-permitted-captured-pages.json
npm run research -- snapshot 'Actual permitted provider/export contract reference'
npm run research -- benchmark .local/datasets/EXACT_HASH.json as-of
npm run research -- benchmark .local/datasets/EXACT_HASH.json retrospective
npm run research -- certify .local/research-runs/EXACT_REPORT_ARRAY.json
```

The first command works now and reports the real blocker. The other commands require actual permitted files; placeholders are not data and should not be invented. A completed eligible certificate can be referenced through the existing private `validationFile`; current defaults remain unchanged.

## Verification and remaining limitations

**Final verification:** `npm run verify` passed **72 tests**, zero failures/skips, strict TypeScript and the production build. Production HTTP checks passed for all three preserved pages, filters and the read-only API; write/cross-origin/Host restrictions passed and dashboard reads left the database hash unchanged. Ten build trace manifests included zero private runtime files. The temporary loopback server was stopped. Local evidence is retained in ignored `.local/v11-verify.log`, `.local/v11-http.json`, `.local/v11-build-privacy.json` and `.local/v11-audit.log`. The commit is reported in the final handoff; no push or deployment is performed. Tests exercise arithmetic, coherence, leakage, source joins, revision/duration/DNP checks, reproducible simulation, chronological splits, paired comparisons, calibration boundaries, market semantics and immutable unissued research. **No genuine advanced-model benchmark was executed**, so its runtime, accuracy, ablation outcomes and calibration remain unverified on basketball data.

The boosted learner is intentionally small and uses a plug-in residual variance, not a fully learned heteroscedastic NGBoost head. Minutes use a transparent empirical projector, not an injury/lineup-aware model without the needed source. Participation calibration currently checks global probability bias/Brier as well as coverage; subgroup reliability needs a sufficiently rich genuine archive. Actual tip-off, complete lineup/roster availability and account-specific odds coverage remain unresolved. Additional implementation/review may be needed when a permitted NBL/provider schema is supplied. No dashboard redesign, deployment, persistent service activation or real notification test occurred.
