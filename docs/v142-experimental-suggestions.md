# V1.4.2 — Experimental NBA suggestions

22 November 2026, Australia/Melbourne. Continues `codex/nba-wide-research` from `2a5d48f`.

## What is running

The owner-controlled **`liveSuggestionsEnabled`** feature is separate from qualified model promotion, research-status delivery and global qualified-alert delivery. It is enabled in the existing Signals SHADOW worker. The current frozen provisional models can produce experimental priced suggestions without a qualification certificate. Qualified alerts remain disabled and their existing validation gates are preserved. New installations default to the experimental feature being off.

The first controlled genuine cycle completed source retrieval → forecast → exact price normalization → screening/ranking → immutable issuance → Telegram submission → ledger registration. It issued **two suggestions** from **86 priced Over/Under quote-side candidates** for Atlanta–Detroit. Both were included in one consolidated Telegram message, which the provider **accepted**. Telegram acceptance does not establish device delivery or reading.

**The complete live lifecycle is not yet verified:** both suggestions remain pending on the same fixture. The first fixture is scheduled for 07:30 Melbourne on 23 November by BDL (07:40 in The Odds API). No genuine settlement, realised hit rate, ROI or model edge is claimed. Settlement and corrections pass isolated integration tests; genuine final-stat observation must complete the live check.

## Actual data and acquisition evidence

