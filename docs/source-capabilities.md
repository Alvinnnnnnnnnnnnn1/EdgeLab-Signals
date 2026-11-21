# Source feasibility audit — 21 November 2026 (Melbourne)

V1.4.1: [Melbourne daytime windows, quiet-hour delivery and optional bookmaker preparation](v141-daytime-research.md). The 60-second heartbeat is separate from acquisition; independent T−90/T−20 source tasks retain overnight fixture deadlines. Sportsbet remains primary; TAB/Ladbrokes adapters are offline preparation, with no new paid allowance or verified NBA prop coverage.

V1.4 current evidence and remaining live-source gates: [live research foundation](v14-live-research-foundation.md). BDL ALL-STAR active-team and injury interfaces are implemented; genuine upcoming schema probing is deferred by the exhausted day allowance. Projected lineups remain GOAT-only and are not queried. Telegram is verified for the private destination; one integrated canary was accepted, with device delivery unobservable. Paid Sportsbet polling remains disabled.

Latest continuation: [NBA-wide acquisition and the finite genuine Sportsbet coverage test](nba-collection-and-live-research.md). The findings below remain historical observations.

Later V1.2 evidence: [authenticated BDL integration results](v12-bdl-integration.md). NBA ALL-STAR player statistics now work and 81 genuine player-games are imported; the initial unconfigured/zero-request findings below are preserved as historical observations.

This separates published capability, old V6 observations, and new-project live tests. No inherited credential, quota receipt, source worker or dataset is reused. No plan or trial was purchased. API adapters alone do not establish current data access.

| Source | Documented capability | Access / cost | New project evidence / decision |
| --- | --- | --- | --- |
| NBA official / nba_api | Player game logs, minutes, PTS/REB/AST/FG3M, roster IDs, schedules; substantial historical depth | Client is free; upstream data terms are separate. No production permission established | Official terms and maintained client documentation reviewed. No stats request, blocked pending permitted usage; no disguised browser headers or proxy workaround. |
| BALLDONTLIE NBA | Games/teams/players Free; game player stats and injuries ALL-STAR; projected lineups GOAT | Published Free 5/min; ALL-STAR US$9.99/month, 60/min; GOAT US$39.99/month, 600/min. Per league; trials can auto-convert | Typed paginated read adapter implemented; no new key configured, zero authenticated API calls. Historical depth marketed to 1946 but per-field/season completeness unverified. Paid stats cannot be obtained with Free. |
| NBL official Stats Hub | Public presentation of official statistics | Automated extraction/reuse and service allowance not established | Official page inspected; no dataset downloaded. Neither widget visibility nor a wrapper licence grants upstream data rights. |
| NBL Rosetta / Genius | Maintained wrapper documents fixtures, rosters, logs and box scores | No documented public automation contract or published price/SLA found in this audit | No gated request or Origin/Referer impersonation. Licensed normalized NBL export adapter implemented; live source remains blocked pending provider permission and schema sample. |
| The Odds API V4 | Event-level props, decimal prices, bookmaker/market timestamps; AU bookmaker catalogue includes Sportsbet | Published Free 500 credits/month; 20K US$30, 100K US$59. Historical props paid. Event odds charged unique returned markets × regions; selected bookmakers grouped in tens | Exact NBA/NBL Sportsbet coverage NOT proven here. Event-level adapter requests only four supported markets, one bookmaker. No key configured; zero price calls. A dedicated NBL page now documents Sportsbet prop examples, but examples do not verify current event/account coverage. |
| BlueBubbles | macOS REST send/query, message GUID and delivery state | Self-hosted, no LLM/API purchase required; Mac relay must be awake | Implemented direct adapter and local mocked transport tests. No destination/password verified; delivery disabled. Submission is never counted as delivery. |
| Hermes | Official BlueBubbles messaging integration | Adds a separate agent/gateway; unnecessary for deterministic outbound notices | Documentation reviewed as secondary option; not installed or activated. |
| Other licensed feeds | API-Sports, SportsDataIO, Sportradar/Genius are candidates | Coverage and commercial rights require provider confirmation | Not queried with old keys. No substitution for Sportsbet. Future adapters can implement the same ports. |

## Primary references checked

- https://docs.balldontlie.io/ — tier table, player stats, injuries, pagination and timestamps.
- https://the-odds-api.com/liveapi/guides/v4/ — event odds, event markets, response headers and credit accounting.
- https://the-odds-api.com/ — published plans; not an account-specific quota check.
- https://the-odds-api.com/sports/nbl-odds — current documented NBL prop capability and Sportsbet examples, not a live quote.
- https://the-odds-api.com/terms-and-conditions.html — provider states analytical, storage and derived-value uses are permitted; no raw-feed resale.
- https://the-odds-api.com/sports-odds-data/betting-markets.html — market availability is sport/bookmaker specific.
- https://github.com/swar/nba_api — client coverage and operational caveats, not a licence to NBA data.
- https://www.nba.com/termsofuse — upstream restrictions; permitted production use unresolved.
- https://www.nbl.com.au/pages/stats-hub — official public statistics presentation.
- https://hoopr.sportsdataverse.org/reference/ — Rosetta wrapper capability, not provider permission.
- https://docs.bluebubbles.app/server/developer-guides/rest-api-and-webhooks — REST transport; implementation cross-checks server source.
- https://hermes-agent.nousresearch.com/docs/user-guide/messaging/bluebubbles — optional gateway.

## Completeness and operational conclusions

Current genuine NBA player logs in this repository: **0**. Current genuine NBL player logs: **0**. Verified current roster/availability records: **0**. Live Sportsbet prices verified by this project: **0**. These remain missing, not zero-valued statistics. Offline synthetic data is explicitly isolated.

V6's 11 November audit retained 191 player-games for ONE player from 2022–2024, not current coverage. Its challenger lost to smoothed empirical scores (Brier .1333596631 vs .1295681240; log loss .4351235595 vs .4081881439). This rebuild does not import or promote it. V6 observed NBA Sportsbet points markets, but did not verify player identities/rules; that historical observation does not establish current service coverage.

Default new-project network allowance is zero. With 500 monthly credits, reserve 100 and four markets/one bookmaker, at most floor(400/4)=100 full event requests/month, including revalidation, before other credit costs. At three full polls per event this is at most 33 event investigations/month; it cannot support league-wide minute polling. Cached event discovery is documented zero-credit; local request attempts still have daily limits. Each attempted request reserves its maximum cost before transport and is not refunded on timeout. Account header limits can further restrict this ceiling. If another application shares the key, use a single external quota authority; this project must not share V6's key.

The attempted NBL terms-page fetch was inaccessible through the browsing tool; no inference of automation permission was made. BlueBubbles REST fields and millisecond delivery timestamps were cross-checked against its official server validator/router/serializer source, not assumed from submission success.

No API account uptime, current paid entitlement, historical completeness or permission is asserted from documentation. Audit CLI reports configured/blocked states without sending messages or spending credits. See `handoff.md` for activation steps.
