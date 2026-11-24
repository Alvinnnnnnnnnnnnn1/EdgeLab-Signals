# V1.4.8 — dormant Australian bookmaker intelligence

## Operating boundary

Development is isolated on `codex/v148-four-bookmaker` in a separate worktree. The live checkout, installed LaunchAgents, environment/private configuration, schedules and ownership are not changed. The current market and comparison workers remain pinned to `89f83e0`; reliable research remains V1.4.5. The market service also starts some diagnostics from the live checkout, so editing that checkout would not have been sufficiently isolated.

The private pre-development baseline and online SQLite snapshots are in the original checkout's `.local/v148`. They capture process birth identities, LaunchAgent/config fingerprints, model hashes, original immutable rows, job identities, leases and the independent comparison journal. The initial snapshot contained 65 recommendations, 2,016 original experimental forecasts and 1,540 prospective pairs; these are timestamped observations, not fixed totals. Legitimate ongoing appends are expected.

`protected-cycle.json` permanently captures ten protected fixture identities and all 45 already-observed market job identities. A calendar change, new line, rescheduled start, new bookmaker or changed stage label cannot remove those exclusions. Every captured job continues in the original Sportsbet path. The new feature is eligible no earlier than 25 November 2026 Melbourne, for a genuinely new, unstarted stage. It additionally requires the protected current-day jobs to be retained and terminal, no reopened protected fixture jobs, and retained BDL final evidence for every protected fixture. Missing finals, missing history or an unfinished cycle fail closed. No original job is rescheduled or backfilled. A later new stage can reuse only price observations proved by immutable decisions from its own activated cycle; legacy price history cannot be relabelled as new work.

## Four bookmakers; one downstream comparison

The exact allowlist is `sportsbet`, `tab`, `neds`, `ladbrokes_au`. The existing offline adapter/normalizer is extended to Neds; the existing Sportsbet-referenced research benchmark remains explicitly a legacy benchmark. The new `multi-bookmaker/comparison.ts` selection engine does **not** require Sportsbet.

Only `basketball_nba` and points/rebounds/assists/threes are supported. All four books share an event-scoped request, using the existing authenticated typed HTTP client, timeout, cache, cooldown, receipt storage and quota ledger. No polling worker, second bot, account login, execution integration or new provider is introduced.

Player descriptions must resolve uniquely to authoritative current roster IDs and teams. Exact provider event discovery, home/away identity, current canonical BDL fixture and retained mapping proofs are required. The existing explicit source-clock bridge retains both clocks and uses the earlier canonical deadline; it is not a new relaxed identity rule. Every accepted quote must re-normalize exactly from its retained original body. Similar names, missing sides, conflicting duplicates, changed teams/fixtures, missing clocks, unsupported prices or ambiguous terms are excluded.

Terms are independently retained per bookmaker/prop, with full-game overtime, integer push and verified DNP-void semantics. Do not copy Sportsbet rules to another bookmaker. Missing per-book terms block that market, not the entire feed. Malformed individual book/market payloads are isolated where their identity is known; valid sibling markets/books remain usable. A malformed common event or unexpected bookmaker fails closed.

Availability states are `AVAILABLE_VERIFIED`, `NOT_OBSERVED`, `STALE`, `IDENTITY_AMBIGUOUS`, `MARKET_MISMATCH`, `SOURCE_ERROR`, `QUOTA_BLOCKED`. An absent book/prop is not declared permanently unsupported. Availability is separate from passing recommendation qualification; a real valid price can still be unqualified.

Both sides are required for proportional de-vig. Original pair protections and the 30-second retrieval/quote-clock comparison tolerance remain. For a given exact line/side, the newest coherent snapshot anchors comparison; asynchronous offers outside 30 seconds are excluded rather than compared to a favourable older price. Among eligible same-outcome offers, highest decimal price wins. Ties use newer pair quote clocks, then newer retrieval, then alphabetical bookmaker key, then immutable quote hash. All survivors have the same mandatory evidence-quality floor; Sportsbet receives no preferred tie rank.

