# NBA-wide collection and live research preparation

This continues V1.2 on 21 November 2026 (Melbourne). The initial checkout was clean on `main`, matching `origin/main` at `63db48c`. Work is isolated on `codex/nba-wide-research`. A private SQLite online backup and hashes of all original log/source rows and relay verification were retained before changes.

## League collection and reviewed limits

`BDLProvider.leagueStats` collects all NBA players using documented `seasons[]`, `start_date`, `end_date`, `per_page=100` and provider cursors. It does not require player lists. Fixture coverage is independent of player selection and reused for contained historical windows, including V1.2 completed checkpoints. Partial legacy fixture cursors resume from their saved position. Fixture/stat cursor namespaces remain separate; empty terminal pages are handled and cursor cycles fail without advancing the checkpoint.

Original response bodies and receipts are retained before immutable normalized revisions and cursor advancement. Interrupted commits can safely replay records. Source exclusions retain quarantine references and stop that batch for inspection. Completion means pagination finished; it does not prove an independent expected roster is complete. Missing values and zero-minute participation reasons remain unknown. See [BDL's documented filters and pagination](https://docs.balldontlie.io/#get-all-stats).

The initial plan assumed 24–36 returned player rows per fixture, completed-season planning bounds of 1,230–1,342 fixtures, and an explicitly unverified 150–350 current-season fixture range. Monthly rounding and possible empty-tail pages are included in upper estimates:

| Source season | Scope | Estimated requests |
| --- | --- | ---: |
| 2024 (2024–25) | October 2024–June 2025 | 309–534 |
| 2025 (2025–26) | October 2025–June 2026 | 309–534 |
| 2026 (2026–27) | October 2026–20 November 2026 | 38–138 |
| Total | Monthly windows, each at most 31 days | **656–1,206** |

These are estimates, not observed complete-season totals. At 100 requests per UTC day this is approximately 7–13 quota days before other usage; it is not a background schedule. Discovery, DNP rows, omissions and reusable fixture coverage affect actual usage.

With 9/10 requests already used, the owner explicitly approved **100 requests/day, up to 91 additional requests that UTC day**, batches of at most 25 and the unchanged 13-second cooldown. Only the private BDL daily cap changed. Public defaults remain network-off/zero-allowance. The finite foreground run prioritized current November/October, then older seasons chronologically. It did not cross the approved UTC day or install a service.

```sh
# Previews and audits make zero sports-provider requests.
npm run research -- collection-plan
npm run research -- coverage
npm run research -- collect-plan 25
npm run research -- collect 2024 2024-11-01 2024-11-30 25

# Execute only within the reviewed, currently remaining allowance.
npm run research -- collect-plan 25 --execute
```

An executable batch refuses a cap larger than the day's remaining allowance, holds the existing research lease, rechecks configuration after waits and reserves requests through `JsonHTTP`/SQLite. Errors stop without automatic retries. Completed historical scopes replay without requests or new rows. The old selected-player helper remains supported.

## Completeness and benchmark scope

`research coverage` saves a private report by player, fixture and season: PTS/REB/AST/3PM/minutes presence, positive/unknown participation, roster uncertainty, discovered final fixtures without logs, quarantine pages and exact receipt integrity. Planned seasons with no data remain explicit zero-row entries. A box score does not prove current availability, a DNP reason or a complete roster denominator.

Raw game dates and exact UTC fixture timestamps remain distinct. Historical outcomes retrieved today retain today's actual observation clocks. Nothing reconstructs fictional historical publication times.

The benchmark target cohort was declared **before running it**: source season 2026, using all earlier imported genuine rows as prior history. Sparse older integration data is retained as history rather than dominating target-date splitting. The optional target filter retains the existing chronological train/selection/calibration/test split and promotion gates:

```sh
npm run research -- snapshot 'ACTUAL_OWNER_CONFIRMED_SOURCE_REFERENCE'
npm run research -- benchmark .local/datasets/EXACT_HASH.json retrospective --target-season 2026
```

The snapshot retains every imported season and exact raw sources; the report records the target cohort. Strongest simple controls, hierarchical NB, minutes simulation, attempts/makes and boosted models are compared when their data requirements permit. Actual held-out counts, calibration and date/fixture paired intervals remain in the frozen report. Synthetic and retrospective results never authorize promotion. Partial seasons are not completed multi-season validation.

## One controlled shared-key Sportsbet test

SportsModel was inspected read-only as explicitly requested. The V6 launch job was loaded with no PID at inspection; that does not establish that its interval job is disabled. Its source config retained a 60-credit monthly ceiling. The latest local shared ledger showed 19 used/reserved, 481 remaining, no uncertainty and 41 credits of unused worker allocation, approximately two hours old.

The owner separately approved **one hour, four requests, five credits**. A private grant binds the configured key by fingerprint, reviewed worker-config hash, month, expiry and finite limits. The guarded transport reads the old ledger/config without changing them. A fresh authenticated quota request precedes paid calls, which must preserve a 100-credit reserve plus the old worker's unused allocation. Grant usage is reserved transactionally, including failed/uncertain attempts, and cannot reset at midnight or by editing the grant.

```sh
npm run research -- odds-plan
# Requires an explicitly approved, owner-only finite grant.
npm run research -- odds-coverage .local/PRIVATE_SHARED_GRANT.json --execute
```

The steps are `/v4/sports` (zero credits), NBA event discovery (zero), one Sportsbet market catalogue (one) and one four-market event odds request (four-credit ceiling), following [The Odds API accounting](https://the-odds-api.com/liveapi/guides/v4/). Temporary execution settings do not enable persistent odds collection or alter private provider configuration. Ongoing shared-key workers still need a reviewed account allocation/coordinator or a dedicated account.

Observed result: **four requests, five credits; 476 provider credits remaining, 24 used**. Philadelphia–Milwaukee returned points/rebounds/assists/threes with **26/24/20/24 priced outcomes**, or **13/12/10/12 player descriptions**. All markets retained original timestamp `2026-11-21T10:12:14Z`; no requested description/line/side/timestamp fields were missing. These are coverage observations; exact cross-provider player/fixture bridges, settlement terms and live quote eligibility remain unverified.

## Prospective research without outbound alerts

```sh
npm run research -- prospective .local/research-runs/FROZEN_BENCHMARK.json
npm run research -- prospective-score
```

The recorder requires a genuine retained training snapshot, frozen artifact, exact upcoming NBA fixture and fresh positive availability with verified roster/team and minutes evidence. It freezes conditional count and baseline distributions, features, immutable input references, original receipts and artifact hashes before tip-off. Unknown participation probability stays null. A unique artifact/player/fixture/prop key retains the first forecast; update/delete triggers prevent rewriting. No prices, recommendations, outbox entries or messages are created.

The scorer uses later genuine participating finals and retained corrections to produce versioned conditional-count accuracy and paired intervals. Forecasts remain unchanged. These records do not replace Sportsbet quote/terms monitoring, participation calibration or promotion gates.

The initial genuine readiness run recorded **zero forecasts**, blocked by missing exact upcoming fixture mapping and positive availability/verified roster evidence. An injury-list omission does not establish availability. Once permitted evidence exists, the same foreground command can freeze future forecasts; preparing it activates no service.

BlueBubbles verification remains intact and delivery disabled. NBL collection, automatic real alerts and real-money execution remain disabled. SportsModel files, schedules, credentials, services and quota counters were not altered. Actual data, grants, keys, backups and artifacts remain private under ignored paths.

## Measured collection and benchmark results

Final measured results follow after the authorized batch and frozen benchmark complete. Private evidence is under `.local/v13` and `.local/research-runs`.