- Historical database: **16,035 genuine player-games**, unchanged during this task. The existing worker had acquired additional 2025 data before the task began.
- Existing genuine fixture feed: **29 scheduled fixtures** and **525 active-roster members**. Zero forecasts initially reflected future T−90 timing, not a broken roster endpoint.
- Initial independent SHADOW registration: **96** conditional forecasts for the first fixture, generated before tip-off from retained receipts without a network call. These remain a separate evidence class.
- New experimental registration: **568 forecasts**, four props for **142 players across five fixtures**. Each prop has 142 forecasts. These overlap the SHADOW population; the two classes are not independent samples.
- Sportsbet: all four requested market families were genuinely observed for the reviewed fixture. **86** normalized quote sides (43 two-sided markets across 12 players) were assessed and retained for candidate-level evaluation; **two** passed. Their original published/retrieved clocks, lines, prices, source receipts and frozen inputs are immutable. They are historical issued prices, not a claim that those prices remain available.
- BDL verification: **one request**, using the existing 100/day allowance and 13-second cooldown; no cap increase. The existing day usage rose from 90 to 91.
- Public Sportsbet rules: one read-only public article API request, retained as a genuine source receipt. [NBA rules](https://helpcentre.sportsbet.com.au/hc/en-us/articles/115013564287-Sports-Novelties-Rules-Terms-Conditions), Basketball – US rules 2, 6 and 15 establish overtime, pushes and non-participation voids for standard full-game player-performance markets. Specials, periods, milestones and unsupported market families are excluded.
- Owner-approved shared allowance: at most **five Odds API requests / nine credits for one hour**. Actual use: **five requests / eight credits**. Last provider headers: **468 remaining / 32 used**, observed at 17:19 Melbourne. The request allowance is exhausted, despite one unused credit. No further acquisition is authorised by that grant.

The event-discovery step exposed an actual ten-minute source-clock discrepancy. The request stopped before paid price acquisition. An explicit **experimental** bridge now requires unique exact home/away names and canonical team identities on the same UTC date, the original native fixture ID and original Odds event ID, retained discovery/fixture receipts, and a later sportsbook clock no more than 15 minutes after the native scheduled clock. This is a source-backed inference of the same physical fixture; timestamps are **not** declared equal or rewritten. Both clocks remain in the mapping proof, and the earlier native time governs pregame expiry. Duplicate/ambiguous pairings, earlier sportsbook starts, larger differences and changed discovery metadata are rejected. Qualified normalization remains strictly timestamp-matched and rejects these experimental bridges.

The existing genuine discovery receipt was reused after that fix. A zero-credit account refresh restored fresh quota evidence; actual price responses supplied market-discovery evidence, saving the standalone catalogue request. Prior quota reservations were preserved. No counter reset or extra allowance was used.

## Forecasting and selection

Experimental policy is `nba-experimental/1.4.2`, using existing `prop-research/1.4.0` artifacts:

| Prop | Deployment estimator | Frozen comparator |
| --- | --- | --- |
| Points | Existing selected ensemble | Last-10 control and selected distribution |
| Rebounds | Existing selected ensemble | Last-10 control and selected distribution |
| Assists | Existing EWA simple control | Existing selected challenger |
| Made threes | Existing season-shrunk simple control | Existing selected challenger |

The latter controls are justified by the existing provisional research in which the assists challenger underperformed and the threes challenger did not establish improvement. This is an explicitly versioned experimental deployment choice, not independent validation or model promotion. Calibration fitted to a different estimator is not transferred onto the controls. New forecasts freeze the chosen, baseline, challenger and minutes-sensitivity distributions with the original artifact and causal source references.

All eligible player-prop forecasts are retained, including non-recommended candidates. History/form, current-season support, home/rest information, roster changes, historical minutes and uncertainty are derived from genuine earlier observations. Opponent identity is verified; defensive matchup, pace, teammate usage and game-specific availability effects are not established and are not fabricated or applied. The active roster does not prove game availability. A fresh completed injury feed is required; listed injury cases are vetoed, including Probable/Questionable. Omission from that feed remains **unconfirmed availability**.

Probabilities and EV are conditional on participation. No missing participation denominator becomes certainty. Verified DNP-void terms are required. Messages explicitly say “if plays”, and name the model experimental/validation limited. A fresh positive game-availability source would improve this limitation; it is not represented as configured.

The initial version requires ten complete earlier participating games, five current-season games, recent history within 30 days, estimated minutes at least 18, minutes SD at most six and no unresolved team change. Prices must be 1.50–2.40, estimated conditional win probability 55–85%, estimator disagreement at most 12 percentage points, conditional EV at least 4%, and positive EV after the conservative model/minutes sensitivity diagnostic. That diagnostic is not a calibrated confidence bound. Both exact market sides are required for proportional vig removal and a fair-market comparison.

Ranking prioritises practical hit probability, with bounded EV, history support and disagreement components. There is **no daily recommendation cap or presentation limit**. One current selection per fixture/player/prop avoids contradictory duplicate positions. Only materially changed same-side opportunities after 15 minutes can create a linked update; original records remain in evaluation. The actual count of two came from the evidence, not a configured two-pick maximum.

The linked-update behaviour above is the historical V1.4.2 rule. [V1.4.5.1](v1451-permanent-recommendation-dedup.md) replaces it with permanent one-issue-per-fixture/player/prop suppression; consult that report for prepared versus live activation status.

## Scheduling, delivery and recovery

The existing 60-second heartbeat, seven Melbourne daytime windows, T−90/T−20 tasks, source TTLs/checkpoints, BDL quotas and cooldowns remain. Experimental work is bounded to one fixture per cycle for forecast computation; that is a work budget, not a pick limit. Ordinary acquisition follows the daytime windows or genuine pregame stages. The explicitly owner-approved foreground verification used its one-off manual invocation. Quiet hours remain 00:30–07:00; essential sources and forecasts can continue independently. Bookmaker requests are deferred when a quiet window would make delivery stale.

One finite acquisition cycle persists account → exact event discovery → catalogue/observed markets → prices → pre-issue refresh checkpoints. Every real request reserves allowance before transport. Interrupted work retains spent requests/credits. The guard protects the **entire 60-credit SportsModel ceiling plus a 100-credit account reserve**, verifies the old configuration/ledger read-only, requires fresh account headers before paid calls, and stops on stale/uncertain allocation evidence, changed credentials, expired grants or exhausted counters. This finite protection is not a genuine account-wide coordinator. Recurring paid collection remains disabled pending a separately reviewed allocation and coordination arrangement.

Suggestions and original inputs are written before sending. Consolidated messages are split to fit Telegram without truncating the opportunity list. Dispatch rechecks original price expiry, earliest fixture deadline, quiet hours, current roster/injury/fixture evidence and allowlisted recipient binding. Accepted, rejected, retryable, uncertain and expired states are distinct. Unknown/interrupted sends are held without blind resend. No automatic canary or fabricated message was sent. The one actual new Telegram message contained genuine priced suggestions.

The existing Signals LaunchAgent was restarted to load the new worker path. No new service was installed and no SportsModel process, file, credential, counter or schedule was changed. A sleeping Mac still cannot provide continuous operation; missed deadlines expire.

## Ledger and backend evaluation

`/opportunities` now focuses on NBA picks; `/ledger` shows all issued experimental suggestions and `/performance` separates model and optional execution results. The ledger includes original market/price/probability, outcomes, fixed hypothetical **A$5** P/L, Placed/Not Placed, optional accepted odds/stake and CSV export. These are tracking fields only; saving them never places a bet or changes model evaluation. No account connection or real-money execution exists.

Model ROI includes all settled issued suggestions, whether placed or ignored. Its denominator is A$5 per settled recommendation, including pushes/voids; pending results are excluded. Optional actual P/L is calculated only from entered execution fields and the independent result; it is not a verified bookmaker account cash statement. Unknown fields stay null. Original prices/probabilities/forecast versions never follow the user's execution edits.

Source-backed finals automatically grade won/lost/push/void. Unknown participation remains pending. Corrections append revisions and preserve the original grade. Material fixture-time changes hold reconciliation. Rescheduled future fixtures append new forecasts and invalidate old quote identities rather than rewriting issued inputs. State-changing ledger requests require a loopback Host, exact browser Origin and JSON; cross-origin writes are rejected. The Host-based origin check handles Next.js's internal hostname correctly. Annotations are append-only; CSV text cells are escaped.

Backend reports retain all-candidate CRPS, MAE, interval coverage, calibration, Brier/log loss, chosen/baseline/challenger metrics and date-clustered paired comparisons. Authentic quote-side candidates also receive later market-specific probability scoring, including non-recommendations. Opposite sides/lines/props remain correlated observations. Hypothetical ROI is calculated only for genuinely issued pregame-priced suggestions. No sample count or synthetic result promotes a model automatically.

## Commands and next activation

The following activation was executed for the approved bounded run:

```sh
npm run research -- suggestions-activate .local/v142/suggestions-grant.json --confirm
npm run research -- suggestions-status
```

The feature is now enabled; the grant's five requests have been consumed. Continued forecasts, scoring and settlement do not require new bookmaker credits. Further priced scans require a **new owner-approved finite grant and fresh shared-allocation evidence**. After that review, the exact command is:

```sh
npm run research -- suggestions-activate APPROVED_PRIVATE_GRANT --confirm
# Optional explicit foreground cycle; the existing worker also advances it.
npm run research -- suggestions-once --execute
```

`npm run research -- suggestions-plan` prepares the request plan without network access. `suggestions-enable --confirm` enables the feature with no grant and therefore no price acquisition. `suggestions-disable --confirm` stops the experimental channel. `deactivate --confirm` stops the overall research mode. Qualified alerts are not enabled by any of these commands.

The local dashboard uses `npm run start` after build (loopback only). Remote hosting still requires authentication and a reviewed storage deployment.

## Verification and remaining live proof

TypeScript, integration tests and production build are run through `npm run verify`. New tests cover the complete isolated source/price/issue/Telegram/settlement path, different per-prop estimators, genuine-shaped finite quota guards, expiry/reserve intrusion, independent placement tracking, source corrections, missing/stale/mismatched markets, injury vetoes, quiet hours, interrupted sends, source-clock bridges, rescheduling, CSV safety and CSRF/origin handling. Synthetic/mock evidence stays in isolated test databases.

Private evidence is under `.local/v142`: approval/finite grant, genuine forecast counts, exact source receipts in SQLite, individual acquisition checkpoints, the live cycle, candidate archival, verification logs and preservation checks. No private runtime files or secrets are published in Git or build traces.

The outstanding end-to-end live step is genuine settlement after the first fixture finishes. The issued original prices cannot be refreshed under the spent allowance. There is no current genuine held-out forward performance or profitability claim. The product can already issue/deliver/track genuine priced experimental suggestions, but the **entire live lifecycle must not be labelled verified until a genuine result is independently ingested and graded**.

## Observed final verification

- `npm run verify`: **155 tests passed**, zero failures, strict TypeScript and production build passed.
- Production HTTP checks passed for NBA Picks, Signals Ledger, Performance and System Status; CSV contained exactly the two genuine issued records. Same-origin requests were accepted; cross-origin writes were rejected; an unknown ID could not create an annotation. Actual user placement fields were not modified by verification.
- Thirteen build trace manifests contained zero private runtime files, and the configured credential/destination strings had zero occurrences in build output.
- All **16,035** original logs, **194** original bodies and **194** original retrieval receipts, four model artifacts and every pre-existing research row were hash-preserved. New fetches appended five body records and seven retrieval receipts. The environment file and both recipient-verification bindings were unchanged. All existing normalized operational configuration was preserved except the explicitly added experimental feature/grant controls.
- The existing Signals worker is active with the feature enabled. Its last post-activation acquisition cycles used zero additional provider requests. Persistent Odds collection and qualified alerts remain off; BDL remains 91/100 for the UTC day with the original cooldown.
- Disabling new suggestions stops issuance/delivery but the independent research scoring job continues settlement and candidate evaluation for already-issued records, provided the overall research service remains active. A regression test covers this control boundary.
- Genuine live counts remain **568 experimental forecasts / 142 players / five fixtures**, plus 96 separately classified SHADOW forecasts; **86 quote sides / 43 exact two-sided markets / 12 priced players**; **two issued, two pending, one Telegram-accepted batch**. There are no genuine graded results yet.

Final machine-readable evidence is private in `.local/v142/release-readiness.json`. SportsModel separation, the original quota reservations and the absence of fabricated outcomes remain intact. The reviewed request allowance is spent; no remaining credit authorises another request.
