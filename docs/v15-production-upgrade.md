# V1.5 production upgrade

Owner scope: forensic reconciliation of the 26 November 2026 slate, independent chronological model comparison, promotion only on qualifying evidence, and guarded production operational/diagnostic repairs. Existing model artifacts, original M1 trial protocol, recommendation families, quote clocks, source limits and settlement semantics remain immutable. No four-book acquisition, paid test prices, wagers or test sends.

The first operational milestone fixes final-event discovery: group scalar event/row identities, then fetch one event body by primary key, rather than sorting the entire large forecast archive. The market worker also honours the existing five-second retained-price retry instead of waiting a full minute. Normal request pacing, original receipt TTL/deadline and all qualification rules remain unchanged.

## Statistical protocol declared before candidate scores

Implement independent three-point candidates: Poisson attempts with binomial conversion; negative-binomial attempts with binomial conversion; negative-binomial attempts with hierarchical beta-binomial conversion; and a shared positive-minutes mixture over the last model. Fit attempt dispersion from attempts rather than made-shot residuals. Conversion pools by lagged minutes/role; no unavailable position, starter, injury or opponent covariate is invented. Zero attempts and posterior parameter uncertainty are explicit. Compare an existing fixed boosted-minutes challenger with M1 PTS/REB/AST; do not automatically replace any market.

Use expanding whole-date folds with separate training, minute residual, CDF calibration, candidate selection and final blocks. Identity/Platt/beta calibrators are fitted only before selection; final scores cannot choose calibration or weights. All models share matched player-games. Retain full predictive distributions, source/feature hashes, trained/calibration cutoffs, failures, date/fixture cluster intervals, subgroup scores and minutes errors. Report genuine archived-price selection/ROI separately from generic research thresholds.

The incident slate (UTC25–26November), previous audited incident UTC23–24November, and their selected outcomes are excluded from candidate fitting/calibration/selection/final evaluation. All 104 historical dates already inspected by prior work remain explicitly SEEN; splitting them again does not create untouched evidence. A model cannot be promoted by relabelling retrospective or inspected results as independent. A predeclared unseen-cohort registry, credible score/calibration improvements and preserved source-clock semantics are mandatory; absence of such evidence retains the incumbent. Existing M1 prospective promotion requirements remain untouched.

Research references (methods assessed independently, no external code copied): [hierarchical conversion](https://www.binomialbasketball.com/p/comprehensive-nba-3pt-modeling), [boosting and chronological calibration](https://github.com/eduardo00-fv/nba-props-model), [quantile ensembles and walk-forward evaluation](https://github.com/johnshun001/nba-props), [pre-registered market comparisons](https://github.com/akilatrades/sports-market-maker). Their performance claims do not validate EdgeLab. Their execution/wagering components are out of scope.

## Reversible source maintenance

`beginSourceMaintenance` acquires the controller's existing `live-cycle` admission mutex through its normal token-conditional API. It returns busy while a genuine source cycle owns the lock; it never cancels that cycle or replaces its valid lease. Once acquired, even the old controller's `liveOnce` returns busy before admitting another source job. Parent heartbeat/ownership continue independently. A drained acknowledgment also requires no assigned/running job and no reserved BDL request. Renew the maintenance token throughout a guarded transaction, then explicitly resume with token-conditional release. On interruption the150second lease expires naturally; stale cleanup cannot release a successor. A second maintenance owner cannot replace an active one. This is scoped admission control using an existing mutex, not a scheduler redesign or a fabricated source job. New production use requires the recorded owner reference, verified process identity, successful detached-snapshot race/drain tests, stable acknowledgment, fresh backup and original preservation/deadline gates.

## Implemented distribution and production boundaries

`src/v15/registry.ts` registers complete prop-specific distributions, including calibration, training/calibration cutoffs, publication time and content hashes. A private immutable journal holds artifacts, evaluations, decisions, feature manifests and prospective forecasts. The raw development experiment's preliminary component identifiers are not production registration IDs: derived evaluation bindings correct this metadata without changing selection or scores. The publication clock of a new distribution is its actual registration window; historical development rows never become pre-event live forecasts.

The optional `production:v15` marker can replace individual markets only with independently qualifying decisions. Routing uses the registered model's actual PMF and holds on missing or changed context; it cannot silently fall back into the displaced model's recommendation authority. Original models remain available through the research-only incumbent route. No marker is installed when validation fails. The shared qualification, exact-line, deduplication, settlement and delivery engines are unchanged.

A separate cached-only `shadow-service.ts` collects future evidence with physical read-only access to the source, fenced ownership of its private journal, bounded rotating fixture/player work, immutable source manifests and real generation clocks. It cannot acquire prices or send messages, and SHADOW_ONLY authority is rejected by production routing. Actual incumbent forecast provenance and a recomputed same-input incumbent PMF are both retained. First prospective registrations count once; later source corrections append grading checks and can invalidate a previously scored result. The original M1 trial clock remains separate.

## Development results and limits

Four valid chronological folds cover 3,782 matched player-games per prop over 28 disjoint final dates. Two earlier folds were excluded by the declared minimum training size, with failures retained. All dates were already inspected during previous work, and historical receipt-as-of evidence is unavailable. These are **seen development replays**, with zero untouched dates, and cannot satisfy promotion.

Selected-model changes versus the matched incumbent replay (negative means lower loss):

| Prop | CRPS | Brier | Log loss | Date-cluster 95% interval for absolute CRPS difference |
| --- | ---: | ---: | ---: | --- |
| Points | +0.752% | +0.588% | +0.043% | −0.000653 to +0.051440 |
| Rebounds | −0.204% | −0.251% | −0.356% | −0.005889 to +0.000424 |
| Assists | −0.072% | −0.024% | −0.067% | −0.001280 to −0.000195 |
| Threes | −1.463% | −1.534% | −1.794% | −0.012712 to −0.005651 |

The incumbent comparison is an M1 architecture refit inside each fold, or a replay of the frozen original 3PM recipe, rather than an unavailable historical production forecast. Final scores do not choose the last fold's frozen future recipes. The private report retains calibration bins, interval coverage, minute errors, role/history/season groups, family scores, date/fixture bootstrap intervals and full predictive PMFs. Historical quotes are unavailable for these candidate forecasts, so their ROI and bookmaker advantage remain unknown. Authentic issued-price outcomes are reported separately.

Quantile models and opponent/injury/rotation effects were assessed but not fitted using absent historical covariates or fabricated contexts. Boosted minutes, distributional attempt regression and chronological CDF calibrators are the implemented feasible challengers. The 26 November outcomes do not tune any parameter or qualification threshold. At least 30 untouched source-valid dates and 1,000 matched player-games, credible proper-score improvement, acceptable calibration/subgroups and production safeguards are required for a new promotion review; there is no automatic promotion.

## Diagnostics and rollback

`/models` presents current production identities, cached lookup clocks, original M1 quality, independently labelled candidate development results, shadow runtime evidence and per-recommendation final-source audits. Extreme probabilities, missing/mismatched identities, duplicate recommendation families, post-decision clocks and material calibration deterioration are warnings only. Cash confirmations remain separate from hypothetical units. Missing finals and ambiguous participation remain held.

Rollback is code-only: verify the incumbent service's PID/birth and leases, drain its current operation, stop that exact LaunchAgent, restore the saved predecessor plist, pass the same ownership/protection/deadline gates and restart its pinned predecessor release. Never restore an old database over production. The added shadow service can be stopped independently; its token-conditional owner cleanup preserves the private journal. The diagnostics server binds to loopback only. Statistical artifacts and the original comparator do not need a restart.
