# Local operating guide

V1.4.4: [independent research intelligence, source feasibility and challenger readiness](v144-research-intelligence.md). The new layer is offline and observational; deployed models, active services, policy, delivery, grading and Bet Log are unchanged. New source acquisition remains disabled.

V1.4.3: [recurring Sportsbet research, automatic A$5 hypothetical results and minimal Bet Log](v143-continuous-research.md). A new bounded recurring policy replaces the expired one-hour grant. The market worker runs separately from the unchanged SHADOW service; full V6 allocation and reserve remain protected. Earlier release statements below are historical snapshots.

V1.4.2: [experimental NBA suggestions, real Sportsbet/Telegram run and Signals Ledger](v142-experimental-suggestions.md). The independent experimental feature is enabled; two genuine suggestions were issued from 86 quote-side candidates and accepted in one Telegram message. Five requests/eight credits consumed the reviewed finite allowance. Genuine settlement remains pending; the full live lifecycle is not yet verified. Qualified model gates remain unchanged.

V1.4.1: [Melbourne daytime windows, quiet-hour delivery and optional bookmaker preparation](v141-daytime-research.md). The 60-second heartbeat is separate from acquisition; independent T−90/T−20 source tasks retain overnight fixture deadlines. Sportsbet remains primary; TAB/Ladbrokes adapters are offline preparation, with no new paid allowance or verified NBA prop coverage.

Current research-only worker, Telegram canary, explicit operating modes and activation/stop commands: [V1.4 live research foundation](v14-live-research-foundation.md). New installations stay disabled; research/SHADOW and status delivery are separate from qualified opportunity alerts. Use the new research service rather than activating the legacy quote-screening worker below.

## Start without any live services

Use Node 24. Dependencies are pinned in `package-lock.json`.

```sh
npm ci
npm run verify
npm run demo
npm run dev
```

Open `http://127.0.0.1:3000`. The default dashboard shows the genuine database, initially empty. To inspect the labelled synthetic result, set `EDGELAB_DB` to the **database path printed by the demo**, then start the dashboard. Each default demo run uses a new `.local/demos/<run-id>/signals.sqlite`; it never opens the genuine database. The demo writes `.local/demo-report.json` and a labelled `.local/demo-bundle.json`. Those are private/ignored and are not a live track record.

`npm run audit` reads local readiness without making network requests. `npm run signals -- scan` executes one configured research cycle; with the shipped defaults it reports `network_disabled` and issues nothing. `npm run worker` is independent of `next dev`/`next start`. The Node CLI reads `.env.local` if present. No persistent service is installed by these commands.

## Private configuration

```sh
cp config/local.example.json config/local.json
chmod 600 config/local.json
cp .env.example .env.local
chmod 600 .env.local
```

The default database is `.local/signals.sqlite`. The data directory is created with mode 0700 and databases with mode 0600. Config files must have owner-only permissions. Keep dedicated secrets in `.env.local` or inject environment variables from the process supervisor. Never put API keys, relay passwords, Apple credentials or the owner's phone number in Git or chat.

Edit `networkEnabled`, provider `enabled`, `dailyLimit`, `monthlyCredits`, `reserve`, `minIntervalSeconds` and the actual subscribed BDL tier only after independent accounts and finite allowances exist. A configuration flag is not a subscription upgrade; a 401/403 stops that request. No trial activation or purchase path exists. Use a dedicated odds key: this local quota implementation cannot coordinate with another application using the same account on another database.

The separately approved [shared-key coverage test](nba-collection-and-live-research.md) binds a finite private grant, inspects the old ledger/config read-only, refreshes account headers and protects the old worker's unused allocation. It does not enable ongoing shared-key collection or install a shared quota coordinator. Keep normal odds collection and delivery disabled.

For a nominal 500-credit Odds API month, a reserve of 100 leaves a maximum 100 full four-market event calls, including pre-send refreshes. A 60-second worker heartbeat does **not** mean a paid query every minute. Default stages are 6h, 2h, 30m and 10m before the exact mapped event; fixture discovery caches for 15m. Significant new evidence can trigger a recheck after a 15m cooldown. Calls stop at the smaller of local allowance and known provider remaining credits. Attempts keep their reservations when a response is uncertain.

