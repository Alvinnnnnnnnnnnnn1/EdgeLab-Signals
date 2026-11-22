# V1.4.5.1 — permanent recommendation families

Prepared on `codex/nba-wide-research`, from live release `e9055e8`. **Not deployed. Neither worker was stopped or restarted.** SHADOW remains the pinned V1.4.5 service; a separately approved market-worker-only restart is required to load this change.

## Confirmed cause and historical audit

An online backup was taken before code changes. At **08:38:58 AEDT, 23 November 2026**, all historical `experimental_suggestions`, `experimental_outbox`, generic delivery records and Telegram status records were examined locally:

| Evidence | Result |
| --- | --- |
| Issued recommendations | **26** |
| Distinct fixture/player/prop families | **18** |
| Families issued twice | **8**, each with two different suggestion IDs |
| Extra recommendations from those families | **8** |
| Recommendation outboxes | **32**: seven accepted batches, 25 consolidated singleton rows |
| Accepted batches / total attempts on them | **7 / 7** |
| Suggestion IDs present in multiple accepted batches | **0** |
| Identical accepted batch texts | **0** |
| Incorrect stored family hashes | **0** |

Every second recommendation has a `supersedes` reference to its earlier issue. The old `rankAndIssue` permits another same-side recommendation when at least 15 minutes passed, the quote clock advanced, and the line moved by at least 1 or decimal price by at least 0.10. Its suggestion ID includes the full quote and issue timestamp, so each permitted update creates a new ID, new outbox content and another hypothetical A$5 ledger entry. Delivery correctly treats those IDs as new recommendations; it has no permanent family rule.

The eight confirmed repeats were all UNDER positions:

| Player / prop | Original line @ price | Subsequent line @ price | Accepted Telegram batch IDs |
| --- | --- | --- | --- |
| Dyson Daniels / points | 10.5 @ 1.96 | 10.5 @ 1.84 | 6 → 9 |
| Jared McCain / assists | 2.5 @ 1.64 | 2.5 @ 1.88 | 8 → 10 |
| Jared McCain / threes | 3.5 @ 1.58 | 3.5 @ 1.80 | 8 → 10 |
| Ajay Mitchell / threes | 1.5 @ 1.56 | 1.5 @ 1.68 | 8 → 10 |
| Ajay Mitchell / assists | 4.5 @ 1.74 | 4.5 @ 2.15 | 8 → 10 |
| Ajay Mitchell / points | 20.5 @ 1.96 | 23.5 @ 1.80 | 8 → 10 |
| Isaiah Hartenstein / points | 9.5 @ 1.80 | 9.5 @ 2.00 | 7 → 11 |
| Jared McCain / points | 18.5 @ 1.85 | 19.5 @ 1.91 | 7 → 11 |

For example, Daniels' first reference `41c9476a3729…` was issued at 06:19:06 UTC on 22 November; reference `424881b6c3dd…` followed at 20:18:17 UTC with `supersedes` pointing to the first. The other seven repeats were issued at 21:33:24 UTC, approximately fourteen hours after their originals. Six repeats changed only price; two changed both line and price.

**The confirmed cause is linked reissuance, not an observed resend of the same ID.** No retained recommendation batch shows more than one send attempt. Telegram provides provider acceptance IDs, not device delivery/read history, so this audit cannot independently diagnose a client-side display issue. Complete references, source clocks and receipt/batch mappings are private in `.local/v1451/audit.json`. The counts are a timestamped snapshot; the unchanged live worker can still issue updates until cutover.

## Implemented rule and atomicity

The family remains exactly `hash([event.id, playerId, prop])`. Time, bookmaker quote, line, side, model ID, grading status, delivery outcome and worker lifecycle never release it.

`src/suggestions/families.ts` installs `experimental_suggestion_families`, keyed uniquely by family and referencing the first historical issue. Backfill runs inside a SQLite writer transaction over **all** issued recommendations, ordered by issue time/ID. It validates the canonical hash and collapses only the new claim representation. Existing duplicate recommendation rows, original odds/probabilities, grades, supersession links and outboxes remain unchanged. A malformed historical family fails closed rather than silently reopening it.

