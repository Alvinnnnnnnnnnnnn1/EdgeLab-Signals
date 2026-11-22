# V1.4.5 research-worker reliability

Implemented on `codex/nba-wide-research`, starting at `11ddcc9`. Investigation: 22 November 2026, Australia/Melbourne (AEDT, UTC+11).

**Verified implementation; pending separately approved activation.** Neither live service was restarted. The existing entry point retains its original behaviour; the replacement has a separate, privately pinned entry point. Models, recommendations, message format, market acquisition and credit policy remain unchanged.

## 1. Confirmed failures and root cause

Original SQLite journals and research bootstrap logs establish:

| Melbourne time | UTC evidence | Effect |
| --- | --- | --- |
| 19:33:15 | Expiry stderr 08:33:15.119 | Earlier expiry confirmed; insufficient retained profiling to attribute this incident independently. |
| 22:30:18–22:45:24 | Start 11:30:18.972; failed journal 11:45:24.456 | Score cycle took **905.484 seconds**. |
| 22:46:24 | Expiry stderr 11:46:24.483 | Renewal failed after the additional 60-second sleep. LaunchAgent recovered to PID 56526. |
| 22:46:25–23:01:32 | Start 11:46:25.016; failed journal 12:01:32.133 | Monitor cycle took **907.117 seconds**. |
| 23:02:32 | Expiry 12:02:32.118; recovered cycle 12:02:32.575 | Recovery to research PID 57208; market PID 52367 remained running. |

The old `liveWorker` renews a 150-second lease before `liveOnce`, then sleeps 60 seconds. The cycle has its own 150-second lease, checked between jobs and never renewed. Scoring/monitoring run synchronously on that event loop and can write report/checkpoint state after expiry before the next job notices. A same-thread renewal timer would also be blocked.

Profiling four real frozen SHADOW forecasts identified **89,064 receipt checks hashing 8.82 GB of repeated original bytes**. Receipt checks consumed **29.783 of 30.623 seconds (97.3%)**. Each forecast shared approximately 11,132 history references. The old path repeatedly reads/hashes the same receipt bodies; monitoring repeats the scorer. A zero-delay timer around one original forecast ran **12,219.565 ms late**, directly demonstrating event-loop starvation. Historical swap, memory-pressure and lock telemetry were not retained, so their contribution to those incidents is unproven. A separate development check also exposed the experimental scorer's all-record materialisation exceeding the new bounded child's capacity; streaming resolved that failure.

The retained incident snapshot has **no expired pregame jobs**. The next known T−90 job was 19:00 UTC, after both expensive cycles; no missed pregame deadline is established for those intervals. Injury pagination was delayed from its first page at 11:30 to completion at 11:46:25, approximately 16 minutes. All 11 issued recommendations remained pending before their fixtures completed; no lost final outcome is established. Original evidence survived recovery. This does not establish uninterrupted service outside retained records.

## 2. Original versus improved architecture

The new controller retains the **150-second** worker lease and renews every **20 seconds**. Its event loop performs supervision, not forecasting/evaluation. The scheduling tick remains approximately 60 seconds, separate from provider request permissions.

Source tasks run in a child, one substantive job at a time. A drain admits at most 12 tasks and stops starting work after 45 seconds; each source child has a 120-second wall deadline. Existing deadline/kind ordering prioritises fixture, roster, injury and pregame work. Grading runs before and after source tasks, independently of analytics and market-policy checks.

Analytics uses a separate process at `nice` 19, a physically read-only WAL snapshot, disabled network transport and no provider/delivery secrets. Its JavaScript heap is limited to 512 MB and its parent wall deadline to 180 seconds. Kernel CPU limits of 120/180 seconds for source/analytics survive controller failure. Timeouts terminate only the owned child, escalating after one second. Analytics holds no writer lock during computation. The heap cap is not a native SQLite/Node RSS cap.

Every heartbeat checks for pregame tasks within five minutes and cancels analytics or non-deadline source work so the source queue can prioritise them. Interrupted analytics restarts from a fresh snapshot without partial report commits. Existing HTTP timeouts, Melbourne windows (07:15, 09:00, 11:00, 13:00, 16:00, 19:30, 22:30), T−90/T−20 checks, quiet hours, TTLs, quotas and shared source cursors remain in effect.

## 3. Measured performance

Detached online backup: **16,035 genuine player-games, 804 experimental forecasts, 96 SHADOW forecasts**. The same frozen evaluation clock was used.

