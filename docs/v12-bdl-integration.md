# V1.2 BDL entitlement and historical import — 21 November 2026 (Melbourne)

The owner confirmed purchase of a dedicated NBA ALL-STAR subscription and configured its key privately. Authenticated NBA player-statistics access now works. This supersedes the empty-data/access findings in the original V1/V1.1 handoffs; those documents preserve their earlier results.

## Entitlement, schema and request accounting

The first authenticated request was `GET /nba/v1/stats` for 1 January 2025 with `per_page=1`, forced fresh through the existing `JsonHTTP` transport and SQLite quota reservation. It returned genuine player statistics and an immutable, nonsimulated receipt. [BDL's endpoint entitlement table](https://docs.balldontlie.io/#account-tiers) places game player stats in ALL-STAR and above. This checks access to the needed feature; no billing or subscription-changing request was made.

Exactly **9 BDL requests** were reserved and completed successfully:

| Purpose | Requests | Result |
| --- | ---: | --- |
| Initial player-stat entitlement probe | 1 | One genuine stat row; raw evidence retained |
| Bounded player-ID selection from the same historical date | 1 | Three exact returned native player IDs selected |
| January fixture pages | 3 | 227 source fixtures retained |
| January selected-player stat page | 1 | 48 player-games imported |
| February fixture pages | 2 | 176 source fixtures retained |
| February selected-player stat page | 1 | 33 player-games imported |
| Total | **9** | **81 unique genuine player-games** |

The configured daily limit of 10 and 13-second cooldown were preserved. A separate persisted initial-run counter capped this verification at ten total requests. One early invocation was rejected by the local cooldown before any HTTP request/reservation; subsequent acquisition waited for the configured interval. There were **zero HTTP/API errors, zero schema errors, and zero normalization exclusions**. No failed request was automatically retried.

The actual stat response has numeric native IDs, string minutes, nullable fields, a flat `game` with home/visitor team IDs, and cursor metadata. Fixture responses supply full teams and the exact source `datetime`. The existing normalizer accepted this schema without changes. Source game dates and UTC start dates can differ; UTC timestamps were preserved rather than reconstructed from date-only fields. Provider-supplied integer-minute precision was preserved. Unknown completion/publication clocks were not invented.

Added `tests/bdl-live-contract.test.ts` uses mocked responses in an in-memory database to cover the observed schema, fixture/stat cursor continuation, completed-scope replay, original timestamps/receipts, traded-player team identity, and unknown participation/statistics. No genuine data or credentials were copied into the tests.

## Imported data and completeness

Scopes: **2025-01-01 through 2025-01-31** and **2025-02-01 through 2025-02-28**, using provider date filters. A source game dated 28 February can start on 1 March UTC.

| Player | Native BDL ID | Genuine player-games |
| --- | ---: | ---: |
| Zach LaVine | 268 | 27 |
| Nikola Vucevic | 460 | 27 |
| Coby White | 666956 | 27 |
| Total | | **81** |

These are 81 unique player-game records and 81 retained revisions, across 37 fixtures, 31 UTC dates, two player teams and season 2024. One player's team change is represented by each game's box-score team rather than the player's current profile team. There are no genuine NBL rows.

| Field | Present | Missing |
| --- | ---: | ---: |
| Points | 81 / 81 (100%) | 0 |
| Rebounds | 81 / 81 (100%) | 0 |
| Assists | 81 / 81 (100%) | 0 |
| Made threes | 81 / 81 (100%) | 0 |
| Minutes | 81 / 81 (100%) | 0 |
| Three-point attempts | 81 / 81 (100%) | 0 |
| Phase / overtime count | 81 / 81 (100%) | 0 |

Twelve records have zero minutes and **unknown participation**, not verified DNP labels. There are 69 positive-minute records. Box scores do not establish a verified roster-opportunity denominator or current positive availability. Completeness here means field presence in this small returned sample; it does not establish league-wide historical coverage or precise seconds played.

Both historical checkpoints are complete. Replaying both with network disabled returned `complete: true`, inserted **zero** rows, and consumed **zero** requests. SQLite integrity and the frozen dataset's exact source-body/receipt hashes passed. Further bounded backfill can safely continue under the unchanged allowance and cooldown, retaining checkpoints on interruption. Only one request remained in that UTC quota day; no further acquisition was started. No continuous backfill job was installed.

## Genuine retrospective benchmark executed

Dataset: `1e73e29af635d2c06901e9d08f8cb31c64509074ea97560b37731ba0fcf6ae79`, stored privately in `.local/datasets`, with seven exact supporting/stat fetch receipts. The initial probe/selection raw pages remain separately retained in SQLite. All collection clocks remain 21 November 2026; no historical observation was backdated.

`research benchmark` completed all four NBA prop families in **retrospective** mode: nine candidates each for points/rebounds/assists and ten for threes, including the attempts model. Boosted candidates were excluded by the existing minimum training sample. NBL remained blocked with no data.

After the ten-game player warm-up and participation filters, each NBA experiment had 39 examples on 20 dates: 19 training, six selection, three calibration fitting, three calibration selection, and **eight held-out player-games on four dates**. Each prop's 24 threshold scores reuse those eight games; they are not 24 independent outcomes.

| Prop | Earlier-selected candidate | Selected CRPS | Strongest earlier-selected simple control CRPS |
| --- | --- | ---: | ---: |
| Points | Last 5 | 5.654622 | 5.654622 |
| Rebounds | Hierarchical NB, prior 240 | 1.081482 | 1.078298 |
| Assists | Hierarchical NB, prior 240 | 1.281841 | 1.281635 |
| Threes | Last 10 | 1.094577 | 1.094577 |

Lower CRPS is better. These small integration results establish that the genuine benchmark executes. They do not establish an advanced-model advantage. Every prop remains **ineligible for promotion**: the sample/calibration floors, reliability, verified participation denominator, historical publication availability, and later prospective/availability/market evidence are insufficient. Historical data fetched today supports retrospective research, not an archived as-of/live validation claim.

Private evidence is in `.local/v12-integration/{result.json,import.log,audit.log,benchmark.log,benchmark-summary.json,verify.log,build-privacy.json}` and the dated immutable report in `.local/research-runs`.

## Verification and operational state

`npm run verify` passed **85 tests**, with zero failures/skips, strict TypeScript and the Next.js production build. Ten build trace manifests contained zero private runtime file entries; scanning build files found zero occurrences of the configured API key. Private configuration, scripts, raw bodies, datasets and reports remain ignored by Git.

Odds collection and iMessage delivery remain disabled. The worker remains unstarted; no services, automatic alerts, recommendations, outbox entries, bookmaker execution, deployment, subscription changes or SportsModel/V6 changes were made. The only tracked changes for this integration are this documentation, the historical-document pointers and the isolated contract regression test.
