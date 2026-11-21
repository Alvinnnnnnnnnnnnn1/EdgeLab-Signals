# V1.1 data/provider findings — 21 November 2026

Later V1.2 evidence: [authenticated BDL integration results](v12-bdl-integration.md) records working NBA ALL-STAR access and 81 genuine NBA player-games. The V1.1 acquisition findings below are historical.

**Original V1.1 genuine player-games acquired: NBA 0, NBL 0.** No genuine outcome dataset was downloaded, no authenticated sports-data requests were made, and no account, trial or subscription was activated. Existing quotas, credentials and V6 records were untouched. The source research below distinguishes capability from our permission, entitlement and observed coverage.

## Access matrix

| Source | Technical capability | Permission / entitlement | Actual action and blocker |
| --- | --- | --- | --- |
| NBA official statistics | Player logs | Intended-use permission absent. [Terms](https://www.nba.com/termsofuse). | Documentation only; no extraction. |
| `nba_api` | Maintained client documents game logs and current/legacy endpoint caveats; access may fail or change | Client code licence is separate from upstream data usage | [Client source/docs](https://github.com/swar/nba_api) reviewed; no requests, spoofed headers or alternative-host circumvention. |
| ESPN | Basketball box scores and historical wrappers are technically available | [Disney terms](https://disneytermsofuse.com/australia-newzealand/) restrict automated extraction without permission | No ESPN box-score request; third-party wrapper availability does not supply permission. |
| BALLDONTLIE NBA | Free teams/players/games; ALL-STAR adds game player stats/injuries; GOAT adds further feeds | Published NBA ALL-STAR approximately US$9.99/month, GOAT US$39.99/month; dedicated valid key and permitted intended usage needed | [Official tier/pagination docs](https://docs.balldontlie.io/) checked. No dedicated key configured; Free does not solve player-stat access. No purchase/trial. |
| NBL official / Rosetta | Official public presentation and client route for whole-game player logs; exact person/season scope matters | No established automation contract for this project | [Official Stats Hub](https://www.nbl.com.au/pages/stats-hub), [hoopR route docs](https://hoopr.sportsdataverse.org/reference/nbl_rosetta_player_game_log.html). No gated feed request or Origin/Referer impersonation. |
| SportsDataverse / hoopR | Wrapper documents Rosetta player logs, match/team/person IDs and season conversion | Wrapper licence does not convey upstream feed rights | Documentation only. Not assumed to be a licensed data supplier or a current availability feed. |
| Sportradar | [Global Basketball API](https://developer.sportradar.com/basketball/reference/global-basketball-overview) offers coverage-dependent players/rosters/statistics with authentication; [NBL announcement](https://www.nbl.com.au/news/nbl-taps-sportradar-to-elevate-the-game) describes a league agreement | Commercial licensed account and exact competition/field/history coverage confirmation; price requires a quote | No trial/account/contact/request. The league announcement alone does not prove every required player field or season is in our package. |
| DunkAPI NBL | [Provider page](https://dunkapi.com/nbl) advertises player box scores and historical seasons; coverage differs by season | Account/key required; [terms](https://dunkapi.com/terms) retain third-party-rights caveats | Documentation only; no independent key. Potential provider, not a verified licensed substitute or demonstrated dataset. |
| Public GitHub/Kaggle/Hugging Face mirrors | Some contain genuine historical outcomes | Source provenance, intended-use permission, actual UTC starts and historical release clocks remain unresolved | Repository/schema/licence metadata reviewed. No outcome tables or real-data fixtures imported. A packaging licence is not treated as an upstream permission grant. |
| The Odds API | Event-level NBA/NBL props, original market clocks, exact bookmaker keys | Dedicated account/finite allowance required; historical endpoint is paid | [V4 guide](https://the-odds-api.com/liveapi/guides/v4/), [NBL page](https://the-odds-api.com/sports/nbl-odds). No key configured or price request made. Sportsbet examples establish documented possibility, not actual current coverage. |

## Four-market odds audit

Required keys remain `player_points`, `player_rebounds`, `player_assists`, `player_threes`, requested per exact NBA/NBL event and `bookmakers=sportsbet`. **All eight league/market combinations remain live-unverified.** A missing bookmaker/market is an exclusion, never a substitute price.

For one bookmaker group and four returned markets, reserve four current event credits; historical event odds reserve forty. Historical costs use ten times returned unique markets times region groups, and entitlement must be confirmed. Public NBL documentation places additional-market history in late September 2026. These are documented capabilities/cost formulas, not account receipts or proof of all four props. Default configured allowance remains zero. Provider headers and local pre-request reservations remain authoritative once independently authorised access exists. [V4 costs/history](https://the-odds-api.com/liveapi/guides/v4/).

New `markets.ts` validates exact two-sided identity before proportional de-vig, labels it conditional on no push, handles DNP/push return semantics, and accepts later price/line movement only from a genuinely observed pre-tip quote. It never creates odds, a closing quote or ROI from analysis thresholds.

## Implemented immediate permitted import route

The practical route when an owner has a legitimate captured API export is now **raw-page BDL import**, rather than hand-authoring normalized facts:

```sh
npm run research -- import-bdl .local/your-captured-pages.json
```

The `bdl-captured-pages/1` contract requires original credential-free BDL endpoints, raw game/stat bodies, their exact receipts/hashes, a permitted-use declaration and licence/contract reference. The parser joins real stat rows to exact fixture IDs, teams and UTC source starts. No names or date-only values create an identity/time. It retains missing fields and source clocks and produces a versioned content-addressed modelling snapshot. This command performs **zero network calls**. It does not grant a licence or convert a Free subscription into player-stat entitlement.

A normalized licensed NBL export remains supported through the existing importer, extended with optional research metadata. Its provider integration must map actual raw facts to the schema under valid permission; no undocumented live Rosetta parser has been guessed without a permitted sample. No arbitrary mirror downloader was added.

## Data quality and missingness

Snapshots retain all observation revisions and original/supporting source receipts. Exact hash, identity and chronology checks cover league, fixture, team, player, finite minutes/counts, DNP conflicts, made-threes ≤ attempts, phase and overtime duration when known. Unknown participation is neither DNP nor zero production. Rosters are not inferred from missing rows; trades are retained as team changes. Duplicate same-clock conflicting revisions fail. Pending games are excluded.

`event.startsAt` is the exact source UTC fixture time, **not independently established actual tip-off**. Date-only starts are rejected, and actual-tip knowledge is not asserted. `phase`, `overtimePeriods`, `threeAttempts` and a verified participation-opportunity denominator remain explicit missing/unknown when absent. Snapshots/audits distinguish revisions from independent player-games. Model evaluation excludes unknown phase rather than assuming regular season.

A source first retrieved today cannot supply an invented earlier observation clock. The as-of experiment uses only revisions actually known before the target; retrospective chronological scoring is separately labelled and cannot authorize alerts.

## Shortest access route

An independently permitted BDL ALL-STAR captured export/key is the smallest documented NBA statistical dependency; confirm current terms and required fields before spending. Add source-backed current roster/positive availability and a separate Odds API account/finite allowance. A genuine historical snapshot can support retrospective research, but an as-of archive plus separate prospective monitoring is needed for alert promotion. NBL needs its own permitted provider contract/sample; it must remain disabled until supplied. No purchase is implied by this recommendation or made by the code.
