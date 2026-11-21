# Bounded BDL history backfill for EdgeLab Signals

For NBA-wide acquisition, prefer the [league-wide collection commands](nba-collection-and-live-research.md), which use season/date/cursor filters without player lists and share historical fixture coverage. The original selected-player helper below remains supported with its existing bounds.

This optional helper reuses the existing `BDLProvider.stats`, `JsonHTTP` request reservations, retained receipts, per-scope resumable checkpoints and SQLite evidence store. It does **not** connect to SportsModel/V6, send iMessages, place bets, change API allowances, obtain a subscription or assert that live data has been acquired.

## Before any execution

- Independently obtain and review a permitted BALLDONTLIE NBA ALL-STAR/GOAT account, including intended private research use. Free does not supply player game statistics.
- Prepare `config/local.json` and `.env.local` with `chmod 600`. Use a **dedicated** key, not SportsModel's key. No secrets in Git or chat.
- Set `networkEnabled: true`, `deliveryEnabled: false` and a positive **finite** BDL daily allowance/cooldown matching the account. Keep the Odds API provider disabled until independently configured.
- Confirm exact native BDL player IDs from a permitted source. This command does not infer roster identity or availability.
- Use Node 24 and `npm ci` / `npm run verify` first. Keep the original Signals worker stopped when performing an initial controlled backfill.

## Dry run (zero network)

```sh
node scripts/bdl-backfill.mjs 123,456 2026-10-01 2026-10-07 --max-pages 2
```

IDs here are syntax examples, **not validated real player IDs**. Dry run does not read private config, load `.env.local`, start an ingestion subprocess or reserve credits. Duplicate option flags are rejected. Each request window must be 1–31 days and contain 1–20 distinct native IDs. `--max-pages` is an upper bound of 1–8 pages; a page may be fixture metadata or player statistics. A page cap is not a data-completeness claim.

## Explicit, bounded execution

Only after independent authorisation and configuration:

```sh
node scripts/bdl-backfill.mjs ACTUAL_PLAYER_IDS 2026-10-01 2026-10-07 --max-pages 2 --execute
```

Execution loads owner-only `.env.local` before validating the effective config and pins that config/environment for its child processes. Existing shell environment variables retain precedence. Config changes between pages stop the run for review.

The helper uses the original CLI (`src/cli.ts ingest`) one retained/cached provider page at a time. It observes the configured cooldown, refuses oversized execution, and stops on errors without an automatic retry. The underlying provider reservation counts and provider headers remain authoritative. Repeating a historical scope uses its saved cursor/complete checkpoint; recheck account quota before each additional run.

After ingestion, use `npm run research -- audit` to confirm **genuine** counts and missing fields; source receipts are original and cannot be backdated. To create a dataset, document the actual authorised licence/contract reference, then:

```sh
npm run research -- snapshot 'YOUR_ACTUAL_PERMITTED_LICENSE_REFERENCE'
npm run research -- benchmark .local/datasets/EXACT_HASH.json retrospective
```

The retrospective experiment is **research-only**. Ingesting historical outcomes today cannot magically establish what was known before past games, and it cannot satisfy the genuine as-of/promoted-alert evidence gate. Build the forward observation archive separately. Player roster/positive participation, bookmaker terms and actual Sportsbet player props still require independently verified sources. No real notifications should be enabled until those gates pass.

## Failure behaviour

No automatic retry after an API/transport/entitlement/quota exception. Successful earlier page receipts and checkpoints remain. Sleep or interrupted execution cannot backdate old observations. Manual resume occurs only after checking allowance and access. Never copy an old V6 quota file into Signals.
