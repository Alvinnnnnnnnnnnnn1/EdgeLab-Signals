# Statistical research methodology

All implementations are experimental until a genuine, permitted dataset passes chronological evaluation. This rebuild does not adopt V6's underperforming one-player points model. No LLM generates the probabilities or message text.

## Candidate distributions

Each of points, rebounds, assists and made threes is fitted separately. NBA and NBL have separate records, priors, thresholds and validation manifests. The fixed research priors in `models.ts` are declared methodological parameters, not measured current league averages.

1. **Historical baseline:** observed per-game count distribution with five broad prior pseudo-games. This is the benchmark every challenger must meet on held-out data.
2. **Minutes bootstrap:** paired historical per-minute production, scaled to expected minutes; a three-point minutes mixture captures the supplied uncertainty. Small integer smoothing and five prior pseudo-games regularise sparse counts. The exact mixture is evaluated deterministically, avoiding simulation noise.
3. **Gamma–Poisson / negative-binomial:** regularised production rate with 240 minutes of prior exposure, a shrunk overdispersion estimate, and a minutes mixture. A Poisson limiting case is implemented and tested. Tail mass is checked before normalising; incomplete distributions fail.

History uses up to 120 prior complete participating games, requires at least 30 by default, excludes missing stat/minutes fields and deduplicates player/event revisions. A player must have at least five games in the current source season and a completed game within 30 days. Recent minutes determine the chronological evaluation's future-minutes estimate; production uses the declared regularised historical window. No unverified pace, usage, teammate absence, role or opponent feature is filled with zero.

Live positive availability and verified roster membership are mandatory. Expected minutes and its uncertainty must be supplied by a permitted evidence integration; low minutes or SD above six fail the default screen. Verified role notes are preserved. Opponent/home factors have schema support, but live use is blocked because the current validation harness does not validate those extra features. Incomplete injury coverage does not turn an unknown player into available.

## Validation and activation

Use `npm run signals -- evaluate as-of`. Each target uses only earlier games and observations known before tip-off. An earlier 60% date block selects the candidate; the later block scores it without refitting model choices to that block. Thresholds are fixed separately per league/market. The report includes Brier, log loss, calibration bins, unique player-games, players and dates. Correlated thresholds are never counted as extra independent player-games.

The live eligibility rule requires genuine as-of evidence, at least 200 held-out player-games, ten players and 30 dates, and held-out Brier/log loss no worse than the simple baseline. Equal benchmark performance can justify using the historical candidate; it does not establish bookmaker-relative edge. This is an initial conservative engineering screen, not proof of calibration or profit. Further independent prospective evaluation remains necessary.

The report and manifest are content bound; changing league, market, version or report bytes breaks loading. A separate dated report is written to `.local/evaluations/`. Set `validationFile` to a complete report array only after reviewing the genuine evidence. No synthetic report, test fixture or retrospective-only report can qualify live. No model is currently live eligible.

`evaluate retrospective` orders historical results by fixture date and excludes same-day data. It explicitly cannot prove historical publication or correction availability. It is useful for exploratory scoring and cannot activate notifications. No fabricated historical bookmaker prices or returns are computed.

## Opportunity screen

For win probability p, push probability q and decimal odds d:

- Estimated unit return = p × d + q − 1.
- Ordinary bookmaker break-even = 1 / d; for a pushing market, unconditional required win probability is (1 − q) / d.
- Fair decimal odds = (1 − q) / p.

A default research candidate needs estimated EV at least 6%, stressed EV at least 1%, probability within 15–85%, and bootstrap/negative-binomial win-probability disagreement no greater than 12 percentage points. The stress takes minutes in both directions and subtracts an approximate sampling penalty. This is a robustness diagnostic, not a calibrated confidence interval or a guarantee of profit.

Exact original bookmaker terms must explicitly support full-game overtime, integer pushes and DNP voiding for the league/market. Unknown terms stay unsupported. Alternative milestones and combinations are excluded until their coverage, settlement rules and dependence models are implemented and evaluated. For future PRA, use paired multivariate player-game sampling or a validated joint count model; never multiply independent component probabilities.

Signals are ranked by stressed EV. There is no quota of recommendations per day. Dedupe includes league, event, player, prop, numerical line, side and bookmaker. A same-family update needs a later quote, at least 15 minutes and a change of one line unit or 0.10 decimal price. An unchanged poll creates no new signal. Opposite-side same-family recommendations are suppressed. Every issued update is retained and reported as a correlated recommendation with its original price and one analytical unit.

## Track record

Only issued recommendations are counted. The system records all outcomes, including losses, pushes, voids and corrections. One hypothetical unit is the fixed analytical denominator; there is no owner stake or account model. Probability scoring on decisive selections conditions on no push. Outcomes in the same fixture and market updates remain correlated; the dashboard shows event clusters and update counts. No result from the synthetic demonstration is evidence of predictive accuracy.