The new issuance path checks the claim under `BEGIN IMMEDIATE`, then inserts the immutable recommendation and its original outbox in that same transaction. An insert trigger creates the unique claim; another rejects any subsequent insert into that family, including attempts bypassing the application check. Failure to queue the outbox rolls back both the recommendation and its claim. Claim update/delete triggers prevent accidental release. Reopening/restoring an older database reconstructs claims from its full immutable history. There is no expiry or reset operation.

The old 15-minute/material-change branch is removed. Newly issued recommendations have `supersedes: null`; historical values are preserved. A `permanentlySuppressed` diagnostic distinguishes already-issued families from model/price ineligibility. Different players, props and fixture IDs still pass the existing screen independently.

Research quotes continue through `archivePricedCandidates`, probability evaluation and existing ranking. A suppressed family adds no recommendation, outbox or hypothetical stake entry. The historical 26 ledger entries remain 26; this release does not rewrite historical accounting into 18 entries.

## Delivery safeguards

The existing Telegram formatting, freshness checks, quiet hours, verified binding, delivery lease, three-attempt limit, known-rejection retries and uncertainty handling remain in place. A 429 can retry the **same original outbox**; an accepted, interrupted or uncertain submission cannot authorize another recommendation or a blind resend.

Before claiming an outbox for sending, an atomic additional check rejects a historical duplicate ID, duplicate family within a batch, or a family already represented by another accepted/sending/uncertain batch. This covers an older pending ID even when a later historical ID was already accepted. Rejected duplicate batches are marked expired with `PERMANENT_FAMILY_DUPLICATE`, without changing their immutable contents or incrementing attempts.

A mixed legacy batch containing a duplicate is held intact; it is not rewritten or split automatically. New batches contain only newly claimed families, so this does not restrict distinct newly eligible opportunities. Existing historical duplicates cannot be unsent, and unknown Telegram outcomes cannot be proven delivered; the guard chooses suppression over another potentially duplicate message.

## Verification and preservation

`npm run verify`: **221 tests passed**, zero failures/skips; TypeScript and production build passed. Twenty-one new regression tests cover changed timestamps/odds/lines, opposite direction, T−90/T−20, restart, historical accepted/pending/retryable/sending/uncertain/expired/rejected states, known 429 retry versus uncertainty, original grades/prices/probabilities, outbox failure rollback, distinct props/players/games, direct database bypass and concurrent issuance from separate processes with different issue-clock material.

A detached genuine-data migration produced **18 claims from all 26 recommendations**, preserved the original suggestions, grades, outboxes and four model records byte-for-byte, rejected a new duplicate insert, and passed SQLite integrity checks. No synthetic/test row entered the live database. Thirteen build trace manifests contain zero private runtime references.

Read-only preservation checks compare original row prefixes and private fingerprints against the pre-change online backup. At the post-change audit, both service identities remain unchanged: **market PID 52367**, **SHADOW PID 62713**. The four deployed model records, source receipts, forecasts, original suggestions/grades/outbox bodies, Telegram settings/verification, recurring policy, quotas and installed LaunchAgents remain unchanged. Authorised background acquisition may append new rows normally; this task makes no provider or Telegram request.

No changes were made to model inference/selection, score thresholds, market acquisition, scheduling, V1.4.5 supervision, Bet Log/CSV, A$5 accounting, provider limits, V6 or qualified-alert settings. The live database has **no new family table yet**. Migration is invoked only by the new issue/delivery path or an explicit deployment migration, not by `Store` construction, dashboard reads, analytics or preparation.

## Minimal market-only deployment plan — separate approval required

The running market process has cached the old engine. Restarting **only** `com.edgelab.signals.markets` is necessary. SHADOW is pinned independently and must stay on PID 62713 (or its independently recovered identity, re-audited before deployment).

Preparation after committing verified code creates private candidate and rollback releases/plists under `.local/v1451/`. It copies tracked code from the reviewed commit and from rollback commit `e9055e8`, with no data, keys or config. Only the market entry-script path changes in the candidate plist; its label, Node/config/policy paths, working directory and other settings are retained. Both plists are linted, never installed. `.local/v1451/deployment-plan.json` binds the reviewed commit, process identities and unchanged policy/config fingerprints. Preparation is not restart approval.

