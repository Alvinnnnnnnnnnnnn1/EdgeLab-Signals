# V1.4.1 — Melbourne daytime research and market preparation

Implemented on `codex/nba-wide-research`, 22 November 2026 (Australia/Melbourne).

## Implemented scheduling

The local service still wakes every **60 seconds**. A heartbeat is not a provider request. Routine research is admitted in these Melbourne windows:

| Opens | Closes (exclusive) |
| --- | --- |
| 07:15 | 07:45 |
| 09:00 | 09:30 |
| 11:00 | 11:30 |
| 13:00 | 13:30 |
| 16:00 | 16:30 |
| 19:30 | 20:00 |
| 22:30 | 23:00 |

Thirty-minute admission periods allow bounded pagination to make progress under the existing per-cycle allowance and cooldown. A window does not force a request: source freshness, relevant fixture evidence, completed collection checkpoints, remaining daily quota and cooldown still govern acquisition. Routine work deferred outside a window resumes at the next opening; an unfinished page retains its original filters and cursor. Fixture discovery remains necessary when future fixtures are unknown. Roster/injury polling is suppressed without a confirmed upcoming NBA fixture within 72 hours. Routine final-stat maintenance requires a known scheduled/final fixture that started 3–96 hours earlier; historical backfill remains independently resumable within daytime windows.

For each exact confirmed fixture, independent **T−90 and T−20** stages schedule fixture, active-roster and injury evidence collection plus prospective research. T−90 expires at T−20; T−20 expires at T−2. These tasks can run outside daytime windows, including early-morning games. They reuse fresh source receipts (15 minutes for fixture/injury stage refreshes, 24 hours for roster membership), existing HTTP TTLs and one shared in-flight cursor per source. Existing per-job pagination checkpoints migrate without refetching their completed pages. Roster membership and absence from an injury report still do not prove availability. Missing evidence blocks or explicitly limits forecasts.

These are BDL source and local forecast tasks, **not bookmaker polling windows**. All API attempts still pass through the existing quota reservation, maximum requests per cycle and provider cooldown. Exhausted quota defers requests to the next UTC quota day; fixture deadlines can expire sooner. Quota exhaustion never authorises a bypass. The BDL allowance remains **100/day**, with a 13-second cooldown in the private configuration. Historical collection still reserves ten requests for maintenance. Original input clocks and immutable prospective records are retained. No late forecast is backdated. Re-scheduling or cancelling a fixture invalidates its old stage identity.

The IANA `Australia/Melbourne` timezone resolves civil windows and notification times. Windows follow DST instead of adding 24 UTC hours. UTC remains the BDL quota accounting boundary. SQLite jobs, source pagination, leases, deduplication and the existing sleep/wake gap detection survive restart. A sleeping Mac cannot meet a deadline; recovery records the gap and expires missed work. It does not claim continuous coverage.

## Telegram delivery

Routine status messages are held from **00:30 inclusive to 07:00 exclusive** Melbourne time. Dispatch persists the next permitted 07:00 timestamp without incrementing attempts, then drains the queue independently of producing another digest. Digests retain their actual journal counters and Melbourne-date deduplication. Sender verification, private allowlisting, opt-in and uncertain-send handling are unchanged.

Future qualified Telegram dispatch also checks the permitted window **before** paid source revalidation. It expires an opportunity if its original quote expiry, freshness limit or T−2 deadline precedes the permitted release time. It also repeats the check in the transport. It cannot release an overnight opportunity after tip-off. Qualified alerts remain disabled; this is a protective preparation, not activation.

An explicitly requested transport canary retains its explicit-send exception; the autonomous worker never queues a canary. No new test message was sent during this implementation.

## Implemented offline market intelligence

Sportsbet remains the sole primary target. Allowlisted adapters for `tab` and `ladbrokes_au` provide **request plans and offline parsing only**, with no HTTP acquisition method. Their actual NBA player-prop coverage remains unverified. The provider's [Australian bookmaker catalogue](https://the-odds-api.com/sports-odds-data/bookmaker-apis.html) lists these identities. Its [event markets endpoint](https://the-odds-api.com/liveapi/guides/v4/#get-event-markets) reports recently seen event-specific keys; that is not universal market support or proof of executable prices. No bet365 NBA prop adapter is implemented.

After a separately authorised probe, retained source receipts can be reviewed without network access:

```sh
npm run research -- market-plan EXACT_ODDS_EVENT_ID
npm run research -- market-review RETAINED_SOURCE_RECEIPT_ID
```

