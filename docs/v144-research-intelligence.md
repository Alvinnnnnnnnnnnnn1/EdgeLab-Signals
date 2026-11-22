# V1.4.4 — independent research intelligence

Reviewed 22 November 2026, Australia/Melbourne. Baseline: `c016f08` on `codex/nba-wide-research`. This release adds offline research code and immutable private exports. No production model, threshold, worker, policy, Telegram path, grading code, Bet Log or CSV route was changed. No service installation, restart, subscription, external data acquisition or test message was performed.

## Outcome and readiness

The strongest immediate opportunity is reuse of licensed boxscore fields already retained: attempts, turnovers and offensive/defensive rebounds. All 16,035 original player-game rows have these fields. An independent feature inventory adds 19 slots to the existing ten features; 14 are derivable for the demonstrated pregame observation. The remaining five stay null.

**There is no source-qualified historical challenger benchmark yet.** The strict as-of run found zero eligible observations for points, rebounds, assists, threes and minutes. No MAE, CRPS, calibration improvement or superiority over the deployed models is asserted from this release. The new evaluator rejects retrospective inputs, requires original pregame fixture evidence, preserves observation/publication clocks and excludes unresolved results. Unverified exploratory artifacts are excluded from release readiness.

Four genuine, separately registered pregame feature observations were saved privately for one player in Atlanta–Detroit, using 34 earlier player-games. These are four correlated prop records, not four independent games. Each contains 29 slots, 24 populated, an unknown outcome and an unknown participation probability. Source cutoffs and actual registration times are separate. These are research evidence, not additional issued picks or changes to original forecasts. No new research process runs unattended.

The active system retains 804 experimental forecasts, 96 SHADOW forecasts, 162 price-side candidates and 11 issued suggestions. No genuine suggestion has a settled result in the audited snapshot.

## Historical coverage and data quality

Baseline snapshot: **22:08:36 Melbourne / 11:08:36 UTC**, 22 November. A second detached snapshot supports the separately timestamped pregame observations; its later injury collection is retained independently from the baseline audit. Full per-player, per-season, per-fixture and field reports remain private under `.local/v144/release/`; the source database was opened read-only for bounded online backups, and analysis used detached copies.

| Season | Player-games | Players | Fixtures | Coverage assessment |
| --- | ---: | ---: | ---: | --- |
| 2024–25 | 1,881 | 524 | 89 | October cursor unfinished; isolated later records do not fill the season |
| 2025–26 | 7,285 | 531 | 209 | October complete; November cursor unfinished, later months uncollected |
| 2026–27 | 6,869 | 535 | 236 | Collected October and November windows through 21 November; undiscovered fixtures remain unknown |
| All retained seasons | **16,035** | **725** | **534** | All 30 teams represented; league-wide completeness is unproven |

There are 475 discovered final fixtures with no player rows: 385 in 2024–25 and 90 in 2025–26. These are known gaps, not an estimate of every missing game. Completed fixture checkpoints do not imply completed player-stat pagination. Player-season coverage is reported individually; an expected game-by-player denominator is unavailable.

Points, rebounds, assists, threes, minutes, FGM/FGA, 3PA, FTM/FTA, OREB/DREB and turnovers are present in every retained row. Plus/minus is present in 12,741, missing in 3,294. Official usage is absent in all rows. Raw identities and normalized prop values agree for all 16,035 rows. Whole-minute source values cannot establish exact seconds.

11,132 rows have positive participation; **4,903 have unknown participation** and none establishes an independently verified DNP. No independent expected-roster denominator exists. There are 490 fixtures whose two-team minutes satisfy the boxscore completeness check; the other 44 cannot support complete-team possession proxies. This check is not proof of a complete expected roster or team-rebound accounting.

274 retained injury-list observations span two collections, not 274 independent players or game-specific availability confirmations. The latest baseline observation is 16:01 Melbourne, stale under a four-hour research assessment at capture. Original publication clocks are absent. Descriptions and return-date text are preserved without converting them into authoritative historical timestamps, probabilities or minutes restrictions. Absence from a list and active-roster membership provide no positive participation confirmation.

## Source ranking and access assessment

This ranking reflects the audited feature gaps and integration cost. Documentation establishes a candidate capability; it does not establish this account's entitlement, historical field completeness or permission to automate a new source.

