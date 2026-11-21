# EdgeLab Signals

Standalone NBA/NBL player-prop research, automatic recommendation history and direct iMessage notification infrastructure. No bookmaker execution or manual betting workflow.

**Current state (V1.1):** research comparison, genuine captured-page import, immutable datasets, competing model/calibration/monitoring infrastructure and a working local engineering implementation with a labelled synthetic end-to-end demonstration. Live data acquisition and real delivery are disabled. No independent provider access is configured; genuine NBA/NBL model accuracy and current Sportsbet coverage are not yet established. The old SportsModel application and its services were not changed.

Requires **Node 24**.

```sh
npm ci
npm run verify
npm run demo
npm run dev
```

Dashboard: `http://127.0.0.1:3000` — Opportunities, Performance and System Status. The default genuine database starts empty. To view the demonstration, set `EDGELAB_DB` to the isolated database printed by `npm run demo` before starting the web server. Synthetic records are visibly labelled and cannot enter live delivery.

```sh
npm run audit                 # local status, no source requests
npm run signals -- help       # ingestion, evaluation, scanner and relay commands
npm run worker                # headless process; disabled defaults spend nothing
```

The worker, SQLite evidence store and BlueBubbles adapter operate independently of the web server. Private config and secrets remain ignored. Nothing is installed as a persistent service automatically.

- [V1.1 evaluation, actual results and source blockers](docs/v11-model-evaluation.md)
- [V1.1 research comparison](docs/v11-model-research-comparison.md)
- [V1.1 provider findings](docs/v11-data-provider-findings.md)
- [Original V1 handoff](docs/handoff.md)
- [Actual source feasibility audit](docs/source-capabilities.md)
- [Operating guide and safe V6 retirement](docs/operations.md)
- [Architecture and host migration](docs/architecture.md)
- [Statistical methodology and validation gates](docs/methodology.md)

The project is prepared for publication with a lockfile and CI workflow. No remote repository, deployment, subscription, trial or real test message has been created.