## Ingest and verify data

`src/providers/import.ts` exports the runtime `bundleSchema`. Start from `fixtures/licensed-export.example.json`; the generated demo bundle shows a complete synthetic shape and is deliberately rejected by the live importer. The real integration must supply permitted records and actual original source bytes.

A normalized export contains:

- `label: licensed_export`, a licence/contract reference and actual export time;
- `sources`: each exact raw JSON/text body and its SHA-256/provider/endpoint/retrievedAt/publishedAt/simulated=false receipt;
- `logs`: exact canonical fixture, team/player IDs, final/participation facts, nullable end time, first observed final time, minutes and nullable PTS/REB/AST/3PM; supporting fixture receipts when required;
- `contexts`: exact event/player/team, positive available status, roster verification, current expected minutes and uncertainty, receipt and observation clock;
- `terms`: bookmaker/league/market-specific supported overtime, push and DNP rules from a genuine source; and
- `registry`: exact odds-event → canonical fixture and event-scoped source description → canonical player/team bridges, with retained proof sources.

```sh
npm run signals -- import .local/your-permitted-export.json
npm run signals -- discover NBA
npm run signals -- markets NBA EXACT_ODDS_EVENT_ID
npm run signals -- ingest NATIVE_PLAYER_ID1,NATIVE_PLAYER_ID2 YYYY-MM-DD YYYY-MM-DD
```

Set `evidenceFile` to the continuously updated licensed export so the worker can refresh contexts and terms on each cycle. A separate `mappingFile` is optional; an embedded registry is used if it is absent. The example fixture is empty and makes no live-coverage claim. A source integration must validate that normalized facts match its provider's raw payload; the generic export loader checks schema, clocks, retained hashes and identities, and treats that integration as the trusted normalization boundary.

BDL ingestion first captures paginated game metadata, then paginated player stats for the exact same date scope. It advances one successful page per invocation and retains checkpoints, so repeat the command on subsequent ticks until `complete: true`. The worker automatically does this for mapped NBA players over the recent three-day window. Complete current-day windows refresh after 15m; completed past-date scopes are retained. Historical catch-up must be requested with a bounded range and allowance. Dataset completeness is explicit; no current roster or positive availability is inferred from a box score or absence on the injury list. Verified final zero-minute rows still have unknown participation reason and are held rather than automatically voided.

For NBA-wide acquisition without player IDs, use `research collection-plan`, then reviewed finite `collect-plan`/`collect` commands and the detailed `coverage` report in [the league-wide guide](nba-collection-and-live-research.md). Historical fixture coverage is shared across player scopes and league windows. `research prospective` and `prospective-score` provide non-issuing forward count research when genuine future fixtures and positive availability evidence exist.

## Evaluate before live recommendations

```sh
npm run signals -- evaluate as-of
npm run signals -- evaluate retrospective
```

Each writes a dated, content-bound report array to `.local/evaluations`. The CLI does not change `validationFile` or promote anything. Point `validationFile` at a genuine, eligible report after reviewing its scope and scores. Retrospective-only and simulated reports cannot qualify. See `methodology.md` for the date split, minimum samples and baseline requirements. Once real sources, mappings, terms and eligible validation are configured, qualified signals issue automatically; there is no owner accept/decline step.

## Verify iMessage without sending a test

Install BlueBubbles on an authorised Mac and use an existing one-to-one **iMessage** chat, not a group or SMS chat. Configure the relay origin, exact recipient, exact `iMessage;-;<recipient>` chat GUID, allowlist and environment password. Keep `deliveryEnabled: false` while preparing.

```sh
npm run signals -- verify-relay
```

This performs only a ping and read of the configured chat. It must verify exactly one remote participant matching the allowlisted recipient. Verification is bound to the URL, recipient, chat GUID and allowlist, lasts 30 days, and is invalidated by any destination change. No unsolicited test-message command exists. `verifiedAt` in the config is informational; it cannot replace successful persisted relay verification.

After source/model readiness and recipient verification, enabling `deliveryEnabled` allows qualified, fresh, genuine recommendations to send autonomously. Immediately before sending, the adapter forces a new event odds request, reloads current evidence and re-runs the screen. A changed price/line expires that original message; a newly qualified update follows the deduplication rules. A missing relay password, unverified destination or simulated signal prevents real transport.

