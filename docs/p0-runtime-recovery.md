# P0 runtime recovery — 25 November 2026

Owner authority: P0 recovery prompt attached 25 November. Operational repair only; statistical files, protocol, source/qualification/exposure policy and BAU boundary remain frozen.

The hourly trial review and engineering report previously materialised every large prediction revision using all().map(JSON.parse), twice during the review. A detached snapshot with 4,801 revisions and 1,340 primary registrations reached approximately 777 MB heap / 946 MB RSS under the original 768 MiB limit, before accounting for the active forecaster. Repaired readers stream metadata, count revisions, and decode only first registrations. Primary body hashes remain verified; untouched refresh bodies remain in the immutable journal. They are not redundantly decoded by primary-cohort reports.

The M1 startup now waits on a valid incumbent lease rather than exiting and causing repeated LaunchAgent launches. Shutdown during that wait preserves the incumbent. Other errors still propagate. An optional operational repair pin verifies both the unchanged protocol's original release hash and the new worker release hash; it does not change the trial marker, model or routing. Heartbeats distinguish actual worker code from original protocol code.

Regression coverage checks refresh exclusion, revision counts, scope filtering, primary hash corruption, lease contention, shutdown and unexpected failures. npm run verify passed TypeScript, 419 tests and production build. Detached repeat-review evidence is private under .local/p0-recovery-20261125 in the repository root.

Production containment: only com.edgelab.signals.m1-trial was booted out at approximately 17:59 AEDT after confirming PID 84079 and 184 LaunchAgent runs. No lease was deleted or invalidated. Market, research and comparator services were left running. This source commit is not itself deployment evidence.

Outstanding: complete repeated-memory validation; independently test operational pin migration; produce immutable release and guarded service-only cutover, fresh backups and 165 awake seconds plus repeated live cycles; repair future market-stage coordination/fairness and diagnostic subprocess observability; verify grading catch-up. Four-book acquisition must remain OFF until stability and all finite-grant, source, settlement and quota checks pass. No new paid request was made during this milestone. Do not call the interrupted BAU window clean.
