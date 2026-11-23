# V1.4.7 targeted experimental forecasting

Continuation baseline: `f6565f6`, following `888d31f`. Owner authorisation is the V1.4.7 brief and its continuation. Runtime deployment evidence is private in `.local/v147`; source preparation is not proof of activation. Read its final deployment record for actual release identifiers/PIDs/counts. No profitability or independently certified promotion claim is made.

## Model decision

| Market | Selected recipe | Decision |
| --- | --- | --- |
| Points | Existing selected ensemble, original sigmoid calibration | Retained. The development EWA CRPS beats the repaired blend; no clean matched comparison against the actual deployed frozen ensemble justifies another change. |
| Rebounds | Existing selected ensemble, raw calibration | Retained. Reject repaired isotonic blend: NLL 2.8636 versus previous advanced 2.2359, despite CRPS 1.3533 versus 1.3660. |
| Assists | 25% repaired quantile-minutes/NB + 75% EWA, raw calibration | Provisional experimental candidate, only with frozen genuine pregame records and valid source evidence. Otherwise original EWA. |
| Threes | Existing season-shrunk, raw calibration | Retained. Repaired advanced CRPS/NLL 0.65874/1.40811 versus previous advanced 0.65849/1.40781; standalone integrated attempts 0.67965/1.4333 trails EWA 0.66430/1.41604. These are not a clean comparison against the actual deployed season-shrunk artifact. |
| Minutes | Repaired quantile PMF inside the assists component; existing recent-ten eligibility mean unchanged | No wholesale minutes replacement. The repaired full minutes blend NLL improves greatly but does not dominate simple MAE or old ensemble CRPS. Other prop-specific quantile distributions remain diagnostic controls. |

Actual old production uses original ensembles for points/rebounds, EWA for assists and season-shrunk for threes. “Previous advanced ensemble” in the V1.4.6 benchmark is a research comparator, not a claim that it was deployed.

Matched assists evidence, 400 player-games / 239 players / 116 fixtures / 17 UTC fixture dates:

| Metric | Actual original recipe: EWA | Candidate | Previous advanced research ensemble |
| --- | ---: | ---: | ---: |
| CRPS | 1.003815 | 0.989533 | 0.991368 |
| NLL | 1.871028 | 1.851178 | 1.856140 |
| Brier, fixed research thresholds | 0.118584 | 0.117201 | 0.116974 |
| Binary log loss | 0.375246 | 0.368553 | 0.368817 |
| ECE | 0.038868 | 0.024881 | 0.030999 |
| 80% interval coverage | 88.00% | 90.25% | 89.00% |

Exploratory date-cluster bootstrap candidate minus EWA: CRPS 95% interval −0.02201 to −0.00668; NLL −0.03608 to −0.00772; Brier −0.002139 to −0.000587. Against the previous advanced research ensemble, fixture-cluster CRPS interval −0.00765 to +0.00370 and NLL −0.01446 to +0.00300 include zero. The candidate slightly worsens Brier against that advanced comparator. Intervals are descriptive: the development holdout was reused after inspection, model selection and tail repairs. These are not independent confirmation, betting-edge intervals or proof of better returns. One-date/one-fixture prospective intervals explicitly remain unavailable.

## Immutable future artifacts and routing

The real Mac subprocess rehearsal found a pre-existing metadata bug: the final-game collector retains `/games/:id` as a single `data` object, but `researchRows()` assumed every receipt contained an array. This prevented inference after new final statistics were ingested. The reader now handles both retained shapes, treats unsupported payloads as unavailable metadata and preserves all original bytes, clocks and normalized log rows. A regression covers single-game Cup classification and unsupported payloads.

V1.4.7 freezes already-known fitted weights and the selected raw quarter-weight assists recipe with the actual publication clock, complete retained-data references, original model identities and pinned forecasting code. The fitting/selection dataset includes retrospectively acquired history; publishing it now does not make that information available before historical games. It can legitimately support future games after actual publication. The protocol records external frozen development parameters, rather than claiming a new strict historical refit.

`productionCode()` and `verifiedPlan()` use the same complete source/runtime manifest. A plan generated with the old research-only manifest is rejected. Every source, worker, inference, routing, scoring, settlement and runtime package file is covered. Source changes or omitted entries fail verification. Source and journal paths must differ; the comparison source handle is physically read-only. Provider credentials are rejected in the supervisor and stripped from children; fetch is disabled. No provider or transport method is called.

The comparison worker produces immutable same-input, same-cutoff active/original pairs for all four props, independently of prices. Original frozen main-store forecasts stay unchanged; their references and different cutoffs are recorded separately when present. Input manifests contain sorted complete body/source clock references, compressed once by content hash. Model parameters and original model artifacts are stored once, not copied into every forecast. Registration validates retained fixture/roster identity, prior feature clocks, fitting references, model/code identities and the actual two-minute pregame deadline before and after its transaction.

The market router performs bounded read-only lookup of precomputed records, verifies identities/hashes, the input manifest, matched control and current fixture/roster evidence, and retains the original on failure. Points/rebounds/threes use unchanged original model parameters; precomputed same-input versions can have newer genuine input cutoffs. Only the assists model recipe changes. Recommendation disagreement keeps the original simple/selected controls. Sensitivity distributions perturb minutes once and condition on supported minutes rather than clipping tails into boundary atoms. The existing conservative-EV penalty remains a heuristic, not a calibrated confidence bound.