| Priority | Candidate | Best contribution | Present access / incremental cost | Decision |
| --- | --- | --- | --- | --- |
| 1 | Retained BDL boxscores | Offensive opportunity and complete-team context proxies | Existing licensed receipts; zero requests or extra cost | Implemented local reuse |
| 2 | Existing BDL injuries | Observed injury designations and uncertainty | Existing ALL-STAR; no extra allowance used | Preserve observations; no inferred availability |
| 3 | BDL GOAT | Pregame lineup status; advanced historical context | Published US$39.99/month versus current US$9.99, about US$30 more before billing adjustments | Disabled; no upgrade |
| 4 | SportsDataIO licensed projections | Direct projected minutes, role and injury evidence | New commercial quote/permission required | Registry and feasibility review only |
| 5 | RotoWire licensed feed | Expected/confirmed starters and contextual injury news | Partner quote and feed rights required | No website scraper |
| 6 | Betfair through The Odds API | Independent exact-market price benchmark if offered | Future shared-credit review required | Offline parser prepared; NBA prop coverage unverified |
| 7 | Betfair delayed development interface | Back/lay depth and spread research | No account/app key/session configured; terms review required | Offline parser prepared; no login |
| 8 | PBP Stats | Possessions, on/off and lineup analytics | No permitted feed contract or published quota/price established | Disabled pending rights review |
| 9 | Official NBA injury report | Dated reference for status changes | Automated production access unavailable pending permission | Reference only |
| 10 | Sportradar | Official-source depth, substitutions and injuries | New contract, quote and mapping work | Candidate only |