The request uses documented `chatGuid`, `message`, `tempGuid` and `method: apple-script` fields. A returned GUID means **submitted**, not delivered. A later exact-message query must show the verified chat, outgoing direction and delivery/read timestamp. 401/403/404/429 are explicit rejections and can retry with backoff, maximum three send claims. A timeout, 400 duplicate-queue response, 5xx or lost response is uncertain: query the exact outgoing message to recover its GUID; never blindly resend. No match or multiple matches stays uncertain for diagnostics. A Mac/BlueBubbles integration still needs a genuine end-to-end delivery test once explicitly configured.

## Supervision, sleep and shutdown

The example LaunchAgent label is `com.edgelab.signals.worker`, separate from V6. The systemd template is for a single always-on research host. Neither is installed or enabled. Review paths, secret storage and account quotas before deliberate installation. Ctrl-C/SIGTERM stops the foreground worker; its persisted outbox/checkpoints support later recovery. It exits between ticks only in response to shutdown, and records stopped status.

The dashboard marks a heartbeat older than three minutes as stale. A gap reports possible sleep, a stopped process or an outage; it does not pretend to diagnose sleep from absence alone. The laptop must be awake for local scanning, and the macOS relay must be awake for iMessage. Moving the research process does not solve a sleeping relay.

Keep the web server bound to 127.0.0.1. A Host check rejects nonlocal names. There is no remote authentication/deployment configured. Do not expose the app via a public tunnel unchanged; prepare authenticated read-only access first.

Back up the live SQLite database with SQLite's online backup API/tool (or after stopping only the new Signals process), including its frozen evidence. Do not copy just the main database file while WAL writes are active. Restore into a new path, run integrity checks and a disabled audit, verify counts/receipt hashes, then transfer single-worker ownership. Never run both the old and restored copies against the same quota/delivery account. Cache and provider checkpoints are technical state; signals, source receipts and grading history are the reproducible research record.

## Retire old V6 services safely — documentation only

No V6 service has been stopped, unloaded, modified or reconfigured by this rebuild. Its source pilots and quota permissions remain entirely separate.

1. Obtain separate owner approval for retirement and identify the exact current V6 label, plist, schedule and active window from its own current documentation. The previously documented Mac label is `com.edgelab.v6-shadow-pilot`; verify rather than assume it is still current.
2. Read-only inventory the loaded service and its latest successful jobs, pending result reconciliation and usage counters. Preserve an integrity-checked archive of its private receipts, immutable journals and model/source artifacts. Do not copy its credentials into Signals.
3. After approval and at a safe boundary, stop/unload only that verified V6 service using launchctl for its actual GUI domain. Do not run a broad unload, kill all Node processes or remove old directories.
4. Confirm no old job remains active, revoke only its dedicated credentials if separately authorised, and record the exact final checkpoint/counters. Retain the original repository and research evidence. Moving Signals to a host never grants authority to change V6.

## V1.1 research protocol

V1.1 source access and model work are documented in [v11-model-evaluation.md](v11-model-evaluation.md). Use `npm run research -- audit` for the genuine-data audit; `research import-bdl` accepts actual permitted raw exports; `snapshot`, `benchmark` and `certify` freeze source inputs and chronological artifacts. See [provider findings](v11-data-provider-findings.md) for the raw-page contract and remaining access gates.

Legacy `signals evaluate` remains a V1 exploratory/synthetic compatibility command. Its old eligibility checkpoint cannot qualify genuine V1.1 alerts. Synthetic and retrospective-only results never activate. An ineligible V1.1 certificate can collect frozen research screenings; only passed statistical and later prospective gates can make it eligible. Existing private configuration is not changed by research commands.

## V1.4.5 research reliability

V1.4.5 operational extension: `npm run reliability -- health` provides a read-only Terminal report without provider/account requests or messages. It distinguishes the legacy worker from the prepared reliable controller and reports leases, source/deadline work, grading and analytics. See [v145-worker-reliability.md](v145-worker-reliability.md) for evidence, benchmarks, tests and exact research-only deployment/rollback commands. Activation requires separate explicit owner approval; Sportsbet remains independently running.