After the owner explicitly approves this **market-only** cutover:

1. Recheck reviewed commit/clean tree, live health and process identities, policy/config hashes and candidate code. Require the market heartbeat to be waiting, no `requesting` market job, no pending quota reservation, no `sending` outbox and no active acquisition/delivery cycle. Require at least ten minutes before any due/imminent market or SHADOW pregame task. Inspect pending legacy duplicate batches before proceeding; never force a send or bypass a guard. If safety is uncertain, leave both workers running and report it.
2. Take a fresh SQLite online backup and check integrity. Copy the installed market plist privately. Record the separate approval in the private plan.
3. Stop only the market service, then verify its actual PID exited within 30 seconds. Never bypass an existing ownership lease; wait for safe expiry if shutdown did not release it. Keep SHADOW running.

   ```sh
   launchctl bootout "gui/$(id -u)/com.edgelab.signals.markets"
   ```

4. With the old market process gone, execute the additive backfill against the live database using the reviewed candidate source. Verify one claim for every distinct historical family, correct first IDs, unchanged original rows, no orphan claims and integrity `ok`. Do not qualify or send a recommendation as a migration test.
5. Install/start only the prepared market candidate:

   ```sh
   cp .local/v1451/markets-v1451.plist /Users/asan/Library/LaunchAgents/com.edgelab.signals.markets.plist
   chmod 600 /Users/asan/Library/LaunchAgents/com.edgelab.signals.markets.plist
   launchctl bootstrap "gui/$(id -u)" /Users/asan/Library/LaunchAgents/com.edgelab.signals.markets.plist
   npm run research -- recurring-status
   npm run reliability -- health
   ```

6. Observe fresh market ownership/heartbeats and preserved SHADOW identity for at least 165 awake seconds. Verify guard coverage over all current historical rows, original models/accounting unchanged, valid family suppressions on subsequent naturally scheduled observations, and no duplicate accepted batches. Existing authorised acquisition may continue within the unchanged allowance. Do not make a paid probe or test send for verification. No synthetic forecast is a live dedup test.

The preparation audit recorded the next market T−90 jobs at **09:30 AEDT on 23 November**; this is not a permanently safe deployment window. Recheck current due tasks when approval arrives. Nothing in this release increases credits, changes stages or requests per-signal approval.

## Rollback

If activation fails, stop **only the new market service**, confirm it exited, and start the prepared pinned rollback market entry point. Do not restart SHADOW or V6 and do not restore SQLite over the live database:

```sh
launchctl bootout "gui/$(id -u)/com.edgelab.signals.markets"
# Confirm the candidate process actually exited before continuing.
cp .local/v1451/markets-rollback.plist /Users/asan/Library/LaunchAgents/com.edgelab.signals.markets.plist
chmod 600 /Users/asan/Library/LaunchAgents/com.edgelab.signals.markets.plist
launchctl bootstrap "gui/$(id -u)" /Users/asan/Library/LaunchAgents/com.edgelab.signals.markets.plist
```

Keep additive family claims/triggers and every historical row. Dropping the guard would reopen already-issued families. The old engine can encounter the retained database rejection and mark a selection cycle blocked rather than sending an update; this is a deliberate fail-closed rollback limitation, and may delay otherwise distinct recommendations in that old selection batch. Acquisition and automatic grading remain independent. Report that condition for repair; do not remove claims to make the old reissuance rule succeed.

## Current status

**LIVE:** V1.4.5 SHADOW and the original market worker, unchanged process identities. **PREPARED:** V1.4.5.1 permanent family suppression, historical backfill, delivery fence, regression tests and private market-only deployment/rollback bundle. It is not active until the separately approved cutover. Consequently, more duplicates remain possible under the currently loaded market code.

Private evidence: `.local/v1451/audit.json`, `before.sqlite`, `backfill-check.json`, `preservation-after.json`, `verify.log` and `deployment-plan.json`.