Different lines are separate selections, evaluated directly against the existing frozen count PMF. The unchanged original risk-weighted score ranks their qualified winners; raw odds or point-estimate EV alone do not rank them. Each selection retains its own line/side, outcome masses, odds, fair market probability and EV. The shared permanent fixture/player/prop claim permits at most one issued recommendation across all books, directions and lines.

## Models and immutable evidence

No mathematical forecasting, feature, calibration, artifact, original SHADOW or comparison-worker code changes. Existing production routing is reused: original points/rebounds/threes and the available V1.4.7 quarter repaired-minutes/NB + three-quarter EWA assists distribution, with original fallback. Model probability is identical for the same line/side regardless of the chosen book.

The original recommendation assessment is factored behind a bookmaker identity parameter. The legacy Sportsbet wrapper retains its behaviour. The new allowlisted wrapper uses the same history/current-season/minutes/role/injury, disagreement, practical probability/price, EV, heuristic sensitivity and fair-market gates. Conditional-on-playing probabilities and the existing conservative-EV heuristic remain labelled as such. No calibrated lower confidence bound, new selection cap or stricter model policy is introduced.

Additive `multi_bookmaker_stages`, `multi_bookmaker_requests`, `multi_bookmaker_decisions` and `multi_bookmaker_progress` tables are initialized only on a future authorised new-stage path. No migration is executed against live SQLite during development. Claims/request associations/decision evidence have update/delete guards; progress is recoverable mutable state. Decisions retain source/discovery receipts, canonical stage/cycle/activation identities, model/input/artifact references, original probabilities, all qualified offers, exclusions, selected exact price, alternatives and intended delivery decision. Actual immutable recommendations/outboxes remain the authoritative issuance/delivery history. Failures retain a blocked decision when the stage has been claimed.

Quota reservation and the extension's request association commit in the same original SQLite transaction. Finite scope usage is derived from the existing quota rows and their response accounting, including conservatively retained uncertain reservations. There is no parallel uncoordinated credit balance. Existing account freshness, full V6 allocation, reserve, daily/monthly ceilings and T−20 credit preference are retained. Owner/authority checks fence stage writes and new recommendation/outbox creation; original family claim/outbox transactions remain the issuance path.

A recovered successful response is reused without a new request. A transport/schema/rate-limit failure or empty response does not authorise repeated paid probing; uncertain debit blocks later spending. A completed stage remains completed. Turning the feature off after a stage claim blocks that extension stage, rather than silently making a second paid Sportsbet request for it. Other legacy jobs continue normally.

## Four disabled controls and future authority

`config/local.example.json` documents `multiBookmaker`:

- `codeEnabled: false`
- `paidAcquisitionEnabled: false`
- `comparisonEnabled: false`
- `telegramEnabled: false`

All book-specific `enabledMarkets` arrays default empty. No private production configuration is edited. Three private paths (`protectionFile`, `activationFile`, `grantFile`) default null. Authority files must be owner-private; activation/grant schemas require explicit owner approval, finite times, exact activation/protection/policy bindings and the existing API-key fingerprint. No separate bookmaker keys are needed.

A future controlled activation must verify the exact pinned code/process and set `multi:active-release` to the reviewed commit and protection hash. Flags alone cannot substitute for that marker. Activation may never reinterpret an existing protected job as a new cycle. The grant must name the allowed canonical event IDs and finite request/credit maxima; it stays inside the existing gross policy and immutable stage/grant binding. Editing a grant cannot reset its spent allowance. No approved grant or activation is produced by this implementation.

Register independently reviewed bookmaker settlement evidence in `multi:terms`. Retain the original four Sportsbet term identities if Sportsbet market benchmarks must continue matching the independent V1.4.7 comparison worker. Enable only the individually verified book/prop combinations. The event `/markets` catalogue is recently seen-key evidence, not proof of complete executable coverage.

## Cost plan; not new spending authority

