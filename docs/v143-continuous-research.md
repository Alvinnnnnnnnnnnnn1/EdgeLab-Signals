# V1.4.3 — continuous NBA research and hypothetical Bet Log

Owner authority is the V1.4.3 continuation brief, separately recorded by attachment hash in the private policy. This replaces the expired V1.4.2 one-hour grant; its reservations and evidence remain unchanged. Experimental suggestions use the same four frozen models and selection rules. Qualified promotion gates, NBL and real-money execution remain disabled.

## Recurring acquisition

The new private policy lasts 90 days, through 20 February 2027, and renews its monthly allowance only when fresh provider evidence confirms the account period. It does not purchase credits or change the subscription. The verified account plan has 500 credits. Signals' gross monthly ceiling is 340; every paid request also preserves **the full V6 60-credit allocation plus the separate 100-credit reserve** in the account's remaining credits. These simultaneous limits can make the usable ceiling lower than 340.

At activation on 22 November, fresh headers showed 34 used / 466 remaining: Signals' original 13 credits plus V6's current 21 reservations reconcile exactly. Usable headroom was therefore 306 credits. This is a dated observation, not a promise of future account availability. The collector reads V6's configured allocation and reservation ledger without changing either. Provider headers must be at most 120 seconds old and match known consumer charges exactly before a paid request. An idle ledger's modification time alone is not quota evidence. Unknown consumers, uncertain debits, changed plan/allocation, missing headers or insufficient reserves stop paid acquisition.

This is a bounded shared-account envelope, not an account-wide mutex installed in V6. Concurrent V6 activity may invalidate a previously read account snapshot. Full protected allocations, V6's existing reservation bound, fresh headers and reconciliation protect the reviewed envelope; unaccounted consumers cause a pause. No code in this release writes to V6.

The daily credit allocation divides currently usable headroom over remaining UTC days and is persisted before use. Activation allocated 34 credits for 22 November, enough for eight maximum-cost four-market snapshots. The limit is not reset by restarting. Each successful response records immutable actual charges alongside the original maximum reservation; verified savings can fund later snapshots. Uncertain requests retain their reservations. There are additional caps of 40 new requests/day and 1,000 requests/month, including zero-credit probes. No number-of-picks cap exists.

At four credits per complete four-market fixture snapshot, 306 credits supports at most 76 additional snapshots this period. A fresh month has at most 85 snapshots under the 340-credit gross envelope, about 2.8/day in a 30-day month before competing-account reductions. The plan cannot price every NBA fixture twice daily. T−20 coverage takes priority; T−90 runs when primary coverage has surplus budget. Actual costs can be lower when markets are missing, but coverage is never assumed. All eligible exact markets in each fetched response are evaluated.

NBA event discovery costs zero credits and caches for 15 minutes. One fresh Sportsbet response discovers the offered four markets, ranks candidates and revalidates their issue prices; there is no redundant immediate second four-credit request. No paid calls occur without current fixture, player, model and settlement evidence. Exact source IDs, line/side, market timestamps and the existing explicit fixture-clock bridge are retained. Missing props produce no fabricated prices. TAB/Ladbrokes remain optional preparation; bet365 is not enabled.

## Service and recovery

The new `com.edgelab.signals.markets` LaunchAgent runs beside the original research worker. The original SHADOW process was not restarted. The existing research service retains its Melbourne daytime windows, source T−90/T−20 exceptions, BDL 100/day quota, 13-second cooldown, source checkpoints and independent prospective forecasts. Clearing the old grant pointer prevents its already-loaded experimental loop from acquiring with expired authority. Generic persistent odds acquisition and qualified delivery remain off; only the scoped recurring adapter can spend this policy.

The market heartbeat runs every 60 seconds; it is not a provider request schedule. SQLite stores stage jobs, deadlines, cooldowns, daily budgets and a separate worker lease. Startup recovers original retained paid receipts instead of repeating transport. Unknown interrupted debits block for reconciliation. Sleep/wake gaps are recorded; missed deadlines expire rather than replaying opportunities after tip-off. Telegram quiet hours remain 00:30–07:00 Melbourne with DST handled by the existing scheduler. Market jobs that cannot be delivered before their deadline expire; independent essential source collection and SHADOW forecasts can continue overnight.

Private operational commands, run from this repository with Node 24:

```sh
npm run research -- recurring-status
npm run research -- recurring-plan .local/v143/recurring-policy.json
npm run research -- recurring-account .local/v143/recurring-policy.json --execute
npm run research -- recurring-once .local/v143/recurring-policy.json --execute
npm run research -- recurring-grade
```

The zero-credit account command still consumes a request and obeys cooldowns. A blocked plan is not permission to raise a cap. Investigate uncertain debits using authentic retained receipts and account evidence; do not delete counters to retry. Future renewal requires a new reviewed private policy and explicit activation, not editing an active policy in place. Activation binds the complete policy hash:

```sh
npm run research -- recurring-activate PRIVATE_REVIEWED_POLICY --confirm
npm run research -- recurring-prepare-service PRIVATE_REVIEWED_POLICY
```

`suggestions-disable --confirm` stops new experimental suggestions while grading remains independent. To unload only the market sidecar use `launchctl bootout gui/$(id -u)/com.edgelab.signals.markets`; do not unload the research or V6 service. Acquisition also fails closed at policy expiry. A Mac that is asleep cannot collect or deliver; no remote hosting is enabled.

## Bet Log and automatic outcomes

The primary `/ledger` page is now **Bet Log**; `/`, `/opportunities` and `/performance` direct to it. It shows total suggestions, Won/Lost/Pending, cumulative hypothetical P/L and ROI, one chronological table, simple date/result filters and complete CSV export. CSV exports all issued history regardless of the table filter, including pending and losing rows, immutable source/model/forecast IDs, original prices and timestamps, latest grade source and cumulative results. CSV formula escaping remains enforced.

Every genuine issue automatically represents a hypothetical A$5 position. It requires no placement annotation. Pending P/L is null and stays outside the ROI denominator. Settled turnover is A$5 per won, lost, push or void recommendation; push and void contribute zero profit. Corrections append grades and recompute the log from the latest revision without changing an original issue. Unknown statistics and unresolved participation stay pending. The existing settlement rules determine DNP, postponement, push and overtime handling from authentic evidence. Private old placement annotations remain stored for compatibility and do not enter this log's calculations.

Settlement runs before policy checks, so expired market authority, budget exhaustion or stopped new acquisition does not suppress grading. Backend evaluation considers all eligible prospective forecasts and observed market candidates, not just selected picks: MAE, CRPS, paired baseline/challenger comparisons, calibration/Brier/log loss and expected-minutes MAE/bias. Private per-prop health records flag insufficient evidence or degradation without changing deployed models. Diagnostics run in a separate process after acquisition/delivery, stop after two minutes and defer around imminent jobs; diagnostic failures cannot occupy the acquisition event loop or revoke suggestions. Indexed fixture-specific result reads avoid reparsing the historical archive on each heartbeat.

## Genuine release observation — 22 November, 18:39 Melbourne

The new recurring worker acquired one current Miami–Oklahoma City Sportsbet snapshot, evaluated **76 genuine quote sides**, issued **nine** experimental suggestions and received Telegram acceptance for **two** consolidated messages. All four requested prop types were observed. No new fixture-specific grant was created. The original two suggestions were not resent. The new paid snapshot cost four credits; the five requests recorded through the recurring adapter up to this observation included four zero-credit account/discovery requests. An earlier account-only probe also used zero credits.

Fresh price-response headers reported **38 used / 462 remaining**, exactly reconciling Signals' 17 credits and V6's 21 reservations. Remaining policy headroom was **302 credits**, with **30 credits left in the initial day's paced allocation**. Headers expire for acquisition decisions; idle time does not cause repeated account probes. The next paid stage must refresh them.

The database held 16,035 genuine historical player-games, 568 experimental forecasts, 96 independent SHADOW forecasts, 162 observed quote-side candidates and **11 issued suggestions**. All 11 were pending: hypothetical cumulative P/L A$0, ROI undefined until a result is settled. Live backend evaluation had no final fixtures to score, so it correctly reported no held-out forward results. Neither retrospective model results nor the isolated accounting tests establish live profitability.

## Verification and practical limits

Regression tests cover shared-account reconciliation, reserve and daily limits, monthly renewal with an observed reset, multiple fixtures under one policy, paid-response crash recovery, no duplicate delivery, quiet-hour expiry, grading after policy expiry, and A$5 pending/won/lost/push/void/correction accounting. Existing DST, early-fixture, exact-line, stale-price, quota and evidence tests remain required.

Release verification passed TypeScript, **164 tests** and the production build. Loopback HTTP checks confirmed the Bet Log and CSV each contain the same 11 issues, including all pending records; a filtered export still returns the complete history. Build traces contained no private data/configuration paths or configured secret values. SQLite integrity passed, original table prefixes matched the online pre-change backup, and private credential/recipient-verification hashes were unchanged. Both research and market worker heartbeats were current after deploying the revised market service; the original SHADOW PID remained unchanged.

The first two V1.4.2 suggestions and their original sources are preserved. The owner confirmed receipt of that consolidated message. Telegram API acceptance for later messages is recorded separately; device delivery/read status is not observable through this integration. No genuine selected fixture had finished at initial activation: real end-to-end final grading must wait for authentic final statistics. Isolated regression outcomes demonstrate mechanics, not live profitability or model validation.

All private data, policy, receipts, grant, logs and verification reports remain under ignored `.local`; secrets remain in private configuration. The default site is loopback-only. No activation of NBL, qualified betting alerts, real-money execution or new paid service occurs through this release.