| Measurement | Original | Improved |
| --- | --- | --- |
| Same four genuine SHADOW records | 30,622.572 ms | **573.148 ms**, exactly equal JSON report |
| Receipt work, same four | 89,064 checks; 8,822,800,720 body bytes hashed | 22,272 checks; **178 body hashes / 20,566,981 bytes** |
| All 96 SHADOW records | Not rerun as a controlled paired benchmark | **1,629.598 ms**; 182 body hashes / 20,712,777 bytes |
| Single-record timer delay | 12,219.565 ms | 817.067 ms; now isolated from the controller |
| Full bounded child: 804 experimental + 96 SHADOW | Initial all-record implementation exited without a report under the 512 MB cap | **5,536.139 ms**, completed under the cap; exactly equal to direct streamed computation |
| Unchanged-input watermark check | Evaluations repeated | **3.853 ms**, skips evaluation |

The paired four-record run was approximately **53× faster**. These are individual observations, not a latency SLA. A detached genuine as-of replay regenerated 96 forecasts for 24 players in 16,841.645 ms under the same 512 MB heap cap, with zero inserts/exclusions; it was a replay at the original frozen cutoff, not newly registered live evidence. A pre-streaming full direct analytics run took 11,903.496 ms under concurrent verification load; it is not a controlled comparison with the later child run. The 905/907-second incident durations are complete failed cycles, not paired benchmark timings. Memory point samples do not establish peak RSS.

No genuine forecast has an observed final outcome yet: these measurements prove processing/equivalence, not predictive accuracy or promotion. Isolated mocked-final tests compare corrected cohorts, all four prop definitions, calibration/scoring and frozen distributions with the original implementations.

## 4. Lease management and fencing

All replacement-worker writes validate worker/task/cycle ownership **inside the same SQLite writer transaction**, with another check before commit. This includes direct statement writes, explicit transactions and `INSERT ... RETURNING`. Expired owners cannot renew themselves, commit delayed results or overwrite successor status. Source-task deadlines are also fenced at each write/commit; an overrun rolls back and yields to the next pregame stage. Cleanup deletes only matching old tokens.

The controller renews the source cycle and separate source/analytics task leases. Analytics commits require both parent/task ownership and an unchanged immutable-input watermark inside the commit transaction. New evidence makes a result `superseded`; no stale report is applied.

The old worker lacks these new fences. Activation therefore requires the reviewed old process to have exited and no other research service process to remain alive; an expired legacy lease is insufficient permission to start another owner. The market service is independent and is not hot-swapped.

## 5. Database/checkpoint improvements

No destructive migration is required. Operational checkpoints use the existing `meta` table; sources, forecasts and grading revisions stay append-only. Receipt bodies are verified once per task/snapshot, with exact retrieval-receipt identities checked separately. Misses are never negatively cached. Shared history proofs are reused only after full validation and only when their maximum source time/game day permits the next cutoff. Log parsing and final fixture/player lookup are shared within a score pass.

Experimental forecasts stream in original `at,id` order, sorting small identities rather than materialising hundreds of megabytes of JSON. The scorer accepts an optional iterable; its default market-worker path and statistical formulas are unchanged. No model fitting, selection, ranking or threshold code changed.

Persistent watermarks cover logs, both research forecast tables, experimental forecasts/candidates, model records and retained receipts. New finals, corrections, resolved games and new forecasts invalidate the cache. Unchanged inputs reuse reports with their original computation clock. Changed-input confidence intervals and calibration are recomputed to preserve definitions, rather than approximated by averaging reports.

Validation/hash work precedes short ingestion transactions, with at most 100 rows per transaction. Immutable rows are inserted before cursor advancement. Crash replay uses original bytes and IDs. Busy errors retry without advancing checkpoints; cleanup contention leaves the matching lease to expire safely.

## 6. Finals, grading and recovery

Final acquisition targets registered NBA fixtures through `/nba/v1/games/{id}`, then `/nba/v1/stats?game_ids[]={id}` and cursor pagination. It validates fixture/player/team identity, season, source start and final status. Changed identities, repeated cursors and out-of-scope pages are held/rejected before cursor movement. Genuine retrieval timestamps are retained; no historical information is relabelled as pregame availability.

Collection is due at start + three hours, nonfinal games retry after 15 minutes, and complete fixtures are revisited for corrections. The ordinary correction horizon is four days; incomplete pages, never-completed collections and unresolved issued recommendations remain recoverable after longer outages. Empty/partial responses do not invent DNPs or losses. Existing BDL quota/cooldown and per-tick request budgets apply. Registered finals can run outside routine daylight windows. No bookmaker acquisition is added.