[The provider's V4 guide](https://the-odds-api.com/liveapi/guides/v4/) groups up to ten requested bookmakers into one billing-region equivalent. For these four books, conservatively reserve up to four credits for a response containing all four requested prop markets. Actual returned-market charging is reconciled from the original response headers; do not assume that adding books is always free when it expands the returned market union.

Two existing stages cost up to **8 credits per fixture**, plus an optional one-credit catalogue call. Account/event discovery calls add bounded request counts even when their credit cost is zero. They count toward the finite allowance. The shared request replaces an eligible original stage request; it does not add four book-specific scans. For model-comparison stages, the original history/minutes/current-player source gates run before any provider request. An unavailable or insufficient candidate population therefore cannot consume acquisition credits. A separately authorised coverage-only stage does not run model qualification, ranking or issuance.

| Strategy | Maximum price credits/day | 30-day price credits |
| --- | ---: | ---: |
| One selected fixture/day, both stages | 8 | 240 |
| Three fixtures/day, both stages | 24 | 720 |
| Thirteen fixtures/day, both stages | 104 | 3,120 |

The authoritative baseline gross Signals envelope is 340 credits, with the full V6 60-credit allocation and a further 100-credit reserve protected. Signals had already charged 77 credits at baseline; the 263-credit arithmetic remainder is not fresh spendable account evidence or a new allowance. Existing commitments also consume that envelope. Full-slate monthly coverage does not fit it. A separately approved, bounded candidate-first event list must be reviewed against current shared usage and pending original stages. Do not raise caps automatically.

Offline planner: `node --import tsx src/multi-bookmaker/cli.ts plan 1 30`. It has no acquisition command or credential requirement. No paid coverage probe is performed during this task.

## Telegram and website preparation

New-book offers use the existing suggestion family claim, immutable recommendation, consolidated batch/outbox, private destination binding, sender verification and transport. No new sender/outbox exists. The new renderer identifies the selected bookmaker, exact line, conditional model probability, odds, break-even, push-aware EV, other qualified same-line prices, unchanged rationale and Melbourne comparison/expiry clocks. Unavailable alternatives are omitted. No bookmaker links are manufactured.

Before issuance and before dispatch, new records recheck active authority, original eligibility, source freshness, exact T−2 deadline, the current injury/roster/fixture proof, original delivery ownership and family-delivery protection. Stored alternative prices must also remain valid or the outbox expires; old immutable text is never rewritten to hide a stale alternative. Known retries and uncertain/accepted-send suppression remain unchanged. Quiet hours are 00:30 inclusive to 07:00 exclusive in Melbourne, including DST. No live test message is sent.

The prepared System Status section shows disabled/configured state, per-book/market coverage, last comparison/source clock, selected/excluded counts, ledger-derived extension usage, authority blocker and earliest new-cycle conditions. No simulated coverage is displayed as live availability. Existing Sportsbet operation is explicitly separate. Watch is not restored.

The prepared Bet Log displays the issued bookmaker while preserving chronological cumulative accounting and newest-first filtering. Sportsbet-only CSV output retains its original format. If non-Sportsbet issues exist, the export uses a generic original-odds label and appends the exact bookmaker column. Original rows/prices/probabilities/grades are not rewritten. Research-only decisions never enter Bet Log or Performance.

## Controlled deployment and rollback

The complete release is **PREPARED**, not loaded into the current workers or website. Loading the extension into the pinned market process requires a controlled restart, forbidden in the protected operating cycle. Do not restart research or comparison simply to introduce market intelligence.

Before a later activation:

1. Verify committed code/release manifest, disabled flags, current PIDs/LaunchAgents, backups/integrity and unchanged models/policy/credentials. Re-read actual live usage and next deadlines.
2. Preserve this captured protection file/hash. Prove current-day market jobs/finals complete; leave every protected/pre-existing job in its legacy path.
3. Obtain a new explicit finite shared allowance bound to the current policy and protection/activation. Fresh account evidence and the existing coordinator must protect both applications; otherwise stop.
4. Independently review terms and use the approved bounded shared request to establish genuine event-specific coverage. Catalogue entries alone do not enable a prop.
5. In an explicitly approved future market-only maintenance window, install the pinned dormant code, verify ownership/health, and bind the reviewed activation metadata. No busy acquisition/delivery or imminent deadline may be interrupted. Research/comparison remain untouched.
6. Enable acquisition/comparison for the approved new cycle; enable Telegram only after coverage and controlled integration checks, under existing recipient/transport permissions. Never backfill missed stages.

Scoped rollback disables all four feature flags and the active release marker, retaining current working V1.4.7/model fixes. Already claimed extension stages fail closed; pending extension messages expire, accepted/uncertain records and permanent family claims remain. Existing unclaimed Sportsbet stages continue normally. Preserve all legitimate receipts/decisions/grades. Never restore an old database over live data or revert blindly to `13db5ff`, which contains the previously diagnosed single-game metadata defect.

Private execution evidence records before/after historical-row preservation, current leases/PIDs and legitimate appends separately. A healthy build or a synthetic integration test is not a live coverage claim. TAB, Neds and Ladbrokes NBA props remain **UNVERIFIED** pending the separately authorised validation.

## Verification and readiness record

`npm run verify` passed: 326 tests (including 40 four-bookmaker cases), TypeScript and the production Next.js build. The isolated four-bookmaker tests deny unmocked network access. They exercise source/identity/settlement exclusions, incomplete feeds, shared finite quota fencing, response recovery, unchanged probabilities/risk gates, deterministic ranking, one-family issuance, original outbox bodies, quiet hours/DST, expiry and the protected-cycle barrier.

A temporary loopback production server used a detached copy of the pre-development database and comparison journal, with acquisition/delivery disabled. Bet Log, Performance, System Status and CSV returned successfully; Watch remained 404. Sportsbet-only CSV was byte-identical to the original-code export from the same snapshot. All 13 production dependency traces passed the private-file exclusion check. The temporary server was then stopped; the production website was untouched.

The read-only audit at 12:18 AEDT on 24 November found unchanged process birth identities and launch counts for market, reliable research and comparison, unchanged website PID, valid parent leases with their original tokens, normal research health and healthy comparison. All captured historical bodies remained byte-identical: 16,317 player-game records, four original model records, 65 recommendations, 56 grades, 2,016 experimental forecasts, 608 SHADOW forecasts, 79 original outbox bodies/bindings and 1,540 prospective pairs, including their original comparison manifests/artifacts. Original market job identities/deadlines and quota reservations were preserved. No extension schema or activation marker exists in live SQLite. All captured private configuration and LaunchAgent fingerprints matched.

Existing authorised workers legitimately appended another recommendation, receipts, candidates and quota rows during development. At that audit there were 66 recommendations and 85 monthly charged Signals credits, compared with 65 and 77 at baseline. This task made **zero authenticated provider requests, spent zero additional credits and sent zero real Telegram messages**; ongoing original-worker traffic is not represented as zero. No original model or worker service was changed, and SportsModel V6 was not modified.

| Bookmaker | Adapter / offline verification | Genuine coverage evidence | New shared acquisition / comparison |
| --- | --- | --- | --- |
| Sportsbet | Implemented / passed | Existing independent production path; V1.4.8 shared scope unverified | Not authorised / dormant |
| TAB | Implemented / passed | UNVERIFIED NBA props | Not authorised / dormant |
| Neds | Implemented / passed | UNVERIFIED NBA props | Not authorised / dormant |
| Ladbrokes Australia | Implemented / passed | UNVERIFIED NBA props | Not authorised / dormant |

Private baseline, protection manifest and after-audit evidence are retained under the original checkout's `.local/v148`; test/build/HTTP evidence is under the isolated worktree's `.local`. These paths and databases are excluded from Git and release contents. The pinned source release and its per-file manifest are staged separately after committing. No owner-approved authority is manufactured. The prepared market extension, formatter and website changes have **not** been activated or loaded into production. All four new flags default false and every per-book/prop enablement defaults empty.
