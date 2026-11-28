# High-coverage M1 opportunity engine

Owner authority: 28 November 2026 request to implement/deploy broad opportunity generation and a separate WATCH funnel. Existing M1 PTS/REB/AST distributions, production 3PM, V1.5 shadow, qualification, source allowances, exposure, settlement and delivery rules remain frozen.

## What changes

- Every captured player/fixture/prop/line/side/bookmaker/settlement identity is an opportunity. Prices, receipt snapshots and forecast revisions are observations of that identity, not extra opportunities. Both sides and every genuinely captured line are retained. No additional market keys, bookmaker or acquisition allowance is requested.
- Identical repeated outcomes coalesce; conflicting same-clock prices still hold. The latest original market clock wins across snapshots; retrieval never extends expiry. Conservative name formatting normalisation permits unique spelling/diacritic/punctuation matches within the exact source-verified fixture roster. It never drops suffixes, guesses a player or resolves an ambiguous name.
- A mixed retained-price batch evaluates and issues ready candidates through the existing engine while missing M1 forecasts catch up. Retry is five seconds inside original quote/stage/pre-tip clocks. Ten genuinely known player-games can justify waiting even when the old forecast cache has no row. No retry purchases another snapshot.
- M1 alternates a current-priced catch-up batch with ordinary fair slate work. The hint is read-only and must reference an authenticated, unexpired LIVE_STAGE quote. It cannot change features, weights, PMFs or qualification. Missing/busy hints fall back to ordinary scheduling; archived WATCH rows never request priority.

## Authority and evidence

`rankAndIssue` still delegates mathematical qualification to the unchanged `assessSuggestion`/`assessOffer` and recommendation creation to the unchanged `issueQualifiedSuggestions`. The existing source revalidation, family, placement, exposure, outbox and Telegram guards remain authoritative. Exact source comparisons of those functions and frozen statistical files are deployment evidence, rather than a claim that the entire operational module is unchanged.

The private `EDGELAB_OPPORTUNITY_JOURNAL` is separate from source SQLite and the M1/V1.5 journals. Immutable opportunity, observation, evaluation and normalization-exclusion records retain quote hashes, actual forecast IDs, prices/clocks, probabilities, EV, sensitivity scenarios and every gate. Writes require the actual source-cycle/market lease token. An issued recommendation remains a source-ledger fact; a numerical pass is not a delivery or wager.

`/watch` is loopback-only research presentation. It distinguishes legitimate live-stage evaluations from archived research, displays expiry/evaluation clocks, and exposes data/identity/freshness, minutes/uncertainty, probability/price, EV, sensitivity EV, disagreement and duplicate/correlation/exposure gates. Unknown evidence remains unknown. WATCH cannot send notifications or create claims.

A bounded idle market-worker intake processes distinct retained candidate records with a resumable private cursor. It yields near protected market deadlines, makes no network requests and does not invoke issuance. Preload/replay uses physical read-only source access. Historical source context is not reconstructed from current injuries/rosters. Recorded old verdicts and newly computed numerical diagnostics are explicitly different evidence.

## Validation and interpretation

Focused tests cover alternative lines/sides, duplicate snapshots, conflicting prices, ambiguous roster names, simultaneous gate failures, immutable/no-authority WATCH records, owner loss, unexpired-priority fairness, and mixed batches that issue ready offers while another player refreshes without re-paying or re-sending.

Retained replays count unique opportunity identities separately from observations. Original 23 November recommendations are reconciled in AEDT. M1 did not exist for that original cohort and is never backcast as an authentic prediction. Matched later comparisons use actual pre-event M1 and same-input original controls, authentic quote timestamps and genuine final evidence. Unavailable historical source context blocks a full counterfactual qualification claim. Only actual issued positions receive portfolio hypothetical ROI; opposite sides/rejected lines are descriptive diagnostics.

Probability-band and worst-scenario sensitivity restrictions are examined without fitting or changing thresholds. More observations or recommendations do not establish predictive advantage. Any future rule experiment must freeze its cohort and rule before outcomes, evaluate proper scores/calibration and selection results with fixture/date uncertainty, preserve source/exposure constraints, and remain separate from this inspected replay.

## Guarded deployment and rollback

Use an isolated worktree, full verification, pinned archive, fresh online source and M1-journal backups with integrity/SHA checks, original statistical/configuration/protection proofs, current service identities, natural owner release and existing market/isolated-M1 gates. Never interrupt a protected stage, steal/delete a lease or restore old SQLite over production. Source/comparator/V1.5 workers remain running.

Update only the market, M1 operational-plan and loopback dashboard release pins/environment. Observe at least165awake seconds and repeated actual cycles, private-journal intake progress, immutable lineage, correct frozen routing, renewing owners, bounded memory, unchanged paid accounting and no duplicate messages. If no live market stage is due during observation, identify that limitation: historical research cycles are not live quote qualification.

Rollback is code-only via the saved predecessor plists after the same fresh-backup, owner, source/protection and deadline gates. The opportunity journal remains immutable evidence. Disable the added operational hint only by a guarded service/environment rollback; statistical artifacts and the original trial window never change.