The existing exact-match hypothetical settlement engine and Bet Log/CSV remain unchanged. Grading runs regardless of new suggestions, Sportsbet credit exhaustion or market-policy expiry. Interrupted grading replays idempotently; corrections append revisions. Completion is checkpointed only when no held/error rows remain. Unknown outcomes stay pending. A BDL zero-minute row alone does not prove DNP; void grading requires explicit permitted evidence. Frozen odds/probabilities and analytical A$5 profit/ROI remain intact; no placement or execution is introduced.

A heartbeat gap longer than the lease is recorded and ownership rechecked. An expired worker never resurrects its token after sleep. Children stop, supervisor recovery can acquire a new owner, interrupted jobs requeue, cursors resume and missed pregame opportunities expire. A gap indicates suspension/outage, not proof of a particular sleep event. Source and analytics failures have independent retries. No operational Telegram messages/test sends were added.

## 7. Tests

`npm run verify`: **200 passing tests**, zero failures/skips; TypeScript and Next.js production build passed. Twenty-one new isolated tests cover expiry/replacement, conflicting writers, stale commit rollback, token-safe cleanup, renewal over simulated 240/400-second work, sleep/wake, separate CPU children, T−20 preemption, interrupted analytics, SQLite busy recovery, read-only analytics, watermark rejection, receipt corruption/missing/future inputs, all four scoring definitions, interrupted grading, multiple corrected players, won/lost/push/void/pending, original odds, pagination after reopen, wrong fixtures/cyclic cursors, early fixtures, deadline expiry, deduplication, paid-acquisition rejection and unapproved activation. Existing tests cover DST/quiet hours, BDL quota exhaustion, market allocations, messages, models and settlement exports.

A separate **real-time** isolated stress run kept a CPU-bound child busy for more than **165 seconds**, renewing the unchanged 150-second lease eight times. A second mocked high-priority child dispatched at 75 seconds completed in approximately 124 ms while analytics continued. Exact observations are private in `.local/v145/soak-result.json`. This is additional to compressed virtual-clock tests, not a timeout increase.

Thirteen Next.js trace manifests contain **zero private runtime references**. No test used the live database for mutations, acquisition, delivery or deployment.

## 8. Preservation evidence

The 12:06:29 UTC baseline and post-change read-only checks establish:

| Live evidence | Preserved result |
| --- | --- |
| Genuine logs / original bodies / retrieval receipts | **16,035 / 202 / 209**, original rows unchanged |
| Deployed model records/artifact bindings | **4**, hashes unchanged |
| Experimental / SHADOW / verified forecasts | **804 / 96 / 0**, unchanged |
| Issued suggestions / final grades | **11 / 0**, unchanged; all 11 pending |
| Recommendation / status outbox | **14 / 2**, original rows unchanged |
| Quota rows | **208**, unchanged |
| Bet Log/CSV | All 11 originals retained; ROI null until outcomes |
| SQLite integrity | `ok` |

Private env/config, Telegram fingerprint, recurring policy and both installed LaunchAgent plist fingerprints are unchanged. Streaming SHA-256 comparisons protect all original source/forecast/issue/outbox/quota rows, rather than checking counts alone. Workers may legitimately append after an audit.

Policy remains Signals' **340-credit gross monthly ceiling**, V6's protected **60**, plus **100 reserve**. Signals' local charges remain **17**, leaving **323** in its local gross envelope. Last account evidence: 462 remaining / 38 used at 07:39:11 UTC, now **stale**, not a current spendable balance. No account refresh/additional paid request was made. V6 was untouched. Qualified alerts and research-intelligence challengers remain unactivated.

## 9. Terminal health

```sh
cd /Users/asan/EdgeLab-Signals
npm run reliability -- health
launchctl print "gui/$(id -u)/com.edgelab.signals.research"
launchctl print "gui/$(id -u)/com.edgelab.signals.markets"
```

Health shows heartbeats, current task/duration, last successful cycle, expiries observed in retained logs, deferred jobs, pagination, pending grading, next fixture deadline, analytics/cache and local quota/stale-account evidence. It makes no provider/account request and sends nothing. Retained-log expiry counts are not lifetime counters.

Reviewed service state: research **PID 57208, runs 7**; market **PID 52367, runs 1**. Both heartbeats are fresh, research waiting with a valid lease. Health explicitly states **legacy running; 1.4.5 pending approval**. Healthy idle status does not fix the loaded legacy expensive-job path.

## 10. Deployment and rollback — not executed

