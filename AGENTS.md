# EdgeLab Signals

This is the independent NBA/NBL player-prop research project. Work only in this repository. SportsModel is a separate application: never change its files, workers, credentials, quota counters, schedules, or services from a Signals task.

- Node 24, TypeScript, SQLite and Next.js. Run `npm run verify` after material code changes.
- Network acquisition and real delivery default off. No trials, purchases, credential borrowing, bookmaker execution, or automated test sends.
- Preserve all issued recommendations and original inputs. Provider corrections append grading revisions. Unknown values stay null. Exact IDs and original market timestamps are mandatory.
- Synthetic data belongs only in isolated demo/test databases. Never promote synthetic or retrospective-only validation into live use.
- No account balances, deposits, stake controls, owner acceptance flows or wagering simulators. One unit is only an analytical measure per issued recommendation.
- Read `docs/handoff.md`, `docs/source-capabilities.md`, and `docs/operations.md` before enabling a new source or service. Configuration of an existing permitted source and finite allowance authorizes autonomous cycles within that scope; no per-signal approval is required.
- Keep `.local`, `.env*` (except `.env.example`) and `config/local.json` private and out of Git. Do not publish a data directory or private config in a build artifact.
- Default dashboard is loopback-only. Hosting or remote exposure needs authentication and a host-specific storage deployment. Do not deploy the local SQLite dashboard unchanged as a public site.