`market-plan` is a specification, not an executable grant. `market-review` uses the SHA-256 **source receipt ID**, not only the body hash, preserving the exact retrieval clock. It validates retained genuine NBA event-market bytes and source-backed exact identity/settlement evidence from the private evidence bundle. It rejects simulated, unretained, future or foreign-provider evidence. Reviews are saved privately, and their summary appears on System Status.

Comparison requires the same exact fixture metadata, player, team, prop, **line**, both Over/Under sides and proven matching settlement semantics. Each bookmaker's original timestamps are retained. Freshness follows the configured quote limit and T−2 cutoff; pair and cross-book snapshots must be within 30 seconds, with original retrieval timestamps also within 30 seconds across books. Ambiguous sides, missing market timestamps, absent primary markets, mismatched terms and stale odds are excluded explicitly. Different lines are never substituted. Both sides use proportional two-sided vig removal, conditional on no push; displayed probability differences are descriptive. Books are treated as correlated observations, with **no pooled probability, added effective sample size or promotion evidence**. Reviews remain labelled historical snapshots as they age.

Catalogue discovery distinguishes `recently_seen`, `not_observed` and `ambiguous`; missing markets remain unknown rather than being declared universally unsupported. A catalogue alone cannot produce a price comparison. No genuine TAB/Ladbrokes observations or comparisons were manufactured for this release. Mocked tests use isolated temporary/in-memory databases.

## Prepared, not activated

No new bookmaker probe, recurring paid collection, account allowance or shared-credit coordinator was activated. The previous one-off grant does not authorise this scope. New paid acquisition requires a finite owner-approved shared allowance and genuine account-level coordination protecting SportsModel V6's allocation and reserve. The adapters intentionally cannot send requests themselves. SportsModel V6 files, processes, service settings, credentials and counters were not changed or inspected during this task.

The existing owner-activated Signals SHADOW mode and research-status opt-in were preserved; qualified delivery stayed off. Only the already-running Signals service is restarted to load verified code. No new service is installed. Research and SHADOW continue without bookmaker prices, subject to genuine fixture, roster, historical/model and availability evidence. All promotion gates are unchanged. NBL, qualified opportunity alerts and real-money execution are not enabled.

## Validation and owner actions

Run `npm run verify` for TypeScript checks, the complete test suite and production build. Added regression coverage includes both Melbourne DST transitions and the repeated hour; quiet-hour boundaries and delayed outbox release; early fixtures; missed deadlines after sleep; quota exhaustion; no-fixture request suppression; shared pagination across SQLite reopen; absent markets; stale/asynchronous prices; terms; exact differing lines; and pre-send expiry before source acquisition.

System Status now shows the seven windows, heartbeat versus acquisition policy, next opening, quiet-hour state, queued routine statuses, pending deadline tasks and optional bookmaker comparison evidence.

No new activation is needed for the existing permitted research schedule. Genuine multi-bookmaker observations need the new shared allowance/coordinator, an approved finite event-specific coverage probe and exact identities/settlement receipts. Positive current availability and sufficient forward evidence remain necessary before any model or alert can become live eligible. This release does not establish a forecasting edge or relax those gates.

## Observed release checks

- `npm run verify`: **143 tests passed**, zero failures; strict TypeScript and production build passed.
- Production loopback `/status` and `/api/snapshot` smoke checks passed, including Melbourne windows, quiet hours, optional-market preparation and disabled paid/qualified paths. The temporary server was stopped.
- Ten production build trace manifests contained **zero private runtime files**.
- Existing Signals LaunchAgent restarted gracefully; its replacement worker is active in the owner's existing SHADOW mode and loaded the shared-cursor migration. Existing research-status opt-in was preserved; qualified alerts remain disabled.
- **8,715** original player-game rows, **104** original bodies/receipts, four frozen models and all existing research journal rows were hash-verified unchanged. The active worker appended normal cycle journals. Private config, credentials and both recipient verification bindings were unchanged.
- **Zero new provider requests, zero new bookmaker credits and zero new Telegram messages** during implementation/validation. BDL remains 100/100 used for UTC 21 November, with its 100/day cap and 13-second cooldown unchanged. Bookmaker acquisition remains disabled. No SportsModel inspection or modification was performed.
- No model training or benchmark rerun was warranted by this scheduling/market-preparation change. Existing retrospective results and model promotion gates remain unchanged; no genuine forward forecasts or new market coverage are claimed.

Private execution evidence is retained in `.local/v141/verify.log`, `http-smoke.json`, `build-privacy.json`, and the before/after preservation records. None is included in Git or production build traces.