A controlled **research-only restart** is required. The market worker remains independently running. After committing verified code, preparation creates an unapproved private activation record, candidate plist, installed-original plist copy and pinned tracked-code release:

```sh
npm run reliability -- prepare
plutil -lint .local/v145/reliable-research.plist
```

Preparation requires a clean committed tree, never installs/restarts services, and refuses an already active reliable service. `.local/v145/releases/<implementation-hash>` contains reviewed `HEAD` code, no data/config/keys. Its plist uses that pinned entry point; children resolve against pinned source, while the working directory/private runtime paths remain the repository. Future worktree edits cannot silently change this release.

At the audit the next fixture task is **06:00 AEDT Monday 23 November** (19:00 UTC Sunday 22 November), T−90 for Atlanta–Detroit at 07:30; T−20 is 07:10. The idle interval beforehand is a candidate deployment window. **Recheck immediately before activation**: no running source job and at least ten minutes before due/imminent pregame work; valid old service and unchanged market PID/policy. This window is not permanent approval.

Only **after separate explicit owner approval**, use the following procedure. If the old PID/identity changed, prepare the plan again before approving it. First repeat health/service checks, then take a fresh online backup:

```sh
node --env-file-if-exists=.env.local --import tsx --input-type=module -e 'import{backup}from"node:sqlite";import{Store}from"./src/core/store.ts";import{loadConfig}from"./src/core/config.ts";const s=new Store(loadConfig().database,true);try{await backup(s.db,".local/v145/pre-activation.sqlite");}finally{s.close();}'
chmod 600 .local/v145/pre-activation.sqlite
```

Record the separately granted approval and stop only research:

```sh
node --input-type=module -e 'import{readFileSync,writeFileSync}from"node:fs";const p=".local/v145/activation.json",r=JSON.parse(readFileSync(p,"utf8"));r.ownerApproved=true;r.approvedAt=new Date().toISOString();writeFileSync(p,JSON.stringify(r,null,2)+"\n",{mode:0o600});'
launchctl bootout "gui/$(id -u)/com.edgelab.signals.research"
node --import tsx --input-type=module -e 'import{validateActivation}from"./src/research/reliability/deployment.ts";validateActivation(".local/v145/activation.json");console.log("Research activation guard passed");'
```

The guard must pass: verify the old process actually exited within a bounded 30-second observation window. If it remains alive, stop the rollout for review; do not bypass the guard or kill all Node processes. Once passed:

```sh
cp .local/v145/reliable-research.plist /Users/asan/Library/LaunchAgents/com.edgelab.signals.research.plist
chmod 600 /Users/asan/Library/LaunchAgents/com.edgelab.signals.research.plist
launchctl bootstrap "gui/$(id -u)" /Users/asan/Library/LaunchAgents/com.edgelab.signals.research.plist
npm run reliability -- health
launchctl print "gui/$(id -u)/com.edgelab.signals.markets"
```

Observe at least 165 awake seconds and multiple heartbeats: implementation 1.4.5, valid ownership, source progress, bounded analytics/cache reuse, unchanged market PID, original model/record/policy fingerprints and no duplicate recommendations/unapproved paid requests. A source not due yet is not a failed collection.

If validation fails, roll back **only research**, verifying the new process exited before restarting the original:

```sh
launchctl bootout "gui/$(id -u)/com.edgelab.signals.research"
cp .local/v145/original-research.plist /Users/asan/Library/LaunchAgents/com.edgelab.signals.research.plist
chmod 600 /Users/asan/Library/LaunchAgents/com.edgelab.signals.research.plist
launchctl bootstrap "gui/$(id -u)" /Users/asan/Library/LaunchAgents/com.edgelab.signals.research.plist
```

Never restore the backup over live SQLite: retain every record appended since backup. Never unload/mutate market or V6 services. The original entry point retains its original worker path.

## 11. Owner next action and limits

Review this implementation and the private prepared plan, then explicitly approve a controlled **SHADOW research-worker-only restart** in a rechecked safe window. No model promotion, budget change, recurring odds change, challenger activation or message test is requested. Until approval, the loaded research worker retains the known defect: this implementation is **not deployed**.

After activation, observe genuine source deadlines and eventual finals/grading. Tests cannot establish multi-day live uptime, Mac wake reliability or prospective model accuracy. If future archives outgrow the bounded child, analytics defers safely while source/grading continues; further paging can preserve the same statistical definitions.

Detailed backup, timings, stress results, verification log and preservation fingerprints stay private under `.local/v145/`. This report contains no keys, recipient identifiers, raw source bodies or private configuration.