BDL GOAT endpoints include `/nba/v2/stats/advanced`, `/nba/v1/stats/tracking`, `/nba/v1/matchups`, `/nba/v1/lineup_stats` and `/nba/v1/projected_lineups`. Advanced V2 starts in 2015; tracking/matchups advertise 2018–19 onward with variable coverage and postgame delay. These describe earlier games, not the forthcoming defensive assignment. Actual `/lineups` begins at tip-off, so it cannot establish pregame starters. Projected lineups distinguish expected/confirmed status and an update clock; they do not supply projected minutes in the documented payload. Published GOAT throughput is 600/minute; a subscription would still need a reviewed local allowance. No new endpoint was queried. [BDL documentation](https://nba.balldontlie.io/)

SportsDataIO documents `StartingLineupsByDate`, injury feeds, and projected player game statistics. Relevant fields include `LineupConfirmed`, `LineupStatus`, injury status/notes and projected minutes/seconds. Its timestamps require attention to US Eastern time and DST; an undated or ambiguous update cannot become a UTC pregame fact. [NBA API documentation](https://sportsdata.io/developers/api-documentation/nba), [data dictionary](https://sportsdata.io/developers/data-dictionary/nba)

Endpoint guidance suggests three-minute lineup polling and one-minute injury polling; broader guidance differs by feed. Commercial cadence should follow the contracted endpoint, not these numbers as a local allowance. History varies by feed; archived pregame snapshots require explicit confirmation. Game/Player/Team IDs need an evidenced crosswalk to BDL. [Coverage and endpoint intervals](https://sportsdata.io/developers/coverages/nba), [historical coverage](https://sportsdata.io/help/historical-data-integration-guide)

Commercial SportsDataIO pricing is use-specific. Discovery Lab is next-day delayed, with 100–1,000 daily calls by tier; it cannot replace a live availability feed. Scrambled trial/development responses are unsuitable for genuine evidence. No signup or trial was started. Contract rights must cover model use, retention and the intended product. [Access products](https://sportsdata.io/developers), [pricing](https://sportsdata.io/pricing), [data rights](https://sportsdata.io/help/data-rights-and-licensing-questions)

RotoWire advertises expected and confirmed lineups, injury information and contextual news through partner syndication. A retail subscription or visible lineup page is not feed permission. Historical revisions, update clocks, refresh limits, automated use and price require a partner agreement; none is configured. Cross-provider player/team/fixture IDs must be established without fuzzy-name guesses. [RotoWire syndication](https://www.rotowire.com/partner/)

PBP Stats advertises NBA history since 2000–01, possession counts, rebound zones, assist combinations and on/off analytics. Its API includes game logs, possessions and lineup summaries; possession queries cap results at 500. Public documentation supplies no reviewed acquisition allowance or model-use licence here. Its upstream NBA data dependency remains a rights blocker. Similar broad pace estimates can already be derived locally; detailed possession and lineup effects cannot. [PBP Stats](https://www.pbpstats.com/), [API](https://api.pbpstats.com/docs), [upstream data loaders](https://pbpstats.readthedocs.io/en/stable/index.html)

NBA-site automation remains blocked pending written permission for this use. No NBA.com data loader was added. [NBA terms](https://www.nba.com/termsofuse), [injury reference](https://www.nba.com/players/injury-report)

Sportradar's NBA API provides schedules, boxscores, injuries and play-by-play, with historical data since 2013 and official NBA data from 2017. Documented per-feed update rules exist; account quotas, pricing and use-specific rights need a contract. UUID mappings and original observation clocks would be required. Its detailed substitutions could improve role modelling, but there is no authorised account or collected sample here. Media API access must not be assumed to grant this use. [NBA capabilities](https://developer.sportradar.com/basketball/docs/nba-ig-api-basics), [history](https://developer.sportradar.com/basketball/docs/nba-ig-historical-data), [update rules](https://developer.sportradar.com/basketball/docs/nba-ig-update-frequencies)

## Betfair feasibility and prospective costs

The bookmaker catalogue lists **`betfair_ex_au`**, but establishes no exact NBA points/rebounds/assists/threes coverage. No genuine Betfair payload is retained locally and no authenticated probe was authorised or executed. All four prop coverage states remain **unverified**. Game moneylines, spreads, totals and `h2h_lay` are classified separately from player props. [Bookmaker catalogue](https://the-odds-api.com/sports-odds-data/bookmaker-apis.html), [market catalogue](https://the-odds-api.com/sports-odds-data/betting-markets.html)

The Odds API adapter preserves market `last_update` as the provider's observation clock, not an exchange publication claim. Unknown sizes and commission stay null; bet limits are not liquidity. Exact fixture/player/side/line and settlement signatures must match before comparison. Sportsbet's paired prices are vig-adjusted; exchange back/lay commission sensitivity remains separate, with no pooled probability. Distinct bookmakers and opposite sides are correlated observations.

Under published event-odds accounting, adding a second selected bookmaker inside the first group of ten need not increase a four-market request's credit cost if the returned market union remains four. This is a future-policy estimate, not permission to modify today's Sportsbet request. Separate probes consume their own credits. A future one-event proposal could reserve up to **five credits / four requests** for account evidence, events, market discovery and four-prop prices, with current reserves and V6 coordination preserved. It has not been activated. [Odds API accounting and timestamp semantics](https://the-odds-api.com/liveapi/guides/v4/)

Betfair's delayed development key operates against production Exchange data, with variable 1–180-second delay and restricted price depth. It is not a sandbox and can expose betting operations, which this module does not implement. Delayed runner traded volume is unavailable. The offline parser retains back/lay price-level sizes when present, and never substitutes `lastMatchTime` for an original quote timestamp. Consequently a delayed book without an original quote clock cannot qualify as a current-price comparison. [Application-key rules](https://betfair-developer-docs.atlassian.net/wiki/spaces/1smk3cen4v3lu3yomq5qye0ni/pages/2687105/Application+Keys)

Official market-data requests have a weighted 200-point limit. Development data is advertised without an activation fee; paid Live App Key activation is excluded from this work. Australian Version 1.0 logins can also incur account-level access charges under Betfair's rules. Commission is market/account-specific and charged on net market winnings, so the code's isolated-position adjustment is a sensitivity calculation, not a promise of realised settlement. No account login, key activation, order capability or fee acceptance was performed. [Data limits](https://betfair-developer-docs.atlassian.net/wiki/spaces/1smk3cen4v3lu3yomq5qye0ni/pages/2687478/Market+Data+Request+Limits), [Australian developer comparison](https://developer.betfair.com.au/), [Australian charges](https://www.betfair.com.au/AUS_NZL/aboutUs/Betfair.Charges/)

**Additional V1.4.4 provider requests, credits and subscriptions: zero.** Existing authorised V1.4.3 collection continues under its unchanged policy; its activity is independent of these offline commands.

## Feature inventory: existing versus proposed

| Area | Existing deployed features | Independent research addition | Limits |
| --- | --- | --- | --- |
| Recent production | Last five, last ten, EWA, season shrinkage, per-minute production | FGA/min, 3PA/min, FTA/min, assists/min, smoothed three-make rate | Attempt zeros stay observed zeros; missing exposure stays null. Shooting smoothing uses an explicit Beta(.5,.5) prior |
| Minutes | Recent mean and standard deviation | Unclamped historical volatility; separate optional minutes challenger | Conditional on participation; no confirmed role, restriction or DNP denominator |
| Opponent | No explicit defensive context | Pace/possessions proxy, defensive-efficiency proxy, combined missed-FG environment, assists and 3PA allowed | Complete two-team historical boxscores only; no tracking or assigned-defender claim |
| Schedule | Rest days, home/away, team-change flag | Observed play within 36h and observed team games in seven days | Observed lower bounds; incomplete schedules cannot establish full congestion, rest or travel |
| Opportunity allocation | No genuine teammate-absence adjustment | Exact-game observed teammate-outs slot | Null without original game-specific evidence; no causal redistribution inferred |
| Role / restrictions | No confirmed pregame starter or restriction | Confirmed-starter and minutes-limit slots | Both null in the real observation; projections remain projections |
| Game / matchup | No genuine pregame spread or assignment | Competitiveness/blowout and defensive-matchup slots | Null; historical outcomes or later closing prices cannot fill them |

Possessions use the explicit boxscore estimate `0.5 × Σteams(FGA + 0.44×FTA − OREB + TOV)`, adjusted for known game duration to obtain a pace proxy. Usage is also a boxscore proxy. Neither substitutes for official possessions, rebound chances, potential assists or an individual defensive matchup. Production by expected-minutes role is evaluated using prior expected minutes, never target-game actual minutes.

## Isolated module, evaluation and commands

`src/research-intelligence/` contains the source capability registry, detached exporter, raw-field identity checks, injury observation preservation, optional lineup contract parser, Betfair parsers, strict feature snapshots, append-only label reconciliation and challenger evaluator. No production module imports it. Its external acquisition function always rejects; there is no order endpoint, credential loading, Telegram code or service installer.

The exporter refuses the configured live database path, including symlink aliases, and opens a detached copy read-only. It verifies source hashes and exact identities. Research JSON uses exclusive creation, content-bound IDs and private permissions. Original raw receipts, normalized logs and frozen forecasts are never rewritten. Complete reports and artifacts are private, versioned under `research-intelligence/1.4.4` and `ri-challenger/1.4.4/<target>`.

The evaluator supports points, rebounds, assists, threes and minutes. Optional candidates are an opportunity/context boosted count model, a minutes/opportunity NB model, an attempts/makes threes model when its evidence is complete, and a separate expected-minutes model. It compares the strongest selection-period simple baseline on identical held-out rows. A frozen deployed-artifact replay is allowed only after original artifact publication/registration and calibration boundaries; it is not an original issued forecast.

Training, selection, calibration and test dates are disjoint, using the existing chronological framework. Fitting requires at least 200 earlier training examples and 20 dates; bounded challenger fitting uses at most 1,000 training rows and 12 stumps. Imputation medians and missingness indicators are training-only. Calibration fits on the first half of its period and chooses on the second. Reports support MAE, CRPS, Brier, log loss, calibration, expected-minutes error and role splits, with date- and fixture-cluster bootstrap comparisons. Pending observations never become losses. No genuine matched market-outcome cohort exists yet.

Current source-qualified held-out sample sizes are **zero for all five targets**, so no genuine fitted challenger is accepted for readiness. Isolated test fixtures establish evaluator mechanics only. Promotion is always disabled; the module contains no deployment path.

```sh
npm run intelligence -- registry
npm run intelligence -- export PRIVATE_DETACHED_SQLITE .local/research-intelligence/snapshot.json
npm run intelligence -- audit .local/research-intelligence/snapshot.json .local/research-intelligence/audit.json
npm run intelligence -- observe SNAPSHOT_JSON EXACT_FIXTURE_ID EXACT_PLAYER_ID points PRIVATE_NEW_OUTPUT
npm run intelligence -- reconcile OBSERVATION_JSON ORIGINAL_SNAPSHOT FINAL_SNAPSHOT PRIVATE_NEW_LABEL
npm run intelligence -- evaluate SNAPSHOT_JSON points as-of PRIVATE_NEW_REPORT
```

`reconcile` verifies the original snapshot and registered feature values, then saves a separate final label or pending record. Later corrections produce separate label identities; the original observation remains unchanged. Genuine labels can be passed to the isolated evaluator once a sufficiently broad cohort exists.

Use a fresh detached snapshot for `observe`; source cutoff and registration time are retained separately, and an outcome stays null. New observations require original fixture/roster evidence and respect source age and pre-tip deadlines. Never relabel an old snapshot as freshly acquired data. Heavy commands lower their own OS priority, cap the Node heap at 1 GiB, enforce a two-minute work budget and yield to known fixture pregame windows. They do not hold a live acquisition lease, share a live event loop or write to the active SQLite database. No research schedule was installed.

## Verification, preservation and operational finding

Before work, private evidence captured the Git head, SQLite integrity, original counts, four artifact hashes, active policy identity, configuration/credential fingerprints and both LaunchAgent definitions. The original process IDs were research **53136** and market **52367**. After implementation, original row prefixes, artifact bodies, policy/configuration bytes, recipient verifications and LaunchAgent files matched. The Bet Log still contains every original suggestion with unchanged probabilities and prices. Mutable delivery-state progress is allowed; original message content remains unchanged. V6 was not accessed or modified.

The market process **52367** remained uninterrupted with a current heartbeat. The original research process **53136** was CPU-active in its existing scheduled `score` job, begun at 22:30 Melbourne, and exceeded its heartbeat lease. It subsequently exited with `Research worker lease expired` at **22:46:24 Melbourne**; its existing LaunchAgent automatically started process **56526**. The journal records the same lease-expiry error at 19:33, before this task. No restart, unload, service replacement or production patch was performed by this release.

**Uninterrupted SHADOW process continuity cannot be certified.** Its supervisor recovered it, but the replacement process was again busy in the existing `monitor` job at the later check. This is a production operational blocker, so no new live integration or research service is deployed. All new acquisition and model-integration paths remain disabled. The original scoring/monitoring path needs profiling and a separately reviewed remedy; this task's explicit no-interruption requirement rules out intervening in that service.

The new tests cover strict source cutoffs, target-outcome independence, late corrections, null/zero handling, complete-team proxies, immutable exports, live-path rejection, pregame yielding, unknown prospective outcomes, expected versus confirmed lineups, post-tip projection rejection, Betfair game/prop separation, back/lay depth, stale/different-line/term exclusions, training-only imputation, matched cohorts, test-label independence and independently appended final/correction labels. **`npm run verify` passed TypeScript, 179 tests and the production build.** Eleven build traces contained no private configuration/data paths or configured secret values. Genuine reconciliation of the new pregame observation remains pending; isolated correction tests are not live outcome evidence.

## Next controlled stage

1. Review the existing SHADOW scoring/monitoring lease-expiry and automatic restart cycle; plan any optimisation as a separate deployment. Keep the recurring market worker and all source gates unchanged. Do not claim unattended research continuity until the existing failure is resolved.
2. Continue the already-authorised bounded historical backfill and existing prospective forecast/outcome collection. Fill incomplete season windows without inventing player-game denominators.
3. Save independent pregame research observations from genuinely fresh retained inputs, then append authentic results after games finish. Accumulate a source-qualified chronological cohort before fitting or scoring genuine challengers.
4. If needed, separately approve a limited Betfair coverage probe and its shared-account binding. Record missing props as missing; do not change the current Sportsbet request implicitly.
5. Review a licensed lineup/projection source only if the local evidence gap persists. Confirm entitlement, timestamps, historical availability, rights, mappings and finite quotas before acquisition. No trial or purchase is needed for the offline layer.
6. Propose a separately versioned model only after matched prospective evaluation, calibration, uncertainty and degradation review. Any live enrichment requires later owner-approved activation. Original issued forecasts, prices, outcomes and the current four models remain preserved.