`production:routing-latest` records actual market lookups with advanced-assists, original-precomputed, fallback, source-blocked and artifact-mismatch counts plus individual reasons. These are lookup counts, not independent forecasts or issued recommendations. The website exposes this distinction. No configured flag alone means advanced forecasts were used.

## Independent supervision and automatic evaluation

Dedicated label: `com.edgelab.signals.comparison`. Journal-only 150-second ownership lease; heartbeat/renewal every five seconds. Four registration attempts per batch, nominal minimum 15-second cadence (960 attempts/hour before runtime, unavailable inputs and production preemption). Failed source identities checkpoint against actual input fingerprints, preventing an ineligible early player from starving the rest. Completed identities survive restarts.

Low-priority disposable children have a 512-MiB V8 heap, kernel CPU limits (35 seconds registration / 75 seconds report) and wall limits (45 / 90 seconds), followed by SIGTERM then SIGKILL after one second. Heap bounds are not total RSS bounds; RSS is measured in each task. Transactional journal fences reject expired/stolen ownership and crossed deadlines. A sleep/wake gap cancels the current child; expired ownership cannot be resurrected. Current or imminent ten-minute production work preempts comparison tasks. Stopping/failing this worker cannot stop the original market or SHADOW service.

Five-minute bounded reconciliation uses only existing verified final statistics. Reports are timestamped under `.local/v147/reports/`; the latest committed report is referenced in journal metadata and health output. They separate matched pairs, pre-existing different-cutoff originals, original issued counts, void/pending/held outcomes, prop metrics, minutes diagnostics, fixed-threshold calibration, exact observed-market Brier/calibration and fixture/date-cluster uncertainty. Four-prop minutes diagnostics are correlated, not four independent minutes samples. A bounded grading cursor can require several cycles to reconcile a large slate; pending counts remain explicit.

Only genuinely retained, exact two-sided Sportsbet prices captured while still fresh and pregame can register hypothetical model decisions. Existing qualification/source/quiet-hour tests apply, with independent first-family claims per comparison model. They never create production suggestions/outboxes or ledger entries. No historical prices or late positions are fabricated. Reports preserve original lines, prices, clocks, settlement and append-only corrected outcomes. Later incomplete finals hold the current selection result. Hypothetical A$5 returns use actual registered quotes; populations selected by different models are not paired strategy returns. Multiple lines are distinct prices and correlated targets. No automatic retraining, reweighting or promotion occurs.

Coverage reports list discovered fixtures, roster players, history-eligible conditional opportunities, registered/unprocessed counts, stale fixtures/rosters and exact holds. This is not verified playing availability. Original final-stat collection remains unchanged: a comparison-only fixture can stay pending until the existing production collector independently collects its final. This task adds no collection requests.

## Telegram and website

Compact text is applied only while inserting a new immutable outbox. Legacy text still determines existing pagination, batch order and identities. If the compact formatter would split/change that batch, legacy text is retained. Existing bodies, IDs, bindings, accepted/uncertain states, retry safeguards and permanent family claims are never rewritten. Underlying recommendation evidence freezes the actual routed distribution/model/version. No SHADOW recommendation enters Telegram.

Website navigation is Bet Log, Performance and Service status. Watch stays absent. Bet Log remains issued-only/newest-first with existing filters, CSV, grades and chronological cumulative accounting. Performance separates original historical positions from first-family analysis. Advanced comparisons and unissued observations stay backend-only. Status performs lightweight journal reads, without importing the supervisor or walking manifests.

Build in a private-free isolated source/dependency copy, preserving relative dependency symlinks. The website root is explicit, preventing a nested release from inheriting another checkout's Turbopack root. Never build into or overwrite the serving `.next`.

## Controlled activation and rollback

1. Verify clean branch/commit, source manifest, passing full `npm run verify`, exact frozen replays, actual process identities and private configuration/model hashes. Create and integrity-check a fresh online SQLite backup. Keep rollback code/website build and original market plist.
2. Publish versioned artifacts with genuine current clocks; install only the independent comparison label. Verify actual Mac subprocess execution, ownership, resource limits, source isolation, heartbeats and genuine registration or precise source holds. No paid probes.
3. Deploy the website as a separate loopback release; verify Bet Log/CSV/Performance/Watch-404. Original market/SHADOW remain running throughout the website switch.
4. Market cutover requires a healthy comparison worker and valid genuine future assists records. Recheck no acquisition, delivery or quota reservation, no active source job or pregame deadline within ten minutes, fresh worker heartbeats and unchanged private policy/credentials/models. `deploymentSafety()` is used before and after stopping the old market. Record owner approval from the supplied briefs, bind candidate/rollback files and actual old process birth identity.
5. Stop only the verified market LaunchAgent; verify complete old-process exit and released ownership. Enable the approved routing pointer only after all guards pass; bootstrap only the pinned market replacement. SHADOW/V6 are untouched. Observe at least 165 awake seconds and actual router selections. Never send synthetic live picks or test messages.
6. Failure: stop/verify exit of only the candidate market, disable its routing pointer, restore/bootstrap only the retained original market plist. Keep all new journal predictions, grading revisions, compact texts, family claims and main-store records. Never restore a database backup over live records or remove deduplication protections. Comparison and website can be rolled back/stopped separately without touching SHADOW.

Health: `node --import tsx scripts/comparison-service.mjs health .local/v147/comparison-plan.json`, `npm run reliability -- health`, `npm run research -- recurring-status`. Service runtime uses the pinned release entry, not a mutable working-tree script. Final release/process/coverage evidence and exact rollback file paths are in `.local/v147/deployment.json`.
